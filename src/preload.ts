import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

contextBridge.exposeInMainWorld('electronAPI', {
    onStartRecording: (callback: (event: IpcRendererEvent, screen: string, uploda: boolean) => void) => ipcRenderer.on('start-recording', callback),
    onStopRecording: (callback: (event: IpcRendererEvent) => void) => ipcRenderer.on('stop-recording', callback),
    sendVideoChunk: (buffer: ArrayBuffer, start_ts: number) => ipcRenderer.send('video-chunk-ready', buffer, start_ts),
    sendVideoReady: () => ipcRenderer.send('video-ready'),
    liveKitToggle: (callback: (event: IpcRendererEvent, upload: boolean) => void) => ipcRenderer.on('livekit-toggle', callback),
    startRendererRoom: (callback: (event: IpcRendererEvent, liveKitUrl: String, livekitToken: string) => void) => ipcRenderer.on('start-renderer-room', callback),
    rendererRoomReady: () => ipcRenderer.send('renderer-room-ready'),
    cleanup: (callback: (event: IpcRendererEvent) => void) => ipcRenderer.on('cleanup-renderer', callback)
})