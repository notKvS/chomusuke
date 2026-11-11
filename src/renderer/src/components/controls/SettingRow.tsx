import type { ReactNode } from 'react'

/**
 * A setting as one row: bold title and a hint on the left, the control(s) on the right. `off` dims it. Several buttons
 * sit side by side and wrap under each other in a narrow window; the text takes the rest of the width.
 */
export function SettingRow({
  title,
  hint,
  off,
  children
}: {
  title: string
  hint: string
  off?: boolean
  children: ReactNode
}) {
  return (
    <div className={`sharing__row ${off ? 'is-off' : ''}`}>
      <span className="sharing__text">
        <strong>{title}</strong>
        <small>{hint}</small>
      </span>
      <div className="sharing__control">{children}</div>
    </div>
  )
}
