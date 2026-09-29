import { create } from 'zustand'
import type {
  CachedDataVersion,
  GraphEdgeV1,
  GraphNodeV1,
  ProjectDocumentV1,
  RecipeDetail,
  SolveResult
} from '../../../shared/types'
import { cloneProject, createNode, createProject } from '../lib/project'

interface ProjectState {
  project: ProjectDocumentV1
  recipes: Record<string, RecipeDetail>
  selectedNodeId: string | null
  selectedEdgeId: string | null
  solveResult: SolveResult | null
  solving: boolean
  dirty: boolean
  currentPath?: string
  past: string[]
  future: string[]
  initializeProject: (version: CachedDataVersion | null) => void
  loadProject: (project: ProjectDocumentV1, path?: string) => void
  registerRecipe: (detail: RecipeDetail) => void
  addNode: (
    detail: RecipeDetail,
    position: { x: number; y: number }
  ) => GraphNodeV1
  duplicateNodes: (ids: string[]) => void
  removeNodes: (ids: string[]) => void
  updateNode: (id: string, patch: Partial<GraphNodeV1>, history?: boolean) => void
  setNodePositions: (
    positions: Array<{ id: string; x: number; y: number }>,
    history?: boolean
  ) => void
  addEdge: (edge: Omit<GraphEdgeV1, 'id'>) => void
  updateEdge: (id: string, patch: Partial<GraphEdgeV1>, history?: boolean) => void
  removeEdges: (ids: string[]) => void
  setSelection: (nodeId?: string | null, edgeId?: string | null) => void
  setViewport: (viewport: ProjectDocumentV1['viewport']) => void
  setTimeUnit: (unit: ProjectDocumentV1['timeUnit']) => void
  pushHistory: () => void
  setSolving: (solving: boolean) => void
  setSolveResult: (result: SolveResult) => void
  invalidateSolve: () => void
  setCurrentPath: (path?: string) => void
  markSaved: () => void
  undo: () => void
  redo: () => void
}

function snapshot(project: ProjectDocumentV1): string {
  return JSON.stringify(project)
}

