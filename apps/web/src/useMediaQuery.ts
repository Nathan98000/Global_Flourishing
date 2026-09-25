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
/** Below this the nav's secondary items fold into "More" — the same
 * width at which the nav takes its own row, so no link ever wraps. */
export const NAV_FOLD_VIEWPORT = '(max-width: 50rem)'
/** Below this, long segmented groups become native selects (§8). */
export const SELECT_VIEWPORT = '(max-width: 30rem)'
