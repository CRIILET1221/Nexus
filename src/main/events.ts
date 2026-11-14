import { BrowserWindow } from 'electron'

/** Отправляет событие во все окна приложения */
export function emit(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}
