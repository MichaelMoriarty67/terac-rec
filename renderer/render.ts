let recorder: MediaRecorder | null = null

window.electronAPI.onStartRecording((_, screen: string) => {
    console.log("recording started...")

    const getUserMediaOptions: any = {
        audio: false,
        video: {
            mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: screen
            }
        }
    }

    navigator.mediaDevices.getUserMedia(getUserMediaOptions).then((stream: MediaStream) => {
        const options = { mimeType: "video/webm; codecs=vp9" }
        recorder = new MediaRecorder(stream, options)

        recorder.ondataavailable = async (e: BlobEvent) => {
            if (e.data.size === 0) return

            const ts = Date.now()
            const buf = await e.data.arrayBuffer()

            window.electronAPI.sendVideoChunk(buf, ts)
        }

        recorder.start(10000) // 10 second chunks for testing
    })
})

window.electronAPI.onStopRecording(() => {
    recorder?.stop()
    window.electronAPI.sendVideoReady()
})
