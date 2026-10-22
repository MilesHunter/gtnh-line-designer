import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(
  readFileSync(path.join(root, 'package.json'), 'utf8')
)
const archive = path.resolve(
  process.env.GTNH_ARCHIVE ??
    path.join(
      root,
      'release',
      `GTNH-Line-Designer-${packageJson.version}-portable-x64.zip`
    )
)

if (!existsSync(archive)) {
  throw new Error(`Portable archive not found: ${archive}`)
}

const entries = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)

const isPath = (entry, name) => entry === name || entry.startsWith(`${name}/`)
const forbiddenChecks = [
  ['data cache', (entry) => isPath(entry, 'data')],
  ['workspace', (entry) => isPath(entry, 'workspace')],
  ['logs', (entry) => isPath(entry, 'logs')],
  ['data.bin', (entry) => /(^|\/)data\.bin(?:\.gz)?$/i.test(entry)],
  ['atlas.webp', (entry) => /(^|\/)atlas\.webp$/i.test(entry)],
  [
    'NESQL database',
    (entry) => /(^|\/)nesql-db\.(?:script|properties)$/i.test(entry)
  ],
  ['project file', (entry) => /\.gtnhgraph$/i.test(entry)],
  ['partial download', (entry) => /\.partial$/i.test(entry)]
]

for (const [label, matches] of forbiddenChecks) {
  const found = entries.filter(matches)
  if (found.length > 0) {
    throw new Error(
      `Portable archive contains forbidden ${label}: ${found.slice(0, 5).join(', ')}`
    )
  }
}

if (entries.some((entry) => entry.startsWith('./'))) {
  throw new Error(
    'Portable archive contains "./" entries, which Windows Explorer may show as an empty ZIP'
  )
}

const requiredEntries = [
  'GTNH Line Designer.exe',
  'resources/integrations/manifest.json'
]
for (const required of requiredEntries) {
  if (!entries.includes(required)) {
    throw new Error(`Portable archive is missing required entry: ${required}`)
  }
}

console.log(`Verified portable archive: ${archive}`)
console.log(`  ${entries.length} entries`)
console.log('  no data caches, workspaces, logs, or GTNH recipe assets')
