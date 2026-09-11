import type { DoclocalApi } from './index'

declare global {
  interface Window {
    doclocal: DoclocalApi
  }
}
