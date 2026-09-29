import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const NESQL_COMMIT = 'b5b896ebd9bcf4cfe1f4fad19ccdc7de8414ee57'
const NESQL_VERSION = '0.5.7-ShadowTheAge'
const NESQL_LEGACY_COMMIT = '9f467e16ad40bfa4e7ff042e986579b1d416a9ea'
const NESQL_LEGACY_VERSION = '0.5.6-ShadowTheAge'
const CONVERTER_COMMIT = 'af8c79888ec859913b27543c1381c3c11c24658f'

const root = path.resolve(import.meta.dirname, '..')
const cacheRoot = path.join(root, '.cache', 'integrations')
const resourcesRoot = path.join(root, 'resources', 'integrations')
const nesqlRepo = path.join(cacheRoot, 'nesql-exporter')
const nesqlLegacyRepo = path.join(cacheRoot, 'nesql-exporter-2.8.4')
const nesqlLegacyOutput = path.join(resourcesRoot, 'nesql', '2.8.4')
const converterRepo = path.join(cacheRoot, 'gtnh-calculator')
const converterOutput = path.join(resourcesRoot, 'converter')
const localPluginRepo = path.join(cacheRoot, 'local-plugin-repo')

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(' ')}`)
  execFileSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: 'inherit'
  })
}

function commandOutput(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: 'utf8'
  }).trim()
}

function ensureCheckout(repo, remote, commit) {
  if (existsSync(path.join(repo, '.git'))) {
    const current = commandOutput('git', ['rev-parse', 'HEAD'], { cwd: repo })
    if (current === commit) return
  }
  rmSync(repo, { recursive: true, force: true })
  mkdirSync(path.dirname(repo), { recursive: true })
  run('git', ['clone', '--filter=blob:none', '--no-checkout', remote, repo])
  run('git', ['fetch', '--depth', '1', 'origin', commit], { cwd: repo })
  run('git', ['checkout', '--detach', 'FETCH_HEAD'], { cwd: repo })
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function findJava17() {
  const candidates = [
    process.env.JAVA17_HOME,
    'D:\\jdk-17.0.4.1',
    process.env.JAVA_HOME
  ].filter(Boolean)
  for (const candidate of candidates) {
    const executable = path.join(candidate, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    if (!existsSync(executable)) continue
    const version = spawnSync(executable, ['-version'], {
      encoding: 'utf8'
    })
    const versionText = `${version.stdout ?? ''}${version.stderr ?? ''}`
    if (!versionText.includes('17.')) continue
    return candidate
  }
  throw new Error('NESQL 构建需要 JDK 17；请设置 JAVA17_HOME')
}

async function ensureJava8() {
  const candidates = [
    process.env.JAVA8_HOME,
    'D:\\jdk8',
    'D:\\jdk-8',
    'C:\\Program Files\\Eclipse Adoptium\\jdk-8'
  ].filter(Boolean)
  const isJava8 = (candidate) => {
    const executable = path.join(
      candidate,
      'bin',
      process.platform === 'win32' ? 'java.exe' : 'java'
    )
    if (!existsSync(executable)) return false
    const version = spawnSync(executable, ['-version'], { encoding: 'utf8' })
    return `${version.stdout ?? ''}${version.stderr ?? ''}`.includes('1.8.')
  }
  for (const candidate of candidates) {
    if (isJava8(candidate)) return candidate
  }

  const jdkCache = path.join(cacheRoot, 'jdk8')
  if (isJava8(jdkCache)) return jdkCache
  if (existsSync(jdkCache)) {
    const existing = readdirSync(jdkCache, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(jdkCache, entry.name))
      .find(isJava8)
    if (existing) return existing
  }
  const archive = path.join(cacheRoot, 'temurin-jdk8.zip')
  if (!existsSync(archive)) {
    await downloadFile(
      'https://api.adoptium.net/v3/binary/latest/8/ga/windows/x64/jdk/hotspot/normal/eclipse',
      archive
    )
  }
  rmSync(jdkCache, { recursive: true, force: true })
  ensureDir(jdkCache)
  run('tar', ['-xf', archive, '-C', jdkCache])
  const extracted = readdirSync(jdkCache, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(jdkCache, entry.name))
    .find(isJava8)
  if (!extracted) throw new Error('无法从 Temurin 压缩包定位 JDK 8')
  return extracted
}

function ensureDir(directory) {
  mkdirSync(directory, { recursive: true })
}

function copyOrThrow(source, destination) {
  if (!existsSync(source)) throw new Error(`Missing build output: ${source}`)
  copyFileSync(source, destination)
}

function collectFiles(directory, prefix = '') {
  const files = {}
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = prefix ? path.join(prefix, entry.name) : entry.name
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      Object.assign(files, collectFiles(filePath, relativePath))
    } else if (entry.isFile() && relativePath !== 'manifest.json') {
      files[relativePath.replaceAll('\\', '/')] = {
        bytes: statSync(filePath).size,
        sha256: sha256(filePath)
      }
    }
  }
  return files
}

async function downloadFile(url, destination) {
  mkdirSync(path.dirname(destination), { recursive: true })
  run(process.platform === 'win32' ? 'curl.exe' : 'curl', [
    '-L',
    '--fail',
    '--retry',
    '5',
    '--retry-delay',
    '2',
    '-o',
    destination,
    url
  ])
}

async function prepareRetroFuturaGradlePlugin(repo) {
  const version = '1.3.35'
  const markerPath = path.join(
    localPluginRepo,
    'com',
    'gtnewhorizons',
    'retrofuturagradle',
    'com.gtnewhorizons.retrofuturagradle.gradle.plugin',
    version
  )
  const modulePath = path.join(
    localPluginRepo,
    'com',
    'gtnewhorizons',
    'retrofuturagradle',
    version
  )
  ensureDir(markerPath)
  ensureDir(modulePath)
  const jarPath = path.join(modulePath, `retrofuturagradle-${version}.jar`)
  if (!existsSync(jarPath)) {
    await downloadFile(
      `https://github.com/GTNewHorizons/RetroFuturaGradle/releases/download/${version}/retrofuturagradle-${version}.jar`,
      jarPath
    )
  }
  writeFileSync(
    path.join(modulePath, `retrofuturagradle-${version}.pom`),
    `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.gtnewhorizons</groupId>
  <artifactId>retrofuturagradle</artifactId>
  <version>${version}</version>
  <packaging>jar</packaging>
</project>
`
  )
  writeFileSync(
    path.join(
      markerPath,
      `com.gtnewhorizons.retrofuturagradle.gradle.plugin-${version}.pom`
    ),
    `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.gtnewhorizons.retrofuturagradle</groupId>
  <artifactId>com.gtnewhorizons.retrofuturagradle.gradle.plugin</artifactId>
  <version>${version}</version>
  <packaging>pom</packaging>
  <dependencies>
    <dependency>
      <groupId>com.gtnewhorizons</groupId>
      <artifactId>retrofuturagradle</artifactId>
      <version>${version}</version>
    </dependency>
  </dependencies>
</project>
`
  )

  const settingsPath = path.join(repo, 'settings.gradle.kts')
  let settings = readFileSync(settingsPath, 'utf8')
  if (!settings.includes('local-plugin-repo')) {
    settings = settings.replace(
      'repositories {',
      `repositories {\n        maven("${pathToFileURL(localPluginRepo).href}")`
    )
    writeFileSync(settingsPath, settings)
  }
}

