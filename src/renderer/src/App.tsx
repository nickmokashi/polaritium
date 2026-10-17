import { useEffect } from 'react'
import { bridge } from './bridge'
import { useUI } from './state/store'
import { Game } from './ui/Game'
import { AtlasScreen, GalleryScreen } from './ui/Library'
import { ChambersScreen, MainMenu, NewExperiment } from './ui/Menus'
import { CompareScreen } from './ui/Compare'
import { SettingsScreen, applySettings } from './ui/Settings'
import { Toasts } from './ui/Hud'
import { audio } from './audio/engine'
import { runSelftest } from './selftest'

export function App() {
  const screen = useUI((s) => s.screen)
  const dialog = useUI((s) => s.dialog)
  useEffect(() => {
    void (async () => {
      const s = await bridge.settings.get()
      useUI.getState().set({ settings: s, atlas: await bridge.atlas.list() })
      applySettings(s)
      audio.onCaption = (t) => useUI.getState().caption(t)
      if (await bridge.app.isSelftest()) void runSelftest()
    })()
  }, [])
  useEffect(() => {
    if (dialog?.kind === 'settings') useUI.getState().set({ screen: 'settings' })
  }, [dialog])
  return (
    <>
      {screen === 'menu' && <MainMenu />}
      {screen === 'new' && <NewExperiment />}
      {screen === 'game' && <Game />}
      {screen === 'chambers' && <ChambersScreen />}
      {screen === 'gallery' && <GalleryScreen />}
      {screen === 'atlas' && <AtlasScreen />}
      {screen === 'settings' && <SettingsScreen initial={dialog?.kind === 'settings' && dialog.data === 'ai' ? 'ai' : undefined} />}
      {screen === 'compare' && <CompareScreen />}
      {screen !== 'game' && <Toasts />}
    </>
  )
}
