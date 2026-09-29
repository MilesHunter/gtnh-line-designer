import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  statfs,
  writeFile
} from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import {
  DATA_FORMAT_VERSION,
  type CachedDataVersion,
  type DataManifest,
  type ExportFileTransaction,
  type ExportJarInstallation,
  type ExportSession,
  type InstanceBinding,
  type LocalImportProgress,
  type NesqlProfileId
} from '../shared/types'

const CONVERTER_SOURCE_COMMIT = 'af8c79888ec859913b27543c1381c3c11c24658f'
const CONVERTER_VERSION = `${CONVERTER_SOURCE_COMMIT.slice(0, 10)}-v7`

interface NesqlProfile {
  id: NesqlProfileId
  label: string
  version: string
  mainJar: string
  depsJar: string
  resourceSegments: string[]
}

const NESQL_PROFILES: Record<NesqlProfileId, NesqlProfile> = {
  modern: {
    id: 'modern',
    label: 'GTNH 2.9.x',
    version: '0.5.7-ShadowTheAge',
    mainJar: 'NESQL-Exporter-0.5.7-ShadowTheAge.jar',
    depsJar: 'NESQL-Exporter-0.5.7-ShadowTheAge-deps.jar',
    resourceSegments: []
  },
  'gtnh-2.8.4': {
    id: 'gtnh-2.8.4',
    label: 'GTNH 2.8.4',
    version: '0.5.6-ShadowTheAge',
    mainJar: 'NESQL-Exporter-0.5.6-ShadowTheAge.jar',
    depsJar: 'NESQL-Exporter-0.5.6-ShadowTheAge-deps.jar',
    resourceSegments: ['nesql', '2.8.4']
  }
}

const NESQL_JAR_PATTERN = /^NESQL-Exporter-.*\.jar$/i

function getNesqlProfile(id: NesqlProfileId | undefined): NesqlProfile {
  return NESQL_PROFILES[id ?? 'modern'] ?? NESQL_PROFILES.modern
}

function detectNesqlProfile(
  versionId: string | null,
  modFiles: string[]
): NesqlProfileId {
  const normalizedVersion = (versionId ?? '').toLocaleLowerCase()
  const nei = modFiles.find((name) => /^NotEnoughItems-.*\.jar$/i.test(name)) ?? ''
  const gregTech =
    modFiles.find((name) => /^gregtech-.*\.jar$/i.test(name)) ?? ''
  const exact284 =
    normalizedVersion.includes('2.8.4') ||
    (gregTech === 'gregtech-5.09.51.482.jar' &&
      nei === 'NotEnoughItems-2.8.44-GTNH.jar')
  return exact284 ? 'gtnh-2.8.4' : 'modern'
}

interface LocalExportManagerOptions {
  appRoot: string
  resourceRoot: string
  onProgress?: (progress: LocalImportProgress) => void
  stabilityDurationMs?: number
}

interface PersistedLocalState {
  boundInstance: InstanceBinding | null
  exportSession: ExportSession | null
  localImport: LocalImportProgress | null
}

type LocalProgressPatch = Pick<LocalImportProgress, 'stage' | 'message'> &
  Partial<Omit<LocalImportProgress, 'stage' | 'message' | 'updatedAt'>> & {
    startedAt?: string
  }

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  hash.update(await readFile(filePath))
  return hash.digest('hex')
}

function shortHash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 20)
}

function now(): string {
  return new Date().toISOString()
}

function safeSessionId(value: string): string {
  return value.replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 40)
}

function stableMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export class LocalExportManager {
  private readonly appRoot: string
  private readonly dataRoot: string
  private readonly resourceRoot: string
  private readonly statePath: string
  private readonly cacheRoot: string
  private readonly importsRoot: string
  private readonly onProgress?: (progress: LocalImportProgress) => void
  private readonly stabilityDurationMs: number
  private readonly stability = new Map<
    string,
    { signature: string; since: number }
  >()
  private state: PersistedLocalState = {
    boundInstance: null,
    exportSession: null,
    localImport: null
  }
  private activeConverter?: ReturnType<typeof spawn>
  private saveChain: Promise<void> = Promise.resolve()

  constructor(options: LocalExportManagerOptions) {
    this.appRoot = options.appRoot
    this.dataRoot = path.join(options.appRoot, 'data')
    this.resourceRoot = options.resourceRoot
    this.statePath = path.join(this.dataRoot, 'local-source.json')
    this.cacheRoot = path.join(this.dataRoot, 'cache')
    this.importsRoot = path.join(this.dataRoot, 'imports')
    this.onProgress = options.onProgress
    this.stabilityDurationMs = options.stabilityDurationMs ?? 15_000
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.dataRoot, { recursive: true }),
      mkdir(this.cacheRoot, { recursive: true }),
      mkdir(this.importsRoot, { recursive: true })
    ])
    try {
      this.state = JSON.parse(
        await readFile(this.statePath, 'utf8')
      ) as PersistedLocalState
    } catch (error) {
      if (!isMissing(error)) {
        console.warn('Unable to read local instance state', error)
      }
    }
    if (this.state.exportSession) {
      await this.refreshExportSession()
    }
  }

  getState(): PersistedLocalState {
    return this.state
  }

  getResourceRoot(): string {
    return this.resourceRoot
  }

  async inspectAndBind(gameDir: string): Promise<InstanceBinding> {
    this.setProgress({
      stage: 'inspecting',
      message: '正在检查游戏实例…'
    })
    try {
      const binding = await this.inspectInstance(gameDir)
      this.state.boundInstance = binding
      await this.saveState()
      this.setProgress({
        stage: 'idle',
        message: binding.hasNesql
          ? '检测到已安装 NESQL，可直接准备或读取既有导出。'
          : '实例检查完成，可以准备 NESQL 导出环境。'
      })
      return binding
    } catch (error) {
      const message = stableMessage(error)
      this.setProgress({ stage: 'error', message, error: message })
      throw error
    }
  }

  async refreshBinding(): Promise<InstanceBinding | null> {
    if (!this.state.boundInstance) return null
    this.state.boundInstance = await this.inspectInstance(
      this.state.boundInstance.gameDir
    )
    await this.saveState()
    return this.state.boundInstance
  }

  async prepareExport(): Promise<ExportSession> {
    if (
      this.state.exportSession &&
      this.state.exportSession.state !== 'restored'
    ) {
      throw new Error(
        '当前已有导出环境或导入任务；请先“恢复游戏模组”，再准备新的导出任务'
      )
    }
    const binding =
      (await this.refreshBinding()) ??
      (() => {
        throw new Error('请先选择游戏实例')
      })()
    if (!binding.hasNei) {
      throw new Error('实例 mods 中没有找到 NotEnoughItems，无法导出 NEI 配方')
    }
    const nesqlProfile = getNesqlProfile(binding.nesqlProfile)
    const nesqlResourceRoot = path.join(
      this.resourceRoot,
      ...nesqlProfile.resourceSegments
    )
    if (!(await exists(path.join(nesqlResourceRoot, nesqlProfile.mainJar)))) {
      throw new Error(
        `缺少 ${nesqlProfile.label} 专用的 NESQL 主程序 ${nesqlProfile.mainJar}，请先运行 npm run integrations:build`
      )
    }
    if (!(await exists(path.join(nesqlResourceRoot, nesqlProfile.depsJar)))) {
      throw new Error(
        `缺少 ${nesqlProfile.label} 专用的 NESQL 依赖 ${nesqlProfile.depsJar}，请先运行 npm run integrations:build`
      )
    }

    const disk = await statfs(binding.gameDir)
    const freeBytes = Number(disk.bavail) * Number(disk.bsize)
    if (freeBytes < 2 * 1024 * 1024 * 1024) {
      throw new Error('游戏实例所在磁盘至少需要 2 GB 可用空间用于 NESQL 导出')
    }

    const id = `${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${Math.random()
      .toString(36)
      .slice(2, 7)}`
    const repoName = `gtnh-line-designer-${id.slice(-5)}`
    const sessionRoot = path.join(
      binding.gameDir,
      '.gtnh-line-designer',
      'sessions',
      id
    )
    const disabledRoot = path.join(sessionRoot, 'disabled')
    const repoPath = path.join(binding.gameDir, 'nesql', repoName)
    await mkdir(disabledRoot, { recursive: true })

    let logOffset = 0
    try {
      logOffset = (await stat(path.join(binding.gameDir, 'logs', 'latest.log'))).size
    } catch (error) {
      if (!isMissing(error)) throw error
    }

    const session: ExportSession = {
      id,
      gameDir: binding.gameDir,
      modsDir: binding.modsDir,
      instanceName: binding.displayName,
      repoName,
      repoPath,
      state: 'preparing',
      preparedAt: now(),
      updatedAt: now(),
      logOffset,
      message: `正在创建可逆导出环境（${nesqlProfile.label} / NESQL ${nesqlProfile.version}）…`,
      nesqlProfile: nesqlProfile.id,
      nesqlVersion: nesqlProfile.version,
      movedFiles: [],
      installedJars: [],
      lastLogLines: []
    }
    this.state.exportSession = session
    this.setProgress({
      stage: 'preparing',
      message: session.message,
      repoPath
    })
    await this.saveState()

    try {
      for (const bugtorchName of binding.bugtorchFiles) {
        const originalPath = path.join(binding.modsDir, bugtorchName)
        const backupPath = path.join(disabledRoot, bugtorchName)
        const hash = await sha256File(originalPath)
        await moveFile(originalPath, backupPath)
        session.movedFiles.push({
          originalPath,
          backupPath,
          sha256: hash,
          kind: 'bugtorch'
        })
      }

      const existingNesql = (await readdir(binding.modsDir)).filter(
        (name) =>
          NESQL_JAR_PATTERN.test(name) &&
          name !== nesqlProfile.mainJar &&
          name !== nesqlProfile.depsJar
      )
      for (const jarName of existingNesql) {
        const originalPath = path.join(binding.modsDir, jarName)
        const backupPath = path.join(disabledRoot, jarName)
        const hash = await sha256File(originalPath)
        await moveFile(originalPath, backupPath)
        session.movedFiles.push({
          originalPath,
          backupPath,
          sha256: hash,
          kind: 'existing-nesql'
        })
      }

      for (const jarName of [nesqlProfile.mainJar, nesqlProfile.depsJar]) {
        const sourcePath = path.join(nesqlResourceRoot, jarName)
        const targetPath = path.join(binding.modsDir, jarName)
        const hash = await sha256File(sourcePath)
        if (!(await exists(targetPath))) {
          session.installedJars.push({
            sourceName: jarName,
            targetPath,
            copied: true,
            sha256: hash
          })
          await copyFile(sourcePath, targetPath)
        } else {
          const targetHash = await sha256File(targetPath)
          if (targetHash === hash) {
            session.installedJars.push({
              sourceName: jarName,
              targetPath,
              copied: false,
              sha256: targetHash
            })
          } else {
            const backupPath = path.join(disabledRoot, jarName)
            await moveFile(targetPath, backupPath)
            session.movedFiles.push({
              originalPath: targetPath,
              backupPath,
              sha256: targetHash,
              kind: 'existing-nesql'
            })
            session.installedJars.push({
              sourceName: jarName,
              targetPath,
              copied: true,
              sha256: hash
            })
            await copyFile(sourcePath, targetPath)
          }
        }
      }

      session.state = 'waiting-game'
      session.message = `${nesqlProfile.label} 导出环境已准备（NESQL ${nesqlProfile.version}），请手动启动游戏并执行命令。`
      session.updatedAt = now()
      await this.saveState()
      this.setProgress({
        stage: 'waiting-game',
        message: session.message,
        repoPath,
        logTail: session.lastLogLines
      })
      return session
    } catch (error) {
      session.state = 'error'
      session.error = stableMessage(error)
      session.message = `准备失败：${session.error}`
      session.updatedAt = now()
      await this.removeCopiedJars(session).catch(() => undefined)
      await this.restoreMovedFiles(session).catch(() => undefined)
      await this.saveState()
      this.setProgress({
        stage: 'error',
        message: session.message,
        error: session.error,
        repoPath,
        logTail: session.lastLogLines
      })
      throw error
    }
  }

  async refreshExportSession(): Promise<ExportSession | null> {
    const session = this.state.exportSession
    if (!session) return null
    if (session.state === 'imported' || session.state === 'restored') {
      return session
    }

    try {
      const logPath = path.join(session.gameDir, 'logs', 'latest.log')
      try {
        const logSize = (await stat(logPath)).size
        if (logSize < session.logOffset) session.logOffset = 0
      } catch (error) {
        if (!isMissing(error)) throw error
      }
      const lines = await this.readNewLogLines(logPath, session.logOffset)
      const exportMarkers = [
        'Exporting data to:',
        'Exporting data...',
        'Initializing plugins.'
      ]
      if (
        !session.exportStartedAt &&
        session.lastLogLines.some((line) =>
          exportMarkers.some((marker) => line.includes(marker))
        )
      ) {
        session.exportStartedAt = session.updatedAt
      }
      if (
        session.completionMarkerSeen === undefined &&
        session.lastLogLines.some((line) => line.includes('Export complete!'))
      ) {
        session.completionMarkerSeen = true
      }
      if (lines.length) {
        session.lastLogLines = [...session.lastLogLines, ...lines].slice(-40)
        session.logOffset = (await stat(logPath)).size
        for (const line of lines) {
          if (exportMarkers.some((marker) => line.includes(marker))) {
            session.exportStartedAt ??= now()
            session.state = 'exporting'
            session.message = '游戏正在导出 NEI 与 GT 配方数据…'
          }
          if (line.includes('Export complete!')) {
            session.completionMarkerSeen = true
            session.message = '游戏日志已报告导出完成，正在核对文件…'
          }
          if (
            session.exportStartedAt &&
            (line.includes('Stopping!') || line.includes('Stopping server'))
          ) {
            session.gameStoppedAt ??= now()
          }
        }
      }
      const fatalLine =
        lines.find(
          (line) =>
            line.includes('Something went wrong during export') ||
            line.includes('NEI item list is empty') ||
            line.includes('Cannot create repository') ||
            line.includes('Failed to create repository') ||
            line.includes('Failed to create image zip file')
        ) ??
        session.lastLogLines.find(
          (line) =>
            line.includes('Something went wrong during export') ||
            line.includes('NEI item list is empty') ||
            line.includes('Cannot create repository') ||
            line.includes('Failed to create repository') ||
            line.includes('Failed to create image zip file')
        )
      if (fatalLine) {
        session.state = 'error'
        session.error = fatalLine
        session.message = fatalLine
      }

      const required = [
        path.join(session.repoPath, 'nesql-db.script'),
        path.join(session.repoPath, 'nesql-db.properties'),
        path.join(session.repoPath, 'image.zip')
      ]
      const fileStates = await Promise.all(
        required.map(async (filePath) => {
          try {
            const info = await stat(filePath)
            return { exists: true, size: info.size, mtimeMs: info.mtimeMs }
          } catch (error) {
            if (isMissing(error)) return { exists: false, size: 0, mtimeMs: 0 }
            throw error
          }
        })
      )
      const allPresent = fileStates.every((entry) => entry.exists)
      const scriptSize = fileStates[0]?.size ?? 0
      const imageSize = fileStates[2]?.size ?? 0
      const hasLock = await exists(
        path.join(session.repoPath, 'nesql-db.lck')
      )
      const hasTemp = await exists(
        path.join(session.repoPath, 'nesql-db.tmp')
      )
      const exportStarted =
        Boolean(session.exportStartedAt) ||
        hasLock ||
        hasTemp ||
        (allPresent && (scriptSize > 0 || imageSize > 0))
      if (exportStarted && !session.exportStartedAt) {
        session.exportStartedAt = session.updatedAt
      }
      if (
        session.exportStartedAt &&
        !session.gameStoppedAt &&
        session.lastLogLines.some(
          (line) => line.includes('Stopping!') || line.includes('Stopping server')
        )
      ) {
        session.gameStoppedAt = session.updatedAt
      }
      const completeInLog = session.completionMarkerSeen === true
      const stoppedBeforeComplete =
        Boolean(session.gameStoppedAt) && !completeInLog
      const payloadsComplete =
        allPresent &&
        scriptSize > 1_000_000 &&
        imageSize > 1_000_000
      const filesComplete = payloadsComplete && !hasLock && !hasTemp
      const signature = fileStates.map((entry) => `${entry.size}:${entry.mtimeMs}`).join('|')

      if (allPresent) {
        const previous = this.stability.get(session.id)
        if (!previous || previous.signature !== signature) {
          this.stability.set(session.id, { signature, since: Date.now() })
        }
        const stableFor =
          Date.now() - (this.stability.get(session.id)?.since ?? Date.now())
        if (fatalLine) {
          session.state = 'error'
          session.error = fatalLine
          session.message = fatalLine
        } else if (
          filesComplete &&
          (completeInLog ||
            stoppedBeforeComplete ||
            stableFor >= this.stabilityDurationMs)
        ) {
          session.state = 'ready'
          session.message = completeInLog
            ? 'NESQL 导出完成，可以生成本地配方。'
            : '数据库锁已释放且导出文件完整，已按文件状态确认完成。'
          session.error = undefined
        } else if (exportStarted && stoppedBeforeComplete) {
          session.state = 'error'
          session.error =
            '游戏在 NESQL 报告导出完成前已停止，当前仓库不完整。'
          session.message = `${session.error} 请恢复模组后重新准备导出。`
        } else if (session.state !== 'error' || exportStarted) {
          session.state = 'exporting'
          session.error = undefined
          session.message = completeInLog
            ? '游戏日志已报告导出完成，正在等待数据库锁释放和图片文件关闭…'
            : hasLock
              ? 'HSQLDB 正在事务内处理配方；数据库脚本暂时不增长属于正常现象，请保持游戏运行。'
              : hasTemp
                ? 'HSQLDB 正在压缩或合并数据库，请保持游戏运行。'
                : payloadsComplete
                  ? '导出数据已写入，正在完成最后的文件稳定性检查…'
                  : 'NESQL 正在导出，等待数据库提交；请勿退出世界或关闭游戏。'
        }
      }
      session.updatedAt = now()
      await this.saveState()
      this.publishSessionProgress(session)
      return session
    } catch (error) {
      session.state = 'error'
      session.error = stableMessage(error)
      session.message = `监控导出失败：${session.error}`
      session.updatedAt = now()
      await this.saveState()
      this.publishSessionProgress(session)
      return session
    }
  }

  async convertExport(): Promise<CachedDataVersion> {
    const session = await this.refreshExportSession()
    if (!session) throw new Error('没有可转换的 NESQL 导出任务')
    const required = [
      path.join(session.repoPath, 'nesql-db.script'),
      path.join(session.repoPath, 'image.zip')
    ]
    for (const filePath of required) {
      if (!(await exists(filePath))) {
        throw new Error(`缺少 NESQL 导出文件：${path.basename(filePath)}`)
      }
    }

    const converter = await this.findConverter()
    const staging = path.join(this.importsRoot, session.id)
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })

    session.state = 'converting'
    session.message = '正在将 HSQLDB 转换为 data v7…'
    session.updatedAt = now()
    await this.saveState()
    this.setProgress({
      stage: 'converting',
      message: session.message,
      repoPath: session.repoPath,
      logTail: []
    })

    try {
      const output = await this.runConverter(
        converter,
        session.repoPath,
        staging,
        session.gameDir
      )
      session.lastLogLines = [...session.lastLogLines, ...output].slice(-40)
      const rawDataPath = path.join(staging, 'data.bin')
      const atlasPath = path.join(staging, 'atlas.webp')
      const rawData = await readFile(rawDataPath)
      let unpackedData: Buffer
      try {
        unpackedData = gunzipSync(rawData)
      } catch {
        throw new Error('转换器输出的 data.bin 不是有效的 gzip 数据')
      }
      const dataVersion = unpackedData.readInt32LE(0)
      if (dataVersion !== DATA_FORMAT_VERSION) {
        throw new Error(
          `转换器输出 data v${dataVersion}，当前应用仅支持 v${DATA_FORMAT_VERSION}`
        )
      }
      if (!(await exists(atlasPath))) {
        throw new Error('转换器没有生成 atlas.webp')
      }

      this.setProgress({
        stage: 'importing',
        message: '正在校验并写入本地数据缓存…',
        percent: 92,
        repoPath: session.repoPath,
        logTail: output.slice(-12)
      })

      const binding = this.state.boundInstance
      const scriptInfo = await stat(path.join(session.repoPath, 'nesql-db.script'))
      const imageInfo = await stat(path.join(session.repoPath, 'image.zip'))
      const fingerprint = shortHash(
        [
          binding?.sourceFingerprint ?? '',
          session.instanceName,
          String(scriptInfo.size),
          String(scriptInfo.mtimeMs),
          String(imageInfo.size),
          String(imageInfo.mtimeMs),
          String(rawData.length),
          String((await stat(atlasPath)).size),
          session.nesqlProfile ?? '',
          session.nesqlVersion ?? ''
        ].join('\n')
      )
      const commit = `local-${fingerprint}`
      const gzipData = rawData
      const dataSha256 = createHash('sha256').update(gzipData).digest('hex')
      const atlas = await readFile(atlasPath)
      const atlasSha256 = createHash('sha256').update(atlas).digest('hex')
      const manifest: DataManifest = {
        ref: `本机导出 · ${session.instanceName}`,
        commit,
        dataVersion,
        downloadedAt: now(),
        dataBytes: gzipData.length,
        atlasBytes: atlas.length,
        dataSha256,
        atlasSha256,
        sourceType: 'local',
        displayName: session.instanceName,
        instancePath: session.gameDir,
        instanceName: session.instanceName,
        sourceFingerprint: fingerprint,
        converterVersion: CONVERTER_VERSION,
        nesqlProfile: session.nesqlProfile,
        nesqlVersion: session.nesqlVersion
      }

      const target = path.join(this.cacheRoot, commit)
      const tempTarget = path.join(this.cacheRoot, `.local-${session.id}.tmp`)
      await rm(tempTarget, { recursive: true, force: true })
      await mkdir(tempTarget, { recursive: true })
      await writeFile(path.join(tempTarget, 'data.bin.gz'), gzipData)
      await writeFile(path.join(tempTarget, 'atlas.webp'), atlas)
      await writeFile(
        path.join(tempTarget, 'manifest.json'),
        JSON.stringify(manifest, null, 2)
      )
      await rm(target, { recursive: true, force: true })
      await rename(tempTarget, target)
      await this.writeJsonAtomic(path.join(this.dataRoot, 'selected.json'), {
        commit,
        selectedAt: now()
      })

      session.state = 'imported'
      session.message = `已生成本地数据版本 ${manifest.ref}`
      session.convertedCommit = commit
      session.updatedAt = now()
      await this.saveState()
      this.setProgress({
        stage: 'done',
        message: session.message,
        percent: 100,
        repoPath: session.repoPath,
        logTail: output.slice(-12)
      })
      return {
        ref: manifest.ref,
        commit,
        dataVersion,
        installed: true,
        manifest,
        sourceType: 'local',
        displayName: session.instanceName
      }
    } catch (error) {
      session.state = 'ready'
      session.error = stableMessage(error)
      session.message = `转换失败：${session.error}`
      session.updatedAt = now()
      await this.saveState()
      this.setProgress({
        stage: 'error',
        message: session.message,
        error: session.error,
        repoPath: session.repoPath,
        logTail: session.lastLogLines.slice(-12)
      })
      throw error
    }
  }

  async restoreInstance(): Promise<void> {
    const session = this.state.exportSession
    if (!session) return
    session.state = 'restoring'
    session.message = '正在恢复游戏模组…'
    session.updatedAt = now()
    await this.saveState()
    this.setProgress({
      stage: 'restoring',
      message: session.message,
      repoPath: session.repoPath
    })

    try {
      await this.removeCopiedJars(session)
      await this.restoreMovedFiles(session)
      session.state = 'restored'
      session.message = '原游戏模组已恢复，NESQL 导出数据仍保留。'
      session.error = undefined
      session.updatedAt = now()
      await this.saveState()
      this.setProgress({
        stage: 'idle',
        message: session.message,
        repoPath: session.repoPath
      })
    } catch (error) {
      session.state = 'error'
      session.error = stableMessage(error)
      session.message = `恢复失败：${session.error}。请关闭游戏后重试。`
      session.updatedAt = now()
      await this.saveState()
      this.setProgress({
        stage: 'error',
        message: session.message,
        error: session.error,
        repoPath: session.repoPath
      })
      throw error
    }
  }

  async cleanupExport(): Promise<void> {
    const session = this.state.exportSession
    if (!session) return
    const nesqlRoot = path.resolve(session.gameDir, 'nesql')
    const repoPath = path.resolve(session.repoPath)
    if (
      path.dirname(repoPath) !== nesqlRoot ||
      path.basename(repoPath) !== session.repoName ||
      !session.repoName.startsWith('gtnh-line-designer-')
    ) {
      throw new Error('拒绝清理不在本应用导出目录中的数据')
    }
    await rm(repoPath, { recursive: true, force: true })
    session.message = '本次 NESQL 原始导出已清理。'
    session.updatedAt = now()
    await this.saveState()
    this.setProgress({
      stage: 'idle',
      message: session.message,
      repoPath
    })
  }

  cancelConversion(): void {
    if (this.activeConverter) {
      this.activeConverter.kill()
      this.activeConverter = undefined
    }
  }

  private async inspectInstance(gameDir: string): Promise<InstanceBinding> {
    const resolved = await realpath(path.resolve(gameDir))
    const modsDir = path.join(resolved, 'mods')
    const modsInfo = await stat(modsDir).catch(() => null)
    if (!modsInfo?.isDirectory()) {
      throw new Error('所选目录下没有 mods 文件夹，请选择正确的游戏实例 gameDir')
    }

    const probe = path.join(resolved, `.gtnh-line-designer-${process.pid}.tmp`)
    await writeFile(probe, 'ok')
    await rm(probe, { force: true })

    const modFiles = (await readdir(modsDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jar'))
      .map((entry) => entry.name)
    const modStats = await Promise.all(
      modFiles.map(async (name) => {
        const info = await stat(path.join(modsDir, name))
        return `${name}:${info.size}`
      })
    )
    modStats.sort()

    const hasNei = modFiles.some((name) =>
      /^NotEnoughItems-.*\.jar$/i.test(name)
    )
    const hasGregTech = modFiles.some(
      (name) =>
        /^gregtech-.*\.jar$/i.test(name) ||
        /^GTNewHorizonsCoreMod-.*\.jar$/i.test(name)
    )
    if (!hasGregTech) {
      throw new Error('所选实例没有检测到 GTNH / GregTech，请选择正确的 gameDir')
    }

    const versionId =
      (await this.readVersionId(resolved)) || path.basename(resolved)
    const nesqlProfileId = detectNesqlProfile(versionId, modFiles)
    const nesqlProfile = getNesqlProfile(nesqlProfileId)
    const sourceFingerprint = shortHash(
      [resolved.toLowerCase(), versionId, ...modStats].join('\n')
    )
    return {
      id: `instance-${sourceFingerprint}`,
      gameDir: resolved,
      modsDir,
      displayName: versionId,
      versionId,
      nesqlProfile: nesqlProfile.id,
      nesqlProfileLabel: nesqlProfile.label,
      nesqlProfileVersion: nesqlProfile.version,
      hasNei,
      hasNesql: modFiles.some((name) => /^NESQL-Exporter-.*\.jar$/i.test(name)),
      nesqlJars: modFiles.filter((name) =>
        /^NESQL-Exporter-.*\.jar$/i.test(name)
      ),
      bugtorchFiles: modFiles.filter((name) => /^bugtorch-.*\.jar$/i.test(name)),
      sourceFingerprint,
      boundAt: now()
    }
  }

  private async readVersionId(gameDir: string): Promise<string | null> {
    const candidates = [
      ...(await this.jsonFiles(gameDir)),
      ...(await this.jsonFiles(
        path.join(path.dirname(path.dirname(gameDir)), 'versions', path.basename(gameDir))
      ))
    ]
    for (const filePath of candidates) {
      try {
        const parsed = JSON.parse(await readFile(filePath, 'utf8')) as {
          id?: string
          rfbVersionJson?: boolean
        }
        if (parsed.id && parsed.id.trim()) return parsed.id.trim()
      } catch {
        // Ignore non-version JSON files.
      }
    }
    return null
  }

  private async jsonFiles(directory: string): Promise<string[]> {
    try {
      return (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => path.join(directory, entry.name))
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
  }

  private async readNewLogLines(
    logPath: string,
    offset: number
  ): Promise<string[]> {
    try {
      const content = await readFile(logPath)
      if (content.length <= offset) return []
      const chunk = content.subarray(offset).toString('utf8')
      return chunk
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
  }

  private async findConverter(): Promise<string> {
    const candidates = [
      path.join(this.resourceRoot, 'converter', 'GTNH.DataExporter.exe'),
      path.join(this.resourceRoot, 'converter', 'export.exe')
    ]
    for (const candidate of candidates) {
      if (await exists(candidate)) return candidate
    }
    throw new Error(
      '缺少内置 data v7 转换器，请先运行 npm run integrations:build'
    )
  }

  private runConverter(
    executable: string,
    repoPath: string,
    outputPath: string,
    gameDir: string
  ): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const log: string[] = []
      const child = spawn(
        executable,
        [repoPath, '--output', outputPath, '--minecraft', gameDir],
        {
          cwd: path.dirname(executable),
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        }
      )
      this.activeConverter = child
      const consume = (chunk: Buffer): void => {
        const lines = chunk
          .toString('utf8')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
        log.push(...lines)
        const session = this.state.exportSession
        if (session) {
          session.lastLogLines = [...session.lastLogLines, ...lines].slice(-40)
          session.updatedAt = now()
          void this.saveState()
        }
        this.setProgress({
          stage: 'converting',
          message: lines.at(-1) ?? '正在转换 NESQL 数据库…',
          repoPath,
          logTail: log.slice(-16)
        })
      }
      child.stdout?.on('data', consume)
      child.stderr?.on('data', consume)
      child.once('error', (error) => {
        this.activeConverter = undefined
        reject(error)
      })
      child.once('exit', (code) => {
        this.activeConverter = undefined
        if (code === 0) resolve(log)
        else reject(new Error(`转换器退出码 ${code}\n${log.slice(-12).join('\n')}`))
      })
    })
  }

  private async restoreMovedFiles(session: ExportSession): Promise<void> {
    for (const transaction of [...session.movedFiles].reverse()) {
      if (!(await exists(transaction.backupPath))) continue
      if (await exists(transaction.originalPath)) {
        const existingHash = await sha256File(transaction.originalPath)
        if (existingHash === transaction.sha256) {
          await rm(transaction.backupPath, { force: true })
          continue
        }
        throw new Error(`原位置已有不同文件，无法恢复 ${transaction.originalPath}`)
      }
      await mkdir(path.dirname(transaction.originalPath), { recursive: true })
      await moveFile(transaction.backupPath, transaction.originalPath)
    }
  }

  private async removeCopiedJars(session: ExportSession): Promise<void> {
    for (const installed of session.installedJars) {
      if (!installed.copied) continue
      if (!(await exists(installed.targetPath))) continue
      const currentHash = await sha256File(installed.targetPath)
      if (currentHash !== installed.sha256) {
        throw new Error(
          `拒绝删除被外部修改的文件 ${path.basename(installed.targetPath)}`
        )
      }
      await rm(installed.targetPath, { force: true })
    }
  }

  private publishSessionProgress(session: ExportSession): void {
    const stage =
      session.state === 'waiting-game'
        ? 'waiting-game'
        : session.state === 'exporting'
          ? 'exporting'
          : session.state === 'ready'
            ? 'ready'
            : session.state === 'error'
              ? 'error'
              : 'idle'
    this.setProgress({
      stage,
      message: session.message,
      repoPath: session.repoPath,
      error: session.error,
      logTail: session.lastLogLines.slice(-16)
    })
  }

  private setProgress(patch: LocalProgressPatch): LocalImportProgress {
    const previous = this.state.localImport
    const progress: LocalImportProgress = {
      sessionId:
        patch.sessionId ?? previous?.sessionId ?? this.state.exportSession?.id ?? '',
      stage: patch.stage,
      message: patch.message,
      percent: patch.percent,
      logTail: patch.logTail ?? previous?.logTail ?? [],
      startedAt: patch.startedAt ?? previous?.startedAt ?? now(),
      updatedAt: now(),
      repoPath: patch.repoPath ?? previous?.repoPath,
      error: patch.error
    }
    this.state.localImport = progress
    void this.saveState().catch((error) => {
      console.warn('Unable to persist local import progress', error)
    })
    this.onProgress?.(progress)
    return progress
  }

  private async saveState(): Promise<void> {
    this.saveChain = this.saveChain
      .catch(() => undefined)
      .then(() => this.writeJsonAtomic(this.statePath, this.state))
    await this.saveChain
  }

  private async writeJsonAtomic(destination: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(destination), { recursive: true })
    const temp = `${destination}.${process.pid}.tmp`
    try {
      await writeFile(temp, JSON.stringify(value, null, 2))
      await rename(temp, destination)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined)
      throw error
    }
  }
}

async function moveFile(source: string, destination: string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true })
  try {
    await rename(source, destination)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await copyFile(source, destination)
    await rm(source, { force: true })
  }
}
