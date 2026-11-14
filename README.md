# Nexus

SFTP/SSH-клиент для серверов Minecraft с панелью локальных серверов.
Electron + React + TypeScript.

## Возможности

- **Подключения**: сохранённые серверы, вход по паролю или SSH-ключу. Пароли шифруются через Windows DPAPI (`safeStorage`), ключи хостов проверяются (TOFU).
- **Файловый менеджер**: навигация, drag & drop из проводника (в том числе прямо в папку), загрузка и скачивание файлов и папок с прогрессом, переименование, удаление, создание, контекстное меню, горячие клавиши (F2, Del, F5, Enter, Backspace, Ctrl+A).
- **Редактор**: Monaco (как в VS Code) с подсветкой `.yml`, `.json`, `.properties` и т. д., Ctrl+S сохраняет.
- **SSH-консоль**: xterm.js, несколько вкладок, копирование и вставка (Ctrl+C при выделении, Ctrl+V, ПКМ).
- **Локальные серверы**: Paper, Purpur, Fabric, Vanilla. Скачивание ядра с проверкой контрольной суммы, EULA, `server.properties`, `start.bat`. Запуск, остановка, перезапуск, консоль с историей команд, адрес для LAN, параметры RAM/порт/JVM.

## Запуск

```bash
npm install
npm run dev       # режим разработки с горячей перезагрузкой
npm run typecheck # проверка типов
npm run dist      # сборка установщика .exe в release/
```

## Структура

```
src/main/        — main-процесс: ssh.ts (SFTP/SSH), minecraft.ts (серверы), store.ts (данные)
src/preload/     — мост между интерфейсом и main
src/renderer/    — React-интерфейс (views/, components/)
src/shared/      — общие типы
```

Данные приложения хранятся в `%APPDATA%\nexus\nexus-data.json`.
