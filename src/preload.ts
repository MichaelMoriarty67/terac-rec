import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

contextBridge.exposeInMainWorld('electronAPI', {
    onStartRecording: (callback: (event: IpcRendererEvent, screen: string) => void) => ipcRenderer.on('start-recording', callback),
    onStopRecording: (callback: (event: IpcRendererEvent) => void) => ipcRenderer.on('stop-recording', callback),
    sendVideoReady: (buffer: ArrayBuffer) => ipcRenderer.send('video-ready', buffer)
})