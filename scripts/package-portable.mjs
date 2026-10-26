import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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

const checksum = createHash('sha256')
  .update(readFileSync(archive))
  .digest('hex')
  .toUpperCase()
const checksumFile = path.join(releaseDir, 'SHA256SUMS.txt')
writeFileSync(
  checksumFile,
  `${checksum}  ${path.basename(archive)}\n`,
  'utf8'
)

console.log(`Portable archive: ${archive}`)
console.log(`SHA-256: ${checksum}`)
