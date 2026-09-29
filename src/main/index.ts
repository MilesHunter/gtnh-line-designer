import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  shell
} from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DataManager } from './data-manager'
import { LocalExportManager } from './local-export-manager'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'gtnh-data',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
])

let mainWindow: BrowserWindow | null = null
let dataManager: DataManager
let localExportManager: LocalExportManager

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#0f1115',
    title: 'GTNH 产线设计器',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  const getCombinedStatus = async () => ({
    ...(await dataManager.getStatus()),
    ...localExportManager.getState()
  })

  ipcMain.handle('data:status', getCombinedStatus)
  ipcMain.handle('data:download', async (event, ref: string) => {
    const version = await dataManager.downloadVersion(ref, (progress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('data:progress', progress)
      }
    })
    return { version }
  })
  ipcMain.handle('data:cancel', () => {
    dataManager.cancelDownload()
  })
  ipcMain.handle('data:select', (_event, commit: string) =>
    dataManager.selectVersion(commit)
  )
  ipcMain.handle('data:appRoot', () => dataManager.getAppRoot())
  ipcMain.handle('instance:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择 GTNH 游戏实例 gameDir',
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    return localExportManager.inspectAndBind(result.filePaths[0])
  })
  ipcMain.handle('instance:refresh', async () => {
    const binding = await localExportManager.refreshBinding()
    return {
      binding,
      status: await getCombinedStatus()
    }
  })
  ipcMain.handle('instance:prepare-export', async (event) => {
    const session = await localExportManager.prepareExport()
    if (!event.sender.isDestroyed()) {
      event.sender.send(
        'local-import:progress',
        localExportManager.getState().localImport
      )
    }
    return session
  })
  ipcMain.handle('instance:refresh-export', async () => {
    const session = await localExportManager.refreshExportSession()
    return {
      session,
      status: await getCombinedStatus()
    }
  })
  ipcMain.handle('instance:restore', async () => {
    await localExportManager.restoreInstance()
    return getCombinedStatus()
  })
  ipcMain.handle('instance:convert-export', async () => {
    const version = await localExportManager.convertExport()
    return {
      version,
      status: await getCombinedStatus()
    }
  })
  ipcMain.handle('instance:cleanup-export', async () => {
    await localExportManager.cleanupExport()
    return getCombinedStatus()
  })
  ipcMain.handle('instance:open-folder', async () => {
    const gameDir = localExportManager.getState().boundInstance?.gameDir
    if (!gameDir) throw new Error('尚未绑定游戏实例')
    const error = await shell.openPath(gameDir)
    if (error) throw new Error(error)
  })

  ipcMain.handle('project:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '打开 GTNH 产线项目',
      filters: [
        { name: 'GTNH 产线图', extensions: ['gtnhgraph'] },
        { name: 'JSON', extensions: ['json'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const filePath = result.filePaths[0]
    return { path: filePath, content: await readFile(filePath, 'utf8') }
  })

  ipcMain.handle(
    'project:save',
    async (
      _event,
      content: string,
      currentPath?: string,
      saveAs = false
    ): Promise<string | null> => {
      let filePath = saveAs ? undefined : currentPath
      if (!filePath) {
        const result = await dialog.showSaveDialog(mainWindow!, {
          title: '保存 GTNH 产线项目',
          defaultPath: path.join(
            dataManager.getWorkspaceRoot(),
            `产线设计-${new Date().toISOString().slice(0, 10)}.gtnhgraph`
          ),
          filters: [{ name: 'GTNH 产线图', extensions: ['gtnhgraph'] }]
        })
        if (result.canceled || !result.filePath) return null
        filePath = result.filePath
      }
      await writeFile(filePath, content, 'utf8')
      return filePath
    }
  )

  ipcMain.handle('project:autosave', (_event, content: string) =>
    dataManager.saveAutosave(content)
  )
  ipcMain.handle('project:read-autosave', () => dataManager.readAutosave())
  ipcMain.handle(
    'project:export-png',
    async (_event, bytes: Uint8Array, suggestedName: string): Promise<string | null> => {
      const result = await dialog.showSaveDialog(mainWindow!, {
        title: '导出产线图 PNG',
        defaultPath: path.join(dataManager.getWorkspaceRoot(), suggestedName),
        filters: [{ name: 'PNG 图片', extensions: ['png'] }]
      })
      if (result.canceled || !result.filePath) return null
      await writeFile(result.filePath, Buffer.from(bytes))
      return result.filePath
    }
  )
}

app.whenReady().then(async () => {
  dataManager = new DataManager()
  await dataManager.initialize()
  const resourceRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'integrations')
    : path.join(app.getAppPath(), 'resources', 'integrations')
  localExportManager = new LocalExportManager({
    appRoot: dataManager.getAppRoot(),
    resourceRoot,
    onProgress: (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('local-import:progress', progress)
      }
    }
  })
  await localExportManager.initialize()

  protocol.handle('gtnh-data', async (request) => {
    const url = new URL(request.url)
    const commit = url.hostname
    const file = url.pathname.replace(/^\/+/, '')
    const selected = await dataManager.getSelected()
    const resolvedCommit = commit === 'current' ? selected?.commit : commit
    if (!resolvedCommit) {
      return new Response('No selected data version', { status: 404 })
    }
    if (file !== 'data.bin.gz' && file !== 'atlas.webp') {
      return new Response('Unknown data file', { status: 404 })
    }
    const filePath = dataManager.getDataFile(
      resolvedCommit,
      file === 'data.bin.gz' ? 'data' : 'atlas'
    )
    return net.fetch(pathToFileURL(filePath).toString())
  })

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
