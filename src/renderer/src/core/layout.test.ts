import { describe, expect, it } from 'vitest'
import type {
  GraphEdge,
  GraphNode,
  MachineRef,
  RecipeDetail
} from '../../../shared/types'
import { estimateNodeHeight, layoutGraph } from './layout'

const machine: MachineRef = {
  id: 'machine',
  name: 'Assembler',
  displayName: '组装机',
  iconId: 1,
  mod: 'gregtech',
  multiblock: false
}

function node(id: string, index: number): GraphNode {
  return {
    id,
    machine,
    position: { x: index * 11, y: index * 13 },
    rateMode: 'machines',
    machineCount: 1,
    targetRate: 1,
    voltageTier: 1,
    choices: {},
    overrides: { speedMultiplier: 1, powerMultiplier: 1 }
  }
}

function edge(source: string, target: string): GraphEdge {
  return {
    id: `${source}-${target}`,
    source: { nodeId: source, portKey: '0:3' },
    target: { nodeId: target, portKey: '0:3' },
    priority: 0,
    enabled: true
  }
}

describe('automatic graph layout', () => {
  it('places connected machines from left to right without overlaps', () => {
    const positions = layoutGraph(
      [node('c', 2), node('a', 0), node('b', 1)],
      [edge('a', 'b'), edge('b', 'c')],
      {}
    )
    const byId = new Map(positions.map((position) => [position.id, position]))

    expect(byId.get('a')!.x).toBeLessThan(byId.get('b')!.x)
    expect(byId.get('b')!.x).toBeLessThan(byId.get('c')!.x)
    expect(byId.get('b')!.x - byId.get('a')!.x).toBeGreaterThanOrEqual(520)
    expect(
      new Set(positions.map((position) => `${position.x}:${position.y}`)).size
    ).toBe(3)
  })

  it('keeps branches on the same rank around their shared source', () => {
    const positions = layoutGraph(
      [node('source', 0), node('left', 1), node('right', 2)],
      [edge('source', 'left'), edge('source', 'right')],
      {}
    )
    const byId = new Map(positions.map((position) => [position.id, position]))

    expect(byId.get('left')!.x).toBe(byId.get('right')!.x)
    expect(byId.get('left')!.y).not.toBe(byId.get('right')!.y)
  })

  it('produces finite, grid-aligned positions for cycles and isolated nodes', () => {
    const positions = layoutGraph(
      [node('a', 0), node('b', 1), node('c', 2), node('isolated', 3)],
      [edge('a', 'b'), edge('b', 'a'), edge('b', 'c')],
      {}
    )

    expect(positions).toHaveLength(4)
    for (const position of positions) {
      expect(Number.isFinite(position.x)).toBe(true)
      expect(Number.isFinite(position.y)).toBe(true)
      expect(position.x % 16).toBe(0)
      expect(position.y % 16).toBe(0)
    }
  })

  it('reserves extra height for rows and a collapsed-port control', () => {
    const detail = {
      id: 'recipe',
      recipeType: 'Assembler',
      category: 'crafting',
      durationTicks: 20,
      voltage: 32,
      amperage: 1,
      nativeVoltageTier: 1,
      specialValue: 0,
      metadata: {},
      inputs: Array.from({ length: 8 }, () => ({})),
      outputs: Array.from({ length: 2 }, () => ({})),
      availableCrafters: [machine],
      machineHasModel: true
    } as unknown as RecipeDetail

    expect(estimateNodeHeight(node('recipe', 0), detail)).toBe(364)
    expect(estimateNodeHeight(node('empty', 0))).toBe(191)
  })
})
