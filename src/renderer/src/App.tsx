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
  GraphEdgeV1,
  GraphNodeV1,
  LocalImportProgress,
  ProjectDocumentV1,
  RecipeDetail,
  RecipeSearchMode,
  RecipeSearchResponse
} from '../../shared/types'
import { GtnhWorkerClient } from './lib/worker-client'
import { RecipeNode, type RecipeFlowNode } from './components/RecipeNode'
import { RecipePalette } from './components/RecipePalette'
import { Inspector } from './components/Inspector'
import { AnalysisPanel } from './components/AnalysisPanel'
import { VersionPicker } from './components/VersionPicker'
import { useProjectStore } from './store/project-store'

const nodeTypes: NodeTypes = {
  recipe: RecipeNode
}

const MISSING_RECIPE: RecipeDetail = {
  id: 'missing',
  recipeType: '缺失配方',
  category: 'unknown',
  durationTicks: 0,
  voltage: 0,
  amperage: 0,
  nativeVoltageTier: 0,
  specialValue: 0,
  metadata: {},
  inputs: [],
  outputs: [],
  availableCrafters: [],
  machineHasModel: false
}

function Workspace(): React.JSX.Element {
  const workerRef = useRef<GtnhWorkerClient | null>(null)
  const [status, setStatus] = useState<DataStatus | null>(null)
  const [downloadProgress, setDownloadProgress] =
    useState<DownloadProgress | null>(null)
  const [localProgress, setLocalProgress] =
    useState<LocalImportProgress | null>(null)
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
  const flow = useReactFlow<RecipeFlowNode, Edge>()

  const project = useProjectStore((state) => state.project)
  const recipes = useProjectStore((state) => state.recipes)
  const selectedNodeId = useProjectStore((state) => state.selectedNodeId)
  const selectedEdgeId = useProjectStore((state) => state.selectedEdgeId)
  const solveResult = useProjectStore((state) => state.solveResult)
  const solving = useProjectStore((state) => state.solving)
  const dirty = useProjectStore((state) => state.dirty)
  const currentPath = useProjectStore((state) => state.currentPath)

  const initializeProject = useProjectStore((state) => state.initializeProject)
  const loadProject = useProjectStore((state) => state.loadProject)
  const registerRecipe = useProjectStore((state) => state.registerRecipe)
  const addNode = useProjectStore((state) => state.addNode)
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
  const setSolving = useProjectStore((state) => state.setSolving)
  const setSolveResult = useProjectStore((state) => state.setSolveResult)
  const invalidateSolve = useProjectStore((state) => state.invalidateSolve)
  const setCurrentPath = useProjectStore((state) => state.setCurrentPath)
  const markSaved = useProjectStore((state) => state.markSaved)
  const undo = useProjectStore((state) => state.undo)
  const redo = useProjectStore((state) => state.redo)

  useEffect(() => {
    if (!workerRef.current) workerRef.current = new GtnhWorkerClient()
    const unsubscribeDownload = window.gtnh.onDownloadProgress((next) => {
      setDownloadProgress(next)
      if (next.stage === 'error') setDownloadError(next.message ?? '下载失败')
    })
    const unsubscribeLocal = window.gtnh.onLocalImportProgress((next) => {
      setLocalProgress(next)
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

  const loadWorkerData = useCallback(async () => {
    if (!workerRef.current) return
    setWorkerLoaded(false)
    try {
      const counts = await workerRef.current.load('gtnh-data://current/data.bin.gz')
      setDataCounts({
        items: counts.items,
        fluids: counts.fluids,
        recipes: counts.recipes
      })
      setWorkerLoaded(true)
      const current = useProjectStore.getState().project
      let restored = false
      if (current.nodes.length === 0) {
        const autosave = await window.gtnh.readAutosave()
        if (autosave) {
          try {
            const restoredProject = JSON.parse(autosave) as ProjectDocumentV1
            if (
              restoredProject.schemaVersion === 1 &&
              restoredProject.nodes.length > 0 &&
              restoredProject.data.commit === (status?.selected?.commit ?? '')
            ) {
              loadProject(restoredProject)
              restored = true
              setToast('已恢复上次自动保存')
            }
          } catch {
            // A corrupt autosave should not prevent startup.
          }
        }
      }
      if (!restored && !current.data.commit && status?.selected) {
        initializeProject(status.selected)
      }
    } catch (error) {
      setWorkerLoaded(false)
      setDownloadError(error instanceof Error ? error.message : String(error))
      setShowVersionPicker(true)
    }
  }, [initializeProject, loadProject, status?.selected])

  useEffect(() => {
    if (status?.selected && !workerLoaded) void loadWorkerData()
  }, [status?.selected, workerLoaded, loadWorkerData])

  const calculationKey = useMemo(
    () =>
      JSON.stringify({
        nodes: project.nodes.map(({ position, ...node }) => {
          void position
          return node
        }),
        edges: project.edges
      }),
    [project.nodes, project.edges]
  )

  const solveKeyRef = useRef(calculationKey)
  const solveRequestRef = useRef(0)

  useEffect(() => {
    if (solveKeyRef.current === calculationKey) return
    solveKeyRef.current = calculationKey
    solveRequestRef.current++
    invalidateSolve()
  }, [calculationKey, invalidateSolve])

  const calculateProduction = useCallback(async () => {
    if (
      !workerLoaded ||
      !workerRef.current ||
      solving ||
      !project.nodes.length
    ) {
      return
    }
    const key = calculationKey
    const revision = Date.now()
    const requestId = ++solveRequestRef.current
    setSolving(true)
    try {
      const result = await workerRef.current.solve(
        useProjectStore.getState().project,
        revision
      )
      if (
        result.revision === revision &&
        solveRequestRef.current === requestId &&
        solveKeyRef.current === key
      ) {
        setSolveResult(result)
      }
    } catch (error) {
      if (solveRequestRef.current === requestId) {
        setToast(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (solveRequestRef.current === requestId) setSolving(false)
    }
  }, [
    calculationKey,
    project.nodes.length,
    setSolveResult,
    setSolving,
    solving,
    workerLoaded
  ])

  useEffect(() => {
    if (!workerLoaded) return
    const missing = project.nodes
      .map((node) => node.recipeId)
      .filter((recipeId) => !recipes[recipeId])
    if (!missing.length || !workerRef.current) return
    void Promise.all(missing.map((recipeId) => workerRef.current!.getRecipe(recipeId)))
      .then((details) => {
        for (const detail of details) {
          if (detail) registerRecipe(detail)
        }
      })
  }, [project.nodes, recipes, registerRecipe, workerLoaded])

  useEffect(() => {
    if (!workerLoaded || !dirty) return
    const timer = window.setInterval(() => {
      void window.gtnh.autosaveProject(JSON.stringify(useProjectStore.getState().project, null, 2))
    }, 8000)
    return () => window.clearInterval(timer)
  }, [workerLoaded, dirty])

  const flowNodes = useMemo<RecipeFlowNode[]>(
    () =>
      project.nodes.map((node) => ({
        id: node.id,
        type: 'recipe',
        position: node.position,
        selected: node.id === selectedNodeId,
        data: {
          graphNode: node,
          detail: recipes[node.recipeId] ?? { ...MISSING_RECIPE, id: node.recipeId },
          computed: solveResult?.nodes[node.id],
          timeUnit: project.timeUnit,
          onUpdate: (patch) => updateNode(node.id, patch),
          onSelect: () => setSelection(node.id, null)
        }
      })),
    [
      project.nodes,
      project.timeUnit,
      recipes,
      selectedNodeId,
      setSelection,
      solveResult,
      updateNode
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
        labelBgStyle: { fill: '#171b22', fillOpacity: 0.95 },
        labelStyle: { fill: '#b8c2d0', fontSize: 10 },
        style: {
          stroke: edge.enabled ? '#55b899' : '#5d6572',
          strokeWidth: edge.enabled ? 1.8 : 1,
          strokeDasharray: edge.enabled ? undefined : '5 5'
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: edge.enabled ? '#55b899' : '#5d6572'
        }
      })),
    [project.edges, selectedEdgeId, solveResult]
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
      if (positions.length) setNodePositions(positions, false)
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

  const getPortDirection = useCallback(
    (
      nodeId: string | null | undefined,
      portKey: string | null | undefined
    ): 'input' | 'output' | undefined => {
      if (!nodeId || !portKey) return undefined
      const node = project.nodes.find((entry) => entry.id === nodeId)
      if (!node) return undefined
      const detail = recipes[node.recipeId]
      if (!detail) return undefined
      if (detail.inputs.some((port) => port.key === portKey)) return 'input'
      if (detail.outputs.some((port) => port.key === portKey)) return 'output'
      return undefined
    },
    [project.nodes, recipes]
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
      const sourceDirection = getPortDirection(
        connection.source,
        connection.sourceHandle
      )
      const targetDirection = getPortDirection(
        connection.target,
        connection.targetHandle
      )
      if (
        sourceDirection === targetDirection ||
        (sourceDirection !== 'input' && sourceDirection !== 'output') ||
        (targetDirection !== 'input' && targetDirection !== 'output')
      ) {
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
    [addEdge, getPortDirection]
  )

  const isValidConnection = useCallback<IsValidConnection<Edge>>(
    (connection) => {
      const sourceDirection = getPortDirection(
        connection.source,
        connection.sourceHandle
      )
      const targetDirection = getPortDirection(
        connection.target,
        connection.targetHandle
      )
      return (
        (sourceDirection === 'output' && targetDirection === 'input') ||
        (sourceDirection === 'input' && targetDirection === 'output')
      )
    },
    [getPortDirection]
  )

  const addRecipeAt = useCallback(
    async (recipeId: string, position?: { x: number; y: number }) => {
      if (!workerRef.current) return
      const detail = await workerRef.current.getRecipe(recipeId)
      if (!detail) {
        setToast('找不到该配方')
        return
      }
      const current = useProjectStore.getState().project
      const target =
        position ?? {
          x: 120 + (current.nodes.length % 5) * 60,
          y: 90 + (current.nodes.length % 7) * 48
        }
      addNode(detail, target)
      flow.setCenter(-target.x + 500, -target.y + 280, { zoom: 0.9, duration: 220 })
    },
    [addNode, flow]
  )

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const recipeId = event.dataTransfer.getData('application/x-gtnh-recipe')
      if (!recipeId) return
      const position = flow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY
      })
      void addRecipeAt(recipeId, position)
    },
    [addRecipeAt, flow]
  )

  const handleSearch = useCallback(
    (
      query: string,
      mode: RecipeSearchMode
    ): Promise<RecipeSearchResponse> => {
      if (!workerRef.current) {
        return Promise.resolve({ items: [], recipes: [], total: 0 })
      }
      return workerRef.current.search(query, 100, mode)
    },
    []
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
      const parsed = JSON.parse(opened.content) as ProjectDocumentV1
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.nodes)) {
        throw new Error('不是有效的 .gtnhgraph 项目')
      }
      loadProject(parsed, opened.path)
      if (parsed.data.commit !== status?.selected?.commit) {
        setToast('项目使用的数据版本与当前缓存不同，部分配方可能缺失')
      }
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error))
    }
  }, [loadProject, status?.selected?.commit])

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
        localProgress={localProgress}
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
              data v{status.selected?.dataVersion} · {dataCounts?.recipes.toLocaleString() ?? '—'} 配方
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
            title="计算实际输入输出"
            disabled={!workerLoaded || !project.nodes.length || solving}
            onClick={() => void calculateProduction()}
          >
            <Calculator size={16} />
            {solving ? '计算中…' : '计算'}
          </button>
          <span className="toolbar-separator" />
          <label className="toolbar-select">
            <span>时间单位</span>
            <select
              value={project.timeUnit}
              onChange={(event) =>
                setTimeUnit(event.target.value as ProjectDocumentV1['timeUnit'])
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
          search={handleSearch}
          onAddRecipe={(recipeId) => void addRecipeAt(recipeId)}
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
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            isValidConnection={isValidConnection}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={28}
            onNodeDragStart={pushHistory}
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
              nodeColor={(node) =>
                (node.data as { computed?: { valid?: boolean } }).computed?.valid === false
                  ? '#d66565'
                  : '#4b9e86'
              }
              maskColor="#0f1115b8"
            />
            {solving && (
              <Panel position="top-right">
                <div className="solving-badge">正在求解…</div>
              </Panel>
            )}
            {!project.nodes.length && (
              <Panel position="top-center">
                <div className="canvas-empty">
                  <strong>从左侧拖入生产配方</strong>
                  <span>节点连接后在底部查看外部物料和功率汇总。</span>
                </div>
              </Panel>
            )}
          </ReactFlow>
        </main>

        <Inspector
          node={selectedNode}
          edge={selectedEdge}
          detail={
            selectedNode
              ? recipes[selectedNode.recipeId] ?? {
                  ...MISSING_RECIPE,
                  id: selectedNode.recipeId
                }
              : undefined
          }
          computed={selectedNode ? solveResult?.nodes[selectedNode.id] : undefined}
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

      <AnalysisPanel result={solveResult} timeUnit={project.timeUnit} />

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
