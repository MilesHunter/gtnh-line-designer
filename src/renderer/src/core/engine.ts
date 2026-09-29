import solver from 'javascript-lp-solver'
import {
  Item,
  Fluid,
  Goods,
  OreDict,
  Recipe,
  RecipeIoType,
  RecipeObject,
  Repository
} from './vendor/repository'
import {
  GetParameter,
  GetSingleBlockMachine,
  machines,
  notImplementedMachine,
  singleBlockMachine,
  type Choice,
  type Machine
} from './vendor/machines'
import { voltageTier } from './vendor/utils'
import { RecipeModel, type OverclockResult } from './model'
import type {
  ComputedNode,
  GoodsSummary,
  MachineChoice,
  MachineInfo,
  ProjectDocumentV1,
  RecipeDetail,
  RecipePort,
  RecipeSearchMode,
  RecipeSearchResponse,
  SearchItemResult,
  SearchRecipeResult,
  SolveResult
} from '../../../shared/types'

type SearchableGoods = Goods & {
  production: Int32Array
  consumption: Int32Array
}

interface IndexedGoods {
  object: SearchableGoods
  id: string
  name: string
  normalizedName: string
  kind: 'item' | 'fluid'
}

interface InternalPort {
  publicPort: RecipePort & { ratePerMinute: number }
  goodsObject: RecipeObject
}

interface ComputedInternal {
  publicNode: ComputedNode
  ports: Map<string, InternalPort>
}

const IO_INPUT = new Set<number>([
  RecipeIoType.ItemInput,
  RecipeIoType.OreDictInput,
  RecipeIoType.FluidInput
])

const IO_OUTPUT = new Set<number>([
  RecipeIoType.ItemOutput,
  RecipeIoType.FluidOutput
])

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function choiceLabel(description: string): string {
  const known: Record<string, string> = {
    Coils: '线圈',
    Muffler: '消音仓',
    Electrode: '电极',
    Coolant: '冷却液',
    Parallels: '并行数',
    Mode: '模式',
    Tier: '等级',
    Casings: '外壳'
  }
  return known[description] ?? description
}

function toMachineChoice(key: string, choice: Choice): MachineChoice {
  return {
    key,
    label: choiceLabel(choice.description),
    numeric: !choice.choices?.length,
    min: choice.min ?? 0,
    max: choice.max,
    options: choice.choices
  }
}

export class GtnhEngine {
  private repository: Repository | null = null
  private goodsIndex: IndexedGoods[] = []
  private readonly recipeDetailCache = new Map<string, RecipeDetail>()

  load(buffer: ArrayBuffer): {
    dataVersion: number
    items: number
    fluids: number
    recipeTypes: number
    recipes: number
  } {
    const repository = Repository.load(buffer)
    this.repository = repository
    this.recipeDetailCache.clear()
    this.goodsIndex = []

    for (const pointer of repository.items) {
      const object = repository.GetObject(pointer, Item)
      this.goodsIndex.push(this.indexGoods(object, 'item'))
    }
    for (const pointer of repository.fluids) {
      const object = repository.GetObject(pointer, Fluid)
      this.goodsIndex.push(this.indexGoods(object, 'fluid'))
    }

    return {
      dataVersion: repository.elements[0],
      items: repository.items.length,
      fluids: repository.fluids.length,
      recipeTypes: repository.recipeTypes.length,
      recipes: repository.recipes.length
    }
  }

  search(
    query: string,
    limit = 80,
    mode: RecipeSearchMode = 'product'
  ): RecipeSearchResponse {
    this.requireRepository()
    const normalized = normalize(query)
    const items = this.searchGoods(normalized, limit)
    const recipes = this.searchRecipes(normalized, items, limit, mode)
    return {
      items,
      recipes,
      total: items.length + recipes.length
    }
  }

