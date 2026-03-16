import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit
import os

// MARK: - Configuration

let chunkIntervalMs: Int = 5000

let recordingTimestamp: String = {
    if let idx = CommandLine.arguments.firstIndex(of: "--timestamp"),
        idx + 1 < CommandLine.arguments.count
    {
        return CommandLine.arguments[idx + 1]
    }
    fputs("Usage: ScreenCapture --timestamp <ms>\n", stderr)
    exit(1)
}()

let outputDir: String = {
    let dir = FileManager.default
        .homeDirectoryForCurrentUser
        .appendingPathComponent("Documents/Terac/Recordings")
        .path
    try? FileManager.default.createDirectory(
        atPath: dir,
        withIntermediateDirectories: true
    )
    return dir
}()

// MARK: - Helpers

func chunkURL(for index: Int) -> URL {
    URL(fileURLWithPath: "\(outputDir)/\(recordingTimestamp)_\(index).m4a")
}

func makeWriter(for index: Int) throws -> AVAssetWriter {
    let url = chunkURL(for: index)
    try? FileManager.default.removeItem(at: url)
    return try AVAssetWriter(outputURL: url, fileType: .m4a)
}

func makeAudioInput(sourceFormat: CMFormatDescription?) -> AVAssetWriterInput {
    let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 48000,
        AVNumberOfChannelsKey: 2,
        AVEncoderBitRateKey: 128000,
    ]
    let input = AVAssetWriterInput(
        mediaType: .audio,
        outputSettings: settings,
        sourceFormatHint: sourceFormat
    )
    input.expectsMediaDataInRealTime = true
    return input
}

// MARK: - Shared Mutable State

struct AudioState: @unchecked Sendable {
    var writer: AVAssetWriter?
    var audioInput: AVAssetWriterInput?
    var writerStarted: Bool = false
    var chunkCounter: Int = 0
    var formatDescription: CMFormatDescription?
}

// MARK: - Capturer

final class Capturer: NSObject, SCStreamDelegate, SCStreamOutput {
    nonisolated(unsafe) var stream: SCStream?
    nonisolated(unsafe) var chunkTask: Task<Void, Never>?

    let chunkIntervalMs: Int
    let state: OSAllocatedUnfairLock<AudioState>

    init(chunkIntervalMs: Int) throws {
        self.chunkIntervalMs = chunkIntervalMs
        self.state = OSAllocatedUnfairLock(initialState: AudioState())
    }

    // MARK: Start / Stop

    @MainActor
    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(
            false, onScreenWindowsOnly: true)

        guard let display = content.displays.first else {
            fputs("No display found\n", stderr)
            exit(1)
        }

        let filter = SCContentFilter(display: display, excludingWindows: [])

        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.sampleRate = 48000
        config.channelCount = 2

        stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream?.addStreamOutput(self, type: .audio, sampleHandlerQueue: .global())
        try await stream?.startCapture()

        let intervalNs = UInt64(chunkIntervalMs) * 1_000_000
        chunkTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: intervalNs)
                guard !Task.isCancelled else { break }
                await rotateChunk()
            }
        }
    }

    @MainActor
    func stop() async throws {
        chunkTask?.cancel()
        try await stream?.stopCapture()

        let (lastWriter, lastInput, wasStarted) = state.withLockUnchecked { s in
            (s.writer, s.audioInput, s.writerStarted)
        }

        if wasStarted, let lastWriter {
            lastInput?.markAsFinished()
            await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
                lastWriter.finishWriting { cont.resume() }
            }
        }
    }

    // MARK: Chunk Rotation

    private func rotateChunk() async {
        typealias RotateResult = (
            oldWriter: AVAssetWriter,
            oldInput: AVAssetWriterInput?,
            oldCounter: Int
        )

        let result: RotateResult? = state.withLockUnchecked { s in
            guard s.writerStarted, let oldWriter = s.writer else { return nil }

            let oldInput = s.audioInput
            let oldCounter = s.chunkCounter

            s.writer = nil
            s.audioInput = nil
            s.writerStarted = false
            s.chunkCounter = oldCounter + 1

            return (oldWriter, oldInput, oldCounter)
        }

        guard let r = result else { return }

        r.oldInput?.markAsFinished()
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            r.oldWriter.finishWriting { cont.resume() }
        }
    }

    // MARK: SCStreamOutput

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .audio,
            sampleBuffer.isValid,
            CMSampleBufferGetNumSamples(sampleBuffer) > 0
        else { return }

        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let fmt = CMSampleBufferGetFormatDescription(sampleBuffer)

        // Write to file chunks
        state.withLockUnchecked { s in
            if s.formatDescription == nil {
                s.formatDescription = fmt
            }

            if s.writer == nil {
                s.writer = try? makeWriter(for: s.chunkCounter)
            }

            if s.audioInput == nil, let f = s.formatDescription, let writer = s.writer {
                let input = makeAudioInput(sourceFormat: f)
                writer.add(input)
                s.audioInput = input
            }

            guard let writer = s.writer, let input = s.audioInput else { return }

            if !s.writerStarted {
                writer.startWriting()
                writer.startSession(atSourceTime: pts)
                s.writerStarted = true
            }

            if input.isReadyForMoreMediaData {
                input.append(sampleBuffer)
            }
        }

        // Stream raw PCM to stdout for main process
        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return }
        var lengthAtOffset = 0
        var totalLength = 0
        var dataPointer: UnsafeMutablePointer<Int8>? = nil

        guard
            CMBlockBufferGetDataPointer(
                blockBuffer,
                atOffset: 0,
                lengthAtOffsetOut: &lengthAtOffset,
                totalLengthOut: &totalLength,
                dataPointerOut: &dataPointer
            ) == noErr, let ptr = dataPointer
        else { return }

        let data = Data(bytes: ptr, count: totalLength)
        FileHandle.standardOutput.write(data)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        fputs("Stream error: \(error)\n", stderr)
    }
}

// MARK: - Entry Point

nonisolated(unsafe) var shutdownContinuation: CheckedContinuation<Void, Never>?

let capturer = try Capturer(chunkIntervalMs: chunkIntervalMs)

Task { @MainActor in
    do {
        try await capturer.start()

        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            shutdownContinuation = cont
            signal(SIGINT) { _ in
                shutdownContinuation?.resume()
                shutdownContinuation = nil
            }
        }

        try await capturer.stop()
    } catch {
        fputs("Error: \(error)\n", stderr)
        exit(1)
    }
    exit(0)
}

RunLoop.main.run()
