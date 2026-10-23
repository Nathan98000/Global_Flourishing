// A page that moves under a resting mouse (Find a state's scroll) makes
// the browser report a pointer move at the same screen point: Plot's
// pointer would open the card of whatever row now lies under it, a
// second card beside the found one (H4). After such a move, Plot's
// pointer sees nothing until the pointer really moves.

let last: { x: number; y: number } | null = null

if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType === 'mouse') last = { x: event.clientX, y: event.clientY }
    },
    { capture: true, passive: true },
  )
}

const HELD = ['pointermove', 'pointerover', 'pointerenter'] as const

/** Hold Plot's pointer tips still until the mouse leaves the point it
 * rests on; nothing to hold when no mouse has moved (touch, keyboard). */
export function holdPointerTips(): void {
  const at = last
  if (at === null || typeof window === 'undefined') return
  const hold = (event: Event) => {
    const { clientX, clientY } = event as PointerEvent
    if (clientX === at.x && clientY === at.y) {
      event.stopImmediatePropagation()
      return
    }
    for (const type of HELD) window.removeEventListener(type, hold, true)
  }
  for (const type of HELD) window.addEventListener(type, hold, true)
}
