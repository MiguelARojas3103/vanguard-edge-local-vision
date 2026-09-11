import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'node:path'
import { is } from './is.js'
import {
  ensureModelLoaded,
  extractDocument,
  explainSimple,
  shutdownModel,
  getPerfLog,
  type DocType
} from './qvac.js'
import {
  startNetworkMonitor,
  getNetworkEvents,
  countEventsSince,
  clearNetworkEvents
} from './network-monitor.js'

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(() => {
  startNetworkMonitor()

  ipcMain.handle('doclocal:pickImage', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('doclocal:loadModel', async (event) => {
    const sender = event.sender
    return ensureModelLoaded((pct) => {
      sender.send('doclocal:modelProgress', pct)
    })
  })

  ipcMain.handle('doclocal:extract', async (event, imagePath: string, docType: DocType) => {
    const sender = event.sender
    const before = new Date().toISOString()
    const { fields, stats } = await extractDocument(imagePath, docType, {
      onToken: (token) => sender.send('doclocal:extractToken', token),
      onPlan: (plan) => sender.send('doclocal:extractPlan', plan),
      onFieldStart: (key) => {
        sender.send('doclocal:extractFieldStart', key)
        // Actualizacion en vivo del contador de red mientras corre la
        // inferencia -- antes solo se calculaba una vez al terminar toda
        // la extraccion, asi que en video se veia "Aun sin medir" durante
        // los 15-20 segundos que tarda leer un documento. Emitiendolo en
        // cada paso de campo, el indicador de privacidad se mantiene
        // visiblemente en 0 durante toda la inferencia, no solo al final.
        sender.send('doclocal:networkCount', countEventsSince(before))
      },
      onFieldDone: (key, value) => {
        sender.send('doclocal:extractFieldDone', key, value)
        sender.send('doclocal:networkCount', countEventsSince(before))
      }
    })
    const networkEventsDuring = countEventsSince(before)
    return { fields, stats, networkEventsDuring }
  })

  ipcMain.handle('doclocal:explain', async (event, fields: Record<string, string>) => {
    const sender = event.sender
    const before = new Date().toISOString()
    const { text, stats } = explainSimple(fields as any, {
      onToken: (token) => sender.send('doclocal:explainToken', token)
    })
    const networkEventsDuring = countEventsSince(before)
    return { text, stats, networkEventsDuring }
  })

  ipcMain.handle('doclocal:getPerfLog', async () => getPerfLog())
  ipcMain.handle('doclocal:getNetworkEvents', async () => getNetworkEvents())
  ipcMain.handle('doclocal:clearNetworkEvents', async () => clearNetworkEvents())

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async (event) => {
  event.preventDefault()
  await shutdownModel().catch(() => {})
  app.exit(0)
})
