declare global {
    interface Window {
        electronAPI: {
            onStartRecording: (callback: (event: unknown, screen: string) => void) => void
            onStopRecording: (callback: (event: unknown) => void) => void
            sendVideoReady: (buffer: ArrayBuffer) => void
        }
    }
}

export {}