  getRecipe(recipeId: string): RecipeDetail | null {
    const repository = this.requireRepository()
    const cached = this.recipeDetailCache.get(recipeId)
    if (cached) return cached

    const recipe = repository.GetById<Recipe>(recipeId)
    if (!recipe) return null
    const internal = this.buildRecipeModel(recipe, undefined, false)
    const detail: RecipeDetail = {
      id: recipe.id,
      recipeType: recipe.recipeType.name,
      category: recipe.recipeType.category,
      durationTicks: recipe.gtRecipe?.durationTicks ?? 0,
      voltage: recipe.gtRecipe?.voltage ?? 0,
      amperage: recipe.gtRecipe?.amperage ?? 0,
      nativeVoltageTier: recipe.gtRecipe?.voltageTier ?? 0,
      specialValue: recipe.gtRecipe?.specialValue ?? 0,
      metadata: Object.fromEntries(
        (recipe.gtRecipe?.metadata ?? []).map((entry) => [entry.key, entry.value])
      ),
      inputs: Array.from(internal.ports.values())
        .filter((port) => port.publicPort.direction === 'input')
        .map((port) => port.publicPort),
      outputs: Array.from(internal.ports.values())
        .filter((port) => port.publicPort.direction === 'output')
        .map((port) => port.publicPort),
      availableCrafters: this.availableCrafters(recipe),
      defaultCrafterId: recipe.recipeType.defaultCrafter?.id,
      machineHasModel: internal.publicNode.machineInfo?.hasModel ?? false
    }
    this.recipeDetailCache.set(recipeId, detail)
    return detail
  }

  solve(project: ProjectDocumentV1, revision: number): SolveResult {
    try {
      const repository = this.requireRepository()
      const computed = new Map<string, ComputedInternal>()
      const warnings: string[] = []

      for (const node of project.nodes) {
        const recipe = repository.GetById<Recipe>(node.recipeId)
        if (!recipe) {
          warnings.push(`节点 ${node.id} 的配方 ${node.recipeId} 不存在`)
          continue
        }
        const result = this.computeNode(node.id, recipe, node)
        computed.set(node.id, result)
        warnings.push(...result.publicNode.warnings.map((warning) => `${node.id}: ${warning}`))
      }

      const edges = project.edges.filter((edge) => edge.enabled)
      const edgeResults: Record<string, number> = {}
      const externalInputs: SolveResult['externalInputs'] = []
      const externalOutputs: SolveResult['externalOutputs'] = []
      const model = {
        optimize: 'obj',
        opType: 'min' as const,
        constraints: {} as Record<string, Record<string, number>>,
        variables: {} as Record<string, Record<string, number>>
      }

      const ensurePortBalance = (
        nodeId: string,
        port: InternalPort,
        amountPerMinute: number
      ): string => {
        const key = `balance_${nodeId}_${port.publicPort.key}`
        model.constraints[key] = { equal: amountPerMinute }
        return key
      }

      const externalVariables = new Map<
        string,
        {
          variable: string
          port: InternalPort
          direction: 'input' | 'output'
        }
      >()

      for (const [nodeId, node] of computed) {
        for (const port of node.ports.values()) {
          const balance = ensurePortBalance(
            nodeId,
            port,
            port.publicPort.ratePerMinute
          )
          const variable = `external_${port.publicPort.direction}_${nodeId}_${port.publicPort.key}`
          model.variables[variable] = {
            obj: 1_000_000,
            [balance]: 1
          }
          externalVariables.set(variable, {
            variable,
            port,
            direction: port.publicPort.direction
          })
        }
      }

      for (const edge of edges) {
        const sourceNode = computed.get(edge.source.nodeId)
        const targetNode = computed.get(edge.target.nodeId)
        if (!sourceNode || !targetNode) continue
        const sourcePort = sourceNode.ports.get(edge.source.portKey)
        const targetPort = targetNode.ports.get(edge.target.portKey)
        if (!sourcePort || !targetPort) continue
        if (
          sourcePort.publicPort.direction !== 'output' ||
          targetPort.publicPort.direction !== 'input'
        ) {
          warnings.push(`边 ${edge.id} 的方向无效`)
          continue
        }
        if (!this.areCompatible(sourcePort, targetPort)) {
          warnings.push(
            `边 ${edge.id} 不兼容：${sourcePort.publicPort.goods.name} → ${targetPort.publicPort.goods.name}`
          )
          continue
        }

        const variable = `edge_${edge.id}`
        const sourceBalance = `balance_${edge.source.nodeId}_${edge.source.portKey}`
        const targetBalance = `balance_${edge.target.nodeId}_${edge.target.portKey}`
        const priority = Math.max(0, edge.priority)
        model.variables[variable] = {
          obj: Math.max(0.01, 1 - Math.min(0.95, priority * 0.01)),
          [sourceBalance]: 1,
          [targetBalance]: 1
        }
      }

      const solution = solver.Solve(model)
      if (!solution.feasible) {
        return {
          revision,
          status: 'error',
          error: '物料平衡没有可行解',
          nodes: Object.fromEntries(
            Array.from(computed, ([id, value]) => [id, value.publicNode])
          ),
          edgeFlows: {},
          externalInputs: [],
          externalOutputs: [],
          powerByTier: {},
          totalPower: 0,
          cycles: this.findCycles(project),
          warnings
        }
      }

      for (const edge of edges) {
        const value = Number(solution[`edge_${edge.id}`] ?? 0)
        const normalized = value > 1e-7 ? value : 0
        edgeResults[edge.id] = normalized
      }

      for (const entry of externalVariables.values()) {
        const value = Number(solution[entry.variable] ?? 0)
        if (value <= 1e-7) continue
        const summary = {
          goods: entry.port.publicPort.goods,
          amountPerMinute: value,
          port: {
            nodeId: this.findNodeIdForPort(computed, entry.port),
            portKey: entry.port.publicPort.key
          }
        }
        if (entry.direction === 'input') externalInputs.push(summary)
        else externalOutputs.push(summary)
      }

      const powerByTier: Record<number, number> = {}
      for (const node of project.nodes) {
        const result = computed.get(node.id)
        if (!result || result.publicNode.euPerTick <= 0) continue
        const tier = result.publicNode.machineInfo?.fixedVoltageTier ?? node.voltageTier
        powerByTier[tier] = (powerByTier[tier] ?? 0) + result.publicNode.euPerTick
      }
      const totalPower = Object.values(powerByTier).reduce((sum, power) => sum + power, 0)

      return {
        revision,
        status: warnings.length ? 'partial' : 'solved',
        nodes: Object.fromEntries(
          Array.from(computed, ([id, value]) => [id, value.publicNode])
        ),
        edgeFlows: edgeResults,
        externalInputs: externalInputs.sort(
          (a, b) => b.amountPerMinute - a.amountPerMinute
        ),
        externalOutputs: externalOutputs.sort(
          (a, b) => b.amountPerMinute - a.amountPerMinute
        ),
        powerByTier,
        totalPower,
        cycles: this.findCycles(project),
        warnings
      }
    } catch (error) {
      return {
        revision,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        nodes: {},
        edgeFlows: {},
        externalInputs: [],
        externalOutputs: [],
        powerByTier: {},
        totalPower: 0,
        cycles: [],
        warnings: []
      }
    }
  }

