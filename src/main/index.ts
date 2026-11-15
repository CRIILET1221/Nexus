import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron'
import { join } from 'node:path'
import { promises as fsp, existsSync, mkdirSync, copyFileSync, cpSync } from 'node:fs'
import * as ssh from './ssh'
import * as mc from './minecraft'
import * as panel from './panel'
import { ping } from './ping'
import { profiles, servers, settings } from './store'
import * as textures from './textures'
import { setLang, detectLang, type Lang } from '../shared/i18n'
import * as localfs from './localfs'
import * as modrinth from './modrinth'
import { decryptLegacy } from './legacyKey'
import { tr } from '../shared/i18n'

migrateFromNexus()
textures.registerTextureScheme()

/**
 * Приложение раньше называлось Nexus и хранило данные в %APPDATA%\Nexus.
 * При первом запуске NexAtom переносим оттуда подключения, серверы, иконки предметов и настройки интерфейса.
 */
function migrateFromNexus() {
  try {
    const newDir = app.getPath('userData')
    const oldDir = join(app.getPath('appData'), 'Nexus')
    if (newDir.toLowerCase() === oldDir.toLowerCase()) return
    if (existsSync(join(newDir, 'nexatom-data.json')) || !existsSync(join(oldDir, 'nexus-data.json'))) return
    mkdirSync(newDir, { recursive: true })
    copyFileSync(join(oldDir, 'nexus-data.json'), join(newDir, 'nexatom-data.json'))
    for (const sub of ['textures', 'Local Storage']) {
      if (existsSync(join(oldDir, sub))) cpSync(join(oldDir, sub), join(newDir, sub), { recursive: true })
    }
  } catch (e) {
    console.error('[migrate]', e)
  }
}

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#0d0f14',
    title: 'NexAtom',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0d0f14', symbolColor: '#aab3c5', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  // интерфейс перезагрузился (смена языка) — консоли откроются заново, старые закрываем
  mainWindow.webContents.on('did-start-loading', () => {
    panel.closeAll()
    ssh.closeAllShells()
  })

  // Внешние ссылки — только в браузере, и только https
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    // перезагрузка своей же страницы (смена языка) разрешена, переходы на другие адреса — нет
    const self = mainWindow?.webContents.getURL().split('#')[0]
    if (url.split('#')[0] === self) return
    if (!process.env.ELECTRON_RENDERER_URL || !url.startsWith(process.env.ELECTRON_RENDERER_URL)) e.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

