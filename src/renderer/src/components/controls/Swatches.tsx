import { Icon } from '../Icon'

/** Colour swatches plus a free colour picker, which fills in with the value when it isn't one of the swatches. */
export function Swatches({
  colors,
  value,
  onChange
}: {
  colors: string[]
  value: string
  onChange: (color: string) => void
}) {
  return (
    <div className="swatches">
      {colors.map(color => (
        <button
          key={color}
          type="button"
          className="swatch"
          style={{ background: color }}
          aria-label={color}
          aria-pressed={value === color}
          onClick={() => onChange(color)}
        />
      ))}
      <label
        className="color-picker"
        title="Pick any colour"
        style={colors.includes(value) ? undefined : { background: value, borderStyle: 'solid' }}
      >
        <Icon name="add" size={16} />
        <input type="color" value={value} onChange={e => onChange(e.target.value)} aria-label="Pick any colour" />
      </label>
    </div>
  )
}
