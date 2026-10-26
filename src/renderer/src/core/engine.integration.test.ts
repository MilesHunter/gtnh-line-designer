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
        machine: detail!.availableCrafters[0],
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
    expect(engine.validate(project).valid).toBe(true)
    const danglingValidation = engine.validate({
      ...project,
      edges: [
        {
          id: 'dangling',
          source: { nodeId: 'iron-plate', portKey: detail!.outputs[0].key },
          target: { nodeId: 'deleted-node', portKey: 'missing' },
          priority: 0,
          enabled: true
        }
      ]
    })
    expect(danglingValidation.removedEdgeIds).toContain('dangling')

    const chineseMachineSearch = engine.searchMachines('大型化学反应釜')
    const largeChemicalReactor = chineseMachineSearch.machines.find(
      (machine) => machine.name === 'Large Chemical Reactor'
    )
    expect(largeChemicalReactor?.multiblock).toBe(true)
    const allMachines = engine.searchMachines('', 2000).machines
    expect(allMachines.some((machine) => machine.multiblock)).toBe(true)
    expect(allMachines.some((machine) => !machine.multiblock)).toBe(true)
    const basicAlloySmelter = allMachines.find(
      (machine) => machine.name === 'Basic Alloy Smelter'
    )
    expect(basicAlloySmelter?.multiblock).toBe(false)
    expect(basicAlloySmelter?.displayName).toBe('基础合金炉')

    const ironPlateGoods = engine.searchGoods('Iron Plate', 20).items[0]
    const ironIngotGoods = engine.searchGoods('Iron Ingot', 20).items.find(
      (item) => item.kind === 'item'
    )
    const exactPairSearch = engine.searchExactRecipes({
      input: ironPlateGoods,
      output: ironIngotGoods,
      limit: 100
    })
    expect(exactPairSearch.total).toBeGreaterThan(0)
    expect(
      exactPairSearch.recipes.every(
        (entry) =>
          entry.inputs.some((goods) => goods.name === 'Iron Plate') &&
          entry.outputs.some((goods) => goods.name === 'Iron Ingot')
      )
    ).toBe(true)
    const unfilteredExactSearch = engine.searchExactRecipes({
      input: ironPlateGoods,
      limit: 100
    })
    const compatibleMachine = unfilteredExactSearch.recipes
      .flatMap((entry) => entry.crafters)
      .find((machine) => machine.multiblock) ??
      unfilteredExactSearch.recipes[0]?.crafters[0]
    expect(compatibleMachine).toBeDefined()
    const exactSearch = engine.searchExactRecipes({
      input: ironPlateGoods,
      machineId: compatibleMachine?.id,
      limit: 50
    })
    expect(exactSearch.total).toBeGreaterThan(0)
    expect(
      exactSearch.recipes.every(
        (entry) =>
          entry.crafters.length === 1 &&
          entry.crafters[0].id === compatibleMachine?.id
      )
    ).toBe(true)

    const platePreview = engine.previewNode({
      ...project.nodes[0],
      recipeId: recipe.id,
      machine: detail!.availableCrafters[0]
    })
    expect(platePreview?.valid).toBe(true)
    expect(platePreview?.overclockTiers).toBe(0)
    const singleMachine = detail!.availableCrafters.find(
      (machine) => !machine.multiblock
    )
    if (singleMachine) {
      const singlePreview = engine.previewNode({
        ...project.nodes[0],
        machine: singleMachine
      })
      expect(singlePreview?.machineInfo?.coilAvailable).toBe(false)
    }

    const higherTierRecipe = engine
      .searchExactRecipes({ input: ironPlateGoods, limit: 200 })
      .recipes.map((entry) => engine.getRecipe(entry.id))
      .find((entry) => entry && entry.nativeVoltageTier > 0)
    if (higherTierRecipe) {
      const lowVoltagePreview = engine.previewNode({
        ...project.nodes[0],
        recipeId: higherTierRecipe.id,
        machine: higherTierRecipe.availableCrafters[0],
        voltageTier: 0
      })
      expect(lowVoltagePreview?.valid).toBe(false)
      expect(lowVoltagePreview?.recipesPerMinute).toBe(0)
    }

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
        machine: targetDetail.availableCrafters[0],
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
