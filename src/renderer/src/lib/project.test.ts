import { describe, expect, it } from 'vitest'
import { createProject, formatRate, unitScale } from './project'

describe('project utilities', () => {
  it('creates a v7 project without a selected data version', () => {
    const project = createProject(null)
    expect(project.schemaVersion).toBe(1)
    expect(project.data.commit).toBe('')
    expect(project.nodes).toEqual([])
  })

  it('converts per-minute values into display units', () => {
    expect(unitScale('hour').fromMinute).toBe(60)
    expect(unitScale('tick').fromMinute).toBe(1200)
    expect(formatRate(120, 'sec')).toBe('2.00')
  })
})