  private requireRepository(): Repository {
    if (!this.repository) throw new Error('GTNH 数据尚未加载')
    return this.repository
  }

  private indexGoods(
    object: SearchableGoods,
    kind: 'item' | 'fluid'
  ): IndexedGoods {
    return {
      object,
      id: object.id,
      name: object.name,
      normalizedName: normalize(object.name),
      kind
    }
  }

  private searchGoods(query: string, limit: number): SearchItemResult[] {
    const repository = this.requireRepository()
    let candidates = this.goodsIndex
    if (query) {
      candidates = candidates.filter(
        (entry) =>
          entry.normalizedName.includes(query) ||
          normalize(entry.object.tooltip ?? '').includes(query) ||
          normalize(entry.object.mod).includes(query)
      )
    }

    candidates = [...candidates].sort((a, b) => {
      if (!query) return a.name.localeCompare(b.name)
      const aExact = a.normalizedName === query ? 0 : 1
      const bExact = b.normalizedName === query ? 0 : 1
      if (aExact !== bExact) return aExact - bExact
      const aPrefix = a.normalizedName.startsWith(query) ? 0 : 1
      const bPrefix = b.normalizedName.startsWith(query) ? 0 : 1
      if (aPrefix !== bPrefix) return aPrefix - bPrefix
      return a.name.localeCompare(b.name)
    })

    return candidates.slice(0, limit).map((entry) => {
      const object = repository.GetById<SearchableGoods>(entry.id)
      return {
        ...this.goodsSummary(object ?? entry.object),
        productionRecipes: object?.production.length ?? 0,
        consumptionRecipes: object?.consumption.length ?? 0
      }
    })
  }

