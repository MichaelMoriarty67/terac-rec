import { Room, LocalVideoTrack, Track } from 'livekit-client'

let recorder: MediaRecorder | null = null
let stream: MediaStream | null = null
let pendingChunks: number = 0
let room: Room | null = null
let videoTrack: LocalVideoTrack | null = null
let isFirstChunk: boolean = true
let isRunning: boolean = false

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

        if (!isRunning && pendingChunks === 0) {
            window.electronAPI.sendVideoReady()
        }
    }

    recorder.onstop = () => {
        if (isRunning) {
            startNewRecorder()
        } else if (pendingChunks === 0) {
            window.electronAPI.sendVideoReady()
        }
    }

    recorder.start()
    if (isFirstChunk) {
        window.electronAPI.videoRecordingStarted(Date.now())
        isFirstChunk = false
    }
}

window.electronAPI.startRendererRoom((_, livekitUrl: string, livekitToken: string) => {
    connectRoomRetry(livekitUrl, livekitToken).then((r: Room) => {
        room = r
        window.electronAPI.rendererRoomReady()
    })
})

window.electronAPI.onStartRecording(async (_, screen: string, upload: boolean) => {
    pendingChunks = 0
    isFirstChunk = true
    isRunning = true

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

    // Unpublish livekit video track
    if (videoTrack) {
        await room?.localParticipant.unpublishTrack(videoTrack, false)
        videoTrack.stop()
        videoTrack = null
    }

    isRunning = false
    recorder.stop()
})

window.electronAPI.onRotateChunk(() => {
    if (!isRunning) return
    recorder?.stop()
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