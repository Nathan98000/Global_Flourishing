import { afterEach, describe, expect, test } from 'vitest'
import { THEME_STORAGE_KEY, applyTheme, resolvedTheme, storedTheme, toggleTheme } from '../theme'

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
})

describe('theme', () => {
  test('defaults to the OS preference (auto) with nothing stored', () => {
    expect(storedTheme()).toBe('auto')
    // jsdom reports prefers-color-scheme: dark as false → light.
    expect(resolvedTheme()).toBe('light')
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  test('an explicit choice stamps the document and persists', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(storedTheme()).toBe('dark')
    expect(resolvedTheme()).toBe('dark')
  })

  test('toggle flips and survives a “reload” (fresh read of storage)', () => {
    expect(toggleTheme()).toBe('dark')
    expect(storedTheme()).toBe('dark')
    expect(toggleTheme()).toBe('light')
    expect(storedTheme()).toBe('light')
    // index.html re-applies this before paint; simulate it:
    delete document.documentElement.dataset.theme
    applyTheme(storedTheme())
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  test('junk in storage falls back to auto', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia')
    expect(storedTheme()).toBe('auto')
  })
})
