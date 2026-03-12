import path from 'path'
import * as fs from 'fs'
import { app, BrowserWindow, ipcMain, IpcMainEvent } from 'electron'

import { getSources } from './capture'

let hiddenWindow: BrowserWindow | null = null

app.whenReady().then(() => {
    hiddenWindow = new BrowserWindow({
        show: false,
        webPreferences: {
            preload: path.join(__dirname, '../out/preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        }
    })

    ipcMain.on('video-ready', (_: IpcMainEvent, buffer: ArrayBuffer) => {
        const buf = Buffer.from(buffer)
        fs.writeFileSync('/tmp/video.webm', buf)
    })

    hiddenWindow.webContents.on('did-finish-load', async () => {
        hiddenWindow?.webContents.openDevTools({ mode: 'detach' })
        const screens = await getSources()

        console.log('Sources:', screens.map(s => ({ id: s.id, name: s.name })))

        hiddenWindow?.webContents.send('start-recording', screens[0]?.id)

        setTimeout(() => {
            hiddenWindow?.webContents.send('stop-recording')
        }, 10000)
    })

    hiddenWindow.loadFile('renderer/index.html')
})