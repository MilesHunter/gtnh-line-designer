import { app } from 'electron'
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import {
  DATA_FORMAT_VERSION,
  DATA_REPOSITORY,
  DEFAULT_DATA_BRANCH,
  DEFAULT_DATA_COMMIT,
  type CachedDataVersion,
  type DataManifest,
  type DataStatus,
  type DownloadProgress,
  type VersionChoice
} from '../shared/types'
import {
  describeDownloadError,
  downloadFileWithFallback,
  hashFile
} from './download-utils'

const KNOWN_VERSIONS: VersionChoice[] = [
  {
    label: 'GTNH 2.8.0',
    ref: '2.8.0-v4',
    date: '2025-10-01',
    supported: false,
    reason: 'v1 仅支持 data v7'
  },
  {
    label: 'GTNH 2.8.0 - metadata',
    ref: '2.8.0-v5',
    date: '2025-10-16',
    supported: false,
    reason: 'v1 仅支持 data v7'
  },
  {
    label: 'GTNH 2.8.0 - schema update',
    ref: '2.8.0-v6',
    date: '2026-04-13',
    supported: false,
    reason: 'v1 仅支持 data v7'
  },
  {
    label: 'GTNH 2.9.0',
    ref: DEFAULT_DATA_BRANCH,
    date: '2026-07-19',
    supported: true
  }
]

interface ResolvedCommit {
  ref: string
  commit: string
  date?: string
}

interface DownloadProgressCallback {
  (progress: DownloadProgress): void
}

const DEFAULT_DATA_SHA256 =
  '624c9a20c8476dc630c274145dc04c72d7c582e130a3599dc49ce9aee0a2fe73'
