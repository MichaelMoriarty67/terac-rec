import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

contextBridge.exposeInMainWorld('electronAPI', {
    onStartRecording: (callback: (event: IpcRendererEvent, screen: string) => void) => ipcRenderer.on('start-recording', callback),
    onStopRecording: (callback: (event: IpcRendererEvent) => void) => ipcRenderer.on('stop-recording', callback),
    sendVideoChunk: (buffer: ArrayBuffer, start_ts: number) => ipcRenderer.send('video-chunk-ready', buffer, start_ts),
    sendVideoReady: () => ipcRenderer.send('video-ready')
})