  private searchRecipes(
    query: string,
    goods: SearchItemResult[],
    limit: number,
    mode: RecipeSearchMode
  ): SearchRecipeResult[] {
    const repository = this.requireRepository()
    const recipeIds = new Set<string>()

    for (const item of goods.slice(0, 20)) {
      const object = repository.GetById<SearchableGoods>(item.id)
      if (!object) continue
      const pointers = mode === 'ingredient'
        ? object.consumption
        : object.production
      for (const pointer of pointers) {
        recipeIds.add(repository.GetObject(pointer, Recipe).id)
        if (recipeIds.size >= limit * 3) break
      }
      if (recipeIds.size >= limit * 3) break
    }

    if (query) {
      for (const pointer of repository.recipes) {
        if (recipeIds.size >= limit * 4) break
        const recipe = repository.GetObject(pointer, Recipe)
        if (
          normalize(recipe.recipeType.name).includes(query) ||
          normalize(recipe.recipeType.category).includes(query)
        ) {
          recipeIds.add(recipe.id)
        }
      }
    }

    return Array.from(recipeIds)
      .slice(0, limit)
      .map((id) => {
        const recipe = repository.GetById<Recipe>(id)!
        const detail = this.getRecipe(id)!
        return {
          id,
          recipeType: recipe.recipeType.name,
          category: recipe.recipeType.category,
          durationTicks: recipe.gtRecipe?.durationTicks ?? 0,
          voltage: recipe.gtRecipe?.voltage ?? 0,
          nativeVoltageTier: recipe.gtRecipe?.voltageTier ?? 0,
          outputs: detail.outputs.map((port) => port.goods),
          inputs: detail.inputs.map((port) => port.goods)
        }
      })
  }

  private goodsSummary(object: RecipeObject): GoodsSummary {
    if (object instanceof OreDict) {
      const display = object.items[0]
      return {
        id: object.id,
        kind: 'ore',
        name: display?.name ?? object.id,
        mod: display?.mod ?? '',
        iconId: display?.iconId ?? 0,
        tooltip: display?.tooltip ?? undefined
      }
    }
    const goods = object as Goods
    return {
      id: goods.id,
      kind: object instanceof Fluid ? 'fluid' : 'item',
      name: goods.name,
      mod: goods.mod,
      iconId: goods.iconId,
      tooltip: goods.tooltip ?? undefined
    }
  }

  private availableCrafters(recipe: Recipe): RecipeDetail['availableCrafters'] {
    const result = new Map<
      string,
      { id: string; name: string; iconId: number; multiblock: boolean }
    >()
    for (const item of recipe.recipeType.singleblocks) {
      result.set(item.id, {
        id: item.id,
        name: item.name,
        iconId: item.iconId,
        multiblock: false
      })
    }
    for (const item of recipe.recipeType.multiblocks) {
      result.set(item.id, {
        id: item.id,
        name: item.name,
        iconId: item.iconId,
        multiblock: true
      })
    }
    if (recipe.recipeType.defaultCrafter) {
      const item = recipe.recipeType.defaultCrafter
      result.set(item.id, {
        id: item.id,
        name: item.name,
        iconId: item.iconId,
        multiblock: false
      })
    }
    return Array.from(result.values())
  }

  private selectMachine(
    recipe: Recipe,
    crafterId?: string
  ): { crafter: Item | null; machine: Machine; hasModel: boolean } {
    const repository = this.requireRepository()
    let crafter = crafterId ? repository.GetById<Item>(crafterId) : null
    if (
      crafter &&
      !recipe.recipeType.multiblocks.some((item) => item.id === crafter!.id) &&
      !recipe.recipeType.singleblocks.some((item) => item.id === crafter!.id) &&
      recipe.recipeType.defaultCrafter?.id !== crafter.id
    ) {
      crafter = null
    }
    if (
      crafter &&
      !recipe.recipeType.multiblocks.some((item) => item.id === crafter!.id) &&
      recipe.recipeType.singleblocks.length > 0
    ) {
      crafter = null
    }

    const canBeSingleblock = (() => {
      if (recipe.recipeType.singleblocks.length === 0) return false
      const machine = GetSingleBlockMachine(recipe.recipeType)
      return !(machine.excludesRecipe?.(recipe) ?? false)
    })()

    if (crafter === null && !canBeSingleblock) {
      for (const item of recipe.recipeType.multiblocks) {
        const machine = machines[item.name]
        if (!(machine?.excludesRecipe?.(recipe) ?? false)) {
          crafter = item
          break
        }
      }
      if (!crafter) crafter = recipe.recipeType.defaultCrafter
    }

    const hasModel = crafter ? Boolean(machines[crafter.name]) : true
    const machine =
      (crafter ? machines[crafter.name] : null) ??
      (crafter ? notImplementedMachine : GetSingleBlockMachine(recipe.recipeType))
    return { crafter, machine, hasModel }
  }

