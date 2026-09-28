// One question picker, built for the Correlates page (ADR-0019; the
// Atlas and US States may adopt it later). Closed, it is a button naming
// the chosen question by its short label, its role in the accessible
// name ("First question: Life evaluation today"). Open, it is a panel — a
// popover about 660px wide on a desktop, a full-screen sheet under 600px
// — that reaches any question three ways: search (the page search's own
// matcher over name, label and wording; results grouped by topic, the
// match marked), the questions used most recently in this tab
// (sessionStorage, five at most), and browse (topics on the left with how
// many of their questions were asked at the wave, the chosen topic's
// subtopics nested under it; its questions on the right, each a short
// label over one line of wording). A question that can't be chosen stays
// in view, disabled, with the reason in words. Listbox and option
// semantics: arrows move, Enter picks, Escape closes, and Tab walks
// search → recently used → topics → questions (→ the footer's buttons).
// A single-select panel closes on a pick; a multi-select one (Compare
// several) ticks questions within the table's room and adds them at once.

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import type { VariableSummary, Wave } from '../../api/types'
import { shortName } from '../../labels'
import { subtopicsOf, topicFamily, topicsOf } from '../../topics'
import { searchMeasures } from './OutcomePicker'
import styles from './QuestionPicker.module.css'

/** How many recently used questions the panel keeps and lists. */
export const RECENT_MAX = 5
const RECENT_KEY = 'flourish-atlas:recent-questions'

/** The questions used most recently in this tab, newest first; empty
 * when storage is refused (a private window, blocked site data). */
export function readRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((name): name is string => typeof name === 'string').slice(0, RECENT_MAX)
      : []
  } catch {
    return []
  }
}

/** Put `names` at the front of the recently used list; returns the list. */
export function rememberRecent(names: readonly string[]): string[] {
  const next = [...names, ...readRecent().filter((name) => !names.includes(name))].slice(
    0,
    RECENT_MAX,
  )
  try {
    window.sessionStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Storage refused: the list simply isn't kept.
  }
  return next
}

/** A question's line under its label: its wording, else the catalog's
 * description (a derived score has no wording). */
function wordingOf(variable: VariableSummary): string {
  return variable.wording ?? variable.label ?? ''
}

/** `text` with the first match of `needle` marked. */
function marked(text: string, needle: string): ReactNode {
  const at = needle ? text.toLowerCase().indexOf(needle) : -1
  if (at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <mark className={styles.mark}>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  )
}

/** The wording line is one line: when the match sits far into it, start
 * a few words before the match so the mark is in view. */
export function wordingSnippet(text: string, needle: string): string {
  const at = needle ? text.toLowerCase().indexOf(needle) : -1
  if (at <= 40) return text
  const start = text.lastIndexOf(' ', at - 20)
  return `…${text.slice(start + 1)}`
}

/** One shelf of the browse column: a topic, or one of its subtopics. */
interface Shelf {
  key: string
  name: string
  depth: 0 | 1
  /** The topic this shelf belongs to (itself, for a topic). */
  family: string
  /** Its questions, in sections (a topic with subtopics: one per subtopic). */
  sections: Section[]
}

interface Section {
  title?: string
  items: VariableSummary[]
}

/** The browse column: every topic, and each topic's subtopics. */
function shelvesOf(variables: readonly VariableSummary[]): Shelf[] {
  return topicsOf([...variables]).flatMap((topic) => {
    const subtopics = subtopicsOf(topic.measures)
    const own: Shelf = {
      key: topic.family,
      name: topic.name,
      depth: 0,
      family: topic.family,
      sections:
        subtopics.length > 0
          ? subtopics.map((sub) => ({ title: sub.name, items: sub.measures }))
          : [{ items: topic.measures }],
    }
    return [
      own,
      ...subtopics.map((sub): Shelf => ({
        key: `${topic.family}:${sub.code}`,
        name: sub.name,
        depth: 1,
        family: topic.family,
        sections: [{ items: sub.measures }],
      })),
    ]
  })
}

