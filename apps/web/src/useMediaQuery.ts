// One hook for the two responsive behaviours CSS alone can't express
// (§8): folding display options into a <details> and swapping a long
// segmented group for a native <select>. jsdom's stub (and any browser
// without matchMedia) reports false — the desktop rendering.

import { useEffect, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const list = window.matchMedia(query)
    const update = () => setMatches(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])
  return matches
}

/** The fold breakpoint (§8): below this, display options collapse. */
export const NARROW_VIEWPORT = '(max-width: 40rem)'
/** Below this the nav takes its own row under the brand, where its
 * secondary items fold into "More" only if the seven don't fit that row
 * (measured — F8); and Methods folds its contents above the prose. */
export const NAV_FOLD_VIEWPORT = '(max-width: 50rem)'
/** Below this, long segmented groups become native selects (§8). */
export const SELECT_VIEWPORT = '(max-width: 30rem)'
