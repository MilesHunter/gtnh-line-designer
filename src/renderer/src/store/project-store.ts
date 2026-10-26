import { create } from 'zustand'
import type {
  CachedDataVersion,
  ComputedNode,
  GraphEdge,
  GraphNode,
  MachineRef,
  ProjectDocument,
  RecipeDetail,
  SolveResult
} from '../../../shared/types'
import { cloneProject, createNode, createProject } from '../lib/project'

interface ProjectState {
  project: ProjectDocument
  recipes: Record<string, RecipeDetail>
  previews: Record<string, ComputedNode | null>
  selectedNodeId: string | null
  selectedEdgeId: string | null
  solveResult: SolveResult | null
  solveStale: boolean
  solving: boolean
  dirty: boolean
  currentPath?: string
  invalidNodes: Record<string, string[]>
  invalidEdges: Record<string, string[]>
  past: HistoryEntry[]
  future: HistoryEntry[]
  initializeProject: (version: CachedDataVersion | null) => void
  loadProject: (project: ProjectDocument, path?: string) => void
  registerRecipe: (detail: RecipeDetail) => void
  setPreviews: (previews: Record<string, ComputedNode | null>) => void
  clearPreviews: () => void
  addNode: (
    machine: MachineRef,
    position: { x: number; y: number },
    detail?: RecipeDetail
  ) => GraphNode
  setNodeRecipe: (id: string, machine: MachineRef, detail: RecipeDetail) => void
  setNodeMachine: (id: string, machine: MachineRef) => void
  duplicateNodes: (ids: string[]) => void
  removeNodes: (ids: string[]) => void
  updateNode: (id: string, patch: Partial<GraphNode>, history?: boolean) => void
  setNodePositions: (
    positions: Array<{ id: string; x: number; y: number }>,
    history?: boolean
  ) => void
  addEdge: (edge: Omit<GraphEdge, 'id'>) => void
  updateEdge: (id: string, patch: Partial<GraphEdge>, history?: boolean) => void
  removeEdges: (ids: string[], history?: boolean) => void
  setSelection: (nodeId?: string | null, edgeId?: string | null) => void
  setViewport: (viewport: ProjectDocument['viewport']) => void
  setTimeUnit: (unit: ProjectDocument['timeUnit']) => void
  pushHistory: () => void
  commitHistory: () => void
  setSolving: (solving: boolean) => void
  setSolveResult: (result: SolveResult) => void
  setValidation: (
    nodes: Record<string, string[]>,
    edges: Record<string, string[]>
  ) => void
  clearValidation: () => void
  setCurrentPath: (path?: string) => void
  markSaved: () => void
  undo: () => void
  redo: () => void
}

interface NodeHistoryChange {
  id: string
  before?: GraphNode
  after?: GraphNode
  beforeIndex: number
  afterIndex: number
}

interface EdgeHistoryChange {
  id: string
  before?: GraphEdge
  after?: GraphEdge
  beforeIndex: number
  afterIndex: number
}

interface HistoryEntry {
  nodes: NodeHistoryChange[]
  edges: EdgeHistoryChange[]
  timeUnit?: {
    before: ProjectDocument['timeUnit']
    after: ProjectDocument['timeUnit']
  }
}

let pendingDragBefore: ProjectDocument | null = null

function historyEntry(
  before: ProjectDocument,
  after: ProjectDocument
): HistoryEntry {
  const beforeNodes = new Map(before.nodes.map((node, index) => [node.id, { node, index }]))
  const afterNodes = new Map(after.nodes.map((node, index) => [node.id, { node, index }]))
  const nodeIds = new Set([...beforeNodes.keys(), ...afterNodes.keys()])
  const nodes: NodeHistoryChange[] = []
  for (const id of nodeIds) {
    const previous = beforeNodes.get(id)
    const next = afterNodes.get(id)
    if (previous?.node === next?.node) continue
    nodes.push({
      id,
      before: previous?.node,
      after: next?.node,
      beforeIndex: previous?.index ?? -1,
      afterIndex: next?.index ?? -1
    })
  }

  const beforeEdges = new Map(before.edges.map((edge, index) => [edge.id, { edge, index }]))
  const afterEdges = new Map(after.edges.map((edge, index) => [edge.id, { edge, index }]))
  const edgeIds = new Set([...beforeEdges.keys(), ...afterEdges.keys()])
  const edges: EdgeHistoryChange[] = []
  for (const id of edgeIds) {
    const previous = beforeEdges.get(id)
    const next = afterEdges.get(id)
    if (previous?.edge === next?.edge) continue
    edges.push({
      id,
      before: previous?.edge,
      after: next?.edge,
      beforeIndex: previous?.index ?? -1,
      afterIndex: next?.index ?? -1
    })
  }

  return {
    nodes,
    edges,
    timeUnit:
      before.timeUnit === after.timeUnit
        ? undefined
        : { before: before.timeUnit, after: after.timeUnit }
  }
}