function parseSnapshot(value: string): ProjectDocumentV1 {
  return JSON.parse(value) as ProjectDocumentV1
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: createProject(null),
  recipes: {},
  selectedNodeId: null,
  selectedEdgeId: null,
  solveResult: null,
  solving: false,
  dirty: false,
  past: [],
  future: [],

  initializeProject: (version) =>
    set({
      project: createProject(version),
      recipes: {},
      solveResult: null,
      selectedNodeId: null,
      selectedEdgeId: null,
      currentPath: undefined,
      dirty: false,
      past: [],
      future: []
    }),

  loadProject: (project, path) =>
    set({
      project,
      recipes: {},
      solveResult: null,
      selectedNodeId: null,
      selectedEdgeId: null,
      currentPath: path,
      dirty: false,
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

  addNode: (detail, position) => {
    const node = createNode(detail.id, detail, position)
    const state = get()
    const history = snapshot(state.project)
    set({
      project: cloneProject(state.project, {
        nodes: [...state.project.nodes, node]
      }),
      recipes: { ...state.recipes, [detail.id]: detail },
      selectedNodeId: node.id,
      selectedEdgeId: null,
      dirty: true,
      past: [...state.past.slice(-99), history],
      future: []
    })
    return node
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
        ...structuredClone(node),
        id,
        position: {
          x: node.position.x + 40 + index * 16,
          y: node.position.y + 40 + index * 16
        }
      }
    })
    const copiedEdges = state.project.edges
      .filter((edge) => idMap.has(edge.source.nodeId) && idMap.has(edge.target.nodeId))
      .map((edge) => ({
        ...structuredClone(edge),
        id: crypto.randomUUID(),
        source: { ...edge.source, nodeId: idMap.get(edge.source.nodeId)! },
        target: { ...edge.target, nodeId: idMap.get(edge.target.nodeId)! }
      }))
    set({
      project: cloneProject(state.project, {
        nodes: [...state.project.nodes, ...copies],
        edges: [...state.project.edges, ...copiedEdges]
      }),
      selectedNodeId: copies[0]?.id ?? null,
      dirty: true,
      past: [...state.past.slice(-99), snapshot(state.project)],
      future: []
    })
  },

  removeNodes: (ids) => {
    if (!ids.length) return
    const state = get()
    const idSet = new Set(ids)
    set({
      project: cloneProject(state.project, {
        nodes: state.project.nodes.filter((node) => !idSet.has(node.id)),
        edges: state.project.edges.filter(
          (edge) =>
            !idSet.has(edge.source.nodeId) && !idSet.has(edge.target.nodeId)
        )
      }),
      selectedNodeId: idSet.has(state.selectedNodeId ?? '')
        ? null
        : state.selectedNodeId,
      dirty: true,
      past: [...state.past.slice(-99), snapshot(state.project)],
      future: []
    })
  },

  updateNode: (id, patch, history = true) => {
    const state = get()
    const before = history ? snapshot(state.project) : null
    set({
      project: cloneProject(state.project, {
        nodes: state.project.nodes.map((node) =>
          node.id === id ? { ...node, ...patch } : node
        )
      }),
      dirty: true,
      past: before ? [...state.past.slice(-99), before] : state.past,
      future: history ? [] : state.future
    })
  },

  setNodePositions: (positions, history = true) => {
    if (!positions.length) return
    const state = get()
    const map = new Map(positions.map((entry) => [entry.id, entry]))
    const before = history ? snapshot(state.project) : null
    set({
      project: cloneProject(state.project, {
        nodes: state.project.nodes.map((node) => {
          const position = map.get(node.id)
          return position
            ? { ...node, position: { x: position.x, y: position.y } }
            : node
        })
      }),
      dirty: true,
      past: before ? [...state.past.slice(-99), before] : state.past,
      future: history ? [] : state.future
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
    set({
      project: cloneProject(state.project, {
        edges: [...state.project.edges, { ...edge, id: crypto.randomUUID() }]
      }),
      selectedEdgeId: null,
      dirty: true,
      past: [...state.past.slice(-99), snapshot(state.project)],
      future: []
    })
  },

  updateEdge: (id, patch, history = true) => {
    const state = get()
    const before = history ? snapshot(state.project) : null
    set({
      project: cloneProject(state.project, {
        edges: state.project.edges.map((edge) =>
          edge.id === id ? { ...edge, ...patch } : edge
        )
      }),
      dirty: true,
      past: before ? [...state.past.slice(-99), before] : state.past,
      future: history ? [] : state.future
    })
  },

  removeEdges: (ids) => {
    if (!ids.length) return
    const state = get()
    const idSet = new Set(ids)
    set({
      project: cloneProject(state.project, {
        edges: state.project.edges.filter((edge) => !idSet.has(edge.id))
      }),
      selectedEdgeId: idSet.has(state.selectedEdgeId ?? '')
        ? null
        : state.selectedEdgeId,
      dirty: true,
      past: [...state.past.slice(-99), snapshot(state.project)],
      future: []
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
    set({
      project: cloneProject(state.project, { timeUnit }),
      dirty: true,
      past: [...state.past.slice(-99), snapshot(state.project)],
      future: []
    })
  },

  pushHistory: () => {
    const state = get()
    set({
      past: [...state.past.slice(-99), snapshot(state.project)],
      future: []
    })
  },

  setSolving: (solving) => set({ solving }),
  setSolveResult: (solveResult) => set({ solveResult }),
  invalidateSolve: () => set({ solveResult: null, solving: false }),

  setCurrentPath: (currentPath) => set({ currentPath }),
  markSaved: () => set({ dirty: false }),

  undo: () => {
    const state = get()
    const previous = state.past.at(-1)
    if (!previous) return
    set({
      project: parseSnapshot(previous),
      past: state.past.slice(0, -1),
      future: [snapshot(state.project), ...state.future].slice(0, 100),
      dirty: true
    })
  },

  redo: () => {
    const state = get()
    const next = state.future[0]
    if (!next) return
    set({
      project: parseSnapshot(next),
      past: [...state.past.slice(-99), snapshot(state.project)],
      future: state.future.slice(1),
      dirty: true
    })
  }
}))
