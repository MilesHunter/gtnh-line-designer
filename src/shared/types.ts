export const DATA_FORMAT_VERSION = 7
export const DEFAULT_DATA_BRANCH = '2.9.0-v7'
export const DEFAULT_DATA_COMMIT = 'd200440ea31d0357068a294d7312acf1146de909'
export const DATA_REPOSITORY = 'ShadowTheAge/gtnh-data'

export type TimeUnit = 'hour' | 'min' | 'sec' | 'tick'
export type RateMode = 'machines' | 'target'
export type PortDirection = 'input' | 'output'
export type NesqlProfileId = 'modern' | 'gtnh-2.8.4'

export interface VersionChoice {
  label: string
  ref: string
  date?: string
  supported: boolean
  reason?: string
}

export interface DataManifest {
  ref: string
  commit: string
  dataVersion: number
  downloadedAt: string
  dataBytes: number
  atlasBytes: number
  dataSha256: string
  atlasSha256: string
  sourceType?: 'remote' | 'local'
  displayName?: string
  instancePath?: string
  instanceName?: string
  sourceFingerprint?: string
  converterVersion?: string
  nesqlProfile?: NesqlProfileId
  nesqlVersion?: string
}

export interface CachedDataVersion {
  ref: string
  commit: string
  dataVersion: number
  installed: true
  manifest: DataManifest
  sourceType: 'remote' | 'local'
  displayName: string
}

export interface DataStatus {
  writable: boolean
  writableError?: string
  appRoot: string
  dataDirectory: string
  selected: CachedDataVersion | null
  installed: CachedDataVersion[]
  knownVersions: VersionChoice[]
  boundInstance: InstanceBinding | null
  exportSession: ExportSession | null
  localImport: LocalImportProgress | null
}

export interface DownloadProgress {
  ref: string
  stage: 'resolving' | 'download' | 'verify' | 'ready' | 'error'
  file?: 'data' | 'atlas'
  receivedBytes?: number
  totalBytes?: number
  message?: string
}

export interface DownloadResult {
  version: CachedDataVersion
}

export interface InstanceBinding {
  id: string
  gameDir: string
  modsDir: string
  displayName: string
  versionId: string
  nesqlProfile?: NesqlProfileId
  nesqlProfileLabel?: string
  nesqlProfileVersion?: string
  hasNei: boolean
  hasNesql: boolean
  nesqlJars: string[]
  bugtorchFiles: string[]
  sourceFingerprint: string
  boundAt: string
}

export type ExportSessionState =
  | 'preparing'
  | 'waiting-game'
  | 'exporting'
  | 'ready'
  | 'converting'
  | 'imported'
  | 'restoring'
  | 'restored'
  | 'error'

export interface ExportFileTransaction {
  originalPath: string
  backupPath: string
  sha256: string
  kind: 'bugtorch' | 'existing-nesql'
}

export interface ExportJarInstallation {
  sourceName: string
  targetPath: string
  copied: boolean
  sha256: string
}

export interface ExportSession {
  id: string
  gameDir: string
  modsDir: string
  instanceName: string
  repoName: string
  repoPath: string
  state: ExportSessionState
  preparedAt: string
  updatedAt: string
  logOffset: number
  message: string
  nesqlProfile?: NesqlProfileId
  nesqlVersion?: string
  movedFiles: ExportFileTransaction[]
  installedJars: ExportJarInstallation[]
  lastLogLines: string[]
  exportStartedAt?: string
  completionMarkerSeen?: boolean
  gameStoppedAt?: string
  convertedCommit?: string
  error?: string
}

export interface LocalImportProgress {
  sessionId: string
  stage:
    | 'idle'
    | 'inspecting'
    | 'preparing'
    | 'waiting-game'
    | 'exporting'
    | 'ready'
    | 'converting'
    | 'importing'
    | 'restoring'
    | 'done'
    | 'error'
  message: string
  percent?: number
  logTail: string[]
  startedAt: string
  updatedAt: string
  repoPath?: string
  error?: string
}

export interface PortRef {
  nodeId: string
  portKey: string
}

export interface GraphNodeV1 {
  id: string
  recipeId: string
  position: {
    x: number
    y: number
  }
  rateMode: RateMode
  machineCount: number
  targetPortKey?: string
  targetRate: number
  voltageTier: number
  crafterId?: string
  choices: Record<string, number>
  overrides: {
    speedMultiplier: number
    powerMultiplier: number
    parallels?: number
  }
  label?: string
}

export interface GraphEdgeV1 {
  id: string
  source: PortRef
  target: PortRef
  priority: number
  enabled: boolean
}

export interface ProjectDocumentV1 {
  schemaVersion: 1
  name: string
  data: {
    ref: string
    commit: string
    dataVersion: number
  }
  timeUnit: TimeUnit
  nodes: GraphNodeV1[]
  edges: GraphEdgeV1[]
  viewport: {
    x: number
    y: number
    zoom: number
  }
  createdAt: string
  updatedAt: string
}

