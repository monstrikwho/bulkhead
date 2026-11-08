import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { ConnectionFormApp } from './connectionForm/ConnectionFormApp'
import { ConsoleApp } from './orca/ConsoleApp'
import { OrcaApp } from './orca/OrcaApp'
import { TableApp } from './orca/TableApp'
import './styles.css'
import './connectionForm/form.css'
import './orca/orca.css'

// One bundle serves every webview; the host says which app to render.
const app = document.body.dataset.app

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {app === 'orca' ? (
      <OrcaApp />
    ) : app === 'orca-console' ? (
      <ConsoleApp />
    ) : app === 'orca-table' ? (
      <TableApp />
    ) : app === 'connection-form' ? (
      <ConnectionFormApp />
    ) : (
      <App variant={app === 'table' ? 'table' : 'results'} />
    )}
  </StrictMode>,
)
