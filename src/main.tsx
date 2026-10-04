import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { startMotion } from '@/shared/layout/motion'
import './index.css'

startMotion()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
