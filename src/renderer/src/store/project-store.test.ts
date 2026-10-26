import { beforeEach, describe, expect, it } from 'vitest'
import type {
  GraphNode,
  MachineRef,
  ProjectDocument,
  RecipeDetail
} from '../../../shared/types'
import { createProject } from '../lib/project'
import { useProjectStore } from './project-store'

const machine: MachineRef = {
  id: 'i-machine',
  name: 'Large Chemical Reactor',
  displayName: '大型化学反应釜',
  iconId: 1,
  mod: 'gregtech',
  multiblock: true
}

function makeNode(index: number, recipeId = 'r-one'): GraphNode {
  return {
    id: `node-${index}`,
    machine,
    recipeId,
    position: { x: index * 10, y: index * 4 },
    rateMode: 'machines',
    machineCount: 1,
    targetPortKey: '0:3',
    targetRate: 1,
    voltageTier: 2,
    choices: {},
    overrides: { speedMultiplier: 1, powerMultiplier: 1 }
  }
}

function withNodes(nodes: GraphNode[], edgeCount = 1): ProjectDocument {
  return {
    ...createProject(null),
    nodes,
    edges: Array.from({ length: edgeCount }, (_, index) => ({
        id: `edge-${index}`,
        source: {
          nodeId: nodes[index % nodes.length].id,
          portKey: `source-${index}`
        },
        target: {
          nodeId: nodes[(index + 1) % nodes.length].id,
          portKey: `target-${index}`
        },
        priority: 0,
        enabled: true
      }))
  }
}

describe('project store performance boundaries', () => {
  beforeEach(() => {
    useProjectStore.setState({ past: [], future: [], solveResult: null })
  })

  it('updates only the moved node objects', () => {
    const nodes = Array.from({ length: 500 }, (_, index) => makeNode(index))
    useProjectStore.setState({ project: withNodes(nodes, 1000) })
    const before = useProjectStore.getState().project.nodes
    const beforeEdges = useProjectStore.getState().project.edges
    useProjectStore
      .getState()
      .setNodePositions([{ id: 'node-250', x: 9000, y: 7000 }])
    const after = useProjectStore.getState().project.nodes

    expect(after).not.toBe(before)
    expect(after[0]).toBe(before[0])
    expect(after[499]).toBe(before[499])
    expect(after[250]).not.toBe(before[250])
    expect(after[250].position).toEqual({ x: 9000, y: 7000 })
    expect(useProjectStore.getState().project.edges).toBe(beforeEdges)
  })

  it('drops every edge attached to a node when its recipe changes', () => {
    const nodes = [makeNode(0), makeNode(1), makeNode(2)]
    useProjectStore.setState({ project: withNodes(nodes) })
    const detail = {
      id: 'r-two',
      recipeType: 'Chemical Reactor',
      category: 'chemistry',
      durationTicks: 20,
      voltage: 120,
      amperage: 1,
      nativeVoltageTier: 2,
      specialValue: 0,
      metadata: {},
      inputs: [],
      outputs: [],
      availableCrafters: [machine],
      machineHasModel: true
    } satisfies RecipeDetail

    useProjectStore.getState().setNodeRecipe('node-0', machine, detail)
    const state = useProjectStore.getState()
    expect(state.project.edges).toEqual([])
    expect(state.project.nodes[0].recipeId).toBe('r-two')
    expect(state.recipes['r-two']).toEqual(detail)
  })

  it('stores only the moved node in drag history', () => {
    const nodes = Array.from({ length: 500 }, (_, index) => makeNode(index))
    useProjectStore.setState({
      project: withNodes(nodes),
      past: [],
      future: []
    })
    useProjectStore.getState().pushHistory()
    useProjectStore
      .getState()
      .setNodePositions([{ id: 'node-250', x: 1200, y: 800 }])
    useProjectStore.getState().commitHistory()

    const entry = useProjectStore.getState().past.at(-1)
    expect(entry?.nodes).toHaveLength(1)
    expect(entry?.nodes[0].id).toBe('node-250')

    useProjectStore.getState().undo()
    expect(
      useProjectStore.getState().project.nodes[250].position
    ).toEqual({ x: 2500, y: 1000 })
    useProjectStore.getState().redo()
    expect(
      useProjectStore.getState().project.nodes[250].position
    ).toEqual({ x: 1200, y: 800 })
  })

  it('undoes node configuration patches without copying unrelated nodes', () => {
    const nodes = [makeNode(0), makeNode(1), makeNode(2)]
    useProjectStore.setState({
      project: withNodes(nodes),
      past: [],
      future: []
    })
    useProjectStore.getState().updateNode('node-1', { machineCount: 3.5 })
    const entry = useProjectStore.getState().past.at(-1)
    expect(entry?.nodes).toHaveLength(1)
    expect(entry?.nodes[0].after?.machineCount).toBe(3.5)

    useProjectStore.getState().undo()
    expect(useProjectStore.getState().project.nodes[1].machineCount).toBe(1)
    useProjectStore.getState().redo()
    expect(useProjectStore.getState().project.nodes[1].machineCount).toBe(3.5)
  })
})
