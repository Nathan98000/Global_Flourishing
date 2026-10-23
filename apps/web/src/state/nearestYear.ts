// A link's year the question wasn't asked in (H14): the page opens the
// nearest year it was asked — never a request the server can only refuse
// — and says so with the link notice ("This link asked for something we
// can't show"). The years in time order, so "nearest" is by distance; a
// tie goes to the earlier.

import { useEffect, useState } from 'react'
import { WAVES, type Wave } from '../api/types'

/** The year nearest `wave` among those `asked`, or undefined. */
export function nearestAsked(asked: readonly string[], wave: Wave): Wave | undefined {
  const at = WAVES.indexOf(wave)
  return [...WAVES]
    .filter((candidate) => asked.includes(candidate))
    .sort((a, b) => Math.abs(WAVES.indexOf(a) - at) - Math.abs(WAVES.indexOf(b) - at))[0]
}

/** Moves a page off a year its question wasn't asked in (`move`, once the
 * question's years are known); whether it did — until another year is
 * chosen or the notice is dismissed — for the link notice. */
export function useNearestAskedYear(
  wave: Wave,
  asked: readonly string[] | undefined,
  move: (wave: Wave) => void,
): { moved: boolean; dismiss: () => void } {
  const [movedTo, setMovedTo] = useState<Wave | undefined>()
  const missing = asked !== undefined && asked.length > 0 && !asked.includes(wave)
  const nearest = missing ? nearestAsked(asked, wave) : undefined
  useEffect(() => {
    if (nearest === undefined) return
    setMovedTo(nearest)
    move(nearest)
    // Only a year the question lacks triggers this; `move` is the page's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearest])
  return { moved: movedTo !== undefined && movedTo === wave, dismiss: () => setMovedTo(undefined) }
}

/** The link notice's list, with the year a page moved off. */
export function withMovedYear(
  invalid: readonly string[] | undefined,
  moved: boolean,
): string[] | undefined {
  const keys = [...(invalid ?? []), ...(moved && !invalid?.includes('wave') ? ['wave'] : [])]
  return keys.length > 0 ? keys : undefined
}
