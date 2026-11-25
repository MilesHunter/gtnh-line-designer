import dagre from '@dagrejs/dagre'
import type {
  GraphEdge,
  GraphNode,
  RecipeDetail
} from '../../../shared/types'

const NODE_WIDTH = 520
const NODE_HEADER_HEIGHT = 49
const PORT_COLUMN_HEADER_HEIGHT = 27
const PORT_ROW_HEIGHT = 35
const NODE_FOOTER_HEIGHT = 50
const PORT_EXPANDER_HEIGHT = 28
const EMPTY_RECIPE_HEIGHT = 92
const VISIBLE_PORT_LIMIT = 6
const GRID_SIZE = 16

export interface NodePosition {
  id: string
  x: number
  y: number
}

function snap(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE
}

export function estimateNodeHeight(
  _node: GraphNode,
  detail?: RecipeDetail
): number {
  if (!detail) {
    return NODE_HEADER_HEIGHT + EMPTY_RECIPE_HEIGHT + NODE_FOOTER_HEIGHT
  }
  const visibleRows = Math.max(
    1,
    Math.min(
      VISIBLE_PORT_LIMIT,
      Math.max(detail.inputs.length, detail.outputs.length)
    )
  )
  const hasHiddenPorts =
    detail.inputs.length > VISIBLE_PORT_LIMIT ||
    detail.outputs.length > VISIBLE_PORT_LIMIT
  return (
    NODE_HEADER_HEIGHT +
    PORT_COLUMN_HEADER_HEIGHT +
    visibleRows * PORT_ROW_HEIGHT +
    (hasHiddenPorts ? PORT_EXPANDER_HEIGHT : 0) +
    NODE_FOOTER_HEIGHT
  )
}

export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  recipes: Record<string, RecipeDetail>
): NodePosition[] {
  if (!nodes.length) return []

  const graph = new dagre.graphlib.Graph()
  graph.setGraph({
    rankdir: 'LR',
    ranker: 'network-simplex',
    acyclicer: 'greedy',
    align: 'UL',
    nodesep: 40,
    ranksep: 108,
    edgesep: 24,
    marginx: 80,
    marginy: 80
  })
  graph.setDefaultEdgeLabel(() => ({}))

  const orderedNodes = [...nodes].sort(
    (left, right) =>
      left.position.y - right.position.y ||
      left.position.x - right.position.x ||
      left.id.localeCompare(right.id)
  )
  const nodeIds = new Set(nodes.map((node) => node.id))
  for (const node of orderedNodes) {
    graph.setNode(node.id, {
      width: NODE_WIDTH,
      height: estimateNodeHeight(
        node,
        node.recipeId ? recipes[node.recipeId] : undefined
      )
    })
  }

  for (const edge of edges) {
    if (
      edge.source.nodeId === edge.target.nodeId ||
      !nodeIds.has(edge.source.nodeId) ||
      !nodeIds.has(edge.target.nodeId)
    ) {
      continue
    }
    graph.setEdge(edge.source.nodeId, edge.target.nodeId, {
      minlen: 1,
      weight: edge.enabled ? 1 + Math.max(0, edge.priority) : 0.25
    })
  }

  dagre.layout(graph)

  return orderedNodes.map((node) => {
    const laidOut = graph.node(node.id) as {
      x: number
      y: number
      width: number
      height: number
    }
    return {
      id: node.id,
      x: snap(laidOut.x - laidOut.width / 2),
      y: snap(laidOut.y - laidOut.height / 2)
    }
  })
}
