// A labelled radio group rendered as a segmented row — native inputs,
// full keyboard support, no dead options (unavailable ones say why).

import styles from './RadioRow.module.css'

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
}: {
  legend: string
  name: string
  options: readonly RadioOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Long rows (answer levels) span the full width of the phone grid. */
  wide?: boolean
}) {
  return (
    <fieldset className={styles.fieldset} data-wide={wide || undefined}>
      <legend className={styles.legend}>{legend}</legend>
      <span className={styles.row}>
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
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </span>
    </fieldset>
  )
}
