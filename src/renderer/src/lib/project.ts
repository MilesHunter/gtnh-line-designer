import type {
  CachedDataVersion,
  GraphNodeV1,
  ProjectDocumentV1,
  RecipeDetail
} from '../../../shared/types'

export function createProject(version: CachedDataVersion | null): ProjectDocumentV1 {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    name: '未命名产线',
    data: {
      ref: version?.ref ?? '',
      commit: version?.commit ?? '',
      dataVersion: version?.dataVersion ?? 7
    },
    timeUnit: 'min',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 0.9 },
    createdAt: now,
    updatedAt: now
  }
}

export function createNode(
  recipeId: string,
  detail: RecipeDetail,
  position: { x: number; y: number }
): GraphNodeV1 {
  const firstOutput = detail.outputs[0]
  return {
    id: crypto.randomUUID(),
    recipeId,
    position,
    rateMode: 'machines',
    machineCount: 1,
    targetPortKey: firstOutput?.key,
    targetRate: firstOutput ? Math.max(1, firstOutput.amount) : 1,
    voltageTier: detail.nativeVoltageTier,
    crafterId: detail.defaultCrafterId,
    choices: {},
    overrides: {
      speedMultiplier: 1,
      powerMultiplier: 1
    }
  }
}

export function cloneProject(
  project: ProjectDocumentV1,
  patch: Partial<ProjectDocumentV1>
): ProjectDocumentV1 {
  return {
    ...project,
    ...patch,
    data: { ...project.data, ...patch.data },
    viewport: { ...project.viewport, ...patch.viewport },
    nodes: patch.nodes ?? project.nodes.map((node) => structuredClone(node)),
    edges: patch.edges ?? project.edges.map((edge) => structuredClone(edge)),
    updatedAt: new Date().toISOString()
  }
}

export function unitScale(unit: ProjectDocumentV1['timeUnit']): {
  fromMinute: number
  label: string
} {
  if (unit === 'hour') return { fromMinute: 60, label: '小时' }
  if (unit === 'sec') return { fromMinute: 1 / 60, label: '秒' }
  if (unit === 'tick') return { fromMinute: 1200, label: 'tick' }
  return { fromMinute: 1, label: '分钟' }
}

export function formatRate(value: number, unit: ProjectDocumentV1['timeUnit']): string {
  const scale = unitScale(unit)
  const converted = value * scale.fromMinute
  if (Math.abs(converted) >= 1_000_000) return `${(converted / 1_000_000).toFixed(2)}M`
  if (Math.abs(converted) >= 1_000) return `${(converted / 1_000).toFixed(2)}K`
  if (Math.abs(converted) >= 100) return converted.toFixed(1)
  if (Math.abs(converted) >= 1) return converted.toFixed(2)
  if (converted === 0) return '0'
  return converted.toFixed(4)
}

export function formatPower(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}G`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  if (value >= 100) return value.toFixed(0)
  return value.toFixed(2)
}
