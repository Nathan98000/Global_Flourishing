import { useState } from 'react'
import { resolvedTheme, toggleTheme } from '../theme'
import styles from './ThemeToggle.module.css'

export function ThemeToggle() {
  const [theme, setTheme] = useState(() => resolvedTheme())
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-pressed={theme === 'dark'}
      onClick={() => setTheme(toggleTheme())}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☾' : '☀'}</span> {''}
      {theme === 'dark' ? 'Dark' : 'Light'}
    </button>
  )
}
