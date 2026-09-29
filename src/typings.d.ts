import type { AppApi } from './shared/types'

declare global {
  interface Window {
    gtnh: AppApi
  }
}

export {}
