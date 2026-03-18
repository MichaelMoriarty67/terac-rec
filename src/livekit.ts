import {
  Room,
  AudioSource,
  LocalAudioTrack,
  AudioFrame,
  TrackPublishOptions,
  TrackSource
} from '@livekit/rtc-node';

export async function publishAudio(room: Room): Promise<(chunk: Buffer) => void> {
  const sampleRate = 48000
  const channels = 2

  const audioSource = new AudioSource(sampleRate, channels)
  const audioTrack = LocalAudioTrack.createAudioTrack('system-audio', audioSource)

  const publishOptions = new TrackPublishOptions({
    source: TrackSource.SOURCE_SCREENSHARE_AUDIO,
    dtx: false,
    red: false,
    simulcast: false,
})

  await room.localParticipant?.publishTrack(audioTrack, publishOptions)

  // Swift sends 32-bit float PCM, LiveKit expects 16-bit signed int
  // Convert float32 → int16 and push as AudioFrames
  return (chunk: Buffer) => {
    const totalFloats = chunk.byteLength / 4
    const samplesPerChannel = totalFloats / channels
    const int16 = new Int16Array(totalFloats)

    // Deplanar: input is [L L L L ... R R R R]
    // Output must be interleaved: [L R L R L R ...]
    for (let i = 0; i < samplesPerChannel; i++) {
        const l = chunk.readFloatLE(i * 4)
        const r = chunk.readFloatLE((samplesPerChannel + i) * 4)
        int16[i * 2]     = Math.max(-32768, Math.min(32767, Math.round(l * 32767)))
        int16[i * 2 + 1] = Math.max(-32768, Math.min(32767, Math.round(r * 32767)))
    }

    audioSource.captureFrame(new AudioFrame(int16, sampleRate, channels, samplesPerChannel))
}
}

export async function createRoom(url: string, token: string): Promise<Room> {
  const room = new Room();
  await room.connect(url, token, { autoSubscribe: false, dynacast: true });
  return room
}