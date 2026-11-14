// Рендерит иконку приложения в build/icon.png (512x512) через Electron.
// Запуск: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#0ea5e9"/>
    </linearGradient>
    <linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".22"/><stop offset=".5" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="24" y="24" width="464" height="464" rx="112" fill="url(#g)"/>
  <rect x="24" y="24" width="464" height="464" rx="112" fill="url(#s)"/>
  <path d="M160 360 V152 L352 360 V152" fill="none" stroke="#04140d" stroke-width="56" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512, height: 512, show: false, transparent: true, frame: false,
    useContentSize: true, webPreferences: { offscreen: true }
  })
  await win.loadURL('data:text/html,' + encodeURIComponent(
    `<html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`))
  await new Promise((r) => setTimeout(r, 500))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 })
  const dir = join(__dirname, '..', 'build')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'icon.png'), img.resize({ width: 512, height: 512 }).toPNG())
  app.exit(0)
})
