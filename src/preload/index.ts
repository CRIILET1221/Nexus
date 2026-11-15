import { contextBridge, ipcRenderer, webUtils } from 'electron'

async function call<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const res = await ipcRenderer.invoke(channel, ...args)
  if (!res.ok) throw new Error(res.error)
  return res.data as T
}

const api = {
  invoke: call,
  send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
  on(channel: string, cb: (payload: any) => void) {
    const listener = (_e: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  },
  /** Путь к файлу, перетащенному из проводника */
  pathForFile: (file: File) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('nexus', api)

export type NexAtomBridge = typeof api