function isEmptyHistory(entry: HistoryEntry): boolean {
  return !entry.nodes.length && !entry.edges.length && !entry.timeUnit
}

function appendHistory(
  past: HistoryEntry[],
  entry: HistoryEntry
): HistoryEntry[] {
  return isEmptyHistory(entry) ? past : [...past.slice(-99), entry]
}

function applyHistory(
  project: ProjectDocument,
  entry: HistoryEntry,
  side: 'before' | 'after'
): ProjectDocument {
  let nodes = [...project.nodes]
  for (const change of entry.nodes) {
    nodes = nodes.filter((node) => node.id !== change.id)
  }
  const nodeInsertions = entry.nodes
    .map((change) => ({
      index: side === 'before' ? change.beforeIndex : change.afterIndex,
      node: side === 'before' ? change.before : change.after
    }))
    .filter(
      (entry): entry is { index: number; node: GraphNode } =>
        Boolean(entry.node) && entry.index >= 0
    )
    .sort((a, b) => a.index - b.index)
  for (const insertion of nodeInsertions) {
    nodes.splice(Math.min(insertion.index, nodes.length), 0, insertion.node)
  }

  let edges = [...project.edges]
  for (const change of entry.edges) {
    edges = edges.filter((edge) => edge.id !== change.id)
  }
  const edgeInsertions = entry.edges
    .map((change) => ({
      index: side === 'before' ? change.beforeIndex : change.afterIndex,
      edge: side === 'before' ? change.before : change.after
    }))
    .filter(
      (entry): entry is { index: number; edge: GraphEdge } =>
        Boolean(entry.edge) && entry.index >= 0
    )
    .sort((a, b) => a.index - b.index)
  for (const insertion of edgeInsertions) {
    edges.splice(Math.min(insertion.index, edges.length), 0, insertion.edge)
  }

  return cloneProject(project, {
    nodes,
    edges,
    timeUnit:
      side === 'before'
        ? entry.timeUnit?.before ?? project.timeUnit
        : entry.timeUnit?.after ?? project.timeUnit
  })
}

function issueMap(
  issues: Array<{ nodeId?: string; edgeId?: string; message: string }>
): {
  nodes: Record<string, string[]>
  edges: Record<string, string[]>
} {
  const nodes: Record<string, string[]> = {}
  const edges: Record<string, string[]> = {}
  for (const issue of issues) {
    if (issue.nodeId) (nodes[issue.nodeId] ??= []).push(issue.message)
    if (issue.edgeId) (edges[issue.edgeId] ??= []).push(issue.message)
  }
  return { nodes, edges }
}

