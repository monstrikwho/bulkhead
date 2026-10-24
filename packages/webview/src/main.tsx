import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { ConnectionFormApp } from './connectionForm/ConnectionFormApp'
import './styles.css'
import './connectionForm/form.css'

// One bundle serves every webview; the host says which app to render.
const app = document.body.dataset.app

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {app === 'connection-form' ? (
      <ConnectionFormApp />
    ) : (
      <App variant={app === 'table' ? 'table' : 'results'} />
    )}
  </StrictMode>,
)
