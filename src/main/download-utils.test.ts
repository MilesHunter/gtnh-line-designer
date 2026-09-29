import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  downloadFileWithFallback,
  type DownloadFileResult
} from './download-utils'

const servers: Server[] = []
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve()))
    )
  )
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })
    )
  )
})

describe('downloadFileWithFallback', () => {
  it('resumes with Range after a terminated response', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'gtnh-download-'))
    temporaryRoots.push(root)
    const destination = path.join(root, 'data.bin')
    const payload = Buffer.alloc(64 * 1024, 7)
    let requests = 0
    const server = createServer((request, response) => {
      requests += 1
      const range = request.headers.range
      if (!range) {
        response.writeHead(200, { 'content-length': String(payload.length) })
        response.write(payload.subarray(0, 1200))
        setTimeout(() => response.socket?.destroy(), 50)
        return
      }
      const start = Number(range.match(/bytes=(\d+)-/)?.[1] ?? 0)
      const chunk = payload.subarray(start)
      response.writeHead(206, {
        'content-length': String(chunk.length),
        'content-range': `bytes ${start}-${payload.length - 1}/${payload.length}`
      })
      response.end(chunk)
    })
    servers.push(server)
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve())
    )
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No test port')
    const url = `http://127.0.0.1:${address.port}/data.bin`
    const controller = new AbortController()

    const result: DownloadFileResult = await downloadFileWithFallback(
      [url],
      destination,
      () => undefined,
      controller.signal
    )
    expect(result.bytes).toBe(payload.length)
    expect(await readFile(destination)).toEqual(payload)
    expect(requests).toBeGreaterThanOrEqual(2)
  }, 20_000)

  it('restarts when the server ignores the Range header', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'gtnh-download-'))
    temporaryRoots.push(root)
    const destination = path.join(root, 'data.bin')
    const payload = Buffer.from('complete-download')
    let requests = 0
    const server = createServer((_request, response) => {
      requests += 1
      if (requests === 1) {
        response.writeHead(200, { 'content-length': '1000' })
        response.write('partial')
        response.socket?.destroy()
        return
      }
      response.writeHead(200, {
        'content-length': String(payload.length)
      })
      response.end(payload)
    })
    servers.push(server)
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve())
    )
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No test port')
    const controller = new AbortController()
    const result = await downloadFileWithFallback(
      [`http://127.0.0.1:${address.port}/data.bin`],
      destination,
      () => undefined,
      controller.signal
    )
    expect(result.bytes).toBe(payload.length)
    expect(await readFile(destination)).toEqual(payload)
  }, 20_000)
})
