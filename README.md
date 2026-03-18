# Terac Desktop Recording App
## Table of Contents
- [Terac Desktop Recording App](#terac-desktop-recording-app)
  - [Table of Contents](#table-of-contents)
  - [Architecture Overview \& Key Decision](#architecture-overview--key-decision)
    - [Audio Stream Flow](#audio-stream-flow)
    - [Video Stream Flow](#video-stream-flow)
    - [Other](#other)
  - [Setup, Run, \& Build Instructions](#setup-run--build-instructions)
    - [Setup](#setup)
    - [Run](#run)
    - [Build](#build)
  - [Distribution](#distribution)
  - [Limitations \& Improvements](#limitations--improvements)

## Architecture Overview & Key Decision
The biggest challenge building this app was unifying recording & saving of system audio and screen video. 

For audio, I decided to use ScreenCaptureKit in swift. I opted against using BlackHole because using it would require the user to accept a dialogue saying 'this app wants to download something onto your computer'. Even thought this is a prototype, requiring a user to download some random stuff is terrible UX imo, so I decided that route was not an option. In order to run ScreenCaptureKit, my swift code gets compiled into a binary. The electron app then spawns a process that runs the binary and communciates with it over stdin/stdout.

For video, I originally thought about streaming both the video and audio over stdout but after some research it looked like this would be super CPU intensive. I opted to seperate the audio and video recording and make use of electrons build in chromium instances in the render process for screen recording. This was not only much simpler setup (`navigator.mediaDevices.getUserMedia` + `MediaRecorder` APIs) but also should be less CPU intensive.

In order to communicate between electrons main process and render process I used Electrons InterCommunciationProtocol.

For local recording backups, I have the swift process write audio chunks directly to the configured output directory. The render process sends video in chunks back to the main process that also writes it to the configured dir. When recording is stopped, my app uses an npm package called `ffmpeg-static` that contains a packageable `ffmpeg` binary to align and combine the audio / video chunks.

### Audio Stream Flow
```ScreenCaptureKit (Swift binary) -> raw audio to stdout -> electron main process -> livekit/rtc-node```

### Video Stream Flow
```electron render process -> getDisplayMedia browser api -> livekit-client```

### Other
This app is fully typescript, both the render and main process are written in it. Since you can't just pass .ts files into the render process, I use `esbuild` to transpile the typescript into ESM Javascript that the browser can run.

## Setup, Run, & Build Instructions

> **Note:** This app is built to work on Apple Silicon Macs only. No other platforms have been tested.

### Setup

1. Clone this repo
2. Make sure you have Node installed
3. Run `npm i` in the root of this project

**LiveKit Tokens** (optional — the tokens already in `./src/config.ts` are valid for 30 days)

If you want to create your own tokens:

1. Install the LiveKit CLI: `brew install livekit-cli`
2. Create a [LiveKit Cloud](https://cloud.livekit.io) account and set up a project
3. Run the following to generate 3 tokens — one each for the main process, renderer process, and browser:
```bash
lk token create --join --room test_room --identity browser --valid-for 720h && \
lk token create --join --room test_room --identity main --valid-for 720h && \
lk token create --join --room test_room --identity renderer --valid-for 720h
```
4. Add the tokens and your LiveKit project URL to `./src/config.ts`

**LiveKit Meets Browser App**

You'll need to open the [LiveKit Meets browser app](https://meet.livekit.io/) with your project URL and browser token to view the stream. Alternatively, use the pre-made token & my project url below which is valid for 30 days:

**Project Url:**
`wss://terac-test-luzsolx8.livekit.cloud`

**Token:**
`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3NzYzOTM4MzEsImlkZW50aXR5IjoiYnJvd3NlciIsImlzcyI6IkFQSW9SRzY5QUdEeWFNZyIsIm5hbWUiOiJicm93c2VyIiwibmJmIjoxNzczODAxODMxLCJzdWIiOiJicm93c2VyIiwidmlkZW8iOnsicm9vbSI6InRlc3Rfcm9vbSIsInJvb21Kb2luIjp0cnVlfX0.Rkhyhr-xTqsUnsZ_3H_O4n_qr13KuLOpiGdlHjX_a8U`
   
### Run
To run the dev version of this app, run `npm run dev`. This will launch the electron app.

### Build
To build the app using `electron-builder` and make it an actual mac .app application, run `npm run build`. Your app will be available in the folder `./dist/mac-arm64/` and is called `terac-screen-rec`.

## Distribution
Since no apple developer account was used to notorize this build, mac will act funny towards the app if its distributed to another machine.

If you want to distribute the app, make sure that:
1) Before you open the app for the first time on the new machine, run `xattr -cr /Applications/YourApp.app` in the terminal, replacing `/Application/YourApp.app` with the actual path to your app. This will remove Mac's blacklists on running the app.
2) When you first open the app, right click the app, then click 'Open' isntead of double clicking it.


## Limitations & Improvements
1) During testing, the audio & video quality in the livekit meets app is not as high as in the recorded backups. I am not sure if this is a livekit displaying limitation, or if there is a way to improve the quality of the streams.
2) Currently you can't change what monitor you're recording without stopping recording, switching the monitor in the app menu bar, and starting recording again. With more time, I would add this feature.
3) Right now two users have to join the livekit room since I'm streaming audio from the main process and video from the render process. With more time I would just use IPC to send the raw audio chunks to the renderer process and have it also manage the audio publishing to livekit.