function prepareNesqlBuild(repo, options = {}) {
  const mainPath = path.join(
    repo,
    'src',
    'main',
    'java',
    'com',
    'github',
    'dcysteine',
    'nesql',
    'exporter',
    'main',
    'Main.java'
  )
  let mainSource = readFileSync(mainPath, 'utf8')
  if (!mainSource.includes('org.jboss.logging.provider')) {
    mainSource = mainSource.replace(
      'public final class Main {',
      `public final class Main {
    static {
        // GTNH ships Log4j 2 beta, which is incompatible with this Hibernate
        // version's JBoss Log4j2 bridge. Use the JDK bridge to avoid a
        // NoSuchMethodError on every Hibernate trace call during export.
        System.setProperty("org.jboss.logging.provider", "jdk");
    }
`
    )
    writeFileSync(mainPath, mainSource)
  }

  const buildFile = path.join(repo, 'build.gradle.kts')
  let buildScript = readFileSync(buildFile, 'utf8')
  buildScript = buildScript.replace(
    /compileOnly\("com\.github\.GTNewHorizons:GTNH-Intergalactic:1\.4\.30"\)\s*\{\s*isTransitive = true\s*\}/m,
    '// Optional Intergalactic integration is unused by this exporter build.'
  )
  if (options.legacy) {
    buildScript = buildScript.replace(
      `implementation("com.github.GTNewHorizons:GT5-Unofficial:$gregTech5Version:dev") {
        isTransitive = true
    }`,
      `implementation("com.github.GTNewHorizons:GT5-Unofficial:$gregTech5Version:dev") {
        isTransitive = true
        exclude(group = "com.github.GTNewHorizons", module = "ThaumicTinkerer")
    }`
    )

    const gradlePropertiesPath = path.join(repo, 'gradle.properties')
    let gradleProperties = readFileSync(gradlePropertiesPath, 'utf8')
    const legacyProperties = {
      neiVersion: '2.8.44-GTNH',
      gregTech5Version: '5.09.51.482',
      forestryVersion: '4.10.17',
      railcraftVersion: '9.16.33',
      enderIoVersion: '2.9.28',
      mobsInfoVersion: '0.5.6-GTNH',
      avaritiaVersion: '1.77',
      betterQuestingVersion: '3.7.15-GTNH'
    }
    for (const [key, value] of Object.entries(legacyProperties)) {
      const propertyPattern = new RegExp(`^${key}=.*$`, 'm')
      if (!propertyPattern.test(gradleProperties)) {
        throw new Error(`Missing ${key} in legacy NESQL gradle.properties`)
      }
      gradleProperties = gradleProperties.replace(
        propertyPattern,
        `${key}=${value}`
      )
    }
    writeFileSync(gradlePropertiesPath, gradleProperties)
  }
  writeFileSync(buildFile, buildScript)
}

