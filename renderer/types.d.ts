declare global {
    interface Window {
        electronAPI: {
            onStartRecording: (callback: (event: unknown, screen: string) => void) => void
            onStopRecording: (callback: (event: unknown) => void) => void
            sendVideoChunk: (buffer: ArrayBuffer, start_ts: number) => void
            sendVideoReady: () => void
        }
    }
}

export {}