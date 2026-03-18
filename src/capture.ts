import path from 'path'
import { spawn, ChildProcess } from 'child_process'
import { app, desktopCapturer, screen } from 'electron'
import { recFallbackDir } from './config'

let captureProcess: ChildProcess | null = null
let _onAudioData: ((chunk: Buffer) => void) | null = null

const binaryPath = app.isPackaged
    ? path.join(process.resourcesPath, 'ScreenCapture')
    : path.join(__dirname, '../resources/ScreenCapture')


// callback fn for handling audio chunks
// will pass this to livekit recorder
export function setAudioDataHandler(cb: ((chunk: Buffer) => void) | null) {
    _onAudioData = cb
}

export function startAudioRecording(timestamp: number): void {
    captureProcess = spawn(binaryPath, [
    '--timestamp', timestamp.toString(),
    '--output-dir', recFallbackDir
])

    captureProcess.stderr?.on('data', (data: Buffer) => {
        console.error('Swift stderr:', data.toString())
    })

    captureProcess.stdout?.on('data', (chunk: Buffer) => {
        _onAudioData?.(chunk)
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

export function rotateAudioChunk(): void {
    if (!captureProcess) return
    captureProcess.stdin?.write('rotate\n')
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

