import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalExportManager } from './local-export-manager'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })
    )
  )
})

async function createFixture(): Promise<{
  root: string
  appRoot: string
  gameDir: string
  resourceRoot: string
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'gtnh-line-designer-'))
  temporaryRoots.push(root)
  const appRoot = path.join(root, 'app')
  const gameDir = path.join(root, 'game')
  const resourceRoot = path.join(root, 'resources')
  await mkdir(path.join(appRoot, 'data'), { recursive: true })
  await mkdir(path.join(gameDir, 'mods'), { recursive: true })
  await mkdir(path.join(gameDir, 'logs'), { recursive: true })
  await mkdir(resourceRoot, { recursive: true })

  await writeFile(
    path.join(gameDir, 'GT New Horizons Test.json'),
    JSON.stringify({ id: 'GT New Horizons Test' })
  )
  await writeFile(path.join(gameDir, 'mods', 'gregtech-test.jar'), 'gt')
  await writeFile(
    path.join(gameDir, 'mods', 'GTNewHorizonsCoreMod-test.jar'),
    'core'
  )
  await writeFile(
    path.join(gameDir, 'mods', 'NotEnoughItems-test.jar'),
    'nei'
  )
  await writeFile(path.join(gameDir, 'mods', 'bugtorch-1.2.15.jar'), 'bugtorch')
  await writeFile(path.join(gameDir, 'logs', 'latest.log'), 'game started\n')

  await writeFile(
    path.join(resourceRoot, 'NESQL-Exporter-0.5.7-ShadowTheAge.jar'),
    'nesql-main'
  )
  await writeFile(
    path.join(resourceRoot, 'NESQL-Exporter-0.5.7-ShadowTheAge-deps.jar'),
    'nesql-deps'
  )
  return { root, appRoot, gameDir, resourceRoot }
}