  private buildRecipeModel(
    recipe: Recipe,
    config: ProjectDocumentV1['nodes'][number] | undefined,
    applyMachineRecipe: boolean
  ): ComputedInternal {
    const model = new RecipeModel(recipe)
    const selected = this.selectMachine(recipe, config?.crafterId)
    const machine = selected.machine
    model.crafter = selected.crafter?.id
    model.machineInfo = machine
    model.voltageTier = config?.voltageTier ?? recipe.gtRecipe?.voltageTier ?? 0
    model.choices = { ...(config?.choices ?? {}) }

    if (machine.fixedVoltageTier !== undefined) {
      model.voltageTier = GetParameter(machine.fixedVoltageTier, model)
    }
    model.ValidateChoices(machine)
    model.recipeItems = recipe.items.map((entry) => ({ ...entry }))

    if (!machine.choices) model.choices = {}
    const recipeEffect = applyMachineRecipe && machine.recipe
      ? machine.recipe(model, model.choices, recipe.items)
      : recipe.items

    const ports = new Map<string, InternalPort>()
    recipeEffect.forEach((entry, index) => {
      const direction = IO_INPUT.has(entry.type) ? 'input' : 'output'
      if (direction !== 'input' && direction !== 'output') return

      if (entry.goods instanceof Item && entry.goods.container) {
        const container = entry.goods.container
        const fluidKey = `${index}:fluid`
        ports.set(fluidKey, {
          publicPort: {
            key: fluidKey,
            index,
            direction,
            ioType: entry.type,
            goods: this.goodsSummary(container.fluid),
            slot: entry.slot,
            amount: entry.amount * container.amount,
            probability: entry.probability,
            ratePerMinute: 0
          },
          goodsObject: container.fluid
        })
        const emptyKey = `${index}:empty`
        ports.set(emptyKey, {
          publicPort: {
            key: emptyKey,
            index,
            direction,
            ioType: entry.type,
            goods: this.goodsSummary(container.empty),
            slot: entry.slot,
            amount: entry.amount,
            probability: entry.probability,
            ratePerMinute: 0
          },
          goodsObject: container.empty
        })
        return
      }

      const key = `${index}:${entry.type}`
      ports.set(key, {
        publicPort: {
          key,
          index,
          direction,
          ioType: entry.type,
          goods: this.goodsSummary(entry.goods),
          slot: entry.slot,
          amount: entry.amount,
          probability: entry.probability,
          ratePerMinute: 0
        },
        goodsObject: entry.goods
      })
    })

    const phaseDriven = Boolean(recipe.gtRecipe && recipe.gtRecipe.durationTicks > 0)
    const durationTicks = phaseDriven ? recipe.gtRecipe!.durationTicks : 1200
    const durationMinutes = durationTicks / 1200
    const warnings: string[] = []
    if (!phaseDriven) {
      warnings.push('该配方没有 GT 机器计时，按每台等效机器 1 次/分钟估算')
    }

    let overclockResult: OverclockResult = {
      overclockSpeed: 1,
      overclockPower: 1,
      overclockName: '无超频'
    }
    let machineParallels = 1
    let parallels = 1
    let speedModifier = 1
    let energyModifier = 1
    let overclockTiers = 0
    let speedCorrectionFactor = 1

    if (phaseDriven) {
      const gtRecipe = recipe.gtRecipe!
      const amperage = Math.max(1, gtRecipe.amperage)
      const actualVoltage = voltageTier[model.voltageTier]?.voltage ?? 32
      machineParallels = Math.max(1, GetParameter(machine.parallels, model))
      energyModifier = GetParameter(machine.power, model)
      const safeEnergyModifier = Math.max(0.000001, energyModifier)
      const maxParallels = machine.ignoreParallelLimit
        ? machineParallels
        : Math.max(
            1,
            Math.floor(
              actualVoltage /
                (Math.max(1, gtRecipe.voltage) *
                  safeEnergyModifier *
                  amperage)
            )
          )
      parallels = Math.min(maxParallels, machineParallels)
      const configParallels = config?.overrides.parallels
      if (
        configParallels !== undefined &&
        Number.isFinite(configParallels) &&
        configParallels > 0
      ) {
        parallels = Math.max(1, Math.floor(configParallels))
        if (parallels > maxParallels) {
          warnings.push(`手动并行数超过该电压下的上限 ${maxParallels}`)
        }
      }

      const tierDifference = model.voltageTier - gtRecipe.voltageTier
      if (tierDifference < 0) {
        warnings.push(`机器电压低于配方原始等级 ${voltageTier[gtRecipe.voltageTier]?.name ?? ''}`)
      }
      const isSingleblock = !selected.crafter
      const parallelOverclockLimits = Math.floor(
        Math.log2(Math.max(1, maxParallels / parallels)) / 2
      )
      overclockTiers = isSingleblock
        ? tierDifference
        : Math.min(tierDifference, parallelOverclockLimits)
      overclockTiers = Math.max(0, overclockTiers)
      overclockResult = GetParameter(machine.overclocker, model).calculate(
        model,
        overclockTiers
      )
      speedModifier = GetParameter(machine.speed, model)
      const durationForRounding = machine.roundAfterParallels
        ? gtRecipe.durationTicks / parallels
        : gtRecipe.durationTicks
      const estimatedDuration =
        durationForRounding / (overclockResult.overclockSpeed * speedModifier)
      if (estimatedDuration > 1) {
        const rounded = Math.floor(estimatedDuration)
        speedCorrectionFactor = estimatedDuration / rounded
      }
    }

    const overclockFactor =
      overclockResult.overclockSpeed *
      speedModifier *
      speedCorrectionFactor *
      parallels *
      Math.max(0.000001, config?.overrides.speedMultiplier ?? 1)
    const powerFactor =
      (phaseDriven ? Math.max(1, recipe.gtRecipe!.amperage) : 0) *
      overclockResult.overclockPower *
      energyModifier /
      Math.max(0.000001, speedModifier) /
      Math.max(0.000001, speedCorrectionFactor) *
      Math.max(0, config?.overrides.powerMultiplier ?? 1)

    model.overclockFactor = overclockFactor
    model.powerFactor = powerFactor
    model.overclockTiers = overclockTiers
    model.overclockName = overclockResult.overclockName
    model.parallels = parallels
    model.recipeItems = Array.from(ports.values()).map((port) => ({
      type: port.publicPort.ioType,
      goodsPtr: -1,
      goods: port.goodsObject,
      slot: port.publicPort.slot,
      amount: port.publicPort.amount,
      probability: port.publicPort.probability
    }))

    const machineInfo: MachineInfo | null = machine
      ? {
          id: selected.crafter?.id ?? `singleblock:${recipe.recipeType.name}`,
          name: selected.crafter?.name ?? `${recipe.recipeType.name} (单方块)`,
          hasModel: selected.hasModel,
          fixedVoltageTier: machine.fixedVoltageTier === undefined
            ? undefined
            : model.voltageTier,
          choices: machine.choices
            ? Object.entries(machine.choices).map(([key, choice]) =>
                toMachineChoice(key, choice)
              )
            : [],
          info: machine.info ? GetParameter(machine.info, model) : undefined
        }
      : null

    const node: ComputedNode = {
      nodeId: '',
      recipeId: recipe.id,
      valid: true,
      warnings,
      machineInfo,
      recipesPerMinute: 0,
      machineCount: config?.machineCount ?? 1,
      recommendedMachineCount: 1,
      utilization: 1,
      overclockTiers,
      overclockName: overclockResult.overclockName,
      parallels,
      durationTicks,
      euPerTick: 0,
      ports: Array.from(ports.values()).map((port) => ({
        ...port.publicPort,
        ratePerMinute: 0
      }))
    }

    return {
      publicNode: node,
      ports
    }
  }

