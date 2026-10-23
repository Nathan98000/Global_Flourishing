// How a pop-up closes (H12) — the Countries panel, "What's the
// difference?" and Download ▾ alike: Escape from anywhere while it is
// open closes it and returns focus to its button; focus moving outside it
// (Tab past its last control) closes it where focus went; so does a press
// outside it, focus left alone.

import { useEffect, type RefObject } from 'react'

export function usePopupDismiss(
  open: boolean,
  root: RefObject<HTMLElement | null>,
  button: RefObject<HTMLElement | null>,
  close: () => void,
): void {
  useEffect(() => {
    if (!open) return
    const outside = (target: EventTarget | null) =>
      !(target instanceof Node && root.current?.contains(target))
    const onPointerDown = (event: PointerEvent) => {
      if (outside(event.target)) close()
    }
    const onFocusIn = (event: FocusEvent) => {
      if (outside(event.target)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      close()
      button.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, root, button, close])
}
