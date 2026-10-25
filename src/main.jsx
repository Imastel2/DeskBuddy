import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './Styles/index.css'
import AccountShell from './Panels/AccountShell.jsx'
import TouchKeyboard from './TouchKeyboard.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AccountShell />
    <TouchKeyboard />
  </StrictMode>,
)