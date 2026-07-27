/**
 * Application root: mounts the scene and the UI, and handles session lifecycle.
 *
 * On first mount it restores the autosave if there is one; otherwise it opens
 * one of the sample villages, because an empty island is a poor first
 * impression. Either way the player lands in something already alive.
 */

import { useEffect, useRef } from 'react'
import { Scene } from '@/render/Scene'
import { Palette, useBuilderHotkeys } from '@/ui/Palette'
import { Toolbar } from '@/ui/Toolbar'
import { Notices } from '@/ui/Notices'
import { HelpCard } from '@/ui/HelpCard'
import { StatusBar } from '@/ui/StatusBar'
import { flushAutosave, useBuilder } from '@/state/store'
import { loadFromLocalStorage } from '@/world/serialize'
import { EXAMPLE_VILLAGES } from '@/world/examples'

export function App(): React.ReactElement {
  useBuilderHotkeys()
  useSessionRestore()
  usePersistOnExit()

  return (
    <div className="app">
      <Scene />
      <Toolbar />
      <Palette />
      <StatusBar />
      <Notices />
      <HelpCard />
    </div>
  )
}

/** Restore the autosave, or open a sample village on a first visit. */
function useSessionRestore(): void {
  const loadWorld = useBuilder((s) => s.loadWorld)
  const restored = useRef(false)

  useEffect(() => {
    // React 19 StrictMode double-invokes effects in development; without this
    // guard the restore would run twice and leave a redundant undo entry.
    if (restored.current) return
    restored.current = true

    const saved = loadFromLocalStorage()
    if (saved) {
      loadWorld(saved.world, saved.warnings)
      return
    }
    loadWorld(EXAMPLE_VILLAGES[0].build())
  }, [loadWorld])
}

/**
 * Flush the pending autosave when the tab is hidden or closed.
 *
 * Autosave is debounced, so a player who closes the tab immediately after a
 * change would otherwise lose it. `visibilitychange` is the reliable signal —
 * `beforeunload` is not fired consistently on mobile.
 */
function usePersistOnExit(): void {
  useEffect(() => {
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') flushAutosave()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flushAutosave)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flushAutosave)
    }
  }, [])
}
