// Compare several's set builder (ADR-0019): "Questions in the table · n of
// 10", then one chip per question — a drag handle, its short name, a × —
// wrapping as it needs, and a last chip, "+ Add questions", that opens the
// question picker in its multi-select mode. Chips reorder by dragging or,
// from a handle, with Alt and an arrow key; a status line says where a
// question went. Two questions at least, ten at most; no presets.

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { VariableSummary, Wave } from '../../api/types'
import { QuestionPicker } from '../../components/controls/QuestionPicker'
import { TABLE_MAX, TABLE_MIN } from '../../state/search'
import own from './Correlates.module.css'

/** `names` with the one at `from` moved to `to`. */
export function moveTo(names: readonly string[], from: number, to: number): string[] {
  const next = [...names]
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return next
  next.splice(Math.max(0, Math.min(next.length, to)), 0, moved)
  return next
}

export function QuestionSet({
  names,
  nameOf,
  variables,
  wave,
  unavailable,
  countable,
  tagOf,
  onChange,
  note,
}: {
  /** The table's questions, in the order added. */
  names: readonly string[]
  /** A question's short name. */
  nameOf: (name: string) => string
  variables: readonly VariableSummary[]
  wave: Wave
  unavailable: (variable: VariableSummary) => string | undefined
  /** The picker's topic counts and tags (ADR-0020). */
  countable?: (variable: VariableSummary) => boolean
  tagOf?: (variable: VariableSummary) => string | undefined
  onChange: (names: string[]) => void
  /** A line under the chips (what the wave left out). */
  note?: ReactNode
}) {
  const labelId = useId()
  const hintId = useId()
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const handles = useRef(new Map<string, HTMLButtonElement>())
  const [refocus, setRefocus] = useState<string | null>(null)

  // A chip moved by the keyboard keeps the focus on its handle.
  useEffect(() => {
    if (refocus === null) return
    handles.current.get(refocus)?.focus()
    setRefocus(null)
  }, [refocus, names])

  const move = (from: number, to: number) => {
    if (to < 0 || to >= names.length || from === to) return
    const name = names[from] as string
    onChange(moveTo(names, from, to))
    setAnnouncement(`${nameOf(name)} moved to position ${to + 1} of ${names.length}.`)
    return name
  }
  const onHandleKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!event.altKey) return
    const step =
      event.key === 'ArrowUp' || event.key === 'ArrowLeft'
        ? -1
        : event.key === 'ArrowDown' || event.key === 'ArrowRight'
          ? 1
          : 0
    if (step === 0) return
    event.preventDefault()
    const moved = move(index, index + step)
    if (moved) setRefocus(moved)
  }

  return (
    <div className={own.set}>
      <span className={own.setLabel} id={labelId}>
        Questions in the table · {names.length} of {TABLE_MAX}
      </span>
      <ol className={own.chips} aria-labelledby={labelId}>
        {names.map((name, index) => (
          <li
            key={name}
            className={own.chip}
            draggable
            data-dragging={dragging === index || undefined}
            data-over={over === index && dragging !== index ? true : undefined}
            onDragStart={(event) => {
              setDragging(index)
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', name)
            }}
            onDragOver={(event) => {
              if (dragging === null) return
              event.preventDefault()
              setOver(index)
            }}
            onDragLeave={() => setOver((current) => (current === index ? null : current))}
            onDrop={(event) => {
              event.preventDefault()
              if (dragging !== null) move(dragging, index)
              setDragging(null)
              setOver(null)
            }}
            onDragEnd={() => {
              setDragging(null)
              setOver(null)
            }}
          >
            <button
              type="button"
              className={own.handle}
              aria-label={`Move ${nameOf(name)}`}
              aria-describedby={hintId}
              ref={(element) => {
                if (element) handles.current.set(name, element)
                else handles.current.delete(name)
              }}
              onKeyDown={(event) => onHandleKey(event, index)}
            >
              <span aria-hidden="true">⠿</span>
            </button>
            <span className={own.chipName}>{nameOf(name)}</span>
            <button
              type="button"
              className={own.remove}
              aria-label={`Remove ${nameOf(name)}`}
              disabled={names.length <= TABLE_MIN}
              onClick={() => onChange(names.filter((entry) => entry !== name))}
            >
              ×
            </button>
          </li>
        ))}
        <li className={own.addChip}>
          <QuestionPicker
            multiple
            label="Add questions"
            trigger="Add questions"
            variables={variables}
            wave={wave}
            selected={names}
            max={TABLE_MAX}
            disabled={names.length >= TABLE_MAX}
            unavailable={unavailable}
            countable={countable}
            tagOf={tagOf}
            onAdd={(added) => onChange([...names, ...added])}
          />
        </li>
      </ol>
      <span id={hintId} className="visually-hidden">
        Alt and an arrow key move it; you can also drag it.
      </span>
      <p role="status" className="visually-hidden">
        {announcement}
      </p>
      {note}
    </div>
  )
}