function prepareConverterBuild(repo) {
  const preProcessorPath = path.join(repo, 'export', 'PackPreProcessor.cs')
  let source = readFileSync(preProcessorPath, 'utf8')
  source = source.replace(
    'var aspects = repository.items.Where(x => x.damage == 0 && x.unlocalizedName == "item.aspect").ToDictionary(x => x.name);',
    `var aspects = repository.items
                .Where(x => x.damage == 0 && x.unlocalizedName == "item.aspect")
                .GroupBy(x => x.name)
                .ToDictionary(x => x.Key, x => x.First());`
  )
  source = source.replace(
    'var crafter = repository.items.First(x => x.name == "Alchemical Furnace");',
    `var crafter = repository.items.FirstOrDefault(x => x.name == "Alchemical Furnace");
            if (crafter == null)
            {
                Console.WriteLine("Unable to find Alchemical Furnace; skipping item aspect recipes.");
                return;
            }`
  )
  source = source.replace(
    'itemOutputs = item.aspects.Select((x, id) => new RecipeProduct<Item> { goods = aspects[x.name], probability = 1, slot = id, amount = x.amount}).ToArray(),',
    'itemOutputs = item.aspects.Where(x => aspects.ContainsKey(x.name)).Select((x, id) => new RecipeProduct<Item> { goods = aspects[x.name], probability = 1, slot = id, amount = x.amount}).ToArray(),'
  )
  writeFileSync(preProcessorPath, source)

  const packConverterPath = path.join(repo, 'export', 'PackConverter.cs')
  let packConverter = readFileSync(packConverterPath, 'utf8')
  packConverter = packConverter.replace(
    /foreach \(var aspectModel in generator\.GetTableContents\(aspect\)\)\s*\{\s*aspects\[aspectModel\.Id\] = aspectModel\.Name;\s*\}/m,
    `foreach (var aspectModel in generator.GetTableContents(aspect))
            {
                aspects[aspectModel.Id] = aspectModel.Name;
                if (!string.IsNullOrEmpty(aspectModel.IconId) &&
                    items.TryGetValue(aspectModel.IconId, out var aspectIcon) &&
                    aspectIcon != null)
                {
                    aspectIcon.name = aspectModel.Name;
                }
            }`
  )
  writeFileSync(packConverterPath, packConverter)

  const memoryMappedPath = path.join(
    repo,
    'export',
    'MemoryMappedPackConverter.cs'
  )
  let memoryMapped = readFileSync(memoryMappedPath, 'utf8')
  memoryMapped = memoryMapped.replace(
    'Array.ConvertAll(serviceItems, x => this.repository.items.First(y => y.name == x))',
    'Array.ConvertAll(serviceItems, x => this.repository.items.FirstOrDefault(y => y.name == x))'
  )
  writeFileSync(memoryMappedPath, memoryMapped)

  const hardcodeFixesPath = path.join(repo, 'export', 'HardcodeFixes.cs')
  let hardcodeFixes = readFileSync(hardcodeFixesPath, 'utf8')
  hardcodeFixes = hardcodeFixes.replace(
    'var canner = repository.recipeTypes.First(x => x.name == "Canner");\n            canner.fluidInputs = canner.fluidOutputs = new RecipeDimensions(1, 1);',
    `var canner = repository.recipeTypes.FirstOrDefault(x => x.name == "Canner");
            if (canner != null)
                canner.fluidInputs = canner.fluidOutputs = new RecipeDimensions(1, 1);`
  )
  hardcodeFixes = hardcodeFixes.replace(
    'var eoh = repository.recipeTypes.First(x => x.name == "Eye of Harmony");\n            eoh.fluidInputs = new RecipeDimensions(1, 3);',
    `var eoh = repository.recipeTypes.FirstOrDefault(x => x.name == "Eye of Harmony");
            if (eoh != null)
                eoh.fluidInputs = new RecipeDimensions(1, 3);`
  )
  writeFileSync(hardcodeFixesPath, hardcodeFixes)
}

