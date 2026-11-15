# Nexus

**English** · [Русский](README.ru.md)

A Minecraft server control panel for Windows. Manage your hosted servers (SFTP + Pterodactyl/Pelican panel API) and local servers on your own PC from one window, without opening the web panel or digging through folders.
Built with Electron, React and TypeScript.

> The interface is available in English, Ukrainian and Russian (switch at the bottom of the sidebar; by default it follows the Windows language).

## Features

**Hosted servers**
- **Add by API key**: enter the panel address and a client API key, and Nexus finds your servers and fills in the SFTP host, port and username for you. Any SFTP server or VPS can also be added manually.
- **Server header**: status, CPU/RAM usage, the game address (click to copy) and start/restart/stop buttons, visible on every tab.
- **Console** over the panel websocket, in a classic terminal style (Classic Console Neue font).
- **Backups, schedules, startup settings (variables, Docker image), network allocations, databases, sub-users, activity log, rename and reinstall.**
- **Auto-reconnect**: if the connection drops and the password is saved, the session is restored automatically.

**Local servers**
- Paper, Purpur, Fabric, Forge and Vanilla: core download with checksum verification, EULA, `server.properties`, start/stop/restart, console, LAN address, RAM/port/JVM settings.
- Local zip backups (using `save-off`/`save-all` while the server is running).

**For both hosted and local servers**
- **File manager**: drag & drop from Explorer, uploads and downloads with progress, Monaco editor, archives (extract/compress), download a file from a URL. Local deletions go to the Windows Recycle Bin.
- **Plugins, mods and datapacks** from Modrinth: search filtered by loader and game version, one-click install with required dependencies, recognition of already installed files, update checks and updates, enable/disable without deleting.
- **Players**: online list, everyone who has joined, OP/kick/ban/whitelist, and a player profile showing inventory, armor, ender chest, health, coordinates, effects and statistics. Item icons come from the official game client (downloaded on demand).
- **server.properties** as a form with descriptions.

Passwords and API keys are encrypted with Windows DPAPI (`safeStorage`). SSH host keys are verified on first use (TOFU).

## Getting started

```bash
npm install
npm run dev       # development mode with hot reload
npm run typecheck # type checking
npm run i18n:check # make sure every UI string is translated
npm run dist      # build the .exe installer into release/
```

The installer is not code-signed, so Windows SmartScreen may warn about it ("More info → Run anyway"), and Smart App Control blocks unsigned apps.

## Project structure

```
src/main/        — main process: ssh.ts (SFTP/SSH), panel.ts (panel API), localfs.ts (local server files),
                   minecraft.ts (local servers), modrinth.ts (catalog), textures.ts (item icons), store.ts (app data)
src/preload/     — bridge between the UI and the main process
src/renderer/    — React UI (views/, components/, mc/ — NBT and player data parsing)
src/shared/      — shared types
```

App data is stored in `%APPDATA%\nexus\nexus-data.json`.

The console font is [Classic Console Neue](https://webdraft.hu/fonts/classic-console/) (MIT), see `src/renderer/src/assets/fonts/LICENSE-clacon.txt`.