/** The shelf a panel opens on: the question's own subtopic (or topic). */
function homeShelf(shelves: readonly Shelf[], variable: VariableSummary | undefined): string {
  if (variable) {
    const family = topicFamily(variable)
    const sub = shelves.find((shelf) => shelf.key === `${family}:${variable.subfamily ?? ''}`)
    if (sub) return sub.key
    if (shelves.some((shelf) => shelf.key === family)) return family
  }
  return shelves[0]?.key ?? ''
}

interface Common {
  /** The picker's role, in words: the start of the button's accessible
   * name and the panel's title ("First question"). */
  label: string
  /** The whole catalog; the picker lists its servable questions. */
  variables: readonly VariableSummary[]
  /** Topic counts are of the questions asked at this wave. */
  wave: Wave
  /** Why a question can't be chosen here, in words (undefined: it can). */
  unavailable?: (variable: VariableSummary) => string | undefined
}

interface SingleProps extends Common {
  multiple?: false
  value: string | undefined
  onPick: (name: string) => void
}

interface MultipleProps extends Common {
  multiple: true
  /** What the button says ("Add questions"). */
  trigger: string
  /** The questions already in the table: shown ticked, and disabled. */
  selected: readonly string[]
  /** How many the table may hold in all. */
  max: number
  /** The table is full: the button can't open. */
  disabled?: boolean
  onAdd: (names: string[]) => void
}

export type QuestionPickerProps = SingleProps | MultipleProps