ensureDir(cacheRoot)
ensureDir(resourcesRoot)

const integrationManifestPath = path.join(resourcesRoot, 'manifest.json')
if (
  !process.env.FORCE_INTEGRATIONS_BUILD &&
  existsSync(integrationManifestPath)
) {
  try {
    const manifest = JSON.parse(readFileSync(integrationManifestPath, 'utf8'))
    const tracked = Object.entries(manifest.files ?? {})
    const valid = tracked.every(([name, expected]) => {
      const filePath = path.join(resourcesRoot, name)
      return (
        existsSync(filePath) &&
        statSync(filePath).size === expected.bytes &&
        sha256(filePath) === expected.sha256
      )
    })
    const converterName =
      manifest.converter?.executable === 'GTNH.DataExporter.exe'
        ? 'GTNH.DataExporter.exe'
        : 'export.exe'
    if (valid && existsSync(path.join(converterOutput, converterName))) {
      console.log(`Integration resources already valid: ${resourcesRoot}`)
      process.exit(0)
    }
  } catch (error) {
    console.warn('Existing integration manifest is invalid; rebuilding.', error)
  }
}

console.log('Preparing NESQL Exporter', NESQL_VERSION)
ensureCheckout(
  nesqlRepo,
  'https://github.com/ShadowTheAge/nesql-exporter.git',
  NESQL_COMMIT
)
const javaHome = findJava17()
const java8Home = await ensureJava8()
const pathSeparator = process.platform === 'win32' ? ';' : ':'
const gradleEnv = {
  JAVA_HOME: javaHome,
  PATH: `${path.join(javaHome, 'bin')}${pathSeparator}${process.env.PATH ?? ''}`
}
const gradleWrapperProperties = path.join(
  nesqlRepo,
  'gradle',
  'wrapper',
  'gradle-wrapper.properties'
)
const gradleWrapper = readFileSync(gradleWrapperProperties, 'utf8').replace(
  'https\\://services.gradle.org/distributions/gradle-8.7-bin.zip',
  'https\\://mirrors.cloud.tencent.com/gradle/gradle-8.7-bin.zip'
)
writeFileSync(gradleWrapperProperties, gradleWrapper)
const gradlePropertiesPath = path.join(nesqlRepo, 'gradle.properties')
const java8Path = java8Home.replaceAll('\\', '/')
let gradleProperties = readFileSync(gradlePropertiesPath, 'utf8')
if (!gradleProperties.includes('org.gradle.java.installations.paths')) {
  gradleProperties += `\norg.gradle.java.installations.paths=${java8Path}\n`
  writeFileSync(gradlePropertiesPath, gradleProperties)
}
await prepareRetroFuturaGradlePlugin(nesqlRepo)
prepareNesqlBuild(nesqlRepo)
if (process.platform === 'win32') {
  run(
    'cmd.exe',
    [
      '/d',
      '/s',
      '/c',
      'gradlew.bat clean build depsJar'
    ],
    {
      cwd: nesqlRepo,
      env: gradleEnv
    }
  )
} else {
  run(
    './gradlew',
    [
      'clean',
      'build',
      'depsJar'
    ],
    {
      cwd: nesqlRepo,
      env: gradleEnv
    }
  )
}

