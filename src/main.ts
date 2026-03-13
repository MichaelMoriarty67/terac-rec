import path from 'path'
import * as fs from 'fs'
import { app, BrowserWindow, ipcMain, IpcMainEvent, Menu, Tray, nativeImage, DesktopCapturerSource } from 'electron'

import { getSources, startAudioRecording, stopAudioRecording } from './capture'
import { mergeAudioVideo } from './merge'

let hiddenWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isRecording = false
let screens: DesktopCapturerSource[] = []
let currScreen: DesktopCapturerSource | null = null
let liveKitUpload: boolean = true

// create hidden browser window to run render process


app.whenReady().then(async () => {
    // register ipc event handler for when video is done recording on render process
    
    screens = await getSources()
    if (screens.length > 0) {
        currScreen = screens[0] ?? null
    }
    
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
            click: (menuItem) => {
                if (!isRecording){
                    // start audio and video recording
                    startAudioRecording()
                    hiddenWindow?.webContents.send('start-recording', screens[0]?.id)
                    
                    isRecording = !isRecording
                    menuItem.label = isRecording ? 'Stop Recording' : 'Start Recording'
                    tray?.setContextMenu(contextMenu)
                } else {
                    stopAudioRecording()
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
    
    ipcMain.on('video-ready', (_: IpcMainEvent, buffer: ArrayBuffer) => {
        const buf = Buffer.from(buffer)
        fs.writeFileSync('/tmp/video.webm', buf)
    })

    hiddenWindow.webContents.on('did-finish-load', () => {
        tray?.setContextMenu(contextMenu)
    })

    hiddenWindow.loadFile('renderer/index.html')
})