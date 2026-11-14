import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'
import { ToastProvider } from './components/ui'
import { TextureProvider } from './mc/icons'

createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <TextureProvider>
      <App />
    </TextureProvider>
  </ToastProvider>
)
