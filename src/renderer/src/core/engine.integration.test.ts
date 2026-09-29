import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { DEFAULT_DATA_COMMIT } from '../../../shared/types'
import { createProject } from '../lib/project'
import { GtnhEngine } from './engine'

const dataPath = path.resolve(
  'data',
  'cache',
  DEFAULT_DATA_COMMIT,
  'data.bin.gz'
)
const hasLocalData = existsSync(dataPath)

describe.skipIf(!hasLocalData)('GtnhEngine with GTNH 2.9.0-v7 data', () => {
  it('loads the full repository and computes a real recipe graph', () => {
    const engine = new GtnhEngine()
    const raw = gunzipSync(readFileSync(dataPath))
    const counts = engine.load(
      raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
    )
    expect(counts).toEqual({
      dataVersion: 7,
      items: 50811,
      fluids: 1476,
      recipeTypes: 176,
      recipes: 221760
    })

    const search = engine.search('Iron Plate', 20)
    expect(search.recipes.length).toBeGreaterThan(0)
    const recipe = search.recipes[0]
    const detail = engine.getRecipe(recipe.id)
    expect(detail?.outputs.some((port) => port.goods.name === 'Iron Plate')).toBe(
      true
    )

    const project = createProject(null)
    project.data = {
      ref: '2.9.0-v7',
      commit: DEFAULT_DATA_COMMIT,
      dataVersion: 7
    }
    project.nodes = [
      {
        id: 'iron-plate',
        recipeId: recipe.id,
        position: { x: 0, y: 0 },
        rateMode: 'machines',
        machineCount: 1,
        targetPortKey: detail?.outputs[0]?.key,
        targetRate: 1,
        voltageTier: detail?.nativeVoltageTier ?? 0,
        crafterId: detail?.defaultCrafterId,
        choices: {},
        overrides: {
          speedMultiplier: 1,
          powerMultiplier: 1
        }
      }
    ]

    const result = engine.solve(project, 1)
    expect(result.status).not.toBe('error')
    expect(result.nodes['iron-plate'].recipesPerMinute).toBeGreaterThan(0)
    expect(result.totalPower).toBeGreaterThan(0)
    expect(result.externalInputs.length).toBeGreaterThan(0)
    expect(result.externalOutputs.length).toBeGreaterThan(0)

    const sourcePort = detail?.outputs[0]
    const targetSearch = engine.search('Iron Gear', 100)
    let connectedFlow = 0
    for (const targetSummary of targetSearch.recipes) {
      const targetDetail = engine.getRecipe(targetSummary.id)
      if (!targetDetail) continue
      const targetNode = {
        id: 'iron-gear',
        recipeId: targetDetail.id,
        position: { x: 500, y: 0 },
        rateMode: 'machines' as const,
        machineCount: 1,
        targetPortKey: targetDetail.outputs[0]?.key,
        targetRate: 1,
        voltageTier: targetDetail.nativeVoltageTier,
        crafterId: targetDetail.defaultCrafterId,
        choices: {},
        overrides: {
          speedMultiplier: 1,
          powerMultiplier: 1
        }
      }
      for (const targetPort of targetDetail.inputs) {
        const candidate = {
          ...project,
          nodes: [project.nodes[0], targetNode],
          edges: [
            {
              id: 'iron-plate-link',
              source: {
                nodeId: 'iron-plate',
                portKey: sourcePort!.key
              },
              target: {
                nodeId: 'iron-gear',
                portKey: targetPort.key
              },
              priority: 0,
              enabled: true
            }
          ]
        }
        const result = engine.solve(candidate, 2)
        if (result.edgeFlows['iron-plate-link'] > 0) {
          connectedFlow = result.edgeFlows['iron-plate-link']
          break
        }
      }
      if (connectedFlow > 0) break
    }
    expect(connectedFlow).toBeGreaterThan(0)

    const sulfurSearch = engine.search('Sulfur', 1000, 'product')
    const hydrogenSulfideRecipes = sulfurSearch.recipes.filter(
      (entry) =>
        entry.durationTicks === 72 &&
        entry.voltage === 120 &&
        entry.inputs.some((port) =>
          port.id.includes('liquid_hydricsulfur')
        ) &&
        entry.outputs.some((port) =>
          port.id.includes('gt.metaitem.01:2022')
        )
    )
    expect(hydrogenSulfideRecipes.length).toBeGreaterThan(0)
    expect(
      hydrogenSulfideRecipes.some(
        (entry) =>
          !entry.inputs.some((port) => port.id.includes('itemCellEmpty')) &&
          !entry.outputs.some((port) => port.id.includes('itemCellEmpty'))
      )
    ).toBe(true)
    expect(
      hydrogenSulfideRecipes.some((entry) =>
        entry.inputs.some((port) => port.id.includes('itemCellEmpty'))
      )
    ).toBe(true)

    const ingredientSearch = engine.search('Iron Plate', 100, 'ingredient')
    expect(ingredientSearch.recipes.length).toBeGreaterThan(0)
    expect(
      ingredientSearch.recipes.every((entry) =>
        entry.inputs.some((port) => port.name === 'Iron Plate')
      )
    ).toBe(true)
  })
})