  private computeNode(
    nodeId: string,
    recipe: Recipe,
    config: ProjectDocumentV1['nodes'][number]
  ): ComputedInternal {
    const result = this.buildRecipeModel(recipe, config, true)
    const node = result.publicNode
    node.nodeId = nodeId
    const durationMinutes = node.durationTicks / 1200
    const factors = this.computeFactor(recipe, config, node.durationTicks)

    let recipesPerMinute = 0
    let machineCount = config.machineCount

    if (config.rateMode === 'target' && config.targetPortKey) {
      const target = result.ports.get(config.targetPortKey)
      if (!target || target.publicPort.direction !== 'output') {
        node.valid = false
        node.warnings.push('目标输出端口不存在')
      } else {
        const outputPerRecipe =
          target.publicPort.amount * target.publicPort.probability
        if (outputPerRecipe <= 0) {
          node.valid = false
          node.warnings.push('目标输出没有有效产量')
        } else {
          recipesPerMinute = config.targetRate / outputPerRecipe
          const speedPerMachine =
            factors.overclockFactor / Math.max(0.000001, durationMinutes)
          machineCount = recipesPerMinute / speedPerMachine
        }
      }
    } else {
      recipesPerMinute =
        machineCount *
        (factors.overclockFactor / Math.max(0.000001, durationMinutes))
    }

    if (!Number.isFinite(recipesPerMinute) || recipesPerMinute < 0) {
      recipesPerMinute = 0
      machineCount = 0
      node.valid = false
      node.warnings.push('速率计算结果无效')
    }

    node.recipesPerMinute = recipesPerMinute
    node.machineCount = machineCount
    node.recommendedMachineCount = machineCount > 0 ? Math.ceil(machineCount) : 0
    node.utilization =
      node.recommendedMachineCount > 0
        ? machineCount / node.recommendedMachineCount
        : 0

    for (const port of node.ports) {
      const internal = result.ports.get(port.key)!
      port.ratePerMinute =
        port.amount * port.probability * recipesPerMinute
      internal.publicPort = port
    }

    if (recipe.gtRecipe && recipe.gtRecipe.durationTicks > 0) {
      node.euPerTick =
        (recipe.gtRecipe.durationTicks / 1200) *
        recipe.gtRecipe.voltage *
        recipesPerMinute *
        factors.powerFactor
    }

    if (
      node.machineInfo?.choices.some(
        (choice) => choice.key === 'coilTier' || choice.key === 'coils'
      )
    ) {
      this.validateHeat(recipe, config, node)
    }

    return result
  }

