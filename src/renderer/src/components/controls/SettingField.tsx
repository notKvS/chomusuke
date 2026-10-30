import type { ReactNode } from 'react'

/**
 * A labelled setting: label (and current value) above the control, optional hint below. `row` puts a small control
 * such as a switch on the same line as the label.
 */
export function SettingField({
  label,
  value,
  hint,
  row,
  children
}: {
  label: string
  value?: string
  hint?: string
  row?: boolean
  children: ReactNode
}) {
  return (
    <div className={`setting ${row ? 'setting--row' : ''}`}>
      <span className="setting__label">
        <span>{label}</span>
        {value && <span className="setting__value">{value}</span>}
      </span>
      {children}
      {hint && <p className="setting__hint">{hint}</p>}
    </div>
  )
}
