// A disclosure button (the WAI pattern): a real button with
// aria-expanded that shows a panel under it, closed by default. The
// panel hangs over the page rather than pushing the controls row apart;
// it closes on Escape (focus back to the button) and on a pointer press
// outside it (focus left alone), and anchors to the button's right edge
// when a left-anchored panel would overflow the page column — the
// country filter's rules, for settings that most readers never change.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import styles from './Disclosure.module.css'

export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [anchorRight, setAnchorRight] = useState(false)
  const panelId = useId()
  const root = useRef<HTMLDivElement | null>(null)
  const button = useRef<HTMLButtonElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Decided on each open: hang from the right edge when the panel,
  // opened at the end of the controls row, would leave the page column.
  useEffect(() => {
    const host = root.current
    const box = panel.current
    if (!open || !host || !box) return
    const column = host.closest('main')?.getBoundingClientRect().right ?? window.innerWidth
    setAnchorRight(host.getBoundingClientRect().left + box.offsetWidth > column + 1)
  }, [open])

  return (
    // The keydown is a bubbling Escape-to-close for the panel (focus
    // returns to the button) — not a fake interactive element.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={root}
      className={styles.disclosure}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          setOpen(false)
          button.current?.focus()
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className={styles.button}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        {label}
      </button>
      <div
        ref={panel}
        id={panelId}
        className={styles.panel}
        hidden={!open}
        data-anchor={anchorRight ? 'right' : undefined}
      >
        {children}
      </div>
    </div>
  )
}
