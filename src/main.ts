import os from 'os'
import path from 'path'
import * as fs from 'fs'
import { app, BrowserWindow, ipcMain, IpcMainEvent, Menu, Tray, nativeImage, DesktopCapturerSource } from 'electron'
import { Room } from '@livekit/rtc-node'

import { getSources, getDisplaySize, startAudioRecording, stopAudioRecording, setAudioDataHandler } from './capture'
import { recFallbackDir, roomUrl, mainRoomToken, rendererRoomToken } from './config'
import { createRoom, publishAudio } from './livekit'
import { mergeAudioVideo } from './merge'


let hiddenWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isRecording = false
let screens: DesktopCapturerSource[] = []
let currScreen: DesktopCapturerSource | null = null
let liveKitUpload: boolean = false
let publishAudioCallback = (chunk: Buffer<ArrayBufferLike>) => {}
let recTimestamp: number | null = null
let segmentCounter: number = 0
let liveKitRoom: Room | null = null

const redIcon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAACTSURBVHgBpZKBCYAgEEV/TeAIjuIIbdQIuUGt0CS1gW1iZ2jIVaTnhw+Cvs8/OYDJA4Y8kR3ZR2/kmazxJbpUEfQ/Dm/UG7wVwHkjlQdMFfDdJMFaACebnjJGyDWgcnZu1/lrCrl6NCoEHJBrDwEr5NrT6ko/UV8xdLAC2N49mlc5CylpYh8wCwqrvbBGLoKGvz8Bfq0QPWEUo/EAAAAASUVORK5CYII=')
const greenIcon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAACOSURBVHgBpZLRDYAgEEOrEzgCozCCGzkCbKArOIlugJvgoRAUNcLRpvGH19TkgFQWkqIohhK8UEaKwKcsOg/+WR1vX+AlA74u6q4FqgCOSzwsGHCwbKliAF89Cv89tWmOT4VaVMoVbOBrdQUz+FrD6XItzh4LzYB1HFJ9yrEkZ4l+wvcid9pTssh4UKbPd+4vED2Nd54iAAAAAElFTkSuQmCC')

if (!fs.existsSync(recFallbackDir)) {
    fs.mkdirSync(recFallbackDir, {recursive: true})
}

function buildContextMenu() {
    return Menu.buildFromTemplate([
        {
            label: 'Start Recording',
            type: 'normal',
            icon: greenIcon,
            click: async (menuItem) => {
                isRecording = !isRecording
                menuItem.label = isRecording ? 'Stop Recording' : 'Start Recording'
                menuItem.icon = isRecording ? redIcon : greenIcon

                if (isRecording){
                    // setup trackers and dirs for recording
                    recTimestamp = Date.now()
                    segmentCounter = 0

                    // start audio and video recording
                    startAudioRecording(recTimestamp)
                    hiddenWindow?.webContents.send('start-recording', screens[0]?.id, roomUrl, rendererRoomToken)
                } else {
                    await stopAudioRecording()
                    hiddenWindow?.webContents.send('stop-recording')
                }
            }
        },
        {
            label: 'Select Screen',
            type: 'submenu',
            submenu: screens.map((screen, i) => {
                return {
                    label: screen.name,
                    type: 'radio',
                    checked: i === 0 ? true : false,
                    click: () => {
                        currScreen = screen
                    }
                }
            })
        },
        {
            label: 'Upload to LiveKit',
            type: 'checkbox',
            checked: liveKitUpload,
            enabled: liveKitRoom ? true : false,
            click: (menuItem) => {
                liveKitUpload = menuItem.checked
                if (!liveKitUpload) {
                    setAudioDataHandler((chunk: Buffer<ArrayBufferLike>) => {})
                    hiddenWindow?.webContents.send('livekit-toggle', liveKitUpload)
                } else {
                    setAudioDataHandler(publishAudioCallback)
                    hiddenWindow?.webContents.send('livekit-toggle', liveKitUpload)
                }

            }
            
        },
        {
            label: 'Quit',
            role: 'quit'
        }
    ])
}

function connectWithRetry(url: string, token: string, intervalMs: number = 5000): Promise<Room> {
  return new Promise((resolve) => {
    const attempt = async () => {
      try {
        const room = await createRoom(url, token)
        resolve(room) 
      } catch (err) {
        console.error('LiveKit connection failed: ', err)
        setTimeout(attempt, intervalMs) 
      }
    }

    attempt()
  })
}

app.whenReady().then(async () => {    
    screens = await getSources()
    if (screens.length > 0) {
        currScreen = screens[0] ?? null
    }
    
    // create hidden browser window to run render process
    hiddenWindow = new BrowserWindow({
        show: false,
        webPreferences: {
            preload: path.join(__dirname, '../out/preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        }
    })

    tray = new Tray(redIcon)

    connectWithRetry(roomUrl, mainRoomToken).then(async (room: Room) => {
        liveKitRoom = room
        publishAudioCallback = await publishAudio(liveKitRoom)
        setAudioDataHandler(publishAudioCallback)
        liveKitUpload = true

        tray?.setContextMenu(buildContextMenu())
    })
    
    // register ipc event handler for when video chunks are sent from render process
    ipcMain.on('video-chunk-ready', (_: IpcMainEvent, buffer: ArrayBuffer, start_ts: number) => {
        if (!recTimestamp) {
            throw Error("Must have current recording ts available to save chunk")
        }

        const buf = Buffer.from(buffer)

        const chunkFilePath = path.join(recFallbackDir, `${recTimestamp}_${segmentCounter}.webm`)
        fs.writeFileSync(chunkFilePath, buf)

        segmentCounter++
    })

    // register ipc event handler for when render process is done recording video
    ipcMain.on('video-ready', async (_: IpcMainEvent)=> {
        if (!recTimestamp) {
            throw Error("Must have current recording ts available to save chunk")
        }

        mergeAudioVideo(recFallbackDir, recTimestamp)
        
        recTimestamp = null
        segmentCounter = 0
    })


    hiddenWindow.webContents.on('did-finish-load', () => {
        tray?.setContextMenu(buildContextMenu())
        hiddenWindow?.webContents.openDevTools({ mode: 'detach' })
    })

    hiddenWindow.loadFile('renderer/index.html')
})