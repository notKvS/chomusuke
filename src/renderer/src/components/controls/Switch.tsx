/** On/off switch. `label` is the accessible name, since the switch itself shows no text. */
export function Switch({
  checked,
  label,
  disabled,
  onChange
}: {
  checked: boolean
  label: string
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__knob" />
    </button>
  )
}
