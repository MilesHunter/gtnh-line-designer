import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
  type NodePositionChange,
  type NodeTypes
} from '@xyflow/react'
import { toBlob } from 'html-to-image'
import {
  Calculator,
  Database,
  Download,
  FileDown,
  FilePlus2,
  FolderOpen,
  Redo2,
  Save,
  SaveAll,
  Undo2
} from 'lucide-react'
import type {
  CachedDataVersion,
  DataStatus,
  DownloadProgress,
  ExactRecipeSearchRequest,
  MachineRef,
  MachineSearchResponse,
  ProjectDocument,
  ProjectDocumentV1,
  RecipeDetail,
  RecipeSearchResponse
} from '../../shared/types'
import { GtnhWorkerClient } from './lib/worker-client'
import {
  isProjectDocument,
  isProjectDocumentV1,
  migrateProjectV1
} from './lib/project'
import { RecipeNode, type RecipeFlowNode } from './components/RecipeNode'
import { RecipePalette } from './components/RecipePalette'
import { Inspector } from './components/Inspector'
import { AnalysisPanel } from './components/AnalysisPanel'
import { CalculationModal } from './components/CalculationModal'
import { VersionPicker } from './components/VersionPicker'
import { issueMap, useProjectStore } from './store/project-store'

const nodeTypes: NodeTypes = {
  machine: RecipeNode
}

const EMPTY_GOODS_RESPONSE: RecipeSearchResponse = {
  items: [],
  recipes: [],
  total: 0
}

const EMPTY_MACHINE_RESPONSE: MachineSearchResponse = {
  machines: [],
  total: 0
}

function nodePreviewKey(node: ProjectDocument['nodes'][number]): string {
  return JSON.stringify({
    id: node.id,
    recipeId: node.recipeId,
    machineId: node.machine.id,
    machineKind: node.machine.multiblock,
    rateMode: node.rateMode,
    machineCount: node.machineCount,
    targetPortKey: node.targetPortKey,
    targetRate: node.targetRate,
    voltageTier: node.voltageTier,
    choices: node.choices,
    overrides: node.overrides
  })
}

function waitFrame(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 80))
}

