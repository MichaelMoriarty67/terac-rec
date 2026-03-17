declare global {
    interface Window {
        electronAPI: {
            onStartRecording: (callback: (event: unknown, screen: string, upload: boolean) => void) => void
            onStopRecording: (callback: (event: unknown) => void) => void
            sendVideoChunk: (buffer: ArrayBuffer, start_ts: number) => void
            sendVideoReady: () => void
            liveKitToggle: (callback: (event: unknown, upload: boolean) => void) => void
            startRendererRoom: (callback: (event: unknown, liveKitUrl: string, livekitToken: string) => void) => void
            rendererRoomReady: () => void
            cleanup: (callback: (event: unknown) => void) => void
        }
    }
}

export {}