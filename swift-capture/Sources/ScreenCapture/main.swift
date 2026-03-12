import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

let outputPath = "/tmp/audio.m4a"
let outputURL = URL(fileURLWithPath: outputPath)

try? FileManager.default.removeItem(at: outputURL)

let writer = try AVAssetWriter(outputURL: outputURL, fileType: .m4a)

final class Capturer: NSObject, SCStreamDelegate, SCStreamOutput {
    let writer: AVAssetWriter
    nonisolated(unsafe) var audioInput: AVAssetWriterInput?
    nonisolated(unsafe) var stream: SCStream?
    nonisolated(unsafe) var started = false
    nonisolated(unsafe) var writerStarted = false

    init(writer: AVAssetWriter) {
        self.writer = writer
    }

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
        fputs("Audio capture started\n", stderr)
    }

    @MainActor
    func stop() async throws {
        fputs("Stopping capture...\n", stderr)
        try await stream?.stopCapture()
        audioInput?.markAsFinished()
        await writer.finishWriting()
        fputs("Writer status: \(writer.status.rawValue)\n", stderr)
        if let error = writer.error {
            fputs("Writer error: \(error)\n", stderr)
        }
        print(outputPath)
        fflush(stdout)
    }

    func stream(
        _ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .audio else { return }

        if audioInput == nil {
            guard let formatDesc = CMSampleBufferGetFormatDescription(buffer) else { return }

            let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc)?.pointee
            let sampleRate = asbd?.mSampleRate ?? 48000
            let channels = asbd?.mChannelsPerFrame ?? 2
            fputs("Audio format: \(sampleRate)Hz, \(channels)ch\n", stderr)

            let aInput = AVAssetWriterInput(
                mediaType: .audio,
                outputSettings: [
                    AVFormatIDKey: kAudioFormatMPEG4AAC,
                    AVSampleRateKey: sampleRate,
                    AVNumberOfChannelsKey: channels,
                ],
                sourceFormatHint: formatDesc
            )
            aInput.expectsMediaDataInRealTime = true
            guard writer.canAdd(aInput) else {
                fputs("Cannot add audio input\n", stderr)
                return
            }
            writer.add(aInput)
            audioInput = aInput
            writer.startWriting()
            writerStarted = true
            fputs("Writer started\n", stderr)
        }

        guard writerStarted else { return }

        if !started {
            writer.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(buffer))
            started = true
        }

        if audioInput?.isReadyForMoreMediaData == true {
            audioInput?.append(buffer)
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        fputs("Stream error: \(error)\n", stderr)
        exit(1)
    }
}

let capturer = Capturer(writer: writer)

Task { @MainActor in
    do {
        try await capturer.start()
    } catch {
        fputs("Failed to start: \(error)\n", stderr)
        exit(1)
    }
}

signal(SIGTERM) { _ in
    Task { @MainActor in
        try? await capturer.stop()
        exit(0)
    }
}

RunLoop.main.run()