const DEFAULT_ATLAS_SHA256 =
  '4079548e2e53a55b85d3809821ea11cfbf1bde898014979e9e6afea62204f185'

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'GTNH-Line-Designer'
    }
  })
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${await response.text()}`)
  }
  return (await response.json()) as T
}

export class DataManager {
  private readonly appRoot: string
  private readonly dataRoot: string
  private readonly cacheRoot: string
  private readonly downloadsRoot: string
  private readonly workspaceRoot: string
  private readonly logsRoot: string
  private writeError?: string
  private activeDownload?: AbortController

  constructor() {
    this.appRoot = app.isPackaged ? path.dirname(process.execPath) : app.getAppPath()
    this.dataRoot = path.join(this.appRoot, 'data')
    this.cacheRoot = path.join(this.dataRoot, 'cache')
    this.downloadsRoot = path.join(this.dataRoot, 'downloads')
    this.workspaceRoot = path.join(this.appRoot, 'workspace')
    this.logsRoot = path.join(this.appRoot, 'logs')
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.cacheRoot, { recursive: true }),
      mkdir(this.downloadsRoot, { recursive: true }),
      mkdir(this.workspaceRoot, { recursive: true }),
      mkdir(this.logsRoot, { recursive: true })
    ])

    const probe = path.join(this.dataRoot, `.write-test-${process.pid}`)
    try {
      await writeFile(probe, 'ok')
      await rm(probe, { force: true })
      this.writeError = undefined
    } catch (error) {
      this.writeError = error instanceof Error ? error.message : String(error)
    }
  }

  getAppRoot(): string {
    return this.appRoot
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot
  }

  getDataFile(commit: string, file: 'data' | 'atlas'): string {
    return path.join(
      this.cacheRoot,
      commit,
      file === 'data' ? 'data.bin.gz' : 'atlas.webp'
    )
  }

  async getStatus(): Promise<DataStatus> {
    const installed = await this.listInstalled()
    const selected = await this.getSelected()
    return {
      writable: this.writeError === undefined,
      writableError: this.writeError,
      appRoot: this.appRoot,
      dataDirectory: this.dataRoot,
      selected,
      installed,
      knownVersions: KNOWN_VERSIONS,
      boundInstance: null,
      exportSession: null,
      localImport: null
    }
  }

  async listInstalled(): Promise<CachedDataVersion[]> {
    let entries: string[]
    try {
      entries = await readdir(this.cacheRoot)
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }

    const installed: CachedDataVersion[] = []
    for (const commit of entries) {
      const manifestPath = path.join(this.cacheRoot, commit, 'manifest.json')
      try {
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as DataManifest
        await this.verifyManifestFiles(manifest)
        installed.push({
          ref: manifest.ref,
          commit: manifest.commit,
          dataVersion: manifest.dataVersion,
          installed: true,
          manifest,
          sourceType: manifest.sourceType ?? 'remote',
          displayName: manifest.displayName ?? manifest.ref
        })
      } catch (error) {
        if (!isMissing(error)) {
          console.warn(`Ignoring invalid data cache ${commit}`, error)
        }
      }
    }
    return installed.sort((a, b) => b.manifest.downloadedAt.localeCompare(a.manifest.downloadedAt))
  }

  async getSelected(): Promise<CachedDataVersion | null> {
    const selectedPath = path.join(this.dataRoot, 'selected.json')
    try {
      const selected = JSON.parse(await readFile(selectedPath, 'utf8')) as {
        commit: string
      }
      const manifestPath = path.join(this.cacheRoot, selected.commit, 'manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as DataManifest
      await this.verifyManifestFiles(manifest)
      return {
        ref: manifest.ref,
        commit: manifest.commit,
        dataVersion: manifest.dataVersion,
        installed: true,
        manifest,
        sourceType: manifest.sourceType ?? 'remote',
        displayName: manifest.displayName ?? manifest.ref
      }
    } catch (error) {
      if (!isMissing(error)) console.warn('Unable to read selected data version', error)
      return null
    }
  }

  async selectVersion(commit: string): Promise<CachedDataVersion> {
    const manifestPath = path.join(this.cacheRoot, commit, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as DataManifest
    await this.verifyManifestFiles(manifest)
    const selected = {
      ref: manifest.ref,
      commit: manifest.commit,
      dataVersion: manifest.dataVersion,
      installed: true as const,
      manifest,
      sourceType: manifest.sourceType ?? ('remote' as const),
      displayName: manifest.displayName ?? manifest.ref
    }
    await this.writeJsonAtomic(path.join(this.dataRoot, 'selected.json'), {
      commit,
      selectedAt: new Date().toISOString()
    })
    return selected
  }

  async resolveCommit(ref: string): Promise<ResolvedCommit> {
    const normalized = ref.trim()
    if (!normalized) throw new Error('版本引用不能为空')

    if (/^[a-f0-9]{7,40}$/i.test(normalized)) {
      return { ref: normalized, commit: normalized }
    }

    if (normalized === DEFAULT_DATA_BRANCH) {
      try {
        const response = await fetchJson<{
          sha: string
          commit: {
            author?: { date?: string }
          }
        }>(
          `https://api.github.com/repos/${DATA_REPOSITORY}/commits/${encodeURIComponent(normalized)}`
        )
        return {
          ref: normalized,
          commit: response.sha,
          date: response.commit.author?.date
        }
      } catch (error) {
        console.warn('Falling back to bundled GTNH 2.9.0 commit', error)
        return {
          ref: normalized,
          commit: DEFAULT_DATA_COMMIT,
          date: '2026-07-19T23:13:40Z'
        }
      }
    }

    const response = await fetchJson<{
      sha: string
      commit: {
        author?: { date?: string }
      }
    }>(
      `https://api.github.com/repos/${DATA_REPOSITORY}/commits/${encodeURIComponent(normalized)}`
    )
    return {
      ref: normalized,
      commit: response.sha,
      date: response.commit.author?.date
    }
  }

  async downloadVersion(
    ref: string,
    onProgress: DownloadProgressCallback
  ): Promise<CachedDataVersion> {
    if (this.writeError) {
      throw new Error(`软件目录不可写：${this.writeError}`)
    }

    onProgress({ ref, stage: 'resolving' })
    const resolved = await this.resolveCommit(ref)
    const oldKnownVersion = KNOWN_VERSIONS.find(
      (version) => version.ref === resolved.ref && !version.supported
    )
    if (oldKnownVersion) {
      throw new Error(`${oldKnownVersion.ref} 使用不受支持的 data 格式，v1 仅支持 data v7`)
    }

    const targetDir = path.join(this.cacheRoot, resolved.commit)
    const manifestPath = path.join(targetDir, 'manifest.json')
    if (await fileExists(manifestPath)) {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as DataManifest
      if (manifest.dataVersion !== DATA_FORMAT_VERSION) {
        throw new Error(`缓存数据格式为 v${manifest.dataVersion}，当前版本仅支持 v7`)
      }
      await this.verifyManifestFiles(manifest)
      onProgress({ ref: resolved.ref, stage: 'ready', message: '已使用本地缓存' })
      return {
        ref: manifest.ref,
        commit: manifest.commit,
        dataVersion: manifest.dataVersion,
        installed: true,
        manifest,
        sourceType: manifest.sourceType ?? 'remote',
        displayName: manifest.displayName ?? manifest.ref
      }
    }

    const tempDir = path.join(this.downloadsRoot, resolved.commit)
    await mkdir(tempDir, { recursive: true })
    const tempData = path.join(tempDir, 'data.bin.gz')
    const tempAtlas = path.join(tempDir, 'atlas.webp')
    const controller = new AbortController()
    this.activeDownload = controller

    try {
      const rawBase = `https://raw.githubusercontent.com/${DATA_REPOSITORY}/${resolved.commit}`
      const pagesBase = 'https://shadowtheage.github.io/gtnh/data'
      const dataResult = await downloadFileWithFallback(
        [
          `${rawBase}/data.bin`,
          ...(resolved.ref === DEFAULT_DATA_BRANCH ? [`${pagesBase}/data.bin`] : [])
        ],
        tempData,
        (receivedBytes, totalBytes) =>
          onProgress({
            ref: resolved.ref,
            stage: 'download',
            file: 'data',
            receivedBytes,
            totalBytes
          }),
        controller.signal
      )

      const atlasResult = await downloadFileWithFallback(
        [
          `${rawBase}/atlas.webp`,
          ...(resolved.ref === DEFAULT_DATA_BRANCH ? [`${pagesBase}/atlas.webp`] : [])
        ],
        tempAtlas,
        (receivedBytes, totalBytes) =>
          onProgress({
            ref: resolved.ref,
            stage: 'download',
            file: 'atlas',
            receivedBytes,
            totalBytes
          }),
        controller.signal
      )

      onProgress({ ref: resolved.ref, stage: 'verify', message: '验证二进制格式' })
      const compressed = await readFile(tempData)
      const unpacked = gunzipSync(compressed)
      const dataVersion = unpacked.readInt32LE(0)
      if (dataVersion !== DATA_FORMAT_VERSION) {
        throw new Error(`该提交的数据格式为 v${dataVersion}，当前版本仅支持 v7`)
      }

      const manifest: DataManifest = {
        ref: resolved.ref,
        commit: resolved.commit,
        dataVersion,
        downloadedAt: new Date().toISOString(),
        dataBytes: dataResult.bytes,
        atlasBytes: atlasResult.bytes,
        dataSha256: dataResult.sha256,
        atlasSha256: atlasResult.sha256
      }
      if (
        resolved.ref === DEFAULT_DATA_BRANCH &&
        manifest.dataSha256 !== DEFAULT_DATA_SHA256
      ) {
        await rm(tempData, { force: true })
        throw new Error('data.bin 校验失败，下载内容与 2.9.0-v7 固定版本不一致')
      }
      if (
        resolved.ref === DEFAULT_DATA_BRANCH &&
        manifest.atlasSha256 !== DEFAULT_ATLAS_SHA256
      ) {
        await rm(tempAtlas, { force: true })
        throw new Error('atlas.webp 校验失败，下载内容与 2.9.0-v7 固定版本不一致')
      }

      await writeFile(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
      await mkdir(path.dirname(targetDir), { recursive: true })
      try {
        await rename(tempDir, targetDir)
      } catch (error) {
        if (await fileExists(manifestPath)) {
          await rm(tempDir, { recursive: true, force: true })
        } else {
          throw error
        }
      }

      onProgress({ ref: resolved.ref, stage: 'ready', message: '数据下载完成' })
      return {
        ref: manifest.ref,
        commit: manifest.commit,
        dataVersion: manifest.dataVersion,
        installed: true,
        manifest,
        sourceType: manifest.sourceType ?? 'remote',
        displayName: manifest.displayName ?? manifest.ref
      }
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'AbortError'
          ? '下载已取消'
          : error instanceof Error
            ? describeDownloadError(error)
            : String(error)
      onProgress({ ref: resolved.ref, stage: 'error', message })
      throw new Error(message)
    } finally {
      if (this.activeDownload === controller) this.activeDownload = undefined
    }
  }

  cancelDownload(): void {
    this.activeDownload?.abort()
  }

  async saveAutosave(content: string): Promise<void> {
    await this.writeJsonAtomic(path.join(this.workspaceRoot, 'autosave.gtnhgraph'), content, true)
  }

  async readAutosave(): Promise<string | null> {
    try {
      return await readFile(path.join(this.workspaceRoot, 'autosave.gtnhgraph'), 'utf8')
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  private async verifyManifestFiles(manifest: DataManifest): Promise<void> {
    const dataPath = this.getDataFile(manifest.commit, 'data')
    const atlasPath = this.getDataFile(manifest.commit, 'atlas')
    const [dataHash, atlasHash] = await Promise.all([
      hashFile(dataPath),
      hashFile(atlasPath)
    ])
    if (dataHash !== manifest.dataSha256 || atlasHash !== manifest.atlasSha256) {
      throw new Error(`缓存 ${manifest.commit.slice(0, 10)} 校验失败，请重新下载`)
    }
  }

  private async writeJsonAtomic(
    destination: string,
    value: unknown,
    raw = false
  ): Promise<void> {
    await mkdir(path.dirname(destination), { recursive: true })
    const temp = `${destination}.${process.pid}.tmp`
    const content = raw
      ? String(value)
      : typeof value === 'string'
        ? value
        : JSON.stringify(value, null, 2)
    await writeFile(temp, content)
    await rename(temp, destination)
  }
}
