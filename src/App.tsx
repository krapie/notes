import { createContext, useContext, useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import IndexPage from './pages/IndexPage'
import TcpPage from './pages/TcpPage'
import ClosPage from './pages/ClosPage'
import VpcPage from './pages/VpcPage'

type Theme = 'light' | 'dark'

const ThemeCtx = createContext<{ theme: Theme; toggle: () => void; embed: boolean }>({
  theme: 'light',
  toggle: () => {},
  embed: false,
})

export function useTheme() { return useContext(ThemeCtx) }

export default function App() {
  const embed = new URLSearchParams(window.location.search).get('embed') === '1'

  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('kp-theme')
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('kp-theme', theme)
  }, [theme])

  function toggle() { setTheme(t => t === 'dark' ? 'light' : 'dark') }

  return (
    <ThemeCtx.Provider value={{ theme, toggle, embed }}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<IndexPage />} />
          <Route path="/tcp" element={<TcpPage />} />
          <Route path="/clos" element={<ClosPage />} />
          <Route path="/vpc" element={<VpcPage />} />
        </Routes>
      </BrowserRouter>
    </ThemeCtx.Provider>
  )
}
