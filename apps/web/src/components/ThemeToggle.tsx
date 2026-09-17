// The theme button names its action, not the current state (F15):
// "Switch to dark" in light mode, "Switch to light" in dark.

import { useState } from 'react'
import { resolvedTheme, toggleTheme } from '../theme'
import styles from './ThemeToggle.module.css'

export function ThemeToggle() {
  const [theme, setTheme] = useState(() => resolvedTheme())
  return (
    <button type="button" className={styles.toggle} onClick={() => setTheme(toggleTheme())}>
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span> {''}
      {theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
    </button>
  )
}
