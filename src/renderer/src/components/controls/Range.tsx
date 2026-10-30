import type { CSSProperties } from 'react'

/** Slider. `--fill` tells the CSS how much of the track to colour, since range inputs can't style that natively. */
export function Range({
  min,
  max,
  step = 1,
  value,
  onChange,
  disabled
}: {
  min: number
  max: number
  step?: number
  value: number
  onChange: (value: number) => void
  disabled?: boolean
}) {
  const fill = `${((value - min) / (max - min)) * 100}%`
  return (
    <input
      className="range"
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={e => onChange(Number(e.target.value))}
      style={{ '--fill': fill } as CSSProperties}
    />
  )
}
