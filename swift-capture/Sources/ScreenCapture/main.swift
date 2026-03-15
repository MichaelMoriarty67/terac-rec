import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit
import os

// MARK: - Configuration

let chunkIntervalMs: Int = 5000
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
    URL(fileURLWithPath: "\(outputDir)/chunk_\(index).m4a")
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
    var writer: AVAssetWriter?  // nil until first sample of each chunk
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
        fputs("Audio capture started — chunk interval: \(chunkIntervalMs) ms\n", stderr)

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
        fputs("Stopping capture...\n", stderr)
        chunkTask?.cancel()
        try await stream?.stopCapture()

        let (lastWriter, lastInput, lastCounter, wasStarted) = state.withLockUnchecked { s in
            (s.writer, s.audioInput, s.chunkCounter, s.writerStarted)
        }

        if wasStarted, let lastWriter {
            lastInput?.markAsFinished()
            await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
                lastWriter.finishWriting { cont.resume() }
            }
            fputs("Final chunk \(lastCounter) written to \(lastWriter.outputURL.path)\n", stderr)
        }
    }

    // MARK: Chunk Rotation

    private func rotateChunk() async {
        typealias RotateResult = (
            oldWriter: AVAssetWriter,
            oldInput: AVAssetWriterInput?,
            oldCounter: Int
        )

        // Snapshot and clear — didOutputSampleBuffer will lazily create the
        // next writer on the first sample that arrives after rotation.
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
        fputs("Chunk \(r.oldCounter) written to \(r.oldWriter.outputURL.path)\n", stderr)
    }

    // MARK: SCStreamOutput

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .audio, sampleBuffer.isValid else { return }

        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let fmt = CMSampleBufferGetFormatDescription(sampleBuffer)

        state.withLockUnchecked { s in
            if s.formatDescription == nil {
                s.formatDescription = fmt
            }

            // Lazily create the writer on the first sample of every chunk.
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
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        fputs("Stream stopped with error: \(error)\n", stderr)
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
