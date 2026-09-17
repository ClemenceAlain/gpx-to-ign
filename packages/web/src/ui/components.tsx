import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * The grouped-list vocabulary, ported one for one from the Compose app's `ui/Components.kt`
 * so the two builds look like the same product. No component library: a rounded rectangle
 * with hairline separators is not worth a dependency that would fight it.
 */

export function SectionHeader({ children }: { children: ReactNode }): React.JSX.Element {
  return <h2 className="section-header">{children}</h2>
}

export function Section({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="section">{children}</div>
}

export function SectionFootnote({ children }: { children: ReactNode }): React.JSX.Element {
  return <p className="section-footnote">{children}</p>
}

/** Inset to the label's left edge, except under something full-bleed like the preview. */
export function RowSeparator({ inset = true }: { inset?: boolean }): React.JSX.Element {
  return <div className={inset ? 'separator' : 'separator full'} />
}

export interface RowProps {
  title: string
  subtitle?: string | null
  tone?: 'label' | 'accent' | 'danger' | 'success'
  value?: string
  onClick?: (() => void) | undefined
  children?: ReactNode
  testId?: string
}

export function SettingsRow({
  title,
  subtitle,
  tone = 'label',
  value,
  onClick,
  children,
  testId,
}: RowProps): React.JSX.Element {
  const toneClass = tone === 'label' ? '' : ` row-${tone}`
  const body = (
    <>
      <span className="row-label">
        <span className={`row-title${toneClass}`}>{title}</span>
        {subtitle != null && subtitle !== '' && <span className="row-subtitle">{subtitle}</span>}
      </span>
      {value !== undefined && <span className="row-value">{value}</span>}
      {children}
    </>
  )
  if (onClick === undefined) {
    return (
      <div className="row" data-testid={testId}>
        {body}
      </div>
    )
  }
  return (
    <button type="button" className="row" onClick={onClick} data-testid={testId}>
      {body}
    </button>
  )
}

export function SegmentedControl({
  options,
  selectedIndex,
  onSelect,
  label,
  testId,
}: {
  options: readonly string[]
  selectedIndex: number
  onSelect: (index: number) => void
  label: string
  testId?: string
}): React.JSX.Element {
  const track = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState({ width: 0, x: 0 })

  // The pill is positioned from the real button box, so options of different widths still
  // line up — which a flex-basis approximation gets wrong for "IGN SCAN25 (1:25000)".
  useLayoutEffect(() => {
    const node = track.current
    if (node === null) return
    const measure = (): void => {
      const buttons = node.querySelectorAll<HTMLButtonElement>('button')
      const active = buttons[Math.min(selectedIndex, buttons.length - 1)]
      if (active === undefined) return
      setPill({ width: active.offsetWidth, x: active.offsetLeft - 2 })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [selectedIndex, options])

  return (
    <div
      className="segmented"
      role="radiogroup"
      aria-label={label}
      ref={track}
      data-testid={testId}
    >
      <div
        className="segmented-pill"
        style={{ width: `${pill.width}px`, transform: `translateX(${pill.x}px)` }}
      />
      {options.map((option, index) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={index === selectedIndex}
          onClick={() => onSelect(index)}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

export function AppSlider({
  value,
  min,
  max,
  step,
  onChange,
  label,
  testId,
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  label: string
  testId?: string
}): React.JSX.Element {
  return (
    <input
      type="range"
      className="slider"
      aria-label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      data-testid={testId}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  )
}

export function AppSwitch({
  checked,
  onChange,
  label,
  testId,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  testId?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

export function Chevron({ expanded }: { expanded: boolean }): React.JSX.Element {
  return (
    <svg
      className={expanded ? 'chevron expanded' : 'chevron'}
      width="8"
      height="13"
      viewBox="0 0 8 13"
      aria-hidden="true"
    >
      <path
        d="M1.5 1.5 6.5 6.5 1.5 11.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function TextFieldRow({
  title,
  value,
  placeholder,
  onChange,
  testId,
}: {
  title: string
  value: string
  placeholder: string
  onChange: (value: string) => void
  testId?: string
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="row">
      <label className="row-title" htmlFor={id}>
        {title}
      </label>
      <input
        id={id}
        type="text"
        className="text-field"
        value={value}
        placeholder={placeholder}
        data-testid={testId}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  testId,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  testId?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="primary-button"
      onClick={onClick}
      disabled={disabled === true}
      data-testid={testId}
    >
      {children}
    </button>
  )
}

/** Height-animated disclosure, so the advanced section opens without a jump. */
export function Disclosure({
  open,
  children,
}: {
  open: boolean
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className={open ? 'disclosure open' : 'disclosure'} aria-hidden={!open}>
      <div>{children}</div>
    </div>
  )
}
