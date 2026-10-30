import { Icon } from '../Icon'

export type Status = { kind: 'ok' | 'error' | 'busy'; text: string }

/**
 * The outcome of an action (saved, failed, working…), announced to screen readers. `as` picks the element: a block
 * `p` under a section, or an inline `span` beside buttons in a form row.
 */
export function StatusLine({ status, as: Tag = 'span' }: { status: Status; as?: 'p' | 'span' }) {
  return (
    <Tag className={`status-line is-${status.kind}`} role="status">
      {status.kind === 'ok' && <Icon name="check" size={18} />}
      {status.kind === 'error' && <Icon name="error" size={18} />}
      {status.text}
    </Tag>
  )
}
