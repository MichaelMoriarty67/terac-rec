import { Room, LocalVideoTrack, Track } from 'livekit-client'

const chunkMsInterval: number = 5000

let recorder: MediaRecorder | null = null
let stream: MediaStream | null = null
let intervalId: ReturnType<typeof setInterval> | null = null
let pendingChunks: number = 0
let room: Room | null = null
let videoTrack: LocalVideoTrack | null = null

function connectRoomRetry(url: string, token: string): Promise<Room> {
    return new Promise((resolve) => {
        const attempt = async () => {
            try {
                const room = new Room()
                room.prepareConnection(url, token);
                await room.connect(url, token)

                resolve(room)
            } catch {
                setTimeout(attempt, 5000)
            }
        }

        attempt()
    })
}

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

window.electronAPI.startRendererRoom((_, livekitUrl: string, livekitToken: string) => {
    connectRoomRetry(livekitUrl, livekitToken).then((r: Room) => {
        room = r
        window.electronAPI.rendererRoomReady()
    })
})

window.electronAPI.onStartRecording(async (_, screen: string, upload: boolean) => {
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

    const mediaStreamTrack = stream.getVideoTracks()[0]!
    videoTrack = new LocalVideoTrack(mediaStreamTrack)
    
    // Stream to LiveKit if room has been started
    // and upload is configured in main process
    if (room && upload) {
        await room.localParticipant.publishTrack(videoTrack, {
            source: Track.Source.ScreenShare,
        })
    }
})

window.electronAPI.onStopRecording(async () => {
    if (!recorder) return

    // Stop LiveKit stream
    if (videoTrack) {
        await room?.localParticipant.unpublishTrack(videoTrack, false)
        videoTrack.stop()
        videoTrack = null
    }

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

window.electronAPI.cleanup(async () => {
    if (videoTrack) {
        await room?.localParticipant.unpublishTrack(videoTrack)
        videoTrack.stop()
    }

    room?.disconnect()
})