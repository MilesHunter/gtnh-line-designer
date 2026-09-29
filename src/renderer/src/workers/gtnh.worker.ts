/// <reference lib="webworker" />

import { GtnhEngine } from '../core/engine'
import type { WorkerRequest, WorkerResponse } from '../../../shared/types'

const engine = new GtnhEngine()

function respond(message: WorkerResponse): void {
  self.postMessage(message)
}

self.onmessage = async (event: MessageEvent<WorkerRequest>): Promise<void> => {
  const request = event.data
  try {
    if (request.type === 'load') {
      const response = await fetch(request.dataUrl)
      if (!response.ok || !response.body) {
        throw new Error(`无法读取本地数据 ${response.status}`)
      }
      const stream = response.body.pipeThrough(new DecompressionStream('gzip'))
      const buffer = await new Response(stream).arrayBuffer()
      const result = engine.load(buffer)
      respond({ id: request.id, type: 'loaded', result })
      return
    }

    if (request.type === 'search') {
      respond({
        id: request.id,
        type: 'search',
        result: engine.search(request.query, request.limit, request.mode)
      })
      return
    }

    if (request.type === 'recipe') {
      respond({
        id: request.id,
        type: 'recipe',
        result: engine.getRecipe(request.recipeId)
      })
      return
    }

    if (request.type === 'solve') {
      respond({
        id: request.id,
        type: 'solve',
        result: engine.solve(request.project, request.revision)
      })
    }
  } catch (error) {
    respond({
      id: request.id,
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

export {}