const libsDir = path.join(nesqlRepo, 'build', 'libs')
const builtJars = readdirSync(libsDir).filter((name) => name.endsWith('.jar'))
const mainJar = builtJars.find(
  (name) =>
    name.startsWith(`NESQL-Exporter-${NESQL_VERSION}`) &&
    !name.includes('-deps') &&
    !name.includes('-sources') &&
    !name.includes('-sql') &&
    !name.includes('-dev')
)
const depsJar = builtJars.find(
  (name) => name === `NESQL-Exporter-${NESQL_VERSION}-deps.jar`
)
if (!mainJar || !depsJar) {
  throw new Error(`NESQL build outputs not found in ${libsDir}: ${builtJars.join(', ')}`)
}
copyOrThrow(path.join(libsDir, mainJar), path.join(resourcesRoot, mainJar))
copyOrThrow(path.join(libsDir, depsJar), path.join(resourcesRoot, depsJar))
copyOrThrow(
  path.join(nesqlRepo, 'LICENSE.md'),
  path.join(resourcesRoot, 'NESQL-LICENSE-LGPLv3.md')
)
run(
  'git',
  [
    'archive',
    '--format=zip',
    `--output=${path.join(resourcesRoot, 'nesql-exporter-source.zip')}`,
    NESQL_COMMIT
  ],
  { cwd: nesqlRepo }
)

console.log('Preparing GTNH 2.8.4 NESQL Exporter', NESQL_LEGACY_VERSION)
ensureCheckout(
  nesqlLegacyRepo,
  'https://github.com/ShadowTheAge/nesql-exporter.git',
  NESQL_LEGACY_COMMIT
)
const legacyGradleWrapperProperties = path.join(
  nesqlLegacyRepo,
  'gradle',
  'wrapper',
  'gradle-wrapper.properties'
)
const legacyGradleWrapper = readFileSync(
  legacyGradleWrapperProperties,
  'utf8'
).replace(
  'https\\://services.gradle.org/distributions/gradle-8.7-bin.zip',
  'https\\://mirrors.cloud.tencent.com/gradle/gradle-8.7-bin.zip'
)
writeFileSync(legacyGradleWrapperProperties, legacyGradleWrapper)
const legacyGradlePropertiesPath = path.join(
  nesqlLegacyRepo,
  'gradle.properties'
)
let legacyGradleProperties = readFileSync(
  legacyGradlePropertiesPath,
  'utf8'
)
if (!legacyGradleProperties.includes('org.gradle.java.installations.paths')) {
  legacyGradleProperties += `\norg.gradle.java.installations.paths=${java8Path}\n`
  writeFileSync(legacyGradlePropertiesPath, legacyGradleProperties)
}
await prepareRetroFuturaGradlePlugin(nesqlLegacyRepo)
prepareNesqlBuild(nesqlLegacyRepo, { legacy: true })
if (process.platform === 'win32') {
  run(
    'cmd.exe',
    ['/d', '/s', '/c', 'gradlew.bat clean build depsJar'],
    {
      cwd: nesqlLegacyRepo,
      env: gradleEnv
    }
  )
} else {
  run('./gradlew', ['clean', 'build', 'depsJar'], {
    cwd: nesqlLegacyRepo,
    env: gradleEnv
  })
}

