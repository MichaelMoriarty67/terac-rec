import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import { app, desktopCapturer } from 'electron'

let captureProcess: ChildProcess | null = null

const binaryPath = app.isPackaged
    ? path.join(process.resourcesPath, 'ScreenCapture')
    : path.join(__dirname, '../resources/ScreenCapture')

export function startAudioRecording(): void {
    console.log("Binary path: ", binaryPath)
    captureProcess = spawn(binaryPath)
    console.log('Swift process spawned, PID:', captureProcess.pid)

    captureProcess.stderr?.on('data', (data: Buffer) => {
        console.error('Swift stderr:', data.toString())
    })

    captureProcess.on('close', (code, signal) => {
    console.log('Swift process exited with code:', code, 'signal:', signal)
})
}

export function stopAudioRecording(): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!captureProcess) return reject('No recording in progress')

        // Swift prints the file path to stdout when done
        captureProcess.stdout?.once('data', (data: Buffer) => {
            resolve(data.toString().trim()) // resolves with "/tmp/recording.mp4"
        })

        captureProcess.kill('SIGTERM')
    })
}

export async function getSources() {
    const sources = await desktopCapturer.getSources({ types: ['screen']})
    
    return sources
}

