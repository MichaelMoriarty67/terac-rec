const chunkMsInterval: number = 5000

let recorder: MediaRecorder | null = null
let stream: MediaStream | null = null
let intervalId: ReturnType<typeof setInterval> | null = null
let pendingChunks: number = 0

function startNewRecorder() {
    if (!stream) return

    const options = { mimeType: "video/webm; codecs=vp9" }
    recorder = new MediaRecorder(stream, options)

    recorder.ondataavailable = async (e: BlobEvent) => {
        if (e.data.size === 0) return
        pendingChunks++
        const buf = await e.data.arrayBuffer()
        window.electronAPI.sendVideoChunk(buf, Date.now())
        pendingChunks--

        if (!intervalId && pendingChunks === 0) {
            window.electronAPI.sendVideoReady()
        }
    }

    recorder.onstop = () => {
        if (intervalId) {
            startNewRecorder()
        } else if (pendingChunks === 0) {
            window.electronAPI.sendVideoReady()
        }
    }

    recorder.start()
}

window.electronAPI.onStartRecording(async (_, screen: string) => {
    pendingChunks = 0

    const getUserMediaOptions: any = {
        audio: false,
        video: {
            mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: screen
            }
        }
    }

    stream = await navigator.mediaDevices.getUserMedia(getUserMediaOptions)
    startNewRecorder()

    intervalId = setInterval(() => recorder?.stop(), chunkMsInterval)
})

window.electronAPI.onStopRecording(() => {
    if (!recorder) return
    clearInterval(intervalId!)
    intervalId = null
    recorder.stop()
})