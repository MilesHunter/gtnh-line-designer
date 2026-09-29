import type {
  ProjectDocumentV1,
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

  solve(project: ProjectDocumentV1, revision: number): Promise<SolveResult> {
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
