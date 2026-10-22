// A disclosure button (the WAI pattern): a real button with
// aria-expanded that shows a panel under it, closed by default. The
// panel hangs over the page rather than pushing the controls row apart;
// it closes on Escape from anywhere (focus back to the button), when
// focus leaves it and on a pointer press outside it (usePopupDismiss,
// H12), and anchors to the button's right edge
// when a left-anchored panel would overflow the page column — the
// country filter's rules, for settings that most readers never change.
// The `info` variant is a small text button with an "i" — a note a reader
// opens to learn what a control's options mean (Correlates' "What's the
// difference?") — whose panel is wider, a reading measure of about 26rem
// on a desktop and the column's full width on a phone.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import styles from './Disclosure.module.css'
import { usePopupDismiss } from './usePopupDismiss'

export function Disclosure({
  label,
  variant = 'button',
  children,
}: {
  label: string
  variant?: 'button' | 'info'
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [anchorRight, setAnchorRight] = useState(false)
  const panelId = useId()
  const root = useRef<HTMLDivElement | null>(null)
  const button = useRef<HTMLButtonElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)

  const close = useCallback(() => setOpen(false), [])
  usePopupDismiss(open, root, button, close)

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
    <div ref={root} className={styles.disclosure}>
      <button
        ref={button}
        type="button"
        className={variant === 'info' ? styles.info : styles.button}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        {variant === 'info' && (
          <span className={styles.infoIcon} aria-hidden="true">
            i
          </span>
        )}
        {label}
      </button>
      <div
        ref={panel}
        id={panelId}
        className={styles.panel}
        hidden={!open}
        data-anchor={anchorRight ? 'right' : undefined}
        data-variant={variant}
      >
        {children}
      </div>
    </div>
  )
}
