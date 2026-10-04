/// <reference types="vite/client" />
import type { BrushworkApi } from '../../preload/index'

declare global {
  interface Window {
    brushwork?: BrushworkApi
  }
}
export {}
