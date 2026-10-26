import solver from 'javascript-lp-solver'
import {
  Item,
  Fluid,
  Goods,
  OreDict,
  Recipe,
  RecipeIoType,
  RecipeObject,
  RecipeType,
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
  ExactRecipeSearchRequest,
  ExactRecipeSearchResponse,
  GoodsSummary,
  GraphNode,
  MachineChoice,
  MachineInfo,
  MachineRef,
  MachineSearchResponse,
  MachineSummary,
  ProjectDocument,
  ProjectValidationIssue,
  ProjectValidationResult,
  RecipeDetail,
  RecipePort,
  RecipeSearchMode,
  RecipeSearchResponse,
  SearchItemResult,
  SearchRecipeResult,
  SolveResult
} from '../../../shared/types'
import {
  isSingleBlockMachine,
  machineDisplayName,
  machineSearchText
} from './machine-names'

type SearchableGoods = Goods & {
  production: Int32Array
  consumption: Int32Array
}

interface IndexedGoods {
  object: RecipeObject
  id: string
  name: string
  normalizedName: string
  normalizedSearch: string
  kind: 'item' | 'fluid' | 'ore'
}

interface IndexedMachine {
  item: Item
  recipeTypes: Set<string>
  multiblock: boolean
  displayName: string
  normalizedSearch: string
}

interface InternalPort {
  publicPort: RecipePort & { ratePerMinute: number }
  goodsObject: RecipeObject
}

interface ComputedInternal {
  publicNode: ComputedNode
  ports: Map<string, InternalPort>
}

interface IndexedRecipeLinks {
  production: Set<string>
  consumption: Set<string>
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
  private machineIndex: IndexedMachine[] = []
  private readonly machineById = new Map<string, IndexedMachine>()
  private readonly itemOreDicts = new Map<string, Set<string>>()
  private readonly oreRecipeLinks = new Map<string, IndexedRecipeLinks>()
  private readonly recipeDetailCache = new Map<string, RecipeDetail>()
  private readonly previewCache = new Map<string, ComputedNode>()

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
    this.previewCache.clear()
    this.goodsIndex = []
    this.machineIndex = []
    this.machineById.clear()
    this.itemOreDicts.clear()
    this.oreRecipeLinks.clear()

    for (const pointer of repository.items) {
      const object = repository.GetObject(pointer, Item)
      this.goodsIndex.push(this.indexGoods(object, 'item'))
    }
    for (const pointer of repository.fluids) {
      const object = repository.GetObject(pointer, Fluid)
      this.goodsIndex.push(this.indexGoods(object, 'fluid'))
    }
    for (const pointer of repository.oreDicts) {
      const object = repository.GetObject(pointer, OreDict)
      this.goodsIndex.push(this.indexGoods(object, 'ore'))
      for (const item of object.items) {
        const entries = this.itemOreDicts.get(item.id) ?? new Set<string>()
        entries.add(object.id)
        this.itemOreDicts.set(item.id, entries)
      }
    }

    this.buildMachineIndex(repository)
    this.buildOreRecipeIndex(repository)

