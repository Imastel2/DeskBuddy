import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AccountShell from './AccountShell.jsx'
import TouchKeyboard from './TouchKeyboard.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AccountShell />
    <TouchKeyboard />
  </StrictMode>,
)