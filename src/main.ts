import path from 'path'
import * as fs from 'fs'
import { app, BrowserWindow, ipcMain, IpcMainEvent, Menu, Tray, nativeImage, DesktopCapturerSource } from 'electron'
import { Room } from '@livekit/rtc-node'

import { getSources, startAudioRecording, stopAudioRecording, setAudioDataHandler, rotateAudioChunk } from './capture'
import { recFallbackDir, roomUrl, mainRoomToken, rendererRoomToken, chunkMs } from './config'
import { createRoom, publishAudio } from './livekit'
import { mergeAudioVideo } from './merge'

let hiddenWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isRecording = false
let screens: DesktopCapturerSource[] = []
let currScreen: DesktopCapturerSource | null = null
let liveKitUpload: boolean = false
let rendererRoomAvail: boolean = false
let publishAudioCallback = (chunk: Buffer<ArrayBufferLike>) => {}
let recTimestamp: number | null = null
let segmentCounter: number = 0
let liveKitRoom: Room | null = null
let vidAudOffsetMs: number = 0
let chunkTimerId: ReturnType<typeof setInterval> | null = null

const redIcon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAACTSURBVHgBpZKBCYAgEEV/TeAIjuIIbdQIuUGt0CS1gW1iZ2jIVaTnhw+Cvs8/OYDJA4Y8kR3ZR2/kmazxJbpUEfQ/Dm/UG7wVwHkjlQdMFfDdJMFaACebnjJGyDWgcnZu1/lrCrl6NCoEHJBrDwEr5NrT6ko/UV8xdLAC2N49mlc5CylpYh8wCwqrvbBGLoKGvz8Bfq0QPWEUo/EAAAAASUVORK5CYII=')
const greenIcon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAACOSURBVHgBpZLRDYAgEEOrEzgCozCCGzkCbKArOIlugJvgoRAUNcLRpvGH19TkgFQWkqIohhK8UEaKwKcsOg/+WR1vX+AlA74u6q4FqgCOSzwsGHCwbKliAF89Cv89tWmOT4VaVMoVbOBrdQUz+FrD6XItzh4LzYB1HFJ9yrEkZ4l+wvcid9pTssh4UKbPd+4vED2Nd54iAAAAAElFTkSuQmCC')
const appIcon = nativeImage.createFromDataURL('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAxMzkgMTQ2IiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNNS41MzM0OCA2NS40MDQyQzMuMzYwNDQgNTMuMDA2NCAyLjA0ODcgMzQuNTY2MiAxNy45MDc3IDI2LjI5NTFDMjIuNDE2MSAyNC4xMTQ4IDI3LjI3MDggMjMuMTc0MyAzMS45Nzg3IDIyLjk1NTNDMzIuNDc4IDIxLjk1NDkgMzMuMDE1NyAyMC45NyAzMy41ODg1IDIwLjAwMzVDMzkuOTM4IDguODg0OTUgNTIuNjQxNSAtMC4zMTI4NSA2Ni43NTA2IDAuMDA4MTU1ODVDNjcuODk2NiAwLjAxNDA5NzEgNjkuMDIxMiAwLjA2OTU4MTQgNzAuMTY2MSAwLjE3MTQ4MUM4Ny4yNDI3IDEuODk1IDk4LjI0MjEgMTIuMzEzMSAxMDYuMjQgMjUuMzMyOUMxMTMuMTI2IDIxLjY0NjQgMTIzLjM3MyAyNC4wMDI0IDEyOC41MjQgMzAuMTQyOEMxMjguODYzIDMwLjUxNTEgMTI5LjE4NCAzMC44ODk0IDEyOS41MDYgMzEuMjgzN0MxMzguNTkxIDQ0LjUxNDMgMTMzLjg2MyA1OC4yNzU0IDEyOS4zNzIgNjkuNDc1NEMxMjguOTE0IDcwLjQ5MDkgMTI4LjQzMSA3MS40ODYzIDEyNy45MDcgNzIuNDcwNEMxMjcuODAxIDcyLjY2NjQgMTI3LjY2NSA3Mi44NDYxIDEyNy41MDUgNzNDMTI3LjY2NSA3My4xNTM5IDEyNy44MDEgNzMuMzMzNyAxMjcuOTA3IDczLjUyOTZDMTI4LjQzMSA3NC41MTM3IDEyOC45MTQgNzUuNTA5MSAxMjkuMzcyIDc2LjUyNDdDMTMzLjg2MyA4Ny43MjQ2IDEzOC41OTEgMTAxLjQ4NiAxMjkuNTA2IDExNC43MTZDMTI5LjE4NCAxMTUuMTExIDEyOC44NjMgMTE1LjQ4NSAxMjguNTI0IDExNS44NTdDMTIzLjM3MyAxMjEuOTk4IDExMy4xMjYgMTI0LjM1NCAxMDYuMjQgMTIwLjY2N0M5OC4yNDIxIDEzMy42ODcgODcuMjQyNyAxNDQuMTA1IDcwLjE2NjEgMTQ1LjgyOUM2OS4wMjEyIDE0NS45MyA2Ny44OTY2IDE0NS45ODYgNjYuNzUwNiAxNDUuOTkyQzUyLjY0MTUgMTQ2LjMxMyAzOS45MzggMTM3LjExNSAzMy41ODg1IDEyNS45OTdDMzMuMDE1NyAxMjUuMDMgMzIuNDc4IDEyNC4wNDUgMzEuOTc4NyAxMjMuMDQ1QzI3LjI3MDggMTIyLjgyNiAyMi40MTYxIDEyMS44ODUgMTcuOTA3NyAxMTkuNzA1QzIuMDQ4NyAxMTEuNDM0IDMuMzYwNDQgOTIuOTkzNiA1LjUzMzQ4IDgwLjU5NThDNi4wMTQxOSA3OC4wMjU2IDYuNjA2ODcgNzUuNDg4OSA3LjI4MDc2IDczQzYuNjA2ODcgNzAuNTExMSA2LjAxNDE5IDY3Ljk3NDQgNS41MzM0OCA2NS40MDQyWk0yMS40MjQgMzMuODUzN0MyNC45NTggMzIuMjk3OCAyOC45OTAyIDMxLjYwNzkgMzMuMTU3IDMxLjQ5OTlDNjMuMTQ5IDMyLjY0MjYgOTUuMjc4IDUxLjYxMTkgMTIwLjI0MyA3MC4zOTg1SDEwLjc2OTVDMTAuNjc1OCA2OS4xOTkyIDEwLjQ0ODMgNjYuMDI0NiAxMC4zOTI0IDY0LjgzMDJDOS43NDA5OSA1Mi4zNjYzIDExLjU1NSAzNy44MTQ1IDIxLjQyNCAzMy44NTM3Wk0zMy4xNTcgMTE0LjVDNjMuNDM4MiAxMTMuMzQ2IDk1LjEzNTEgOTQuODAyIDEyMC4yNDMgNzUuODAwNkgxMC43Njk1QzEwLjYwNSA3Ny41OTI1IDEwLjQ3NTkgNzkuMzg1NSAxMC4zOTI0IDgxLjE2OThDOS43NDA5OSA5My42MzM3IDExLjU1NSAxMDguMTg2IDIxLjQyNCAxMTIuMTQ2QzI0Ljk1OCAxMTMuNzAyIDI4Ljk5MDIgMTE0LjM5MiAzMy4xNTcgMTE0LjVaTTY2LjcwNzQgOC42NTk1OEM2Ny42MDc5IDguNjY0MjYgNjguNDk3MSA4LjcwNDAxIDY5LjQwOTUgOC43ODIwN0M5NS4wMTM5IDEwLjI0MzcgMTA1LjgwNSAzOC43NTU1IDExNy43MzYgNjIuMTc2MUM5NS4xMjY4IDQyLjc1NzMgNjguOTQwNiAyNi4wOTQxIDM3LjUzOTMgMjMuMjM3NEM0NS4zMDYgMTQuNDEwNSA1NS44Njc3IDguNDU3ODQgNjYuNzA3NCA4LjY1OTU4Wk02Ni43MDc0IDEzNy4zNEM2Ny42MDc5IDEzNy4zMzYgNjguNDk3MSAxMzcuMjk2IDY5LjQwOTUgMTM3LjIxOEM5NS4wMTM5IDEzNS43NTYgMTA1LjgwNSAxMDcuMjQ1IDExNy43MzYgODMuODIzOUM5NS4xMjY4IDEwMy4yNDMgNjguOTQwNiAxMTkuOTA2IDM3LjUzOTMgMTIyLjc2M0M0NS4zMDYgMTMxLjU5IDU1Ljg2NzcgMTM3LjU0MiA2Ni43MDc0IDEzNy4zNFpNMTIyLjg2MyAzNi43NTUxQzEyOC4zNzggNDMuNzMzOCAxMjcuMjc1IDU2LjkyOTMgMTI1LjE1IDY4LjA5NDNDMTIwLjI2MyA1Ni44MzMgMTE1LjYwMiA0Mi4wMzc2IDEwOC40NCAyOS4xMDg5QzExNC4yNzQgMjkuMzgwNyAxMTguNjMxIDMyLjA1MzUgMTIyLjE1OSAzNS45NDU3QzEyMi4zOTggMzYuMjA3NiAxMjIuNjI4IDM2LjQ3MjYgMTIyLjg2MyAzNi43NTUxWk0xMjIuODYzIDEwOS4yNDVDMTI4LjM3OCAxMDIuMjY2IDEyNy4yNzUgODkuMDcwNyAxMjUuMTUgNzcuOTA1N0MxMjAuMjYzIDg5LjE2NyAxMTUuNjAyIDEwMy45NjIgMTA4LjQ0IDExNi44OTFDMTE0LjI3NCAxMTYuNjE5IDExOC42MzEgMTEzLjk0NiAxMjIuMTU5IDExMC4wNTRDMTIyLjM5OCAxMDkuNzkyIDEyMi42MjggMTA5LjUyNyAxMjIuODYzIDEwOS4yNDVaIiBmaWxsPSIjRkZGRkYwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PC9wYXRoPjwvc3ZnPgo=')


