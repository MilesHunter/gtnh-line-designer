import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'

export interface DownloadFileResult {
  bytes: number
  sha256: string
}

export interface DownloadProgressCallback {
  (received: number, total?: number): void
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}

export async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', resolve)
  })
  return hash.digest('hex')
}

export async function downloadFileWithFallback(
  urls: string[],
  destination: string,
  onProgress: DownloadProgressCallback,
  signal: AbortSignal,
  attemptsPerUrl = 4
): Promise<DownloadFileResult> {
  let lastError: unknown
  for (const url of urls) {
    try {
      return await downloadToFile(
        url,
        destination,
        onProgress,
        signal,
        attemptsPerUrl
      )
    } catch (error) {
      if (signal.aborted) throw error
      lastError = error
      console.warn(`Download failed for ${url}; trying fallback if available`, error)
    }
  }
  throw lastError ?? new Error('没有可用的下载地址')
}

export async function downloadToFile(
  url: string,
  destination: string,
  onProgress: DownloadProgressCallback,
  signal: AbortSignal,
  attempts = 4
): Promise<DownloadFileResult> {
  const part = `${destination}.part`
  let lastError: unknown

  try {
    if ((await stat(destination)).size >= 0) {
      return {
        bytes: (await stat(destination)).size,
        sha256: await hashFile(destination)
      }
    }
  } catch (error) {
    if (!isMissing(error)) throw error
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      let existing = 0
      try {
        existing = (await stat(part)).size
      } catch (error) {
        if (!isMissing(error)) throw error
      }

      const response = await fetch(url, {
        signal,
        headers: {
          'User-Agent': 'GTNH-Line-Designer',
          ...(existing > 0 ? { Range: `bytes=${existing}-` } : {})
        }
      })
      if (response.status === 416 && existing > 0) {
        await rm(part, { force: true })
        continue
      }
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`)
      }

      const resuming = response.status === 206 && existing > 0
      if (!resuming && existing > 0) {
        await rm(part, { force: true })
        existing = 0
      }

      const contentRange = response.headers.get('content-range')
      const rangeTotal = contentRange?.match(/\/(\d+)$/)?.[1]
      const contentLength = response.headers.get('content-length')
      const total = rangeTotal
        ? Number(rangeTotal)
        : contentLength
          ? Number(contentLength) + existing
          : undefined
      let received = existing
      const stream: WriteStream = createWriteStream(part, {
        flags: resuming ? 'a' : 'w'
      })

      for await (const chunk of Readable.fromWeb(response.body as never)) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        received += buffer.length
        if (!stream.write(buffer)) {
          await new Promise<void>((resolve, reject) => {
            stream.once('drain', resolve)
            stream.once('error', reject)
          })
        }
        onProgress(received, total)
      }
      await new Promise<void>((resolve, reject) => {
        stream.end((error?: Error | null) => (error ? reject(error) : resolve()))
      })
      if (total !== undefined && received !== total) {
        throw new Error(`下载不完整：${received}/${total} 字节`)
      }

      const sha256 = await hashFile(part)
      const bytes = (await stat(part)).size
      await rm(destination, { force: true })
      await rename(part, destination)
      return { bytes, sha256 }
    } catch (error) {
      lastError = error
      if (signal.aborted) throw error
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt))
      }
    }
  }

  throw lastError ?? new Error(`下载失败：${url}`)
}

export async function moveDirectoryWithRetry(
  source: string,
  destination: string,
  attempts = 6
): Promise<void> {
  let lastError: unknown
  const retryable = new Set(['EPERM', 'EACCES', 'EBUSY', 'EEXIST', 'ENOTEMPTY'])

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await mkdir(path.dirname(destination), { recursive: true })
      await rm(destination, {
        recursive: true,
        force: true,
        maxRetries: 2,
        retryDelay: 100
      })
      await rename(source, destination)
      return
    } catch (error) {
      lastError = error
      const code = (error as NodeJS.ErrnoException).code
      if (!code || !retryable.has(code) || attempt === attempts - 1) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt))
    }
  }

  throw lastError ?? new Error('无法移动下载目录')
}

export function describeDownloadError(error: Error): string {
  const message = error.message
  if (
    message === 'terminated' ||
    /terminated|ECONNRESET|socket hang up|network/i.test(message)
  ) {
    return '网络连接被中断。已保留断点文件，可稍后继续下载。'
  }
  if (/fetch failed/i.test(message)) {
    return '网络请求失败。请检查代理或网络连接后继续下载。'
  }
  return message
}
