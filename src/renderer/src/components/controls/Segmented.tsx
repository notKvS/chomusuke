/** Pick one of a few options. Options without an entry in `labels` show their raw value. */
export function Segmented<T extends string>({
  options,
  value,
  labels,
  onChange
}: {
  options: readonly T[]
  value: T
  labels?: Record<string, string>
  onChange: (value: T) => void
}) {
  return (
    <fieldset className="segmented">
      {options.map(option => (
        <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)}>
          {labels?.[option] ?? option}
        </button>
      ))}
    </fieldset>
  )
}
