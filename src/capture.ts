import path from 'path'
import { spawn, ChildProcess } from 'child_process'

import { app, desktopCapturer, screen } from 'electron'

let captureProcess: ChildProcess | null = null

const binaryPath = app.isPackaged
    ? path.join(process.resourcesPath, 'ScreenCapture')
    : path.join(__dirname, '../resources/ScreenCapture')

export function startAudioRecording(timestamp: number): void {
    console.log("Binary path: ", binaryPath)
    captureProcess = spawn(binaryPath, ['--timestamp', timestamp.toString()])
    console.log('Swift process spawned, PID:', captureProcess.pid)

    captureProcess.stderr?.on('data', (data: Buffer) => {
        console.error('Swift stderr:', data.toString())
    })

    captureProcess.on('close', (code, signal) => {
        console.log('Swift process exited with code:', code, 'signal:', signal)
    })
}

export function stopAudioRecording(): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!captureProcess) return reject('No recording in progress')

        captureProcess.once('close', () => {
            captureProcess = null
            resolve()
        })

        // tell swift process to stop recording
        captureProcess.kill('SIGINT')
    })
}

export async function getSources() {
    const sources = await desktopCapturer.getSources({ types: ['screen']})
    
    return sources
}

// get display size using Screen api display ids
export function getDisplaySize(displayId: string): { width: number, height: number } {
  const display = screen.getAllDisplays().find(d => String(d.id) === displayId);
  
  if (!display) throw new Error(`No display found for source ${displayId}`);
  
  return display.size;
}