if (!fs.existsSync(recFallbackDir)) {
    fs.mkdirSync(recFallbackDir, {recursive: true})
}

function buildContextMenu() {
    return Menu.buildFromTemplate([
        {
            label: 'Start Recording',
            type: 'normal',
            icon: greenIcon,
            enabled: currScreen ? true : false,
            toolTip: currScreen ? "" : "Add this app to Sytem Settings > Privacy & Security > Screen & System Audio Recording to enable recording",
            click: async (menuItem) => {
                isRecording = !isRecording
                menuItem.label = isRecording ? 'Stop Recording' : 'Start Recording'
                menuItem.icon = isRecording ? redIcon : greenIcon

                if (isRecording){
                    tray?.setImage(greenIcon)

                    // setup trackers and dirs for recording
                    recTimestamp = Date.now()
                    segmentCounter = 0

                    // start audio and video recording
                    startAudioRecording(recTimestamp)
                    hiddenWindow?.webContents.send('start-recording', currScreen?.id, liveKitUpload)

                    // interval for rotating chunks
                    chunkTimerId = setInterval(() => {
                        rotateAudioChunk()                                    // → writes "rotate\n" to swift stdin
                        hiddenWindow?.webContents.send('rotate-chunk')        // → renderer stops/starts recorder
                    }, chunkMs)
                } else {
                    tray?.setImage(redIcon)
                    chunkTimerId ? clearInterval(chunkTimerId) : {}
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
            enabled: liveKitRoom && rendererRoomAvail ? true : false,
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
    // getSources will fail if permission to record is denied on mac
    try {
        screens = await getSources()
        if (screens.length > 0) {
            currScreen = screens[0] ?? null
        }
    } catch {}
    
    
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

    ipcMain.on('video-started', (_: IpcMainEvent, ts: number) => {
        if (!recTimestamp) {
            throw Error("Must have current recording ts available to update vid/aud offset")
        }

        vidAudOffsetMs = ts - recTimestamp
    })

    // register ipc event handler for when render process is done recording video
    ipcMain.on('video-ready', async (_: IpcMainEvent)=> {
        if (!recTimestamp) {
            throw Error("Must have current recording ts available to save chunk")
        }

        mergeAudioVideo(recFallbackDir, recTimestamp, vidAudOffsetMs)
        
        recTimestamp = null
        segmentCounter = 0
        vidAudOffsetMs = 0
    })

    ipcMain.on('renderer-room-ready', (_: IpcMainEvent) => {
        rendererRoomAvail = true
        tray?.setContextMenu(buildContextMenu())
    })


    hiddenWindow.webContents.on('did-finish-load', () => {
        tray?.setContextMenu(buildContextMenu())
        hiddenWindow?.webContents.send('start-renderer-room', roomUrl, rendererRoomToken)
    })

    hiddenWindow.loadFile('renderer/index.html')
})

app.on('before-quit', async () => {
    hiddenWindow?.webContents.send('cleanup-renderer')
})