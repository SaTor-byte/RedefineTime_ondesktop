const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('note', {
  loadState: () => ipcRenderer.invoke('state:get'),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  setAdjustable: (adjustable) => ipcRenderer.invoke('window:set-adjustable', adjustable),
  closeApp: () => ipcRenderer.invoke('window:close'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('app:set-auto-launch', enabled),
  onPowerState: (callback) => {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('power-state', handler)
    return () => ipcRenderer.removeListener('power-state', handler)
  },
  onWindowState: (callback) => {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('window-state', handler)
    return () => ipcRenderer.removeListener('window-state', handler)
  },
})
