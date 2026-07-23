import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import TopAtRisk from './TopAtRisk.jsx'

// No router dependency for what's currently a single standalone page —
// /top-at-risk is a shareable artifact meant to be linked directly
// (screenshotted, printed, emailed), not navigated to from within the app shell.
const Root = window.location.pathname === '/top-at-risk' ? TopAtRisk : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