const legacyLibsDir = path.join(nesqlLegacyRepo, 'build', 'libs')
const legacyBuiltJars = readdirSync(legacyLibsDir).filter((name) =>
  name.endsWith('.jar')
)
const legacyMainJar = legacyBuiltJars.find(
  (name) =>
    name.startsWith(`NESQL-Exporter-${NESQL_LEGACY_VERSION}`) &&
    !name.includes('-deps') &&
    !name.includes('-sources') &&
    !name.includes('-sql') &&
    !name.includes('-dev')
)
const legacyDepsJar = legacyBuiltJars.find(
  (name) => name === `NESQL-Exporter-${NESQL_LEGACY_VERSION}-deps.jar`
)
if (!legacyMainJar || !legacyDepsJar) {
  throw new Error(
    `Legacy NESQL build outputs not found in ${legacyLibsDir}: ${legacyBuiltJars.join(', ')}`
  )
}
rmSync(nesqlLegacyOutput, { recursive: true, force: true })
ensureDir(nesqlLegacyOutput)
copyOrThrow(
  path.join(legacyLibsDir, legacyMainJar),
  path.join(nesqlLegacyOutput, legacyMainJar)
)
copyOrThrow(
  path.join(legacyLibsDir, legacyDepsJar),
  path.join(nesqlLegacyOutput, legacyDepsJar)
)
copyOrThrow(
  path.join(nesqlLegacyRepo, 'LICENSE.md'),
  path.join(nesqlLegacyOutput, 'NESQL-LICENSE-LGPLv3.md')
)
run(
  'git',
  [
    'archive',
    '--format=zip',
    `--output=${path.join(nesqlLegacyOutput, 'nesql-exporter-source.zip')}`,
    NESQL_LEGACY_COMMIT
  ],
  { cwd: nesqlLegacyRepo }
)

console.log('Preparing GTNH data v7 converter')
ensureCheckout(
  converterRepo,
  'https://github.com/ShadowTheAge/gtnh.git',
  CONVERTER_COMMIT
)
prepareConverterBuild(converterRepo)
rmSync(converterOutput, { recursive: true, force: true })
ensureDir(converterOutput)
rmSync(path.join(converterRepo, 'export', 'global.json'), { force: true })
run('dotnet', [
  'publish',
  path.join(converterRepo, 'export', 'export.csproj'),
  '--configuration',
  'Release',
  '--runtime',
  'win-x64',
  '--self-contained',
  'true',
  '-p:PublishSingleFile=true',
  '-p:IncludeNativeLibrariesForSelfExtract=true',
  '-p:DebugType=None',
  '-p:DebugSymbols=false',
  '--output',
  converterOutput
])
copyOrThrow(
  path.join(converterRepo, 'LICENSE'),
  path.join(resourcesRoot, 'GTNH-Calculator-LICENSE-MIT.txt')
)
run(
  'git',
  [
    'archive',
    '--format=zip',
    `--output=${path.join(resourcesRoot, 'gtnh-calculator-source.zip')}`,
    CONVERTER_COMMIT
  ],
  { cwd: converterRepo }
)

const files = collectFiles(resourcesRoot)
for (const name of readdirSync(converterOutput)) {
  const filePath = path.join(converterOutput, name)
  if (!statSync(filePath).isFile()) continue
  files[`converter/${name}`] = {
    bytes: statSync(filePath).size,
    sha256: sha256(filePath)
  }
}
const converterExecutable = [
  'GTNH.DataExporter.exe',
  'export.exe'
]
  .map((name) => path.join(converterOutput, name))
  .find((filePath) => existsSync(filePath))
if (!converterExecutable) throw new Error('Converter executable was not published')

writeFileSync(
  path.join(resourcesRoot, 'manifest.json'),
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      nesql: {
        commit: NESQL_COMMIT,
        version: NESQL_VERSION,
        mainJar,
        depsJar
      },
      nesqlProfiles: {
        modern: {
          commit: NESQL_COMMIT,
          version: NESQL_VERSION,
          mainJar,
          depsJar,
          resourcePath: ''
        },
        'gtnh-2.8.4': {
          commit: NESQL_LEGACY_COMMIT,
          version: NESQL_LEGACY_VERSION,
          mainJar: legacyMainJar,
          depsJar: legacyDepsJar,
          resourcePath: 'nesql/2.8.4'
        }
      },
      converter: {
        commit: CONVERTER_COMMIT,
        executable: path.basename(converterExecutable),
        version: 'data-v7'
      },
      files
    },
    null,
    2
  )
)

console.log(`Integration resources ready: ${resourcesRoot}`)
