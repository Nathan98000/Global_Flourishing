// The theme button names its action, not the current state (F15):
// "Switch to dark" in light mode, "Switch to light" in dark. Icon-only
// (redesign §4) — the action name rides on aria-label and title.

import { useState } from 'react'
import { resolvedTheme, toggleTheme } from '../theme'
import styles from './ThemeToggle.module.css'

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(() => resolvedTheme())
  const action = theme === 'dark' ? 'Switch to light' : 'Switch to dark'
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-label={action}
      title={action}
      onClick={() => setTheme(toggleTheme())}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}
