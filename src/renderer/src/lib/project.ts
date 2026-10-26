import type {
  CachedDataVersion,
  GraphNode,
  MachineRef,
  ProjectDocument,
  ProjectDocumentV1,
  RecipeDetail
} from '../../../shared/types'

export function createProject(version: CachedDataVersion | null): ProjectDocument {
  const now = new Date().toISOString()
  return {
    schemaVersion: 2,
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
  machine: MachineRef,
  position: { x: number; y: number },
  detail?: RecipeDetail
): GraphNode {
  const firstOutput = detail?.outputs[0]
  return {
    id: crypto.randomUUID(),
    machine,
    recipeId: detail?.id,
    position,
    rateMode: 'machines',
    machineCount: 1,
    targetPortKey: firstOutput?.key,
    targetRate: firstOutput ? Math.max(1, firstOutput.amount) : 1,
    voltageTier: detail?.nativeVoltageTier ?? 0,
    choices: {},
    overrides: {
      speedMultiplier: 1,
      powerMultiplier: 1
    }
  }
}

export function isProjectDocument(value: unknown): value is ProjectDocument {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ProjectDocument>
  return (
    candidate.schemaVersion === 2 &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.edges) &&
    Boolean(candidate.data && typeof candidate.viewport === 'object')
  )
}

export function isProjectDocumentV1(value: unknown): value is ProjectDocumentV1 {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ProjectDocumentV1>
  return (
    candidate.schemaVersion === 1 &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.edges)
  )
}

export function migrateProjectV1(
  project: ProjectDocumentV1,
  machines: Record<string, MachineRef>
): ProjectDocument {
  const nodes: GraphNode[] = project.nodes.map((node) => {
    const machine =
      machines[node.id] ??
      ({
        id: node.crafterId ?? `missing-machine:${node.id}`,
        name: '未知机器',
        displayName: '未知机器',
        iconId: 0,
        mod: '',
        multiblock: false
      } satisfies MachineRef)
    return {
      id: node.id,
      machine,
      recipeId: node.recipeId,
      position: { ...node.position },
      rateMode: node.rateMode,
      machineCount: node.machineCount,
      targetPortKey: node.targetPortKey,
      targetRate: node.targetRate,
      voltageTier: node.voltageTier,
      choices: { ...node.choices },
      overrides: { ...node.overrides },
      label: node.label
    }
  })
  return {
    schemaVersion: 2,
    name: project.name,
    data: { ...project.data },
    timeUnit: project.timeUnit,
    nodes,
    edges: project.edges.map((edge) => structuredClone(edge)),
    viewport: { ...project.viewport },
    createdAt: project.createdAt,
    updatedAt: new Date().toISOString()
  }
}

export function cloneProject(
  project: ProjectDocument,
  patch: Partial<ProjectDocument>
): ProjectDocument {
  return {
    ...project,
    ...patch,
    data: patch.data ? { ...project.data, ...patch.data } : project.data,
    viewport: patch.viewport
      ? { ...project.viewport, ...patch.viewport }
      : project.viewport,
    nodes: patch.nodes ?? project.nodes,
    edges: patch.edges ?? project.edges,
    updatedAt: new Date().toISOString()
  }
}

export function unitScale(unit: ProjectDocument['timeUnit']): {
  fromMinute: number
  label: string
} {
  if (unit === 'hour') return { fromMinute: 60, label: '小时' }
  if (unit === 'sec') return { fromMinute: 1 / 60, label: '秒' }
  if (unit === 'tick') return { fromMinute: 1200, label: 'tick' }
  return { fromMinute: 1, label: '分钟' }
}

export function formatRate(value: number, unit: ProjectDocument['timeUnit']): string {
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