export function QuestionPicker(props: QuestionPickerProps) {
  const { label, variables, wave, unavailable } = props
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement | null>(null)
  const button = useRef<HTMLButtonElement | null>(null)
  const current = props.multiple ? undefined : variables.find((v) => v.name === props.value)
  const close = () => {
    setOpen(false)
    button.current?.focus()
  }

  // A press anywhere outside the picker closes it (focus left alone).
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && anchor.current?.contains(event.target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const name = current
    ? shortName(current)
    : props.multiple
      ? props.trigger
      : (props.value ?? 'Choose a question')
  return (
    <span className={styles.anchor} ref={anchor}>
      <button
        ref={button}
        type="button"
        className={props.multiple ? styles.addTrigger : styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={props.multiple ? props.disabled : undefined}
        aria-label={props.multiple ? props.trigger : `${label}: ${name}`}
        onClick={() => setOpen((was) => !was)}
      >
        {props.multiple ? (
          <>
            <span aria-hidden="true">+</span> {props.trigger}
          </>
        ) : (
          <>
            <span className={styles.triggerText}>{name}</span>
            <span className={styles.chevron} aria-hidden="true">
              ▾
            </span>
          </>
        )}
      </button>
      {open && (
        <Panel
          {...props}
          label={label}
          variables={variables}
          wave={wave}
          unavailable={unavailable}
          current={current}
          onClose={close}
          anchor={anchor}
        />
      )}
    </span>
  )
}

function Panel(
  props: QuestionPickerProps & {
    current: VariableSummary | undefined
    onClose: () => void
    anchor: React.RefObject<HTMLSpanElement | null>
  },
) {
  const { label, variables, wave, unavailable, current, onClose, anchor } = props
  const multiple = props.multiple === true
  const selected = props.multiple ? props.selected : []
  const id = useId()
  const panel = useRef<HTMLDivElement | null>(null)
  const search = useRef<HTMLInputElement | null>(null)
  const topicsBox = useRef<HTMLUListElement | null>(null)
  const listBox = useRef<HTMLDivElement | null>(null)
  const recentBox = useRef<HTMLUListElement | null>(null)
  const [query, setQuery] = useState('')
  const [ticked, setTicked] = useState<string[]>([])
  const [recent] = useState(readRecent)
  const shelves = useMemo(() => shelvesOf(variables), [variables])
  const byName = useMemo(() => new Map(variables.map((v) => [v.name, v])), [variables])
  const lastSelected = props.multiple
    ? byName.get(props.selected[props.selected.length - 1] ?? '')
    : undefined
  const [shelf, setShelf] = useState(() => homeShelf(shelves, current ?? lastSelected))
  const [cursor, setCursor] = useState<string | undefined>(current?.name)
  const [recentCursor, setRecentCursor] = useState(0)
  const [shift, setShift] = useState(0)
  const needle = query.trim().toLowerCase()
  const room = props.multiple ? props.max - props.selected.length - ticked.length : 0

  /** Why an option is disabled, in words ('' = disabled, reason in the footer). */
  const reasonOf = (variable: VariableSummary): string | undefined => {
    if (multiple && selected.includes(variable.name)) return 'In the table'
    const reason = unavailable?.(variable)
    if (reason) return reason
    if (multiple && room <= 0 && !ticked.includes(variable.name)) return ''
    return undefined
  }

  const activeShelf = shelves.find((entry) => entry.key === shelf) ?? shelves[0]
  // Only the open topic's subtopics are listed, nested under it.
  const visibleShelves = shelves.filter(
    (entry) => entry.depth === 0 || entry.family === activeShelf?.family,
  )
  const sections: Section[] = useMemo(() => {
    if (!needle) return activeShelf?.sections ?? []
    const matches = new Set(searchMeasures([...variables], needle).map((v) => v.name))
    return topicsOf([...variables])
      .map((topic) => ({
        title: topic.name,
        items: topic.measures.filter((v) => matches.has(v.name)),
      }))
      .filter((section) => section.items.length > 0)
  }, [needle, activeShelf, variables])
  const flat = useMemo(() => sections.flatMap((section) => section.items), [sections])
  const activeName =
    cursor !== undefined && flat.some((v) => v.name === cursor) ? cursor : undefined
  const optionId = (name: string) => `${id}-q-${name}`

  // Open: the search takes focus; the panel stays inside the page column
  // (a sheet under 600px needs no shift — CSS pins it to the viewport).
  useEffect(() => {
    search.current?.focus()
  }, [])
  useLayoutEffect(() => {
    const place = () => {
      const host = anchor.current
      const box = panel.current
      if (!host || !box) return
      const left = host.getBoundingClientRect().left
      const width = box.getBoundingClientRect().width
      const room = document.documentElement.clientWidth || window.innerWidth
      setShift(Math.max(16 - left, Math.min(0, room - 16 - width - left)))
    }
    place()
    // Measured again once the page has settled (a first measure can run
    // before its fonts and layout do), and whenever the window resizes.
    const frame = window.requestAnimationFrame(place)
    window.addEventListener('resize', place)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', place)
    }
  }, [anchor])
  // The open topic is in view — in the phone's sideways row too.
  const shelfKey = activeShelf?.key
  useEffect(() => {
    if (shelfKey === undefined || needle) return
    document
      .getElementById(`${id}-t-${shelfKey}`)
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [id, shelfKey, needle])
  // The active option stays in view as the arrows move it.
  useEffect(() => {
    if (activeName === undefined) return
    document.getElementById(optionId(activeName))?.scrollIntoView?.({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeName])

  const choose = (variable: VariableSummary) => {
    const reason = reasonOf(variable)
    if (reason !== undefined) return
    if (props.multiple) {
      setTicked((was) =>
        was.includes(variable.name)
          ? was.filter((name) => name !== variable.name)
          : [...was, variable.name],
      )
      return
    }
    rememberRecent([variable.name])
    props.onPick(variable.name)
    onClose()
  }
  const addTicked = () => {
    if (!props.multiple || ticked.length === 0) return
    rememberRecent([...ticked].reverse())
    props.onAdd(ticked)
    onClose()
  }

  const moveCursor = (to: number) => {
    const target = flat[Math.max(0, Math.min(flat.length - 1, to))]
    if (target) setCursor(target.name)
  }
  const onListKey = (event: KeyboardEvent<HTMLElement>) => {
    const at = activeName === undefined ? -1 : flat.findIndex((v) => v.name === activeName)
    if (event.key === 'ArrowDown') moveCursor(at + 1)
    else if (event.key === 'ArrowUp') moveCursor(at - 1)
    else if (event.key === 'Home') moveCursor(0)
    else if (event.key === 'End') moveCursor(flat.length - 1)
    else if (event.key === 'Enter' || event.key === ' ') {
      const target = flat[at]
      if (target) choose(target)
    } else if (event.key === 'ArrowLeft' && !needle) topicsBox.current?.focus()
    else return
    event.preventDefault()
  }
  const onTopicsKey = (event: KeyboardEvent<HTMLElement>) => {
    const keys = visibleShelves.map((entry) => entry.key)
    const at = keys.indexOf(activeShelf?.key ?? '')
    const go = (index: number) => {
      const key = keys[Math.max(0, Math.min(keys.length - 1, index))]
      if (key) {
        setShelf(key)
        setCursor(undefined)
      }
    }
    if (event.key === 'ArrowDown') go(at + 1)
    else if (event.key === 'ArrowUp') go(at - 1)
    else if (event.key === 'Home') go(0)
    else if (event.key === 'End') go(keys.length - 1)
    else if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
      listBox.current?.focus()
    } else return
    event.preventDefault()
  }
  const recentItems = recent
    .map((name) => byName.get(name))
    .filter((v): v is VariableSummary => v !== undefined && v.servable)
  const onRecentKey = (event: KeyboardEvent<HTMLElement>) => {
    const last = recentItems.length - 1
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      setRecentCursor((at) => Math.min(last, at + 1))
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      setRecentCursor((at) => Math.max(0, at - 1))
    else if (event.key === 'Enter' || event.key === ' ') {
      const target = recentItems[recentCursor]
      if (target) choose(target)
    } else return
    event.preventDefault()
  }
  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveCursor(0)
      listBox.current?.focus()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const first = flat.find((v) => reasonOf(v) === undefined)
      if (first && needle) choose(first)
    }
  }
  // Escape closes; Tab stays inside the panel (it is a modal choice).
  const onPanelKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !panel.current) return
    const stops = [
      ...panel.current.querySelectorAll<HTMLElement>(
        'input, button:not([disabled]), [tabindex="0"]',
      ),
    ]
    const first = stops[0]
    const last = stops[stops.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  const listLabel = needle ? 'Search results' : `${activeShelf?.name ?? ''} questions`
  const titleId = `${id}-title`
  return (
    // The keydown is the dialog's own Escape and Tab handling.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={panel}
      className={styles.panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{ '--panel-shift': `${shift}px` } as CSSProperties}
      onKeyDown={onPanelKey}
    >
      <div className={styles.head}>
        <span className={styles.title} id={titleId}>
          {label}
        </span>
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <input
        ref={search}
        className={styles.search}
        type="search"
        value={query}
        aria-label={`Search questions for the ${label.toLowerCase()}`}
        aria-controls={`${id}-list`}
        placeholder={`Search ${variables.filter((v) => v.servable).length} questions`}
        onChange={(event) => {
          setQuery(event.target.value)
          setCursor(undefined)
        }}
        onKeyDown={onSearchKey}
      />
      {!needle && recentItems.length > 0 && (
        <div className={styles.recent}>
          <span className={styles.recentLabel} id={`${id}-recent`}>
            Recently used
          </span>
          <ul
            ref={recentBox}
            className={styles.recentList}
            role="listbox"
            aria-labelledby={`${id}-recent`}
            aria-orientation="horizontal"
            aria-activedescendant={`${id}-r-${recentCursor}`}
            tabIndex={0}
            onKeyDown={onRecentKey}
          >
            {recentItems.map((variable, index) => {
              const reason = reasonOf(variable)
              return (
                // Options take the pointer; the keyboard goes through
                // the listbox (aria-activedescendant).
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                <li
                  key={variable.name}
                  id={`${id}-r-${index}`}
                  role="option"
                  aria-selected={isChosen(props, ticked, variable.name)}
                  aria-disabled={reason !== undefined || undefined}
                  aria-label={optionName(variable, reason)}
                  className={styles.recentChip}
                  data-active={index === recentCursor || undefined}
                  onClick={() => choose(variable)}
                >
                  {shortName(variable)}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <div className={styles.browse} data-searching={needle ? true : undefined}>
        {!needle && (
          <ul
            ref={topicsBox}
            className={styles.topics}
            role="listbox"
            aria-label="Topics"
            aria-activedescendant={activeShelf ? `${id}-t-${activeShelf.key}` : undefined}
            tabIndex={0}
            onKeyDown={onTopicsKey}
          >
            {visibleShelves.map((entry) => {
              const count = entry.sections
                .flatMap((section) => section.items)
                .filter((v) => v.waves_available.includes(wave)).length
              return (
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                <li
                  key={entry.key}
                  id={`${id}-t-${entry.key}`}
                  role="option"
                  aria-selected={entry.key === activeShelf?.key}
                  aria-label={`${entry.name}, ${count}`}
                  className={styles.topic}
                  data-depth={entry.depth}
                  onClick={() => {
                    setShelf(entry.key)
                    setCursor(undefined)
                  }}
                >
                  <span>{entry.name}</span>
                  <span className={styles.count}>{count}</span>
                </li>
              )
            })}
          </ul>
        )}
        <div
          ref={listBox}
          id={`${id}-list`}
          className={styles.list}
          role="listbox"
          aria-label={listLabel}
          aria-multiselectable={multiple || undefined}
          aria-activedescendant={activeName !== undefined ? optionId(activeName) : undefined}
          tabIndex={0}
          onKeyDown={onListKey}
          onFocus={() => {
            if (activeName === undefined) moveCursor(0)
          }}
        >
          {needle && (
            <p role="status" className="visually-hidden">
              {flat.length === 1 ? '1 question matches' : `${flat.length} questions match`}
            </p>
          )}
          {needle && flat.length === 0 && <p className={styles.none}>No question matches</p>}
          {sections.map((section, index) => (
            <div
              key={section.title ?? index}
              role="group"
              aria-label={section.title}
              className={styles.section}
            >
              {section.title && (
                <p className={styles.sectionTitle} aria-hidden="true">
                  {section.title}
                </p>
              )}
              {section.items.map((variable) => {
                const reason = reasonOf(variable)
                const chosen = isChosen(props, ticked, variable.name)
                return (
                  // The listbox holds focus and names its active option
                  // (aria-activedescendant); options take the pointer.
                  // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
                  <div
                    key={variable.name}
                    id={optionId(variable.name)}
                    role="option"
                    aria-selected={chosen}
                    aria-disabled={reason !== undefined || undefined}
                    aria-label={optionName(variable, reason)}
                    aria-describedby={`${optionId(variable.name)}-w`}
                    className={styles.option}
                    data-active={variable.name === activeName || undefined}
                    onClick={() => {
                      setCursor(variable.name)
                      choose(variable)
                    }}
                  >
                    {multiple && (
                      <span
                        className={styles.check}
                        data-checked={chosen || undefined}
                        aria-hidden="true"
                      />
                    )}
                    <span className={styles.optionText}>
                      <span className={styles.optionName}>
                        {marked(shortName(variable), needle)}
                      </span>
                      <span className={styles.optionWording} id={`${optionId(variable.name)}-w`}>
                        {marked(wordingSnippet(wordingOf(variable), needle), needle)}
                      </span>
                    </span>
                    {reason ? <span className={styles.reason}>{reason}</span> : null}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      {props.multiple && (
        <div className={styles.footer}>
          <span role="status">
            {ticked.length} selected · room for {Math.max(0, room)} more
          </span>
          <span className={styles.footerActions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.add}
              disabled={ticked.length === 0}
              onClick={addTicked}
            >
              Add {ticked.length} to the table
            </button>
          </span>
        </div>
      )}
    </div>
  )
}

/** An option's accessible name: its short label and, when it can't be
 * chosen, why (its wording is its description). Plain text, so a marked
 * match never splits the name. */
function optionName(variable: VariableSummary, reason: string | undefined): string {
  return reason ? `${shortName(variable)}, ${reason}` : shortName(variable)
}

/** Whether an option reads as chosen: the current question (single), or
 * one already in the table or ticked (multiple). */
function isChosen(props: QuestionPickerProps, ticked: readonly string[], name: string): boolean {
  if (props.multiple) return props.selected.includes(name) || ticked.includes(name)
  return props.value === name
}
