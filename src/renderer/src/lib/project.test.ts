import { describe, expect, it } from 'vitest'
import type { MachineRef, ProjectDocumentV1 } from '../../../shared/types'
import {
  createProject,
  formatRate,
  migrateProjectV1,
  unitScale
} from './project'

describe('project utilities', () => {
  it('creates a v7 project without a selected data version', () => {
    const project = createProject(null)
    expect(project.schemaVersion).toBe(2)
    expect(project.data.commit).toBe('')
    expect(project.nodes).toEqual([])
  })

  it('converts per-minute values into display units', () => {
    expect(unitScale('hour').fromMinute).toBe(60)
    expect(unitScale('tick').fromMinute).toBe(1200)
    expect(formatRate(120, 'sec')).toBe('2.00')
  })

  it('migrates legacy recipe nodes to concrete machine nodes', () => {
    const machine: MachineRef = {
      id: 'i-machine',
      name: 'Large Chemical Reactor',
      displayName: '大型化学反应釜',
      iconId: 12,
      mod: 'gregtech',
      multiblock: true
    }
    const legacy: ProjectDocumentV1 = {
      schemaVersion: 1,
      name: '旧项目',
      data: { ref: '2.9.0', commit: 'abc', dataVersion: 7 },
      timeUnit: 'min',
      nodes: [
        {
          id: 'node-1',
          recipeId: 'r-recipe',
          position: { x: 12, y: 34 },
          rateMode: 'machines',
          machineCount: 1.5,
          targetRate: 1,
          voltageTier: 2,
          choices: { coils: 3 },
          overrides: { speedMultiplier: 1, powerMultiplier: 1 }
        }
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }

    const migrated = migrateProjectV1(legacy, { 'node-1': machine })
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.nodes[0].machine).toEqual(machine)
    expect(migrated.nodes[0].recipeId).toBe('r-recipe')
    expect(migrated.nodes[0].machineCount).toBe(1.5)
  })
})