  private computeFactor(
    recipe: Recipe,
    config: ProjectDocumentV1['nodes'][number],
    durationTicks: number
  ): { overclockFactor: number; powerFactor: number } {
    const model = new RecipeModel(recipe)
    const selected = this.selectMachine(recipe, config.crafterId)
    const machine = selected.machine
    model.voltageTier = config.voltageTier
    model.choices = { ...config.choices }
    if (machine.fixedVoltageTier !== undefined) {
      model.voltageTier = GetParameter(machine.fixedVoltageTier, model)
    }
    model.ValidateChoices(machine)

    if (!recipe.gtRecipe || recipe.gtRecipe.durationTicks <= 0) {
      return {
        overclockFactor: Math.max(0.000001, config.overrides.speedMultiplier),
        powerFactor: 0
      }
    }

    const gtRecipe = recipe.gtRecipe
    const actualVoltage = voltageTier[model.voltageTier]?.voltage ?? 32
    const machineParallels = Math.max(1, GetParameter(machine.parallels, model))
    const energyModifier = GetParameter(machine.power, model)
    const maxParallels = machine.ignoreParallelLimit
      ? machineParallels
      : Math.max(
          1,
          Math.floor(
            actualVoltage /
              (Math.max(1, gtRecipe.voltage) *
                Math.max(0.000001, energyModifier) *
                Math.max(1, gtRecipe.amperage))
          )
        )
    let parallels = Math.min(maxParallels, machineParallels)
    if (config.overrides.parallels && config.overrides.parallels > 0) {
      parallels = Math.max(1, Math.floor(config.overrides.parallels))
    }
    const tierDifference = model.voltageTier - gtRecipe.voltageTier
    const overclockTiers = Math.max(
      0,
      !selected.crafter
        ? tierDifference
        : Math.min(
            tierDifference,
            Math.floor(Math.log2(Math.max(1, maxParallels / parallels)) / 2)
          )
    )
    const overclock = GetParameter(machine.overclocker, model).calculate(
      model,
      overclockTiers
    )
    const speedModifier = GetParameter(machine.speed, model)
    const durationForRounding = machine.roundAfterParallels
      ? durationTicks / parallels
      : durationTicks
    const estimatedDuration =
      durationForRounding / (overclock.overclockSpeed * speedModifier)
    const speedCorrectionFactor =
      estimatedDuration > 1
        ? estimatedDuration / Math.floor(estimatedDuration)
        : 1

    return {
      overclockFactor:
        overclock.overclockSpeed *
        speedModifier *
        speedCorrectionFactor *
        parallels *
        Math.max(0.000001, config.overrides.speedMultiplier),
      powerFactor:
        Math.max(1, gtRecipe.amperage) *
        overclock.overclockPower *
        energyModifier /
        Math.max(0.000001, speedModifier) /
        Math.max(0.000001, speedCorrectionFactor) *
        Math.max(0, config.overrides.powerMultiplier)
    }
  }