function withoutNodeEdges(edges: GraphEdge[], nodeId: string): GraphEdge[] {
  return edges.filter(
    (edge) => edge.source.nodeId !== nodeId && edge.target.nodeId !== nodeId
  )
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: createProject(null),
  recipes: {},
  previews: {},
  selectedNodeId: null,
  selectedEdgeId: null,
  solveResult: null,
  solveStale: false,
  solving: false,
  dirty: false,
  invalidNodes: {},
  invalidEdges: {},
  past: [],
  future: [],

  initializeProject: (version) =>
    set({
      project: createProject(version),
      recipes: {},
      previews: {},
      solveResult: null,
      solveStale: false,
      selectedNodeId: null,
      selectedEdgeId: null,
      currentPath: undefined,
      dirty: false,
      invalidNodes: {},
      invalidEdges: {},
      past: [],
      future: []
    }),

  loadProject: (project, path) =>
    set({
      project,
      recipes: {},
      previews: {},
      solveResult: null,
      solveStale: false,
      selectedNodeId: null,
      selectedEdgeId: null,
      currentPath: path,
      dirty: false,
      invalidNodes: {},
      invalidEdges: {},
      past: [],
      future: []
    }),

  registerRecipe: (detail) =>
    set((state) => ({
      recipes: {
        ...state.recipes,
        [detail.id]: detail
      }
    })),

  setPreviews: (previews) =>
    set((state) => ({
      previews: { ...state.previews, ...previews }
    })),

  clearPreviews: () => set({ previews: {} }),

  addNode: (machine, position, detail) => {
    const node = createNode(machine, position, detail)
    const state = get()
    const project = cloneProject(state.project, {
      nodes: [...state.project.nodes, node]
    })
    set({
      project,
      recipes: detail
        ? { ...state.recipes, [detail.id]: detail }
        : state.recipes,
      selectedNodeId: node.id,
      selectedEdgeId: null,
      dirty: true,
      solveStale: Boolean(state.solveResult),
      invalidNodes: {},
      invalidEdges: {},
      past: appendHistory(state.past, historyEntry(state.project, project)),
      future: []
    })
    return node
  },

  setNodeRecipe: (id, machine, detail) => {
    const state = get()
    const target = state.project.nodes.find((node) => node.id === id)
    if (!target) return
    const firstOutput = detail.outputs[0]
    const project = cloneProject(state.project, {
      nodes: state.project.nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              machine,
              recipeId: detail.id,
              targetPortKey: firstOutput?.key,
              targetRate: firstOutput ? Math.max(1, firstOutput.amount) : 1,
              voltageTier: detail.nativeVoltageTier,
              choices: {},
              overrides: {
                speedMultiplier: 1,
                powerMultiplier: 1
              }
            }
          : node
      ),
      edges: withoutNodeEdges(state.project.edges, id)
    })
    set({
      project,
      recipes: { ...state.recipes, [detail.id]: detail },
      selectedEdgeId: null,
      dirty: true,
      solveStale: Boolean(state.solveResult),
      invalidNodes: {},
      invalidEdges: {},
      past: appendHistory(state.past, historyEntry(state.project, project)),
      future: []
    })
  },

  setNodeMachine: (id, machine) => {
    const state = get()
    if (!state.project.nodes.some((node) => node.id === id)) return
    const project = cloneProject(state.project, {
      nodes: state.project.nodes.map((node) =>
        node.id === id ? { ...node, machine } : node
      ),
      edges: withoutNodeEdges(state.project.edges, id)
    })
    set({
      project,
      selectedEdgeId: null,
      dirty: true,
      solveStale: Boolean(state.solveResult),
      invalidNodes: {},
      invalidEdges: {},
      past: appendHistory(state.past, historyEntry(state.project, project)),
      future: []
    })
  },

  duplicateNodes: (ids) => {
    const state = get()
    const selected = state.project.nodes.filter((node) => ids.includes(node.id))
    if (!selected.length) return
    const idMap = new Map<string, string>()
    const copies = selected.map((node, index) => {
      const id = crypto.randomUUID()
      idMap.set(node.id, id)
      return {
        ...node,
        id,
        machine: { ...node.machine },
        choices: { ...node.choices },
        overrides: { ...node.overrides },
        position: {
          x: node.position.x + 40 + index * 16,
          y: node.position.y + 40 + index * 16
        }
      }
    })
    const copiedEdges = state.project.edges
      .filter(
        (edge) =>
          idMap.has(edge.source.nodeId) && idMap.has(edge.target.nodeId)
      )
      .map((edge) => ({
        ...edge,
        id: crypto.randomUUID(),
        source: { ...edge.source, nodeId: idMap.get(edge.source.nodeId)! },
        target: { ...edge.target, nodeId: idMap.get(edge.target.nodeId)! }
      }))
    const project = cloneProject(state.project, {
      nodes: [...state.project.nodes, ...copies],
      edges: [...state.project.edges, ...copiedEdges]
    })
    set({
      project,
      selectedNodeId: copies[0]?.id ?? null,
      dirty: true,
      solveStale: Boolean(state.solveResult),
      invalidNodes: {},
      invalidEdges: {},
      past: appendHistory(state.past, historyEntry(state.project, project)),
      future: []
    })
  },

  removeNodes: (ids) => {
    if (!ids.length) return
    const state = get()
    const idSet = new Set(ids)
    const project = cloneProject(state.project, {
      nodes: state.project.nodes.filter((node) => !idSet.has(node.id)),
      edges: state.project.edges.filter(
        (edge) =>
          !idSet.has(edge.source.nodeId) && !idSet.has(edge.target.nodeId)
      )
    })
    set({
      project,
      selectedNodeId: idSet.has(state.selectedNodeId ?? '')
        ? null
        : state.selectedNodeId,
      dirty: true,
      solveStale: Boolean(state.solveResult),
      invalidNodes: {},
      invalidEdges: {},
      past: appendHistory(state.past, historyEntry(state.project, project)),
      future: []
    })
  },

  updateNode: (id, patch, history = true) => {
    const state = get()
    const project = cloneProject(state.project, {
      nodes: state.project.nodes.map((node) =>
        node.id === id ? { ...node, ...patch } : node
      )
    })
    const entry = historyEntry(state.project, project)
    set({
      project,
      dirty: true,
      solveStale: Boolean(state.solveResult),
      invalidNodes: {},
      invalidEdges: {},
      past: history ? appendHistory(state.past, entry) : state.past,
      future: history ? [] : state.future
    })
  },

  setNodePositions: (positions) => {
    if (!positions.length) return
    const state = get()
    const map = new Map(positions.map((entry) => [entry.id, entry]))
    set({
      project: cloneProject(state.project, {
        nodes: state.project.nodes.map((node) => {
          const position = map.get(node.id)
          return position && (position.x !== node.position.x || position.y !== node.position.y)
            ? { ...node, position: { x: position.x, y: position.y } }
            : node
        })
      }),
      dirty: true
    })
  },

  addEdge: (edge) => {
    const state = get()
    if (
      state.project.edges.some(
        (existing) =>
          existing.source.nodeId === edge.source.nodeId &&
          existing.source.portKey === edge.source.portKey &&
          existing.target.nodeId === edge.target.nodeId &&
          existing.target.portKey === edge.target.portKey
      )
    ) {
      return
    }
    const project = cloneProject(state.project, {
      edges: [...state.project.edges, { ...edge, id: crypto.randomUUID() }]
    })
    set({
      project,
      selectedEdgeId: null,
      dirty: true,
      solveStale: Boolean(state.solveResult),
      invalidNodes: {},
      invalidEdges: {},
      past: appendHistory(state.past, historyEntry(state.project, project)),
      future: []
    })
  },

  updateEdge: (id, patch, history = true) => {
    const state = get()
    const project = cloneProject(state.project, {
      edges: state.project.edges.map((edge) =>
        edge.id === id ? { ...edge, ...patch } : edge
      )
    })
    const entry = historyEntry(state.project, project)
    set({
      project,
      dirty: true,
      solveStale: Boolean(state.solveResult),
      invalidNodes: {},
      invalidEdges: {},
      past: history ? appendHistory(state.past, entry) : state.past,
      future: history ? [] : state.future
    })
  },

  removeEdges: (ids, history = true) => {
    if (!ids.length) return
    const state = get()
    const idSet = new Set(ids)
    const project = cloneProject(state.project, {
      edges: state.project.edges.filter((edge) => !idSet.has(edge.id))
    })
    const entry = historyEntry(state.project, project)
    set({
      project,
      selectedEdgeId: idSet.has(state.selectedEdgeId ?? '')
        ? null
        : state.selectedEdgeId,
      dirty: true,
      solveStale: Boolean(state.solveResult),
      invalidNodes: {},
      invalidEdges: {},
      past: history ? appendHistory(state.past, entry) : state.past,
      future: history ? [] : state.future
    })
  },

  setSelection: (nodeId = null, edgeId = null) =>
    set({ selectedNodeId: nodeId, selectedEdgeId: edgeId }),

  setViewport: (viewport) =>
    set((state) => ({
      project: cloneProject(state.project, { viewport })
    })),

  setTimeUnit: (timeUnit) => {
    const state = get()
    const project = cloneProject(state.project, { timeUnit })
    set({
      project,
      dirty: true,
      invalidNodes: {},
      invalidEdges: {},
      past: appendHistory(state.past, historyEntry(state.project, project)),
      future: []
    })
  },

  pushHistory: () => {
    pendingDragBefore = get().project
  },

  commitHistory: () => {
    if (!pendingDragBefore) return
    const state = get()
    const entry = historyEntry(pendingDragBefore, state.project)
    pendingDragBefore = null
    if (isEmptyHistory(entry)) return
    set({
      past: appendHistory(state.past, entry),
      future: []
    })
  },

  setSolving: (solving) => set({ solving }),
  setSolveResult: (solveResult) =>
    set({
      solveResult,
      solveStale: false,
      invalidNodes: {},
      invalidEdges: {}
    }),
  setValidation: (nodes, edges) =>
    set({ invalidNodes: nodes, invalidEdges: edges }),
  clearValidation: () => set({ invalidNodes: {}, invalidEdges: {} }),

  setCurrentPath: (currentPath) => set({ currentPath }),
  markSaved: () => set({ dirty: false }),

  undo: () => {
    const state = get()
    const previous = state.past.at(-1)
    if (!previous) return
    set({
      project: applyHistory(state.project, previous, 'before'),
      past: state.past.slice(0, -1),
      future: [previous, ...state.future].slice(0, 100),
      solveStale: Boolean(state.solveResult),
      dirty: true,
      invalidNodes: {},
      invalidEdges: {}
    })
  },

  redo: () => {
    const state = get()
    const next = state.future[0]
    if (!next) return
    set({
      project: applyHistory(state.project, next, 'after'),
      past: appendHistory(state.past, next),
      future: state.future.slice(1),
      solveStale: Boolean(state.solveResult),
      dirty: true,
      invalidNodes: {},
      invalidEdges: {}
    })
  }
}))

export { issueMap }
