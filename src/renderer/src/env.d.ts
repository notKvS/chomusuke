import type { ChomusukeApi } from '../../shared/types'

declare global {
  interface Window {
    chomusuke: ChomusukeApi
  }
}
