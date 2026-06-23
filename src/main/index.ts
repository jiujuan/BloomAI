import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut, clipboard, shell } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { fork } from 'child_process'
import type { ChildProcess } from 'child_process'
import { BLOOMAI_PORT_ENV, DEFAULT_SERVER_PORT, IPC_CHANNELS } from '../shared/constants'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = process.env.NODE_ENV === 'development'
const PORT = DEFAULT_SERVER_PORT

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let tray: Tray | null = null
let serverProcess: ChildProcess | null = null

// ── Start embedded Express server ────────────────────────────────────────────
function startServer() {
  const serverPath = isDev
    ? path.join(__dirname, '../src/server/index.ts')
    : path.join(__dirname, '../server/index.js')

  if (isDev) {
    serverProcess = fork(serverPath, [], {
      execArgv: ['-r', 'tsx/cjs'],
      env: { ...process.env, [BLOOMAI_PORT_ENV]: String(PORT) },
      stdio: 'inherit',
    })
  } else {
    serverProcess = fork(serverPath, [], {
      env: { ...process.env, [BLOOMAI_PORT_ENV]: String(PORT) },
      stdio: 'inherit',
    })
  }

  serverProcess.on('error', (err) => console.error('[Server]', err))
  console.log(`[BloomAI] Server starting on port ${PORT}`)
}

// ── Create main window ───────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 13 },
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

// ── Create overlay window ────────────────────────────────────────────────────
function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 420,
    height: 520,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: true,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    overlayWindow.loadURL('http://localhost:5173?overlay=1')
  } else {
    overlayWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      query: { overlay: '1' },
    })
  }

  overlayWindow.on('blur', () => overlayWindow?.hide())
}

// ── Tray ─────────────────────────────────────────────────────────────────────
function createTray() {
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('BloomAI')

  const menu = Menu.buildFromTemplate([
    { label: 'Open BloomAI', click: () => mainWindow?.show() || createMainWindow() },
    { label: 'Overlay (Alt+Space)', click: toggleOverlay },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => mainWindow?.show() || createMainWindow())
}

function toggleOverlay() {
  if (!overlayWindow) { createOverlayWindow(); return }
  if (overlayWindow.isVisible()) {
    overlayWindow.hide()
  } else {
    const { width, height } = require('electron').screen.getPrimaryDisplay().workAreaSize
    overlayWindow.setPosition(width - 450, Math.floor(height / 2) - 260)
    overlayWindow.show()
    overlayWindow.focus()
  }
}

// ── IPC handlers ─────────────────────────────────────────────────────────────
function setupIPC() {
  ipcMain.handle(IPC_CHANNELS.clipboardRead, () => clipboard.readText())
  ipcMain.handle(IPC_CHANNELS.clipboardWrite, (_e, text: string) => { clipboard.writeText(text); return true })
  ipcMain.handle(IPC_CHANNELS.appGetActiveWindow, () => 'BloomAI')  // simplified
  ipcMain.handle(IPC_CHANNELS.windowCloseOverlay, () => overlayWindow?.hide())
  ipcMain.handle(IPC_CHANNELS.windowOpenMain, () => { mainWindow?.show(); mainWindow?.focus() })
  ipcMain.handle(IPC_CHANNELS.appVersion, () => app.getVersion())
  ipcMain.handle(IPC_CHANNELS.shellOpenExternal, (_e, url: string) => shell.openExternal(url))
}

// ── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Wait a moment for server to start
  startServer()
  await new Promise(r => setTimeout(r, 1500))

  setupIPC()
  createMainWindow()
  createTray()

  // Global shortcut for overlay
  globalShortcut.register('Alt+Space', toggleOverlay)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    serverProcess?.kill()
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  serverProcess?.kill()
})
