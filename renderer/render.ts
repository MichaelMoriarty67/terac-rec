let recorder: MediaRecorder | null = null;
const chunks: Blob[] = []

window.electronAPI.onStartRecording((_, screen: string) => {
    console.log("recording started...")
    // using any type because getUserMedia doesn't know about
    // Electrons mandatory contraint
    const getUserMediaOptions: any = {
        audio: false,
        video: {
            mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: screen
            }
        }
    }

    navigator.mediaDevices.getUserMedia(getUserMediaOptions).then((stream: MediaStream) => {
        const options = { mimeType: 'video/webm; codecs=vp9'}
        recorder = new MediaRecorder(stream, options)

        recorder.ondataavailable = handleStartMediaStream
        recorder.onstop = handleStopMediaStream

        recorder.start()
    })
})

function handleStartMediaStream(e: BlobEvent){
    if (chunks.length == 0) console.log("starting rec")
    chunks.push(e.data)
}

async function handleStopMediaStream(e: Event){
    console.log("stopping rec")
    // package the array of Blobs as an mp4 file
    const blob = new Blob(chunks, {
        type:'video/webm; codecs=vp9'
    })

    const buf = await blob.arrayBuffer()

    // send buf back to main process
    window.electronAPI.sendVideoReady(buf)
}

window.electronAPI.onStopRecording(() => {
    recorder?.stop()
})