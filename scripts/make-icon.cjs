// Рендерит иконку NexAtom (атом) в build/icon.png (512x512) через Electron.
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
  <g transform="translate(256 256)">
    <g fill="none" stroke="#04140d" stroke-width="22" stroke-linecap="round">
      <ellipse rx="190" ry="72" transform="rotate(-32)"/>
      <ellipse rx="190" ry="72" transform="rotate(32)"/>
    </g>
    <!-- ядро — блок в изометрии -->
    <polygon points="0,-74 64,-37 0,0 -64,-37" fill="#04140d"/>
    <polygon points="-64,-37 0,0 0,74 -64,37" fill="#04140d" opacity=".78"/>
    <polygon points="64,-37 0,0 0,74 64,37" fill="#04140d" opacity=".9"/>
    <polygon points="0,-60 46,-34 0,-8 -46,-34" fill="#7ef0c4" opacity=".55"/>
    <!-- электроны-пиксели -->
    <rect x="-18" y="-18" width="36" height="36" rx="6" fill="#04140d" transform="rotate(-32) translate(109 -59) rotate(32)"/>
    <rect x="-18" y="-18" width="36" height="36" rx="6" fill="#04140d" transform="rotate(32) translate(-109 59) rotate(-32)"/>
  </g>
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
