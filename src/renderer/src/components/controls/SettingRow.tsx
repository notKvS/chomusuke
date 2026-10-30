import type { ReactNode } from 'react'

/** A setting as one row: bold title and a hint on the left, the control on the right. `off` dims it. */
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
      <span>
        <strong>{title}</strong>
        <small>{hint}</small>
      </span>
      {children}
    </div>
  )
}
