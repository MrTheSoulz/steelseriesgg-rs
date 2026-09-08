import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "../src/shared/contracts";
const bridge: DesktopBridge = {
  getState: () => ipcRenderer.invoke("ssgg:state"),
  getRuntime: () => ipcRenderer.invoke("ssgg:runtime"),
  setStream: (value) => ipcRenderer.invoke("ssgg:stream", value),
  setGroup: (value) => ipcRenderer.invoke("ssgg:group", value),
  setChatmix: (value) => ipcRenderer.invoke("ssgg:chatmix", value),
  setDevice: (value) => ipcRenderer.invoke("ssgg:device", value),
  applyLighting: (value) => ipcRenderer.invoke("ssgg:lighting", value),
  saveProfile: (name) => ipcRenderer.invoke("ssgg:profile-save", name),
  applyProfile: (name) => ipcRenderer.invoke("ssgg:profile-apply", name),
  setCloseToTray: (enabled) => ipcRenderer.invoke("ssgg:close-to-tray", enabled),
  getArtwork: (id) => ipcRenderer.invoke("ssgg:artwork-get", id),
  chooseArtwork: (id) => ipcRenderer.invoke("ssgg:artwork-choose", id),
  downloadArtwork: (id) => ipcRenderer.invoke("ssgg:artwork-download", id),
};
contextBridge.exposeInMainWorld("ssgg", Object.freeze(bridge));
