// A phone page's chart actions in its Options sheet (G3): on a phone the
// chart's "How to read this chart" and its downloads leave the chart's
// header — a row of their own above the chart — for the page's Options
// sheet, so the chart starts higher. The shell provides one slot per
// page; a page's Options sheet takes its place in it, and the page's
// first ChartFigure hands it its actions. A figure on a page without a
// sheet (or not the page's first) keeps its links in its header.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import type { CsvExport } from './ChartFigure'

/** What a chart can do from the sheet: its CSV and its PNG. Read at the
 * moment the sheet draws them, so they are never stale. */
export interface ChartActions {
  csv?: CsvExport
  /** Absent for a chart drawn in HTML, not SVG (a grid): it can't be
   * saved as a picture (H13). */
  png?: () => void
}

interface Slot {
  /** Figures in mount order; the first is the page's chart. */
  figures: { id: string; actions: MutableRefObject<ChartActions> }[]
  /** Options sheets on the page. */
  sheets: number
  addFigure: (id: string, actions: MutableRefObject<ChartActions>) => () => void
  addSheet: () => () => void
}

const SlotContext = createContext<Slot | null>(null)

export function ChartActionsProvider({ children }: { children: ReactNode }) {
  const [figures, setFigures] = useState<Slot['figures']>([])
  const [sheets, setSheets] = useState(0)
  // Stable, so a figure or a sheet registers once, not on every change.
  const addFigure = useCallback<Slot['addFigure']>((id, actions) => {
    setFigures((current) => [...current, { id, actions }])
    return () => setFigures((current) => current.filter((figure) => figure.id !== id))
  }, [])
  const addSheet = useCallback<Slot['addSheet']>(() => {
    setSheets((count) => count + 1)
    return () => setSheets((count) => count - 1)
  }, [])
  const slot = useMemo<Slot>(
    () => ({ figures, sheets, addFigure, addSheet }),
    [figures, sheets, addFigure, addSheet],
  )
  return <SlotContext.Provider value={slot}>{children}</SlotContext.Provider>
}

/** For a ChartFigure: whether its links belong to the page's sheet (it is
 * the page's first figure and the page has a sheet); its actions are
 * registered either way. */
export function useChartActionsInSheet(actions: MutableRefObject<ChartActions>): boolean {
  const slot = useContext(SlotContext)
  const id = useId()
  const addFigure = slot?.addFigure
  useEffect(() => addFigure?.(id, actions), [addFigure, id, actions])
  if (!slot || slot.sheets === 0) return false
  return slot.figures[0]?.id === id
}

/** For an Options sheet: it is on the page, and the page's first chart's
 * actions, read when they are used — null while there is none. */
export function useSheetChartActions(): MutableRefObject<ChartActions> | null {
  const slot = useContext(SlotContext)
  const addSheet = slot?.addSheet
  useEffect(() => addSheet?.(), [addSheet])
  return slot?.figures[0]?.actions ?? null
}