    return {
      dataVersion: repository.elements[0],
      items: repository.items.length,
      fluids: repository.fluids.length,
      recipeTypes: repository.recipeTypes.length,
      recipes: repository.recipes.length
    }
  }

  searchGoods(query: string, limit = 40): RecipeSearchResponse {
    this.requireRepository()
    const normalized = normalize(query)
    const items = this.searchGoodsEntries(normalized, limit)
    return {
      items,
      recipes: [],
      total: items.length
    }
  }

  searchMachines(query: string, limit = 80): MachineSearchResponse {
    this.requireRepository()
    const normalized = normalize(query)
    let candidates = this.machineIndex
    if (normalized) {
      candidates = candidates.filter((entry) =>
        entry.normalizedSearch.includes(normalized)
      )
    }
    const sorted = [...candidates].sort((a, b) => {
      if (!normalized) return a.displayName.localeCompare(b.displayName, 'zh-CN')
      const aExact =
        normalize(a.displayName) === normalized ||
        normalize(a.item.name) === normalized
          ? 0
          : 1
      const bExact =
        normalize(b.displayName) === normalized ||
        normalize(b.item.name) === normalized
          ? 0
          : 1
      if (aExact !== bExact) return aExact - bExact
      const aPrefix = a.normalizedSearch.startsWith(normalized) ? 0 : 1
      const bPrefix = b.normalizedSearch.startsWith(normalized) ? 0 : 1
      if (aPrefix !== bPrefix) return aPrefix - bPrefix
      return a.displayName.localeCompare(b.displayName, 'zh-CN')
    })
    return {
      machines: sorted.slice(0, limit).map((entry) => this.machineSummary(entry)),
      total: candidates.length
    }
  }

  getMachine(machineId: string): MachineSummary | null {
    const entry = this.machineById.get(machineId)
    return entry ? this.machineSummary(entry) : null
  }

  searchExactRecipes(
    request: ExactRecipeSearchRequest
  ): ExactRecipeSearchResponse {
    this.requireRepository()
    const offset = Math.max(0, request.offset ?? 0)
    const limit = Math.max(1, Math.min(500, request.limit ?? 100))
    const inputIds = request.input
      ? this.recipeIdsForGoods(request.input, 'input')
      : null
    const outputIds = request.output
      ? this.recipeIdsForGoods(request.output, 'output')
      : null

    let candidates: Set<string> | null = inputIds
    if (outputIds) {
      if (!candidates) candidates = outputIds
      else candidates = new Set([...candidates].filter((id) => outputIds.has(id)))
    }
    if (!candidates) {
      return { recipes: [], total: 0, hasMore: false }
    }

    const repository = this.requireRepository()
    const machine = request.machineId
      ? this.machineById.get(request.machineId)
      : undefined
    const matching = [...candidates].filter((id) => {
      const recipe = repository.GetById<Recipe>(id)
      if (!recipe) return false
      return !machine || machine.recipeTypes.has(recipe.recipeType.name)
    })
    const fixedCrafter = machine ? this.machineRef(machine) : undefined
    matching.sort((a, b) => {
      const recipeA = repository.GetById<Recipe>(a)
      const recipeB = repository.GetById<Recipe>(b)
      if (!recipeA || !recipeB) return a.localeCompare(b)
      const typeCompare = recipeA.recipeType.name.localeCompare(
        recipeB.recipeType.name
      )
      if (typeCompare !== 0) return typeCompare
      return a.localeCompare(b)
    })

    return {
      recipes: matching
        .slice(offset, offset + limit)
        .map((id) => this.compactRecipeSummary(id, fixedCrafter))
        .filter((entry): entry is SearchRecipeResult => Boolean(entry)),
      total: matching.length,
      hasMore: offset + limit < matching.length
    }
  }

  search(
    query: string,
    limit = 80,
    mode: RecipeSearchMode = 'product'
  ): RecipeSearchResponse {
    this.requireRepository()
    const normalized = normalize(query)
    const items = this.searchGoodsEntries(normalized, limit)
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

  previewNode(node: GraphNode): ComputedNode | null {
    const repository = this.requireRepository()
    if (!node.recipeId) return null
    const recipe = repository.GetById<Recipe>(node.recipeId)
    if (!recipe) return null
    const signature = `${node.id}:${JSON.stringify({
      recipeId: node.recipeId,
      machine: node.machine,
      rateMode: node.rateMode,
      machineCount: node.machineCount,
      targetPortKey: node.targetPortKey,
      targetRate: node.targetRate,
      voltageTier: node.voltageTier,
      choices: node.choices,
      overrides: node.overrides
    })}`
    const cached = this.previewCache.get(signature)
    if (cached) return cached
    const result = this.computeNode(node.id, recipe, node).publicNode
    this.previewCache.set(signature, result)
    return result
  }

  validate(project: ProjectDocument): ProjectValidationResult {
    const repository = this.requireRepository()
    const issues: ProjectValidationIssue[] = []
    const computed = new Map<string, ComputedInternal>()
    const removedEdgeIds: string[] = []

    for (const node of project.nodes) {
      if (!node.machine?.id) {
        issues.push({ nodeId: node.id, message: '尚未选择机器' })
        continue
      }
      if (!node.recipeId) {
        issues.push({ nodeId: node.id, message: '尚未选择配方' })
        continue
      }
      const recipe = repository.GetById<Recipe>(node.recipeId)
      if (!recipe) {
        issues.push({
          nodeId: node.id,
          message: `当前数据版本中不存在配方 ${node.recipeId}`
        })
        continue
      }
      const machine = this.machineById.get(node.machine.id)
      if (!machine || !machine.recipeTypes.has(recipe.recipeType.name)) {
        issues.push({
          nodeId: node.id,
          message: '所选机器不能执行当前配方'
        })
        continue
      }
      const result = this.computeNode(node.id, recipe, node)
      computed.set(node.id, result)
      if (!result.publicNode.valid) {
        for (const warning of result.publicNode.warnings) {
          issues.push({ nodeId: node.id, message: warning })
        }
      }
    }

    for (const edge of project.edges) {
      const sourceNode = project.nodes.find(
        (node) => node.id === edge.source.nodeId
      )
      const targetNode = project.nodes.find(
        (node) => node.id === edge.target.nodeId
      )
      if (!sourceNode || !targetNode) {
        removedEdgeIds.push(edge.id)
        continue
      }
      if (
        !sourceNode.recipeId ||
        !targetNode.recipeId ||
        !repository.GetById<Recipe>(sourceNode.recipeId) ||
        !repository.GetById<Recipe>(targetNode.recipeId)
      ) {
        continue
      }
      const source = computed.get(edge.source.nodeId)
      const target = computed.get(edge.target.nodeId)
      const sourcePort = source?.ports.get(edge.source.portKey)
      const targetPort = target?.ports.get(edge.target.portKey)
      if (!sourcePort || !targetPort) {
        removedEdgeIds.push(edge.id)
        continue
      }
      if (
        sourcePort.publicPort.direction !== 'output' ||
        targetPort.publicPort.direction !== 'input'
      ) {
        issues.push({ edgeId: edge.id, message: '连线方向无效' })
        continue
      }
      if (!this.areCompatible(sourcePort, targetPort)) {
        issues.push({ edgeId: edge.id, message: '连线物料类型不兼容' })
      }
    }

    return {
      valid: issues.length === 0,
      issues,
      removedEdgeIds
    }
  }

  solve(project: ProjectDocument, revision: number): SolveResult {
    try {
      const repository = this.requireRepository()
      const computed = new Map<string, ComputedInternal>()
      const warnings: string[] = []

      for (const node of project.nodes) {
        if (!node.recipeId) {
          warnings.push(`节点 ${node.id} 尚未选择配方`)
          continue
        }
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
    object: RecipeObject,
    kind: 'item' | 'fluid' | 'ore'
  ): IndexedGoods {
    const summary = this.goodsSummary(object)
    return {
      object,
      id: object.id,
      name: summary.name,
      normalizedName: normalize(summary.name),
      normalizedSearch: normalize(
        `${summary.name} ${summary.mod} ${summary.tooltip ?? ''}`
      ),
      kind
    }
  }

  private buildMachineIndex(repository: Repository): void {
    const add = (item: Item, recipeType: string): void => {
      const effectiveMultiblock = !isSingleBlockMachine(
        item.name,
        item.tooltip
      )
      const existing = this.machineById.get(item.id)
      if (existing) {
        existing.recipeTypes.add(recipeType)
        existing.multiblock = effectiveMultiblock
        return
      }
      const displayName = machineDisplayName(item.name)
      const entry: IndexedMachine = {
        item,
        recipeTypes: new Set([recipeType]),
        multiblock: effectiveMultiblock,
        displayName,
        normalizedSearch: normalize(
          `${item.name} ${machineSearchText(item.name)} ${item.mod}`
        )
      }
      this.machineById.set(item.id, entry)
      this.machineIndex.push(entry)
    }

    for (const pointer of repository.recipeTypes) {
      const recipeType = repository.GetObject(pointer, RecipeType)
      for (const item of recipeType.singleblocks) {
        add(item, recipeType.name)
      }
      for (const item of recipeType.multiblocks) {
        add(item, recipeType.name)
      }
      if (recipeType.defaultCrafter) {
        add(recipeType.defaultCrafter, recipeType.name)
      }
    }
  }

  private buildOreRecipeIndex(repository: Repository): void {
    for (const pointer of repository.recipes) {
      const recipe = repository.GetObject(pointer, Recipe)
      for (const entry of recipe.items) {
        if (!(entry.goods instanceof OreDict)) continue
        const links = this.oreRecipeLinks.get(entry.goods.id) ?? {
          production: new Set<string>(),
          consumption: new Set<string>()
        }
        if (IO_INPUT.has(entry.type)) links.consumption.add(recipe.id)
        if (IO_OUTPUT.has(entry.type)) links.production.add(recipe.id)
        this.oreRecipeLinks.set(entry.goods.id, links)
      }
    }
  }

  private recipeIdsForGoods(
    goods: GoodsSummary,
    direction: 'input' | 'output'
  ): Set<string> {
    const repository = this.requireRepository()
    const ids = new Set<string>()
    if (goods.kind === 'ore') {
      const links = this.oreRecipeLinks.get(goods.id)
      const source = direction === 'input' ? links?.consumption : links?.production
      for (const id of source ?? []) ids.add(id)
      return ids
    }

    const object = repository.GetById<SearchableGoods>(goods.id)
    if (!object) return ids
    const pointers = direction === 'input' ? object.consumption : object.production
    for (const pointer of pointers) {
      ids.add(repository.GetObject(pointer, Recipe).id)
    }
    if (direction === 'input') {
      for (const oreId of this.itemOreDicts.get(goods.id) ?? []) {
        for (const id of this.oreRecipeLinks.get(oreId)?.consumption ?? []) {
          ids.add(id)
        }
      }
    }
    return ids
  }

  private compactRecipeSummary(
    id: string,
    fixedCrafter?: MachineRef
  ): SearchRecipeResult | null {
    const repository = this.requireRepository()
    const recipe = repository.GetById<Recipe>(id)
    if (!recipe) return null
    const inputs: GoodsSummary[] = []
    const outputs: GoodsSummary[] = []
    for (const entry of recipe.items) {
      const goods = this.goodsSummary(entry.goods)
      if (IO_INPUT.has(entry.type)) inputs.push(goods)
      if (IO_OUTPUT.has(entry.type)) outputs.push(goods)
    }
    return {
      id,
      recipeType: recipe.recipeType.name,
      category: recipe.recipeType.category,
      durationTicks: recipe.gtRecipe?.durationTicks ?? 0,
      voltage: recipe.gtRecipe?.voltage ?? 0,
      nativeVoltageTier: recipe.gtRecipe?.voltageTier ?? 0,
      outputs,
      inputs,
      crafters: fixedCrafter ? [fixedCrafter] : this.availableCrafters(recipe)
    }
  }

  private searchGoodsEntries(query: string, limit: number): SearchItemResult[] {
    const repository = this.requireRepository()
    let candidates = this.goodsIndex
    if (query) {
      candidates = candidates.filter(
        (entry) => entry.normalizedSearch.includes(query)
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
      if (entry.kind === 'ore') {
        return {
          ...this.goodsSummary(entry.object),
          productionRecipes: 0,
          consumptionRecipes:
            this.oreRecipeLinks.get(entry.id)?.consumption.size ?? 0
        }
      }
      const object = repository.GetById<SearchableGoods>(entry.id)
      return {
        ...this.goodsSummary(object ?? entry.object),
        productionRecipes: object?.production.length ?? 0,
        consumptionRecipes: object?.consumption.length ?? 0
      }
    })
  }

  private machineSummary(entry: IndexedMachine): MachineSummary {
    return {
      ...this.machineRef(entry),
      recipeTypes: [...entry.recipeTypes],
      recipeTypeCount: entry.recipeTypes.size,
      hasModel: Boolean(machines[entry.item.name])
    }
  }

  private machineRef(entry: IndexedMachine): MachineRef {
    return {
      id: entry.item.id,
      name: entry.item.name,
      displayName: entry.displayName,
      iconId: entry.item.iconId,
      mod: entry.item.mod,
      multiblock: entry.multiblock
    }
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
      if (item.kind === 'ore') continue
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
          inputs: detail.inputs.map((port) => port.goods),
          crafters: detail.availableCrafters
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
    const result = new Map<string, MachineRef>()
    for (const item of recipe.recipeType.singleblocks) {
      const indexed = this.machineById.get(item.id)
      if (indexed) result.set(item.id, this.machineRef(indexed))
    }
    for (const item of recipe.recipeType.multiblocks) {
      const indexed = this.machineById.get(item.id)
      if (indexed) result.set(item.id, this.machineRef(indexed))
    }
    if (recipe.recipeType.defaultCrafter) {
      const item = recipe.recipeType.defaultCrafter
      const indexed = this.machineById.get(item.id)
      if (indexed) result.set(item.id, this.machineRef(indexed))
    }
    return Array.from(result.values())
  }

  private selectMachine(
    recipe: Recipe,
    config?: GraphNode
  ): {
    crafter: Item | null
    machine: Machine
    hasModel: boolean
    multiblock: boolean
    compatible: boolean
  } {
    const repository = this.requireRepository()
    let crafter = config?.machine?.id
      ? repository.GetById<Item>(config.machine.id)
      : null
    let multiblock = Boolean(config?.machine?.multiblock)
    let compatible = Boolean(crafter)
    if (crafter) {
      const single = recipe.recipeType.singleblocks.some(
        (item) => item.id === crafter!.id
      )
      const multi = recipe.recipeType.multiblocks.some(
        (item) => item.id === crafter!.id
      )
      compatible =
        single ||
        multi ||
        recipe.recipeType.defaultCrafter?.id === crafter.id
      if (!compatible) {
        crafter = null
      } else {
        multiblock = multi || this.machineById.get(crafter.id)?.multiblock || false
      }
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
    if (!config?.machine && crafter) {
      multiblock = this.machineById.get(crafter.id)?.multiblock ?? false
    }
    return { crafter, machine, hasModel, multiblock, compatible }
  }

  private buildRecipeModel(
    recipe: Recipe,
    config: GraphNode | undefined,
    applyMachineRecipe: boolean
  ): ComputedInternal {
    const model = new RecipeModel(recipe)
    const selected = this.selectMachine(recipe, config)
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
    let invalid = false
    if (config?.machine && !selected.compatible) {
      invalid = true
      warnings.push('所选机器不能执行当前配方')
    }
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
      const parallelCapable =
        machineParallels > 1 || Boolean(machine.ignoreParallelLimit)
      const configParallels = config?.overrides.parallels
      if (
        parallelCapable &&
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
        invalid = true
        warnings.push(`机器电压低于配方原始等级 ${voltageTier[gtRecipe.voltageTier]?.name ?? ''}`)
      }
      const isSingleblock = !selected.multiblock
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
          displayName: config?.machine?.displayName ??
            machineDisplayName(
              selected.crafter?.name ?? recipe.recipeType.name
            ),
          multiblock: selected.multiblock,
          hasModel: selected.hasModel,
          fixedVoltageTier: machine.fixedVoltageTier === undefined
            ? undefined
            : model.voltageTier,
          coilAvailable:
            selected.multiblock &&
            Object.keys(machine.choices ?? {}).some(
              (key) => key === 'coilTier' || key === 'coils'
            ),
          parallelCapable:
            phaseDriven &&
            (machineParallels > 1 || Boolean(machine.ignoreParallelLimit)),
          choices: machine.choices
            ? Object.entries(machine.choices)
                .filter(
                  ([key]) =>
                    selected.multiblock ||
                    (key !== 'coilTier' && key !== 'coils')
                )
                .map(([key, choice]) => toMachineChoice(key, choice))
            : [],
          info: machine.info ? GetParameter(machine.info, model) : undefined
        }
      : null

    const node: ComputedNode = {
      nodeId: '',
      recipeId: recipe.id,
      valid: !invalid,
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
    config: GraphNode
  ): ComputedInternal {
    const result = this.buildRecipeModel(recipe, config, true)
    const node = result.publicNode
    node.nodeId = nodeId
    const durationMinutes = node.durationTicks / 1200
    const factors = this.computeFactor(recipe, config, node.durationTicks)

    let recipesPerMinute = 0
    let machineCount = config.machineCount
    if (!node.valid) {
      node.machineCount = 0
      node.recommendedMachineCount = 0
      node.utilization = 0
      node.euPerTick = 0
      for (const port of node.ports) port.ratePerMinute = 0
      return result
    }

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
      const effectiveChoices = Object.fromEntries(
        node.machineInfo.choices.map((choice) => [
          choice.key,
          config.choices[choice.key] ?? choice.min
        ])
      )
      this.validateHeat(
        recipe,
        { ...config, choices: effectiveChoices },
        node
      )
    }

    return result
  }

  private computeFactor(
    recipe: Recipe,
    config: GraphNode,
    durationTicks: number
  ): { overclockFactor: number; powerFactor: number } {
    const model = new RecipeModel(recipe)
    const selected = this.selectMachine(recipe, config)
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
      !selected.multiblock
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
    config: GraphNode,
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

  private findCycles(project: ProjectDocument): string[][] {
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
