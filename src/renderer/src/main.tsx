import '@fontsource/cormorant-garamond/400.css'
import '@fontsource/cormorant-garamond/500.css'
import '@fontsource/cormorant-garamond/600.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import './styles.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { bridge } from './bridge'
import { runBeforeClose } from './closing'
import { installTestHook } from './testhook'

if (new URLSearchParams(location.search).has('test')) installTestHook()
bridge.app.onClosing?.(runBeforeClose)

createRoot(document.getElementById('root')!).render(<App />)
