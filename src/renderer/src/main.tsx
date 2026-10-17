import '@fontsource/cormorant-garamond/400.css'
import '@fontsource/cormorant-garamond/500.css'
import '@fontsource/cormorant-garamond/600.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import './styles.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { installTestHook } from './testhook'

if (new URLSearchParams(location.search).has('test')) installTestHook()

createRoot(document.getElementById('root')!).render(<App />)
