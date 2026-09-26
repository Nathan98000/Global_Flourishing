// A labelled radio group rendered as a segmented row — native inputs,
// full keyboard support, no dead options (unavailable ones say why: a
// `note` line under the row, which every disabled option points to with
// aria-describedby).
// Under 40rem the row becomes an even grid so no option is orphaned on
// its own line; a group with long labels can opt into rendering as a
// native <select> under 30rem instead (§8). Above SELECT_ABOVE options
// (a long answer list — Current religion has 17) the group is a compact
// native <select> at every width, with the same label, values and URL
// param, so it never overflows the page or wraps into tall cells
// (ADR-0016).

import { useId, type CSSProperties } from 'react'
import { SELECT_VIEWPORT, useMediaQuery } from '../../useMediaQuery'
import styles from './RadioRow.module.css'

/** More options than this and the group renders as a native select. */
export const SELECT_ABOVE = 6

export interface RadioOption<T extends string> {
  value: T
  label: string
  disabled?: boolean
  title?: string
}

export function RadioRow<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  wide = false,
  selectOnNarrow = false,
  note,
}: {
  legend: string
  name: string
  options: readonly RadioOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Long rows (answer levels) span the full width of the phone grid. */
  wide?: boolean
  /** Labels too long for thirds of a phone: a native select under 30rem. */
  selectOnNarrow?: boolean
  /** One line under the row saying why the disabled options are
   * unavailable; each of them is described by it. */
  note?: string
}) {
  const narrow = useMediaQuery(SELECT_VIEWPORT)
  const noteId = useId()
  const describedBy = (option: RadioOption<T>) => (note && option.disabled ? noteId : undefined)
  const noteLine = note ? (
    <span id={noteId} className={styles.note}>
      {note}
    </span>
  ) : null
  const asSelect = options.length > SELECT_ABOVE || (narrow && selectOnNarrow)
  if (asSelect) {
    const select = (
      <label className={styles.fieldset}>
        <span className={styles.legend}>{legend}</span>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value as T)}
          aria-describedby={note ? noteId : undefined}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    )
    // The note stays out of the label, so it never joins the select's name.
    return note ? (
      <div className={styles.fieldset}>
        {select}
        {noteLine}
      </div>
    ) : (
      select
    )
  }
  return (
    <fieldset className={styles.fieldset} data-wide={wide || undefined}>
      <legend className={styles.legend}>{legend}</legend>
      <span
        className={styles.row}
        style={{ '--options': options.length } as CSSProperties}
        data-wide={wide || undefined}
      >
        {options.map((option) => (
          <label
            key={option.value}
            className={styles.option}
            data-checked={option.value === value || undefined}
            data-disabled={option.disabled || undefined}
            title={option.title}
          >
            <input
              className="visually-hidden"
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              disabled={option.disabled}
              aria-describedby={describedBy(option)}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </span>
      {noteLine}
    </fieldset>
  )
}
