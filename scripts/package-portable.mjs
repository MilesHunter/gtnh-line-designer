import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
)
const releaseDir = path.resolve(process.env.GTNH_RELEASE_DIR ?? 'release')
const sourceDir = path.join(releaseDir, 'win-unpacked')
const archive = path.join(
  releaseDir,
  `GTNH-Line-Designer-${packageJson.version}-portable-x64.zip`
)

rmSync(archive, { force: true })
const ignoredEntries = new Set(['data', 'workspace', 'logs'])
const entries = readdirSync(sourceDir).filter(
  (name) => !ignoredEntries.has(name)
)
execFileSync(
  'tar',
  ['-a', '-c', '-f', archive, '-C', sourceDir, ...entries],
  {
    stdio: 'inherit'
  }
)

console.log(`Portable archive: ${archive}`)