  private validateHeat(
    recipe: Recipe,
    config: ProjectDocumentV1['nodes'][number],
    node: ComputedNode
  ): void {
    const coilTier = config.choices.coilTier ?? config.choices.coils
    if (coilTier === undefined) return
    if (recipe.recipeType.name === 'Electric Blast Furnace') {
      const actualHeat =
        1801 + coilTier * 900 + Math.max(0, config.voltageTier - 1) * 100
      if (actualHeat < recipe.gtRecipe?.specialValue) {
        node.valid = false
        node.warnings.push(
          `线圈与电压提供的热量 ${actualHeat}K 低于配方要求 ${recipe.gtRecipe?.specialValue}K`
        )
      }
    }

    const requiredCoil =
      recipe.gtRecipe?.MetadataByKey('nfr_coil_tier') ??
      recipe.gtRecipe?.MetadataByKey('defc_casing_tier')
    if (requiredCoil !== undefined && coilTier + 1 < requiredCoil) {
      node.valid = false
      node.warnings.push(`该配方至少需要 T${requiredCoil} 线圈或外壳`)
    }
  }

  private areCompatible(source: InternalPort, target: InternalPort): boolean {
    if (source.publicPort.goods.id === target.publicPort.goods.id) return true
    if (
      target.publicPort.ioType !== RecipeIoType.OreDictInput ||
      !(target.goodsObject instanceof OreDict)
    ) {
      return false
    }
    const oreDict = target.goodsObject
    return oreDict.items.some((item) => item.id === source.publicPort.goods.id)
  }

  private findNodeIdForPort(
    computed: Map<string, ComputedInternal>,
    needle: InternalPort
  ): string {
    for (const [nodeId, node] of computed) {
      for (const port of node.ports.values()) {
        if (port === needle) return nodeId
      }
    }
    return ''
  }

  private findCycles(project: ProjectDocumentV1): string[][] {
    const adjacency = new Map<string, string[]>()
    for (const node of project.nodes) adjacency.set(node.id, [])
    for (const edge of project.edges) {
      if (!edge.enabled) continue
      adjacency.get(edge.source.nodeId)?.push(edge.target.nodeId)
    }

    const cycles: string[][] = []
    const visited = new Set<string>()
    const stack: string[] = []
    const inStack = new Set<string>()

    const visit = (nodeId: string): void => {
      visited.add(nodeId)
      stack.push(nodeId)
      inStack.add(nodeId)
      for (const next of adjacency.get(nodeId) ?? []) {
        if (!visited.has(next)) {
          visit(next)
        } else if (inStack.has(next)) {
          const index = stack.indexOf(next)
          if (index >= 0) cycles.push(stack.slice(index).concat(next))
        }
      }
      stack.pop()
      inStack.delete(nodeId)
    }

    for (const node of project.nodes) {
      if (!visited.has(node.id)) visit(node.id)
    }
    return cycles
  }
}
