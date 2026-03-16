import os from 'os'
import path from 'path'
import * as fs from 'fs'
import { app, BrowserWindow, ipcMain, IpcMainEvent, Menu, Tray, nativeImage, DesktopCapturerSource } from 'electron'
import { Room } from '@livekit/rtc-node'

import { getSources, getDisplaySize, startAudioRecording, stopAudioRecording, setAudioDataHandler } from './capture'
import { concatVideoAudioChunks } from './merge'
import { recFallbackDir, roomUrl, mainRoomToken, rendererRoomToken } from './config'
import { createRoom, publishAudio } from './livekit'


let hiddenWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isRecording = false
let screens: DesktopCapturerSource[] = []
let currScreen: DesktopCapturerSource | null = null
let liveKitUpload: boolean = true
let recTimestamp: number | null = null
let segmentCounter: number = 0
let liveKitRoom: Room | null = null

if (!fs.existsSync(recFallbackDir)) {
    fs.mkdirSync(recFallbackDir, {recursive: true})
}

app.whenReady().then(async () => {    
    screens = await getSources()
    if (screens.length > 0) {
        currScreen = screens[0] ?? null
    }

    liveKitRoom = await createRoom(roomUrl, mainRoomToken)
    
    // setup handler that takes audio chunks from swift process
    // and streams them to livekit room
    const publishAudioCallback = await publishAudio(liveKitRoom)
    setAudioDataHandler(publishAudioCallback)
    
    // create hidden browser window to run render process
    hiddenWindow = new BrowserWindow({
        show: false,
        webPreferences: {
            preload: path.join(__dirname, '../out/preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        }
    })

    const red = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAACTSURBVHgBpZKBCYAgEEV/TeAIjuIIbdQIuUGt0CS1gW1iZ2jIVaTnhw+Cvs8/OYDJA4Y8kR3ZR2/kmazxJbpUEfQ/Dm/UG7wVwHkjlQdMFfDdJMFaACebnjJGyDWgcnZu1/lrCrl6NCoEHJBrDwEr5NrT6ko/UV8xdLAC2N49mlc5CylpYh8wCwqrvbBGLoKGvz8Bfq0QPWEUo/EAAAAASUVORK5CYII=')
    const green = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAACOSURBVHgBpZLRDYAgEEOrEzgCozCCGzkCbKArOIlugJvgoRAUNcLRpvGH19TkgFQWkqIohhK8UEaKwKcsOg/+WR1vX+AlA74u6q4FqgCOSzwsGHCwbKliAF89Cv89tWmOT4VaVMoVbOBrdQUz+FrD6XItzh4LzYB1HFJ9yrEkZ4l+wvcid9pTssh4UKbPd+4vED2Nd54iAAAAAElFTkSuQmCC')

    tray = new Tray(red)
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Start Recording',
            type: 'normal',
            click: async (menuItem) => {
                if (!isRecording){
                    // setup trackers and dirs for recording
                    recTimestamp = Date.now()
                    segmentCounter = 0

                    // start audio and video recording
                    startAudioRecording(recTimestamp)
                    hiddenWindow?.webContents.send('start-recording', screens[0]?.id, roomUrl, rendererRoomToken)
                    
                    isRecording = !isRecording
                    menuItem.label = isRecording ? 'Stop Recording' : 'Start Recording'
                    tray?.setContextMenu(contextMenu)
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
            click: (menuItem) => {
                liveKitUpload = menuItem.checked
            }
            
        }
    ])
    
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
        
        recTimestamp = null
        segmentCounter = 0
    })


    hiddenWindow.webContents.on('did-finish-load', () => {
        tray?.setContextMenu(contextMenu)
        hiddenWindow?.webContents.openDevTools({ mode: 'detach' })
    })

    hiddenWindow.loadFile('renderer/index.html')
})