/** Регистрирует обработчик, возвращающий {ok, data} | {ok:false, error} — так ошибки приходят в интерфейс без мусора */
function handle(channel: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

function registerIpc() {
  handle('app:version', () => app.getVersion())
  handle('app:setLang', (lang: Lang) => {
    setLang(lang)
    settings.setLang(lang)
  })
  handle('ssh:list', () => ssh.listSessions())

  // Профили
  handle('profiles:list', () => profiles.list())
  handle('profiles:save', (input) => profiles.save(input))
  handle('profiles:remove', (id) => profiles.remove(id))

  // Диалоги
  handle('dialog:openFiles', async (opts: { directories?: boolean; multi?: boolean; title?: string; filters?: any[] }) => {
    const props: any[] = [opts?.directories ? 'openDirectory' : 'openFile']
    if (opts?.multi) props.push('multiSelections')
    if (opts?.directories) props.push('createDirectory')
    const res = await dialog.showOpenDialog(mainWindow!, { title: opts?.title, properties: props, filters: opts?.filters })
    return res.canceled ? [] : res.filePaths
  })
  handle('dialog:confirm', async (opts: { title: string; message: string; detail?: string; ok?: string; danger?: boolean }) => {
    const res = await dialog.showMessageBox(mainWindow!, {
      type: opts.danger ? 'warning' : 'question',
      title: opts.title,
      message: opts.message,
      detail: opts.detail,
      buttons: [tr('Отмена'), opts.ok ?? 'OK'],
      defaultId: opts.danger ? 0 : 1,
      cancelId: 0
    })
    return res.response === 1
  })

  // SSH / SFTP
  handle('ssh:connect', (profileId, secret) => ssh.connect(profileId, secret))
  handle('ssh:disconnect', (id) => ssh.disconnect(id))
  handle('sftp:list', (id, dir) => ssh.list(id, dir))
  handle('sftp:mkdir', (id, path) => ssh.mkdir(id, path))
  handle('sftp:rename', (id, from, to) => ssh.rename(id, from, to))
  handle('sftp:remove', (id, paths) => ssh.remove(id, paths))
  handle('sftp:readText', (id, path) => ssh.readText(id, path))
  handle('sftp:writeText', (id, path, content) => ssh.writeText(id, path, content))
  handle('sftp:readBinary', (id, path) => ssh.readBinary(id, path))
  handle('sftp:upload', (id, locals, dir) => ssh.upload(id, locals, dir))
  handle('sftp:download', (id, remotes, localDir) => ssh.download(id, remotes, localDir))
  handle('shell:open', (id, cols, rows) => ssh.openShell(id, cols, rows))
  ipcMain.on('shell:write', (_e, id, data) => ssh.writeShell(id, data))
  ipcMain.on('shell:resize', (_e, id, cols, rows) => ssh.resizeShell(id, cols, rows))
  handle('shell:close', (id) => ssh.closeShell(id))

  // Консоль через панель хостинга
  handle('panel:servers', (url, key) => panel.listServers(url, key))
  handle('panel:normalize', (url) => panel.normalizePanelUrl(url))
  handle('panel:discover', (url, key) => panel.discover(url, key))
  handle('panel:open', (profileId) => panel.openConsole(profileId))
  handle('panel:command', (id, cmd) => panel.sendCommand(id, cmd))
  handle('panel:power', (id, signal) => panel.setPower(id, signal))
  handle('panel:reconnect', (id) => panel.reconnect(id))
  handle('panel:close', (id) => panel.closeConsole(id))
  handle('panel:request', (profileId, method, path, body) => panel.serverRequest(profileId, method, path, body))
  handle('panel:download', async (url: string, suggestedName: string, progressId: string) => {
    const res = await dialog.showSaveDialog(mainWindow!, { defaultPath: suggestedName })
    if (res.canceled || !res.filePath) return null
    panel.downloadUrl(url, res.filePath, progressId).catch(() => undefined)
    return res.filePath
  })
  handle('mc:ping', (host: string, port: number) => ping(host, port))
  handle('mc:backups', (id) => mc.listBackups(id))
  handle('mc:backupCreate', (id, label) => mc.createBackup(id, label))
  handle('mc:backupRestore', (id, name) => mc.restoreBackup(id, name))
  handle('mc:backupDelete', (id, name) => mc.deleteBackup(id, name))
  handle('mc:backupsDir', (id) => mc.backupsDir(id))
  handle('shell:showItem', (path) => shell.showItemInFolder(path))

  // Локальные серверы
  handle('mc:list', () => servers.list())
  handle('mc:runtimes', () => mc.runtimes())
  handle('mc:versions', (core) => mc.getVersions(core))
  handle('mc:requiredJava', (version) => mc.requiredJava(version))
  handle('mc:detectJava', () => mc.detectJava())
  handle('mc:setJavaPath', (path) => mc.setJavaPath(path))
  handle('mc:defaultDir', () => mc.defaultServersDir())
  handle('mc:create', (input, progressId) => mc.createServer(input, progressId))
  handle('mc:update', (id, patch) => mc.updateServer(id, patch))
  handle('mc:delete', (id, deleteFiles) => mc.deleteServer(id, deleteFiles))
  handle('mc:start', (id) => mc.startServer(id))
  handle('mc:stop', (id) => mc.stopServer(id))
  handle('mc:kill', (id) => mc.killServer(id))
  handle('mc:command', (id, cmd) => mc.sendCommand(id, cmd))
  handle('mc:log', (id) => mc.getLog(id))
  handle('mc:clearLog', (id) => mc.clearLog(id))
  handle('mc:lan', () => mc.lanAddresses())

  // Локальные файлы
  handle('fs:readText', (path) => fsp.readFile(path, 'utf8'))
  handle('fs:writeText', (path, content) => fsp.writeFile(path, content, 'utf8'))
  handle('fs:exists', (path) => fsp.access(path).then(() => true, () => false))
  handle('fs:readBinary', async (path: string) => new Uint8Array(await fsp.readFile(path)))
  handle('fs:list', async (dir: string) => {
    const names = await fsp.readdir(dir)
    return Promise.all(
      names.map(async (name) => {
        const st = await fsp.stat(join(dir, name)).catch(() => null)
        return { name, isDir: !!st?.isDirectory(), size: st?.size ?? 0, mtime: st?.mtimeMs ?? 0 }
      })
    )
  })

  // Файлы локальных серверов
  handle('lfs:list', (id, dir) => localfs.list(id, dir))
  handle('lfs:mkdir', (id, p) => localfs.mkdir(id, p))
  handle('lfs:rename', (id, a, b) => localfs.rename(id, a, b))
  handle('lfs:remove', (id, paths) => localfs.remove(id, paths))
  handle('lfs:readText', (id, p) => localfs.readText(id, p))
  handle('lfs:writeText', (id, p, c) => localfs.writeText(id, p, c))
  handle('lfs:upload', (id, locals, dir) => localfs.upload(id, locals, dir))
  handle('lfs:download', (id, paths, dest) => localfs.download(id, paths, dest))
  handle('lfs:decompress', (id, dir, name) => localfs.decompress(id, dir, name))
  handle('lfs:compress', (id, dir, names) => localfs.compress(id, dir, names))
  handle('lfs:pull', (id, dir, url, name) => localfs.pull(id, dir, url, name))
  handle('lfs:reveal', (id, p) => localfs.reveal(id, p))
  handle('lfs:hash', (id, paths) => localfs.hash(id, paths))
  handle('sftp:hash', (id, paths) => ssh.hashFiles(id, paths))

  // Каталог плагинов и модов (Modrinth)
  handle('modrinth:search', (opts) => modrinth.search(opts))
  handle('modrinth:versions', (id, loaders, gv) => modrinth.versions(id, loaders, gv))
  handle('modrinth:version', (id) => modrinth.version(id))
  handle('modrinth:projects', (ids) => modrinth.projects(ids))
  handle('modrinth:identify', (hashes) => modrinth.identify(hashes))
  handle('modrinth:updates', (hashes, loaders, gv) => modrinth.updates(hashes, loaders, gv))
  handle('modrinth:downloadTemp', (file) => modrinth.downloadTemp(file))
  handle('modrinth:cleanupTemp', (p) => modrinth.cleanupTemp(p))

  // Иконки предметов
  handle('textures:status', () => textures.status())
  handle('textures:install', (progressId) => textures.install(progressId))
  handle('textures:remove', () => textures.remove())
  handle('shell:openPath', (path) => shell.openPath(path))
  handle('shell:openExternal', (url: string) => {
    if (!/^https:\/\//.test(url)) throw new Error(tr('Разрешены только https-ссылки'))
    return shell.openExternal(url)
  })
}

app.whenReady().then(() => {
  // пароли, сохранённые под старым именем (Nexus), — расшифровать и перешифровать новым ключом
  const fixed = profiles.repairSecrets(decryptLegacy)
  if (fixed.recovered || fixed.dropped) console.log('[secrets]', fixed)
  setLang(settings.getLang() ?? detectLang(app.getLocale()))
  Menu.setApplicationMenu(null)
  textures.handleTextureProtocol()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  if (mc.runtimes().length) {
    e.preventDefault()
    quitting = true
    mc.stopAll().finally(() => app.quit())
  }
  ssh.disconnectAll()
  panel.closeAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
