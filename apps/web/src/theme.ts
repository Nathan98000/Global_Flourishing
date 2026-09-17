// Theme = the visitor's explicit choice, or the OS preference when they
// have none. The choice is stamped on <html data-theme> (tokens.css keys
// off it) and persisted in localStorage — index.html re-applies it before
// first paint so a reload never flashes the wrong theme.

export type Theme = 'light' | 'dark'
export type ThemeChoice = Theme | 'auto'

export const THEME_STORAGE_KEY = 'flourish-theme'

export function storedTheme(): ThemeChoice {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    return raw === 'light' || raw === 'dark' ? raw : 'auto'
  } catch {
    return 'auto'
  }
}

export function resolvedTheme(): Theme {
  const choice = storedTheme()
  if (choice !== 'auto') return choice
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'auto') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, choice)
  } catch {
    // Private windows may refuse storage; the stamp below still applies
    // for this page view.
  }
  if (choice === 'auto') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = choice
}

export function toggleTheme(): Theme {
  const next: Theme = resolvedTheme() === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  return next
}
