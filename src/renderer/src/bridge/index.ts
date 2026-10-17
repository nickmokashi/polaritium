import type { Bridge } from '@core/app/bridge'
import { createWebBridge } from './web'

declare global {
  interface Window {
    polaritium?: Bridge
  }
}

/** The desktop app provides window.polaritium through its preload; the browser preview does not. */
export const bridge: Bridge = window.polaritium ?? createWebBridge()