function Workspace(): React.JSX.Element {
  const workerRef = useRef<GtnhWorkerClient | null>(null)
  const workerUrlRef = useRef('gtnh-data://current/data.bin.gz')
  const calculationTokenRef = useRef(0)
  const [status, setStatus] = useState<DataStatus | null>(null)
  const [downloadProgress, setDownloadProgress] =
    useState<DownloadProgress | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [showVersionPicker, setShowVersionPicker] = useState(false)
  const [workerLoaded, setWorkerLoaded] = useState(false)
  const [dataCounts, setDataCounts] = useState<{
    items: number
    fluids: number
    recipes: number
  } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [calculationOpen, setCalculationOpen] = useState(false)
  const [calculationStage, setCalculationStage] = useState(0)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const calculationStartedAtRef = useRef(0)
  const flow = useReactFlow<RecipeFlowNode, Edge>()
  const flowNodeCacheRef = useRef(new Map<string, RecipeFlowNode>())
  const previewKeyCacheRef = useRef(
    new Map<string, { node: ProjectDocument['nodes'][number]; key: string }>()
  )
  const previewedKeysRef = useRef(new Map<string, string>())

  const project = useProjectStore((state) => state.project)
  const recipes = useProjectStore((state) => state.recipes)
  const previews = useProjectStore((state) => state.previews)
  const selectedNodeId = useProjectStore((state) => state.selectedNodeId)
  const selectedEdgeId = useProjectStore((state) => state.selectedEdgeId)
  const solveResult = useProjectStore((state) => state.solveResult)
  const solveStale = useProjectStore((state) => state.solveStale)
  const solving = useProjectStore((state) => state.solving)
  const dirty = useProjectStore((state) => state.dirty)
  const currentPath = useProjectStore((state) => state.currentPath)
  const invalidNodes = useProjectStore((state) => state.invalidNodes)
  const invalidEdges = useProjectStore((state) => state.invalidEdges)

  const initializeProject = useProjectStore((state) => state.initializeProject)
  const loadProject = useProjectStore((state) => state.loadProject)
  const registerRecipe = useProjectStore((state) => state.registerRecipe)
  const setPreviews = useProjectStore((state) => state.setPreviews)
  const clearPreviews = useProjectStore((state) => state.clearPreviews)
  const addNode = useProjectStore((state) => state.addNode)
  const setNodeRecipe = useProjectStore((state) => state.setNodeRecipe)
  const setNodeMachine = useProjectStore((state) => state.setNodeMachine)
  const removeNodes = useProjectStore((state) => state.removeNodes)
  const duplicateNodes = useProjectStore((state) => state.duplicateNodes)
  const updateNode = useProjectStore((state) => state.updateNode)
  const setNodePositions = useProjectStore((state) => state.setNodePositions)
  const addEdge = useProjectStore((state) => state.addEdge)
  const updateEdge = useProjectStore((state) => state.updateEdge)
  const removeEdges = useProjectStore((state) => state.removeEdges)
  const setSelection = useProjectStore((state) => state.setSelection)
  const setViewport = useProjectStore((state) => state.setViewport)
  const setTimeUnit = useProjectStore((state) => state.setTimeUnit)
  const pushHistory = useProjectStore((state) => state.pushHistory)
  const commitHistory = useProjectStore((state) => state.commitHistory)
  const setSolving = useProjectStore((state) => state.setSolving)
  const setSolveResult = useProjectStore((state) => state.setSolveResult)
  const setValidation = useProjectStore((state) => state.setValidation)
  const clearValidation = useProjectStore((state) => state.clearValidation)
  const setCurrentPath = useProjectStore((state) => state.setCurrentPath)
  const markSaved = useProjectStore((state) => state.markSaved)
  const undo = useProjectStore((state) => state.undo)
  const redo = useProjectStore((state) => state.redo)

  const resetWorker = useCallback(async (showErrors = true): Promise<void> => {
    workerRef.current?.dispose()
    const worker = new GtnhWorkerClient()
    workerRef.current = worker
    try {
      const counts = await worker.load(workerUrlRef.current)
      setDataCounts({
        items: counts.items,
        fluids: counts.fluids,
        recipes: counts.recipes
      })
      setWorkerLoaded(true)
    } catch (error) {
      setWorkerLoaded(false)
      if (showErrors) {
        setDownloadError(error instanceof Error ? error.message : String(error))
        setShowVersionPicker(true)
      }
      throw error
    }
  }, [])

  const hydrateProject = useCallback(
    async (raw: unknown): Promise<ProjectDocument> => {
      if (isProjectDocument(raw)) return raw
      if (!isProjectDocumentV1(raw)) {
        throw new Error('不是有效的 .gtnhgraph 项目')
      }
      const legacy = raw as ProjectDocumentV1
      const worker = workerRef.current
      if (!worker) throw new Error('GTNH 数据尚未加载')
      const recipeIds = [...new Set(legacy.nodes.map((node) => node.recipeId))]
      const details = new Map<string, RecipeDetail | null>()
      const resolved = await Promise.all(
        recipeIds.map(async (recipeId) => {
          const detail = await worker.getRecipe(recipeId)
          return [recipeId, detail] as const
        })
      )
      for (const [recipeId, detail] of resolved) details.set(recipeId, detail)

      const machineByNode: Record<string, MachineRef> = {}
      for (const node of legacy.nodes) {
        const detail = details.get(node.recipeId)
        const selected =
          detail?.availableCrafters.find((entry) => entry.id === node.crafterId) ??
          detail?.availableCrafters.find(
            (entry) => entry.id === detail.defaultCrafterId
          ) ??
          detail?.availableCrafters[0]
        if (selected) {
          machineByNode[node.id] = selected
        } else if (node.crafterId) {
          const machine = await worker.getMachine(node.crafterId)
          if (machine) machineByNode[node.id] = machine
        }
      }
      return migrateProjectV1(legacy, machineByNode)
    },
    []
  )

  const loadWorkerData = useCallback(async (): Promise<void> => {
    if (!workerRef.current) workerRef.current = new GtnhWorkerClient()
    setWorkerLoaded(false)
    try {
      await resetWorker()
      const current = useProjectStore.getState().project
      let restored = false
      if (current.nodes.length === 0) {
        const autosave = await window.gtnh.readAutosave()
        if (autosave) {
          try {
            const parsed = JSON.parse(autosave) as unknown
            const restoredProject = await hydrateProject(parsed)
            if (
              restoredProject.nodes.length > 0 &&
              restoredProject.data.commit === (status?.selected?.commit ?? '')
            ) {
              previewedKeysRef.current.clear()
              loadProject(restoredProject)
              restored = true
              setToast('已恢复上次自动保存')
            }
          } catch {
            // Corrupt or incompatible autosaves should not block startup.
          }
        }
      }
      if (!restored && !current.data.commit && status?.selected) {
        initializeProject(status.selected)
      }
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : String(error))
      setShowVersionPicker(true)
    }
  }, [
    hydrateProject,
    initializeProject,
    loadProject,
    resetWorker,
    status?.selected
  ])

  useEffect(() => {
    if (!workerRef.current) workerRef.current = new GtnhWorkerClient()
    const unsubscribeDownload = window.gtnh.onDownloadProgress((next) => {
      setDownloadProgress(next)
      if (next.stage === 'error') setDownloadError(next.message ?? '下载失败')
    })
    const unsubscribeLocal = window.gtnh.onLocalImportProgress((next) => {
      setStatus((current) =>
        current ? { ...current, localImport: next } : current
      )
    })
    void window.gtnh.getDataStatus().then(setStatus)
    return () => {
      unsubscribeDownload()
      unsubscribeLocal()
      workerRef.current?.dispose()
      workerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (status?.selected && !workerLoaded) void loadWorkerData()
  }, [status?.selected, workerLoaded, loadWorkerData])

  useEffect(() => {
    if (!calculationOpen) return
    const timer = window.setInterval(() => {
      setElapsedSeconds(
        (Date.now() - calculationStartedAtRef.current) / 1000
      )
    }, 100)
    return () => window.clearInterval(timer)
  }, [calculationOpen])

  const missingRecipeKey = useMemo(
    () =>
      project.nodes
        .map((node) => node.recipeId)
        .filter((recipeId): recipeId is string => Boolean(recipeId && !recipes[recipeId]))
        .join('|'),
    [project.nodes, recipes]
  )

  useEffect(() => {
    if (!workerLoaded || !workerRef.current || !missingRecipeKey) return
    const recipeIds = missingRecipeKey.split('|')
    void Promise.all(
      recipeIds.map((recipeId) => workerRef.current!.getRecipe(recipeId))
    )
      .then((details) => {
        for (const detail of details) {
          if (detail) registerRecipe(detail)
        }
      })
      .catch(() => {
        // A worker restart can invalidate an in-flight detail request.
      })
  }, [missingRecipeKey, registerRecipe, workerLoaded])

  useEffect(() => {
    if (!workerLoaded || !workerRef.current) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      const worker = workerRef.current
      if (!worker) return
      const nodes = useProjectStore.getState().project.nodes
      const cache = previewKeyCacheRef.current
      const used = new Set<string>()
      const changed = nodes.filter((node) => {
        used.add(node.id)
        const cached = cache.get(node.id)
        const key = cached?.node === node ? cached.key : nodePreviewKey(node)
        if (cached?.node !== node) cache.set(node.id, { node, key })
        return key !== undefined && previewedKeysRef.current.get(node.id) !== key
      })
      for (const id of cache.keys()) {
        if (!used.has(id)) cache.delete(id)
      }
      if (!changed.length) return
      void (async () => {
        for (let offset = 0; offset < changed.length; offset += 16) {
          if (cancelled) return
          const batch = changed.slice(offset, offset + 16)
          const updates: Record<
            string,
            Awaited<ReturnType<typeof worker.preview>>
          > = {}
          await Promise.all(
            batch.map(async (node) => {
              if (!node.recipeId) {
                updates[node.id] = null
                return
              }
              try {
                updates[node.id] = await worker.preview(node)
              } catch {
                updates[node.id] = null
              }
            })
          )
          if (!cancelled) {
            setPreviews(updates)
            for (const node of batch) {
              const key = previewKeyCacheRef.current.get(node.id)?.key
              if (key) previewedKeysRef.current.set(node.id, key)
            }
          }
        }
      })()
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [project.nodes, setPreviews, workerLoaded])

  const calculateProduction = useCallback(async () => {
    if (!workerLoaded || !workerRef.current || solving || !project.nodes.length) {
      return
    }
    const token = ++calculationTokenRef.current
    const worker = workerRef.current
    const snapshot = structuredClone(useProjectStore.getState().project)
    calculationStartedAtRef.current = Date.now()
    setElapsedSeconds(0)
    setCalculationStage(0)
    setCalculationOpen(true)
    setSolving(true)
    try {
      let validation = await worker.validate(snapshot)
      if (token !== calculationTokenRef.current) return
      if (validation.removedEdgeIds.length) {
        const removed = new Set(validation.removedEdgeIds)
        removeEdges(validation.removedEdgeIds, false)
        snapshot.edges = snapshot.edges.filter((edge) => !removed.has(edge.id))
        validation = await worker.validate(snapshot)
        if (token !== calculationTokenRef.current) return
      }
      if (!validation.valid) {
        const mapped = issueMap(validation.issues)
        setValidation(mapped.nodes, mapped.edges)
        setCalculationOpen(false)
        setSolving(false)
        const firstNode = Object.keys(mapped.nodes)[0]
        if (firstNode) {
          setSelection(firstNode, null)
          const node = useProjectStore
            .getState()
            .project.nodes.find((entry) => entry.id === firstNode)
          if (node) {
            void flow.setCenter(node.position.x + 180, node.position.y + 120, {
              zoom: 1,
              duration: 260
            })
          }
        }
        setToast(
          validation.issues[0]?.message
            ? `无法计算：${validation.issues[0].message}`
            : '存在无效节点或连线'
        )
        return
      }

      clearValidation()
      setCalculationStage(1)
      await waitFrame()
      if (token !== calculationTokenRef.current) return
      setCalculationStage(2)
      const revision = Date.now()
      const result = await worker.solve(snapshot, revision)
      if (token !== calculationTokenRef.current) return
      setCalculationStage(3)
      await waitFrame()
      if (token !== calculationTokenRef.current) return
      setSolveResult(result)
      setCalculationOpen(false)
    } catch (error) {
      if (token !== calculationTokenRef.current) return
      setCalculationOpen(false)
      setToast(error instanceof Error ? error.message : String(error))
    } finally {
      if (token === calculationTokenRef.current) setSolving(false)
    }
  }, [
    clearValidation,
    flow,
    project.nodes.length,
    removeEdges,
    setSelection,
    setSolveResult,
    setSolving,
    setValidation,
    solving,
    workerLoaded
  ])

  const cancelCalculation = useCallback(() => {
    calculationTokenRef.current++
    setCalculationOpen(false)
    setSolving(false)
    setToast('计算已取消')
    void resetWorker(false).catch(() => {
      setWorkerLoaded(false)
      setShowVersionPicker(true)
    })
  }, [resetWorker, setSolving])

  useEffect(() => {
    if (!workerLoaded || !dirty) return
    const timer = window.setInterval(() => {
      void window.gtnh.autosaveProject(
        JSON.stringify(useProjectStore.getState().project, null, 2)
      )
    }, 8000)
    return () => window.clearInterval(timer)
  }, [workerLoaded, dirty])

  const selectNode = useCallback(
    (nodeId: string) => setSelection(nodeId, null),
    [setSelection]
  )

  const flowNodes = useMemo<RecipeFlowNode[]>(
    () => {
      const cache = flowNodeCacheRef.current
      const used = new Set<string>()
      const next = project.nodes.map((node): RecipeFlowNode => {
        used.add(node.id)
        const detail = node.recipeId ? recipes[node.recipeId] : undefined
        const preview = previews[node.id]
        const computed = solveStale ? undefined : solveResult?.nodes[node.id]
        const invalidReasons = invalidNodes[node.id]
        const selected = node.id === selectedNodeId
        const cached = cache.get(node.id)
        if (
          cached &&
          cached.position === node.position &&
          cached.selected === selected &&
          cached.data.graphNode === node &&
          cached.data.detail === detail &&
          cached.data.preview === preview &&
          cached.data.computed === computed &&
          cached.data.timeUnit === project.timeUnit &&
          cached.data.invalidReasons === invalidReasons
        ) {
          return cached
        }
        const flowNode: RecipeFlowNode = {
          id: node.id,
          type: 'machine',
          position: node.position,
          selected,
          data: {
            graphNode: node,
            detail,
            preview,
            computed,
            timeUnit: project.timeUnit,
            invalidReasons,
            onSelect: selectNode
          }
        }
        cache.set(node.id, flowNode)
        return flowNode
      })
      for (const id of cache.keys()) {
        if (!used.has(id)) cache.delete(id)
      }
      return next
    },
    [
      invalidNodes,
      previews,
      project.nodes,
      project.timeUnit,
      recipes,
      selectedNodeId,
      selectNode,
      solveResult,
      solveStale
    ]
  )

  const flowEdges = useMemo<Edge[]>(
    () =>
      project.edges.map((edge) => ({
        id: edge.id,
        source: edge.source.nodeId,
        target: edge.target.nodeId,
        sourceHandle: edge.source.portKey,
        targetHandle: edge.target.portKey,
        animated: false,
        selected: edge.id === selectedEdgeId,
        label: solveResult
          ? `${(solveResult.edgeFlows[edge.id] ?? 0).toFixed(2)}/min`
          : undefined,
        labelShowBg: true,
        labelBgStyle: {
          fill: '#171b22',
          fillOpacity: solveStale ? 0.6 : 0.95
        },
        labelStyle: {
          fill: solveStale ? '#6e7887' : '#b8c2d0',
          fontSize: 10
        },
        style: {
          stroke: invalidEdges[edge.id]
            ? '#d66565'
            : edge.enabled
              ? solveStale
                ? '#416f62'
                : '#55b899'
              : '#5d6572',
          strokeWidth: invalidEdges[edge.id] ? 2.2 : edge.enabled ? 1.8 : 1,
          strokeDasharray: edge.enabled ? undefined : '5 5',
          opacity: solveStale ? 0.55 : 1
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: invalidEdges[edge.id]
            ? '#d66565'
            : edge.enabled
              ? '#55b899'
              : '#5d6572'
        }
      })),
    [invalidEdges, project.edges, selectedEdgeId, solveResult, solveStale]
  )

  const onNodesChange = useCallback(
    (changes: NodeChange<RecipeFlowNode>[]) => {
      const positions = changes
        .filter(
          (change): change is NodePositionChange =>
            change.type === 'position' && Boolean(change.position)
        )
        .map((change) => ({
          id: change.id,
          x: change.position?.x ?? 0,
          y: change.position?.y ?? 0
        }))
      if (positions.length) setNodePositions(positions)
      const selection = changes.find((change) => change.type === 'select')
      if (selection?.type === 'select' && selection.selected) {
        setSelection(selection.id, null)
      }
      const removals = changes
        .filter((change) => change.type === 'remove')
        .map((change) => change.id)
      if (removals.length) removeNodes(removals)
    },
    [removeNodes, setNodePositions, setSelection]
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      const selection = changes.find((change) => change.type === 'select')
      if (selection?.type === 'select' && selection.selected) {
        setSelection(null, selection.id)
      }
      const removals = changes
        .filter((change) => change.type === 'remove')
        .map((change) => change.id)
      if (removals.length) removeEdges(removals)
    },
    [removeEdges, setSelection]
  )

  const getPort = useCallback(
    (
      nodeId: string | null | undefined,
      portKey: string | null | undefined
    ) => {
      if (!nodeId || !portKey) return undefined
      const node = useProjectStore
        .getState()
        .project.nodes.find((entry) => entry.id === nodeId)
      if (!node?.recipeId) return undefined
      const detail = useProjectStore.getState().recipes[node.recipeId]
      if (!detail) return undefined
      const input = detail.inputs.find((port) => port.key === portKey)
      if (input) return { direction: 'input' as const, port: input }
      const output = detail.outputs.find((port) => port.key === portKey)
      if (output) return { direction: 'output' as const, port: output }
      return undefined
    },
    []
  )

  const portsCompatible = useCallback(
    (
      source: NonNullable<ReturnType<typeof getPort>>,
      target: NonNullable<ReturnType<typeof getPort>>
    ): boolean => {
      if (source.port.goods.id === target.port.goods.id) return true
      return target.port.goods.kind === 'ore' && source.port.goods.kind === 'item'
    },
    []
  )

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (
        !connection.source ||
        !connection.target ||
        !connection.sourceHandle ||
        !connection.targetHandle
      ) {
        return
      }
      const sourcePort = getPort(
        connection.source,
        connection.sourceHandle
      )
      const targetPort = getPort(
        connection.target,
        connection.targetHandle
      )
      if (!sourcePort || !targetPort) return
      const sourceDirection = sourcePort.direction
      const targetDirection = targetPort.direction
      if (
        sourceDirection === targetDirection ||
        (sourceDirection !== 'input' && sourceDirection !== 'output') ||
        (targetDirection !== 'input' && targetDirection !== 'output')
      ) {
        return
      }
      if (
        !(
          sourceDirection === 'output'
            ? portsCompatible(sourcePort, targetPort)
            : portsCompatible(targetPort, sourcePort)
        )
      ) {
        setToast('物料类型不兼容，无法连线')
        return
      }
      const normalized =
        sourceDirection === 'input'
          ? {
              source: connection.target,
              sourceHandle: connection.targetHandle,
              target: connection.source,
              targetHandle: connection.sourceHandle
            }
          : connection
      addEdge({
        source: {
          nodeId: normalized.source,
          portKey: normalized.sourceHandle!
        },
        target: {
          nodeId: normalized.target,
          portKey: normalized.targetHandle!
        },
        priority: 0,
        enabled: true
      })
    },
    [addEdge, getPort, portsCompatible]
  )

  const isValidConnection = useCallback<IsValidConnection<Edge>>(
    (connection) => {
      const sourcePort = getPort(
        connection.source,
        connection.sourceHandle
      )
      const targetPort = getPort(
        connection.target,
        connection.targetHandle
      )
      if (!sourcePort || !targetPort) return false
      if (
        !(
          (sourcePort.direction === 'output' &&
            targetPort.direction === 'input') ||
          (sourcePort.direction === 'input' &&
            targetPort.direction === 'output')
        )
      ) {
        return false
      }
      return sourcePort.direction === 'output'
        ? portsCompatible(sourcePort, targetPort)
        : portsCompatible(targetPort, sourcePort)
    },
    [getPort, portsCompatible]
  )

  const addMachineAt = useCallback(
    async (
      machine: MachineRef,
      position?: { x: number; y: number },
      recipeId?: string
    ) => {
      if (!workerRef.current) return
      const detail = recipeId
        ? await workerRef.current.getRecipe(recipeId)
        : undefined
      if (recipeId && !detail) {
        setToast('找不到该配方')
        return
      }
      const current = useProjectStore.getState().project
      const target =
        position ?? {
          x: 80 + (current.nodes.length % 3) * 600,
          y: 70 + Math.floor(current.nodes.length / 3) * 250
        }
      addNode(machine, target, detail ?? undefined)
      if (!position) {
        flow.setCenter(target.x + 260, target.y + 110, {
          zoom: 0.85,
          duration: 220
        })
      }
    },
    [addNode, flow]
  )

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const position = flow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY
      })
      const machineJson = event.dataTransfer.getData(
        'application/x-gtnh-machine'
      )
      if (machineJson) {
        try {
          void addMachineAt(JSON.parse(machineJson) as MachineRef, position)
        } catch {
          setToast('机器数据无效')
        }
        return
      }
      const configuredJson = event.dataTransfer.getData(
        'application/x-gtnh-machine-recipe'
      )
      if (!configuredJson) return
      try {
        const payload = JSON.parse(configuredJson) as {
          machine: MachineRef
          recipeId: string
        }
        void addMachineAt(payload.machine, position, payload.recipeId)
      } catch {
        setToast('配方数据无效')
      }
    },
    [addMachineAt, flow]
  )

  const searchGoods = useCallback(
    (query: string): Promise<RecipeSearchResponse> =>
      workerRef.current?.searchGoods(query, 40) ??
      Promise.resolve(EMPTY_GOODS_RESPONSE),
    []
  )

  const searchMachines = useCallback(
    (query: string): Promise<MachineSearchResponse> =>
      workerRef.current?.searchMachines(query, 80) ??
      Promise.resolve(EMPTY_MACHINE_RESPONSE),
    []
  )

  const searchRecipes = useCallback(
    (request: ExactRecipeSearchRequest) =>
      workerRef.current?.searchExactRecipes(request) ??
      Promise.resolve({ recipes: [], total: 0, hasMore: false }),
    []
  )

  const chooseRecipeForNode = useCallback(
    (machine: MachineRef, recipeId: string) => {
      const node = useProjectStore.getState().project.nodes.find(
        (entry) => entry.id === useProjectStore.getState().selectedNodeId
      )
      if (!node || !workerRef.current) return
      void workerRef.current.getRecipe(recipeId).then((detail) => {
        if (!detail) {
          setToast('找不到该配方')
          return
        }
        setNodeRecipe(node.id, machine, detail)
      })
    },
    [setNodeRecipe]
  )

  const saveProject = useCallback(
    async (saveAs = false) => {
      const content = JSON.stringify(useProjectStore.getState().project, null, 2)
      const savedPath = await window.gtnh.saveProject(content, currentPath, saveAs)
      if (savedPath) {
        setCurrentPath(savedPath)
        markSaved()
        setToast('项目已保存')
      }
    },
    [currentPath, markSaved, setCurrentPath]
  )

  const openProject = useCallback(async () => {
    const opened = await window.gtnh.openProject()
    if (!opened) return
    try {
      const parsed = JSON.parse(opened.content) as unknown
      const hydrated = await hydrateProject(parsed)
      previewedKeysRef.current.clear()
      loadProject(hydrated, opened.path)
      if (hydrated.data.commit !== status?.selected?.commit) {
        setToast('项目使用的数据版本与当前缓存不同，部分配方可能缺失')
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error))
    }
  }, [hydrateProject, loadProject, status?.selected?.commit])

  const exportPng = useCallback(async () => {
    const element = document.querySelector('.canvas-shell') as HTMLElement | null
    if (!element) return
    const blob = await toBlob(element, {
      backgroundColor: '#0f1115',
      pixelRatio: 2,
      cacheBust: true
    })
    if (!blob) {
      setToast('PNG 导出失败')
      return
    }
    const saved = await window.gtnh.exportPng(
      new Uint8Array(await blob.arrayBuffer()),
      `${project.name || 'GTNH产线'}.png`
    )
    if (saved) setToast('PNG 已导出')
  }, [project.name])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const modifier = event.ctrlKey || event.metaKey
      const target = event.target as HTMLElement | null
      const editing = Boolean(
        target?.matches('input, select, textarea, [contenteditable="true"]')
      )
      if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveProject(event.shiftKey)
      } else if (modifier && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void openProject()
      } else if (editing) {
        return
      } else if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if (modifier && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
      } else if (modifier && event.key.toLowerCase() === 'c') {
        if (selectedNodeId) {
          event.preventDefault()
          void navigator.clipboard.writeText(
            JSON.stringify({ type: 'gtnh-node-ids', ids: [selectedNodeId] })
          )
        }
      } else if (modifier && event.key.toLowerCase() === 'v') {
        void navigator.clipboard.readText().then((value) => {
          try {
            const payload = JSON.parse(value) as {
              type?: string
              ids?: string[]
            }
            if (payload.type === 'gtnh-node-ids' && payload.ids) {
              duplicateNodes(payload.ids)
            }
          } catch {
            // Ignore clipboard payloads that do not belong to this app.
          }
        })
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedNodeId) removeNodes([selectedNodeId])
        if (selectedEdgeId) removeEdges([selectedEdgeId])
      } else if (event.key.toLowerCase() === 'f') {
        void flow.fitView({ duration: 220, padding: 0.18 })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    duplicateNodes,
    flow,
    openProject,
    redo,
    removeEdges,
    removeNodes,
    saveProject,
    selectedEdgeId,
    selectedNodeId,
    undo
  ])

  const handleDownload = async (ref: string): Promise<void> => {
    setDownloading(true)
    setDownloadError(null)
    try {
      const result = await window.gtnh.resolveAndDownload(ref)
      const nextStatus = await window.gtnh.getDataStatus()
      setStatus(nextStatus)
      await window.gtnh.selectVersion(result.version.commit)
      const selectedStatus = await window.gtnh.getDataStatus()
      setStatus(selectedStatus)
      setWorkerLoaded(false)
      workerUrlRef.current = 'gtnh-data://current/data.bin.gz'
      clearPreviews()
      previewedKeysRef.current.clear()
      if (!useProjectStore.getState().project.nodes.length) {
        initializeProject(result.version)
      }
      await loadWorkerData()
      setShowVersionPicker(false)
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : String(error))
    } finally {
      setDownloading(false)
    }
  }

  const handleSelectVersion = async (version: CachedDataVersion): Promise<void> => {
    try {
      await window.gtnh.selectVersion(version.commit)
      const nextStatus = await window.gtnh.getDataStatus()
      setStatus(nextStatus)
      setWorkerLoaded(false)
      workerUrlRef.current = 'gtnh-data://current/data.bin.gz'
      clearPreviews()
      previewedKeysRef.current.clear()
      if (!useProjectStore.getState().project.nodes.length) {
        initializeProject(version)
      }
      await loadWorkerData()
      setShowVersionPicker(false)
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : String(error))
    }
  }

  const selectedNode = project.nodes.find((node) => node.id === selectedNodeId)
  const selectedEdge = project.edges.find((edge) => edge.id === selectedEdgeId)

  if (!status) {
    return <div className="boot-screen">正在检查便携目录…</div>
  }

  const needsVersion = !status.selected || showVersionPicker || !workerLoaded
  if (needsVersion && (!workerLoaded || showVersionPicker || !status.selected)) {
    return (
      <VersionPicker
        status={status}
        downloadProgress={downloadProgress}
        localProgress={status.localImport}
        downloading={downloading}
        error={downloadError}
        required={!status.selected}
        onDownload={(ref) => void handleDownload(ref)}
        onSelect={(version) => void handleSelectVersion(version)}
        onImported={(version) => void handleSelectVersion(version)}
        onStatusChanged={setStatus}
        onClose={
          status.selected
            ? () => {
                setShowVersionPicker(false)
                setDownloadError(null)
                void loadWorkerData()
              }
            : undefined
        }
      />
    )
  }

  return (
    <div className="app-shell">
      <header className="toolbar">
        <div className="brand">
          <Database size={20} />
          <div>
            <strong>GTNH 产线设计器</strong>
            <span>
              data v{status.selected?.dataVersion} ·{' '}
              {dataCounts?.recipes.toLocaleString() ?? '—'} 配方
            </span>
          </div>
        </div>

        <div className="project-name">
          <input
            value={project.name}
            onChange={(event) =>
              useProjectStore.setState((state) => ({
                project: {
                  ...state.project,
                  name: event.target.value,
                  updatedAt: new Date().toISOString()
                },
                dirty: true
              }))
            }
            aria-label="项目名称"
          />
          {dirty && <span className="dirty-dot" title="未保存" />}
        </div>

        <div className="toolbar-actions">
          <button
            className="icon-text"
            title="新建项目"
            onClick={() => {
              if (!dirty || window.confirm('当前项目尚未保存，仍要新建吗？')) {
                previewedKeysRef.current.clear()
                initializeProject(status.selected)
              }
            }}
          >
            <FilePlus2 size={16} />
            新建
          </button>
          <button className="icon-text" title="打开项目 (Ctrl+O)" onClick={() => void openProject()}>
            <FolderOpen size={16} />
            打开
          </button>
          <button className="icon-text" title="保存 (Ctrl+S)" onClick={() => void saveProject(false)}>
            <Save size={16} />
            保存
          </button>
          <button
            className="icon-button"
            title="另存为 (Ctrl+Shift+S)"
            onClick={() => void saveProject(true)}
          >
            <SaveAll size={16} />
          </button>
          <span className="toolbar-separator" />
          <button className="icon-button" title="撤销 (Ctrl+Z)" onClick={undo}>
            <Undo2 size={16} />
          </button>
          <button className="icon-button" title="重做 (Ctrl+Y)" onClick={redo}>
            <Redo2 size={16} />
          </button>
          <span className="toolbar-separator" />
          <button
            className="icon-text calculate-button"
            title="校验并计算整条产线"
            disabled={!workerLoaded || !project.nodes.length || solving}
            onClick={() => void calculateProduction()}
          >
            <Calculator size={16} />
            {solveStale ? '重新计算' : '计算'}
          </button>
          <span className="toolbar-separator" />
          <label className="toolbar-select">
            <span>时间单位</span>
            <select
              value={project.timeUnit}
              onChange={(event) =>
                setTimeUnit(event.target.value as ProjectDocument['timeUnit'])
              }
            >
              <option value="min">分钟</option>
              <option value="sec">秒</option>
              <option value="hour">小时</option>
              <option value="tick">tick</option>
            </select>
          </label>
          <button className="icon-text" title="导出 PNG" onClick={() => void exportPng()}>
            <FileDown size={16} />
            PNG
          </button>
          <button
            className="icon-text"
            title="数据管理器"
            onClick={() => setShowVersionPicker(true)}
          >
            <Download size={16} />
            数据
          </button>
        </div>
      </header>

      <div className="workspace">
        <RecipePalette
          searchMachines={searchMachines}
          searchGoods={searchGoods}
          searchRecipes={searchRecipes}
          onAddMachine={(machine) => void addMachineAt(machine)}
          onChooseRecipe={(machine, recipeId) =>
            void addMachineAt(machine, undefined, recipeId)
          }
        />

        <main
          className="canvas-shell"
          onDragOver={(event) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }}
          onDrop={handleDrop}
        >
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            defaultViewport={project.viewport}
            minZoom={0.15}
            maxZoom={2.2}
            snapToGrid
            snapGrid={[16, 16]}
            onlyRenderVisibleElements
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            isValidConnection={isValidConnection}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={32}
            onNodeDragStart={pushHistory}
            onNodeDragStop={commitHistory}
            onNodeClick={(_event, node) => setSelection(node.id, null)}
            onEdgeClick={(_event, edge) => setSelection(null, edge.id)}
            onPaneClick={() => setSelection(null, null)}
            onMoveEnd={(_event, viewport) => setViewport(viewport)}
            colorMode="dark"
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={1}
              color="#313846"
            />
            <Controls position="bottom-left" showInteractive={false} />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              nodeColor={(node) => {
                const data = node.data as RecipeFlowNode['data']
                return data.invalidReasons?.length ||
                  data.preview?.valid === false ||
                  !data.graphNode.recipeId
                  ? '#d66565'
                  : '#4b9e86'
              }}
              maskColor="#0f1115b8"
            />
            {!project.nodes.length && (
              <Panel position="top-center">
                <div className="canvas-empty">
                  <strong>从左侧选择机器或精确配方</strong>
                  <span>机器节点先配置配方，再拖拽端口建立产线。</span>
                </div>
              </Panel>
            )}
          </ReactFlow>
        </main>

        <Inspector
          key={selectedNodeId ?? 'none'}
          node={selectedNode}
          edge={selectedEdge}
          detail={
            selectedNode?.recipeId ? recipes[selectedNode.recipeId] : undefined
          }
          preview={selectedNode ? previews[selectedNode.id] : undefined}
          computed={
            selectedNode && !solveStale
              ? solveResult?.nodes[selectedNode.id]
              : undefined
          }
          invalidReasons={
            selectedNode ? invalidNodes[selectedNode.id] : undefined
          }
          searchGoods={searchGoods}
          searchRecipes={searchRecipes}
          onChooseRecipe={chooseRecipeForNode}
          onChangeMachine={(machine) => {
            if (selectedNode) setNodeMachine(selectedNode.id, machine)
          }}
          onUpdateNode={(patch) => {
            if (selectedNode) updateNode(selectedNode.id, patch)
          }}
          onUpdateChoice={(key, value) => {
            if (!selectedNode) return
            updateNode(selectedNode.id, {
              choices: { ...selectedNode.choices, [key]: value }
            })
          }}
          onUpdateEdge={(patch) => {
            if (selectedEdge) updateEdge(selectedEdge.id, patch)
          }}
          onDelete={() => {
            if (selectedNode) removeNodes([selectedNode.id])
            if (selectedEdge) removeEdges([selectedEdge.id])
          }}
          onDuplicate={() => {
            if (selectedNode) duplicateNodes([selectedNode.id])
          }}
        />
      </div>

      <AnalysisPanel
        result={solveResult}
        timeUnit={project.timeUnit}
        stale={solveStale}
        invalidNodeCount={Object.keys(invalidNodes).length + Object.keys(invalidEdges).length}
      />

      <CalculationModal
        open={calculationOpen}
        stage={calculationStage}
        elapsedSeconds={elapsedSeconds}
        onCancel={cancelCalculation}
      />

      {toast && (
        <button className="toast" onClick={() => setToast(null)}>
          {toast}
        </button>
      )}
    </div>
  )
}

export function App(): React.JSX.Element {
  return (
    <ReactFlowProvider>
      <Workspace />
    </ReactFlowProvider>
  )
}
