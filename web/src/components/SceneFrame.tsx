import { Component, Suspense, lazy, type ReactNode } from 'react'
import { canRender3D } from '../lib/device'

export const HeroScene = lazy(() => import('../three/HeroScene'))
export const UrnScene = lazy(() => import('../three/UrnScene'))
export const ResultsScene = lazy(() => import('../three/ResultsScene'))

/** Repli sans 3D : le monogramme SA qui flotte. */
export function MarkFallback({ size = 'h-32 w-40' }: { size?: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <img src="/brand/sa-mark.svg" alt="" className={`floaty ${size} object-contain`} />
    </div>
  )
}

class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/**
 * Affiche une scène 3D décorative (donc masquée aux lecteurs d'écran). Chargée à la demande ; si l'appareil
 * est faible, sans WebGL, ou en mode « réduire les animations », le repli 2D prend sa place.
 */
export function SceneFrame({
  children,
  fallback = <MarkFallback />,
  className = '',
}: {
  children: ReactNode
  fallback?: ReactNode
  className?: string
}) {
  return (
    <div className={className} aria-hidden="true">
      {canRender3D() ? (
        <SceneBoundary fallback={fallback}>
          <Suspense fallback={fallback}>{children}</Suspense>
        </SceneBoundary>
      ) : (
        fallback
      )}
    </div>
  )
}