describe('LocalExportManager', () => {
  it('detects a GTNH instance and prepares a reversible export transaction', async () => {
    const fixture = await createFixture()
    const manager = new LocalExportManager({
      appRoot: fixture.appRoot,
      resourceRoot: fixture.resourceRoot
    })
    await manager.initialize()

    const binding = await manager.inspectAndBind(fixture.gameDir)
    expect(binding.hasNei).toBe(true)
    expect(binding.hasNesql).toBe(false)
    expect(binding.nesqlProfile).toBe('modern')
    expect(binding.nesqlProfileVersion).toBe('0.5.7-ShadowTheAge')
    expect(binding.bugtorchFiles).toEqual(['bugtorch-1.2.15.jar'])

    const session = await manager.prepareExport()
    expect(session.state).toBe('waiting-game')
    await expect(
      stat(path.join(fixture.gameDir, 'mods', 'bugtorch-1.2.15.jar'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      stat(
        path.join(
          fixture.gameDir,
          '.gtnh-line-designer',
          'sessions',
          session.id,
          'disabled',
          'bugtorch-1.2.15.jar'
        )
      )
    ).resolves.toBeTruthy()
    await expect(
      stat(
        path.join(
          fixture.gameDir,
          'mods',
          'NESQL-Exporter-0.5.7-ShadowTheAge.jar'
        )
      )
    ).resolves.toBeTruthy()

    await manager.restoreInstance()
    expect((await manager.getState().exportSession)?.state).toBe('restored')
    expect(
      await readFile(path.join(fixture.gameDir, 'mods', 'bugtorch-1.2.15.jar'), 'utf8')
    ).toBe('bugtorch')
    await expect(
      stat(
        path.join(
          fixture.gameDir,
          'mods',
          'NESQL-Exporter-0.5.7-ShadowTheAge.jar'
        )
      )
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('selects the bundled GTNH 2.8.4 NESQL profile for an exact 2.8.4 instance', async () => {
    const fixture = await createFixture()
    const gameDir = path.join(fixture.root, 'game-2.8.4')
    const modsDir = path.join(gameDir, 'mods')
    const legacyResourceRoot = path.join(
      fixture.resourceRoot,
      'nesql',
      '2.8.4'
    )
    await mkdir(modsDir, { recursive: true })
    await mkdir(path.join(gameDir, 'logs'), { recursive: true })
    await mkdir(legacyResourceRoot, { recursive: true })
    await writeFile(
      path.join(gameDir, 'GT New Horizons 2.8.4.json'),
      JSON.stringify({ id: 'GT New Horizons 2.8.4' })
    )
    await writeFile(
      path.join(modsDir, 'gregtech-5.09.51.482.jar'),
      'legacy-gt'
    )
    await writeFile(
      path.join(modsDir, 'GTNewHorizonsCoreMod-2.7.268.jar'),
      'legacy-core'
    )
    await writeFile(
      path.join(modsDir, 'NotEnoughItems-2.8.44-GTNH.jar'),
      'legacy-nei'
    )
    await writeFile(path.join(modsDir, 'bugtorch-1.2.14.jar'), 'bugtorch')
    await writeFile(
      path.join(legacyResourceRoot, 'NESQL-Exporter-0.5.6-ShadowTheAge.jar'),
      'legacy-nesql-main'
    )
    await writeFile(
      path.join(
        legacyResourceRoot,
        'NESQL-Exporter-0.5.6-ShadowTheAge-deps.jar'
      ),
      'legacy-nesql-deps'
    )

    const manager = new LocalExportManager({
      appRoot: fixture.appRoot,
      resourceRoot: fixture.resourceRoot
    })
    await manager.initialize()
    const binding = await manager.inspectAndBind(gameDir)
    expect(binding.nesqlProfile).toBe('gtnh-2.8.4')
    expect(binding.nesqlProfileLabel).toBe('GTNH 2.8.4')
    expect(binding.nesqlProfileVersion).toBe('0.5.6-ShadowTheAge')

    const session = await manager.prepareExport()
    expect(session.nesqlProfile).toBe('gtnh-2.8.4')
    expect(session.nesqlVersion).toBe('0.5.6-ShadowTheAge')
    expect(
      await readFile(
        path.join(modsDir, 'NESQL-Exporter-0.5.6-ShadowTheAge.jar'),
        'utf8'
      )
    ).toBe('legacy-nesql-main')
    await expect(
      stat(path.join(modsDir, 'NESQL-Exporter-0.5.7-ShadowTheAge.jar'))
    ).rejects.toMatchObject({ code: 'ENOENT' })

    await manager.restoreInstance()
    expect(
      await readFile(path.join(modsDir, 'bugtorch-1.2.14.jar'), 'utf8')
    ).toBe('bugtorch')
    await expect(
      stat(path.join(modsDir, 'NESQL-Exporter-0.5.6-ShadowTheAge.jar'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('marks an export ready only when the session log and files complete', async () => {
    const fixture = await createFixture()
    const manager = new LocalExportManager({
      appRoot: fixture.appRoot,
      resourceRoot: fixture.resourceRoot
    })
    await manager.initialize()
    await manager.inspectAndBind(fixture.gameDir)
    const session = await manager.prepareExport()
    const repoPath = session.repoPath
    await mkdir(repoPath, { recursive: true })
    await writeFile(
      path.join(repoPath, 'nesql-db.script'),
      Buffer.alloc(1_000_100, 1)
    )
    await writeFile(path.join(repoPath, 'nesql-db.properties'), 'properties')
    await writeFile(path.join(repoPath, 'image.zip'), Buffer.alloc(1_000_100, 2))
    await writeFile(
      path.join(fixture.gameDir, 'logs', 'latest.log'),
      'game started\nExporting data to:\nExport complete!\n',
      { flag: 'a' }
    )

    const refreshed = await manager.refreshExportSession()
    expect(refreshed?.state).toBe('ready')
    expect(refreshed?.repoPath).toBe(repoPath)
  })

  it('accepts complete database files without relying on the chat completion marker', async () => {
    const fixture = await createFixture()
    const manager = new LocalExportManager({
      appRoot: fixture.appRoot,
      resourceRoot: fixture.resourceRoot,
      stabilityDurationMs: 0
    })
    await manager.initialize()
    await manager.inspectAndBind(fixture.gameDir)
    const session = await manager.prepareExport()
    await mkdir(session.repoPath, { recursive: true })
    await writeFile(
      path.join(session.repoPath, 'nesql-db.script'),
      Buffer.alloc(1_000_100)
    )
    await writeFile(
      path.join(session.repoPath, 'nesql-db.properties'),
      'properties'
    )
    await writeFile(
      path.join(session.repoPath, 'image.zip'),
      Buffer.alloc(1_000_100)
    )
    await writeFile(
      path.join(fixture.gameDir, 'logs', 'latest.log'),
      'Exporting data...\n',
      { flag: 'a' }
    )

    const refreshed = await manager.refreshExportSession()
    expect(refreshed?.state).toBe('ready')
    expect(refreshed?.message).toMatch(/按文件状态确认完成/)
  })

  it('keeps waiting while the HSQLDB lock exists even if database files are unchanged', async () => {
    const fixture = await createFixture()
    const manager = new LocalExportManager({
      appRoot: fixture.appRoot,
      resourceRoot: fixture.resourceRoot,
      stabilityDurationMs: 0
    })
    await manager.initialize()
    await manager.inspectAndBind(fixture.gameDir)
    const session = await manager.prepareExport()
    await mkdir(session.repoPath, { recursive: true })
    await writeFile(
      path.join(session.repoPath, 'nesql-db.script'),
      Buffer.alloc(1_655)
    )
    await writeFile(
      path.join(session.repoPath, 'nesql-db.properties'),
      'properties'
    )
    await writeFile(path.join(session.repoPath, 'image.zip'), Buffer.alloc(22))
    await writeFile(path.join(session.repoPath, 'nesql-db.lck'), 'locked')
    await writeFile(
      path.join(fixture.gameDir, 'logs', 'latest.log'),
      'Exporting data...\n',
      { flag: 'a' }
    )

    const refreshed = await manager.refreshExportSession()
    expect(refreshed?.state).toBe('exporting')
    expect(refreshed?.message).toMatch(/事务内处理配方/)
  })

  it('rolls back copied jars and BugTorch when preparation fails', async () => {
    const fixture = await createFixture()
    const depsJar = path.join(
      fixture.resourceRoot,
      'NESQL-Exporter-0.5.7-ShadowTheAge-deps.jar'
    )
    await rm(depsJar)
    await mkdir(depsJar)
    const manager = new LocalExportManager({
      appRoot: fixture.appRoot,
      resourceRoot: fixture.resourceRoot
    })
    await manager.initialize()
    await manager.inspectAndBind(fixture.gameDir)
    await expect(manager.prepareExport()).rejects.toBeTruthy()
    expect(
      await readFile(
        path.join(fixture.gameDir, 'mods', 'bugtorch-1.2.15.jar'),
        'utf8'
      )
    ).toBe('bugtorch')
    await expect(
      stat(
        path.join(
          fixture.gameDir,
          'mods',
          'NESQL-Exporter-0.5.7-ShadowTheAge.jar'
        )
      )
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('replaces a stale same-name NESQL jar and restores it afterwards', async () => {
    const fixture = await createFixture()
    const installedJar = path.join(
      fixture.gameDir,
      'mods',
      'NESQL-Exporter-0.5.7-ShadowTheAge.jar'
    )
    await writeFile(installedJar, 'stale-nesql')
    const manager = new LocalExportManager({
      appRoot: fixture.appRoot,
      resourceRoot: fixture.resourceRoot
    })
    await manager.initialize()
    await manager.inspectAndBind(fixture.gameDir)
    const resolvedInstalledJar = path.join(
      await realpath(fixture.gameDir),
      'mods',
      'NESQL-Exporter-0.5.7-ShadowTheAge.jar'
    )

    const session = await manager.prepareExport()
    expect(await readFile(installedJar, 'utf8')).toBe('nesql-main')
    expect(session.movedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          originalPath: resolvedInstalledJar,
          kind: 'existing-nesql'
        })
      ])
    )

    await manager.restoreInstance()
    expect(await readFile(installedJar, 'utf8')).toBe('stale-nesql')
  })

  it('does not accept a stopped export that has no completion marker', async () => {
    const fixture = await createFixture()
    const manager = new LocalExportManager({
      appRoot: fixture.appRoot,
      resourceRoot: fixture.resourceRoot
    })
    await manager.initialize()
    await manager.inspectAndBind(fixture.gameDir)
    const session = await manager.prepareExport()
    await mkdir(session.repoPath, { recursive: true })
    await writeFile(
      path.join(session.repoPath, 'nesql-db.script'),
      Buffer.alloc(1_000_100)
    )
    await writeFile(
      path.join(session.repoPath, 'nesql-db.properties'),
      'properties'
    )
    await writeFile(
      path.join(session.repoPath, 'image.zip'),
      Buffer.alloc(1_000_100)
    )
    await writeFile(path.join(session.repoPath, 'nesql-db.lck'), 'locked')
    await writeFile(
      path.join(fixture.gameDir, 'logs', 'latest.log'),
      'Exporting data...\nStopping!\n',
      { flag: 'a' }
    )

    const refreshed = await manager.refreshExportSession()
    expect(refreshed?.state).toBe('error')
    expect(refreshed?.error).toMatch(/导出完成前已停止/)
  })

  it('refuses to bind a directory without a GTNH instance', async () => {
    const fixture = await createFixture()
    await rm(path.join(fixture.gameDir, 'mods', 'gregtech-test.jar'))
    await rm(
      path.join(fixture.gameDir, 'mods', 'GTNewHorizonsCoreMod-test.jar')
    )
    const manager = new LocalExportManager({
      appRoot: fixture.appRoot,
      resourceRoot: fixture.resourceRoot
    })
    await manager.initialize()
    await expect(manager.inspectAndBind(fixture.gameDir)).rejects.toThrow(
      /没有检测到 GTNH/
    )
  })
})

const realGtnhInstance =
  'G:\\MineCraft\\GTNH\\GTNewHorizons-2.8.4\\versions\\GT New Horizons 2.9.0-beta-3'
const realGtnh284Instance =
  'G:\\MineCraft\\GTNH\\GTNewHorizons-2.8.4\\versions\\GT New Horizons 2.8.4'

describe.skipIf(!existsSync(realGtnhInstance))(
  'LocalExportManager with a real GTNH instance',
  () => {
    it('inspects the configured 2.9.0-beta-3 instance without changing it', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'gtnh-inspect-'))
      temporaryRoots.push(root)
      const appRoot = path.join(root, 'app')
      const resourceRoot = path.join(root, 'resources')
      await mkdir(appRoot, { recursive: true })
      await mkdir(resourceRoot, { recursive: true })
      const manager = new LocalExportManager({ appRoot, resourceRoot })
      await manager.initialize()
      const binding = await manager.inspectAndBind(realGtnhInstance)
      expect(binding.hasNei).toBe(true)
      expect(
        binding.bugtorchFiles.includes('bugtorch-1.2.15.jar') ||
          binding.hasNesql
      ).toBe(true)
      expect(binding.displayName).toContain('2.9.0-beta-3')
    })
  }
)

describe.skipIf(!existsSync(realGtnh284Instance))(
  'LocalExportManager with the configured GTNH 2.8.4 instance',
  () => {
    it('inspects the real 2.8.4 instance and selects its legacy NESQL profile', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'gtnh-inspect-'))
      temporaryRoots.push(root)
      const appRoot = path.join(root, 'app')
      const resourceRoot = path.join(root, 'resources')
      await mkdir(appRoot, { recursive: true })
      await mkdir(resourceRoot, { recursive: true })
      const manager = new LocalExportManager({ appRoot, resourceRoot })
      await manager.initialize()
      const binding = await manager.inspectAndBind(realGtnh284Instance)
      expect(binding.hasNei).toBe(true)
      expect(binding.nesqlProfile).toBe('gtnh-2.8.4')
      expect(binding.nesqlProfileVersion).toBe('0.5.6-ShadowTheAge')
      expect(binding.displayName).toBe('GT New Horizons 2.8.4')
    })
  }
)
