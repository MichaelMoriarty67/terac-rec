import { Room, LocalVideoTrack, Track } from 'livekit-client'

const chunkMsInterval: number = 5000

let recorder: MediaRecorder | null = null
let stream: MediaStream | null = null
let intervalId: ReturnType<typeof setInterval> | null = null
let pendingChunks: number = 0
let room: Room | null = null
let videoTrack: LocalVideoTrack | null = null

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

window.electronAPI.onStartRecording(async (_, screen: string, livekitUrl: string, livekitToken: string) => {
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

    // Start local chunking
    startNewRecorder()
    intervalId = setInterval(() => recorder?.stop(), chunkMsInterval)

    // Stream to LiveKit simultaneously
    room = new Room()
    room.prepareConnection(livekitUrl, livekitToken);
    await room.connect(livekitUrl, livekitToken)

    const mediaStreamTrack = stream.getVideoTracks()[0]!
    videoTrack = new LocalVideoTrack(mediaStreamTrack)
    await room.localParticipant.publishTrack(videoTrack, {
        source: Track.Source.ScreenShare,
    })

    console.log('recording locally and streaming to livekit...')
})

window.electronAPI.onStopRecording(async () => {
    if (!recorder) return

    // Stop LiveKit stream
    if (videoTrack) {
        await room?.localParticipant.unpublishTrack(videoTrack)
        videoTrack.stop()
        videoTrack = null
    }
    await room?.disconnect()
    room = null

    // Stop local chunking
    clearInterval(intervalId!)
    intervalId = null
    recorder.stop()
})

window.electronAPI.liveKitToggle(async (_, upload: boolean) => {
    if (!videoTrack) return
    
    if (upload) {
        await room?.localParticipant.publishTrack(videoTrack, { source: Track.Source.ScreenShare })
    } else {
        await room?.localParticipant.unpublishTrack(videoTrack, false)
    }
})