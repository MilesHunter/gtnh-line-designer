import type {
  ComputedNode,
  ExactRecipeSearchRequest,
  ExactRecipeSearchResponse,
  MachineSearchResponse,
  MachineSummary,
  GraphNode,
  ProjectDocument,
  ProjectValidationResult,
  RecipeDetail,
  RecipeSearchMode,
  RecipeSearchResponse,
  SolveResult,
  WorkerRequest,
  WorkerResponse
} from '../../../shared/types'

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

export class GtnhWorkerClient {
  private worker: Worker
  private nextId = 1
  private pending = new Map<number, Pending>()

  constructor() {
    this.worker = new Worker(
      new URL('../workers/gtnh.worker.ts', import.meta.url),
      { type: 'module' }
    )
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data
      const pending = this.pending.get(response.id)
      if (!pending) return
      this.pending.delete(response.id)
      if (response.type === 'error') {
        pending.reject(new Error(response.error))
      } else {
        pending.resolve(response.result)
      }
    }
    this.worker.onerror = (event) => {
      const error = new Error(event.message || '数据 Worker 发生错误')
      for (const pending of this.pending.values()) pending.reject(error)
      this.pending.clear()
    }
  }

  load(dataUrl: string): Promise<{
    dataVersion: number
    items: number
    fluids: number
    recipeTypes: number
    recipes: number
  }> {
    return this.request({ id: 0, type: 'load', dataUrl })
  }

  search(
    query: string,
    limit = 80,
    mode: RecipeSearchMode = 'product'
  ): Promise<RecipeSearchResponse> {
    return this.request({ id: 0, type: 'search', query, limit, mode })
  }

  getRecipe(recipeId: string): Promise<RecipeDetail | null> {
    return this.request({ id: 0, type: 'recipe', recipeId })
  }

  searchGoods(query: string, limit = 40): Promise<RecipeSearchResponse> {
    return this.request({ id: 0, type: 'goods-search', query, limit })
  }

  searchMachines(query: string, limit = 80): Promise<MachineSearchResponse> {
    return this.request({ id: 0, type: 'machine-search', query, limit })
  }

  searchExactRecipes(
    request: ExactRecipeSearchRequest
  ): Promise<ExactRecipeSearchResponse> {
    return this.request({ id: 0, type: 'exact-recipe-search', request })
  }

  getMachine(machineId: string): Promise<MachineSummary | null> {
    return this.request({ id: 0, type: 'machine', machineId })
  }

  preview(node: GraphNode): Promise<ComputedNode | null> {
    return this.request({ id: 0, type: 'preview', node })
  }

  validate(project: ProjectDocument): Promise<ProjectValidationResult> {
    return this.request({ id: 0, type: 'validate', project })
  }

  solve(project: ProjectDocument, revision: number): Promise<SolveResult> {
    return this.request({ id: 0, type: 'solve', project, revision })
  }

  dispose(): void {
    this.worker.terminate()
    this.pending.clear()
  }

  private request<T>(request: WorkerRequest): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject
      })
      this.worker.postMessage({ ...request, id })
    })
  }
}
