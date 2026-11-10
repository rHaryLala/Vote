import { useSyncExternalStore } from 'react'

/** La 3D est un plus : on la coupe sur les appareils faibles, en mode « réduire les animations » ou sans WebGL. */
let cached: boolean | undefined

export function canRender3D(): boolean {
  if (cached !== undefined) return cached
  try {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const nav = navigator as Navigator & { deviceMemory?: number }
    const weak = (nav.deviceMemory !== undefined && nav.deviceMemory <= 2) || navigator.hardwareConcurrency <= 2
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    cached = !reduce && !weak && !!gl
  } catch {
    cached = false
  }
  return cached
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb)
      window.addEventListener('offline', cb)
      return () => {
        window.removeEventListener('online', cb)
        window.removeEventListener('offline', cb)
      }
    },
    () => navigator.onLine,
    () => true,
  )
}
