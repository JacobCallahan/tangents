import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ShareView } from './components/share/ShareView.tsx'

// Simple path-based routing — no React Router needed.
// /share/{token}  → public read-only share view  (no auth)
// Everything else → main authenticated app

const path = window.location.pathname;
const shareMatch = path.match(/^\/share\/([0-9a-f-]{36})$/i);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {shareMatch ? <ShareView token={shareMatch[1]} /> : <App />}
  </StrictMode>,
)

