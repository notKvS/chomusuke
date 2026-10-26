import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@fontsource/nunito/latin-500.css'
import '@fontsource/nunito/latin-700.css'
import '@fontsource/nunito/latin-800.css'
import '@fontsource/m-plus-rounded-1c/800.css'
import './styles.css'
import './anime.css'
import './theme.css'
import { applyTheme, loadAppearance, loadBackgroundImage } from './theme/dom'

// Apply the saved theme before the first paint so there's no flash of the default colours.
applyTheme(loadAppearance(), loadBackgroundImage())

const root = document.getElementById('root')
if (!root) throw new Error('index.html is missing #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