export interface GoodsSummary {
  id: string
  kind: 'item' | 'fluid' | 'ore'
  name: string
  mod: string
  iconId: number
  tooltip?: string
}

export interface RecipePort {
  key: string
  index: number
  direction: PortDirection
  ioType: number
  goods: GoodsSummary
  slot: number
  amount: number
  probability: number
  containerFluid?: GoodsSummary
  containerEmpty?: GoodsSummary
}

export interface RecipeDetail {
  id: string
  recipeType: string
  category: string
  durationTicks: number
  voltage: number
  amperage: number
  nativeVoltageTier: number
  specialValue: number
  metadata: Record<string, number>
  inputs: RecipePort[]
  outputs: RecipePort[]
  availableCrafters: Array<{
    id: string
    name: string
    iconId: number
    multiblock: boolean
  }>
  defaultCrafterId?: string
  machineHasModel: boolean
}

export interface SearchItemResult extends GoodsSummary {
  productionRecipes: number
  consumptionRecipes: number
}

export type RecipeSearchMode = 'product' | 'ingredient'

export interface SearchRecipeResult {
  id: string
  recipeType: string
  category: string
  durationTicks: number
  voltage: number
  nativeVoltageTier: number
  outputs: GoodsSummary[]
  inputs: GoodsSummary[]
}

export interface RecipeSearchResponse {
  items: SearchItemResult[]
  recipes: SearchRecipeResult[]
  total: number
}

export interface MachineChoice {
  key: string
  label: string
  numeric: boolean
  min: number
  max?: number
  options?: string[]
}

export interface MachineInfo {
  id: string
  name: string
  hasModel: boolean
  fixedVoltageTier?: number
  choices: MachineChoice[]
  info?: string
}

export interface ComputedNode {
  nodeId: string
  recipeId: string
  valid: boolean
  warnings: string[]
  machineInfo: MachineInfo | null
  recipesPerMinute: number
  machineCount: number
  recommendedMachineCount: number
  utilization: number
  overclockTiers: number
  overclockName?: string
  parallels: number
  durationTicks: number
  euPerTick: number
  ports: Array<RecipePort & {
    ratePerMinute: number
  }>
}

export interface FlowSummary {
  goods: GoodsSummary
  amountPerMinute: number
  port: PortRef
}

export interface SolveResult {
  revision: number
  status: 'solved' | 'partial' | 'error'
  error?: string
  nodes: Record<string, ComputedNode>
  edgeFlows: Record<string, number>
  externalInputs: FlowSummary[]
  externalOutputs: FlowSummary[]
  powerByTier: Record<number, number>
  totalPower: number
  cycles: string[][]
  warnings: string[]
}

export type WorkerRequest =
  | { id: number; type: 'load'; dataUrl: string }
  | {
      id: number
      type: 'search'
      query: string
      limit?: number
      mode?: RecipeSearchMode
    }
  | { id: number; type: 'recipe'; recipeId: string }
  | { id: number; type: 'solve'; revision: number; project: ProjectDocumentV1 }

export type WorkerResponse =
  | {
      id: number
      type: 'loaded'
      result: {
        dataVersion: number
        items: number
        fluids: number
        recipeTypes: number
        recipes: number
      }
    }
  | { id: number; type: 'search'; result: RecipeSearchResponse }
  | { id: number; type: 'recipe'; result: RecipeDetail | null }
  | { id: number; type: 'solve'; result: SolveResult }
  | { id: number; type: 'error'; error: string }

export interface AppApi {
  getDataStatus: () => Promise<DataStatus>
  resolveAndDownload: (ref: string) => Promise<DownloadResult>
  cancelDownload: () => Promise<void>
  selectVersion: (commit: string) => Promise<CachedDataVersion>
  chooseGameInstance: () => Promise<InstanceBinding | null>
  refreshGameInstance: () => Promise<{
    binding: InstanceBinding | null
    status: DataStatus
  }>
  prepareNesqlExport: () => Promise<ExportSession>
  refreshExportSession: () => Promise<{
    session: ExportSession | null
    status: DataStatus
  }>
  restoreGameInstance: () => Promise<DataStatus>
  convertLocalExport: () => Promise<{
    version: CachedDataVersion
    status: DataStatus
  }>
  cleanupLocalExport: () => Promise<DataStatus>
  openGameDirectory: () => Promise<void>
  openProject: () => Promise<{ path: string; content: string } | null>
  saveProject: (content: string, path?: string, saveAs?: boolean) => Promise<string | null>
  autosaveProject: (content: string) => Promise<void>
  readAutosave: () => Promise<string | null>
  exportPng: (bytes: Uint8Array, suggestedName: string) => Promise<string | null>
  getAppRoot: () => Promise<string>
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void
  onLocalImportProgress: (callback: (progress: LocalImportProgress) => void) => () => void
}
