import {
  Room,
  VideoSource,
  LocalVideoTrack,
  dispose,
  VideoBufferType,
  VideoFrame,
  TrackPublishOptions,
  VideoCodec,
} from '@livekit/rtc-node';
import { spawn } from 'child_process';

export async function publishVideo(room: Room, videoPath: string, width: number, height: number): Promise<void> {
  const videoSource = new VideoSource(width, height);
  const videoTrack = LocalVideoTrack.createVideoTrack('my-video', videoSource);

  const publishOptions = new TrackPublishOptions({
    videoCodec: VideoCodec.H264,
    simulcast: false,
  });

  await room.localParticipant?.publishTrack(videoTrack, publishOptions);
  console.log('video track published');

  const frameSize = width * height * 1.5;
  let buffer = Buffer.alloc(0);

  const ffmpeg = spawn('ffmpeg', [
    '-i', videoPath,
    '-f', 'rawvideo',
    '-pix_fmt', 'yuv420p',
    '-vf', `scale=${width}:${height}`,
    'pipe:1',
  ]);

  ffmpeg.stdout.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= frameSize) {
      const frame = buffer.subarray(0, frameSize);
      buffer = buffer.subarray(frameSize);
      videoSource.captureFrame(
        new VideoFrame(
          new Uint8Array(frame),
          width,
          height,
          VideoBufferType.I420,
        ),
        BigInt(Date.now() * 1000),
      );
    }
  });

  ffmpeg.stderr.on('data', (d: Buffer) => console.error('[ffmpeg]', d.toString()));

  return new Promise((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log('video done');
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
}

export async function createRoom(url: string, token: string): Promise<Room> {
  const room = new Room();
  await room.connect(url, token, { autoSubscribe: false, dynacast: true });
  
  return room
}