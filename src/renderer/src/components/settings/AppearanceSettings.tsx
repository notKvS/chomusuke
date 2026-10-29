import { type ChangeEvent, type CSSProperties, type ReactNode, useRef, useState } from 'react'
import {
  type Appearance,
  BACKGROUNDS,
  BUTTON_SHAPES,
  BUTTON_STYLES,
  computeTheme,
  FONTS,
  matchingPreset,
  PRESETS,
  presetAppearance,
  randomAppearance,
  SURFACES,
  sanitizeAppearance
} from '../../theme/appearance'
import { encodeBackgroundImage } from '../../theme/dom'
import type { AppearanceControls } from '../../theme/useAppearance'
import { Icon } from '../Icon'

const ACCENTS = [
  '#ff5c8a',
  '#ff3b3b',
  '#ff8a3d',
  '#ffd25c',
  '#6ee7b7',
  '#3f9e6b',
  '#3ec7ff',
  '#2f6bff',
  '#8a6bff',
  '#ff2bd6',
  '#e8e8ec'
]
const ACCENTS_2 = [
  '#8a6bff',
  '#b48cff',
  '#ff8fb1',
  '#ff9f1c',
  '#ffd25c',
  '#5ce1e6',
  '#2f6bff',
  '#00f0ff',
  '#3f9e6b',
  '#b07a4f',
  '#8a8a96'
]

const LABELS: Record<string, string> = {
  dark: 'Dark',
  light: 'Light',
  aurora: 'Aurora',
  mesh: 'Mesh',
  starfield: 'Starfield',
  gradient: 'Gradient',
  solid: 'Solid',
  image: 'Image',
  classic: 'Classic',
  glass: 'Glass',
  frosted: 'Frosted',
  outline: 'Outline',
  pill: 'Pill',
  rounded: 'Rounded',
  square: 'Square',
  soft: 'Soft',
  glow: 'Glow',
  system: 'System',
  serif: 'Serif',
  mono: 'Mono'
}

const FONT_SAMPLES: Record<Appearance['font'], string> = {
  rounded: "'Nunito', sans-serif",
  system: "'Segoe UI', system-ui, sans-serif",
  serif: 'Georgia, serif',
  mono: "'Cascadia Code', Consolas, monospace"
}

/** Every look-and-feel setting, applied live. */
export function AppearanceSettings({ controls }: { controls: AppearanceControls }) {
  const { appearance: a, update, replace, reset, image, setImage } = controls
  const [code, setCode] = useState('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const active = matchingPreset(a)

  const pickImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const encoded = await encodeBackgroundImage(file)
      const stored = setImage(encoded)
      update({ background: 'image' })
      setMessage(
        stored
          ? null
          : {
              kind: 'error',
              text: 'That image is too big to remember after a restart — it’s used for this session only.'
            }
      )
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'That image couldn’t be used.' })
    }
  }

  const importCode = () => {
    try {
      replace(sanitizeAppearance(JSON.parse(code)))
      setMessage({ kind: 'ok', text: 'Theme applied.' })
    } catch {
      setMessage({ kind: 'error', text: 'That doesn’t look like a theme code.' })
    }
  }

  return (
    <div className="appearance">
      <div className="appearance__intro">
        <p>Make Chomusuke yours. Every change applies instantly and is remembered.</p>
        <div className="appearance__actions">
          <button type="button" className="solid-button" onClick={() => replace(randomAppearance())}>
            <Icon name="shuffle" size={18} /> Surprise me
          </button>
          <button type="button" className="ghost-button" onClick={reset}>
            <Icon name="reset" size={18} /> Reset
          </button>
        </div>
      </div>

      <section className="shelf">
        <h2 className="shelf__title">Themes</h2>
        <div className="preset-grid">
          {PRESETS.map(preset => (
            <PresetCard
              key={preset.id}
              values={presetAppearance(preset)}
              name={preset.name}
              blurb={preset.blurb}
              active={active?.id === preset.id}
              onPick={() => replace(presetAppearance(preset))}
            />
          ))}
        </div>
      </section>

      <section className="shelf">
        <h2 className="shelf__title">Colours</h2>
        <div className="setting-grid">
          <Setting label="Mode">
            <Segmented options={['dark', 'light']} value={a.mode} onChange={mode => update({ mode })} />
          </Setting>
          <Setting
            label="Background tint"
            value={`${a.tint}%`}
            hint="How much the secondary colour tints backgrounds and panels."
          >
            <Range min={0} max={100} value={a.tint} onChange={tint => update({ tint })} />
          </Setting>
          <Setting label="Accent">
            <Swatches colors={ACCENTS} value={a.accent} onChange={accent => update({ accent })} />
          </Setting>
          <Setting label="Secondary accent">
            <Swatches colors={ACCENTS_2} value={a.accent2} onChange={accent2 => update({ accent2 })} />
          </Setting>
        </div>
      </section>

      <section className="shelf">
        <h2 className="shelf__title">Background</h2>
        <div className="setting-grid">
          <Setting label="Style">
            <Segmented
              options={BACKGROUNDS}
              value={a.background}
              onChange={background =>
                background === 'image' && !image ? fileInput.current?.click() : update({ background })
              }
            />
          </Setting>
          <Setting label="Animated" row>
            <Toggle
              checked={a.animatedBackground}
              onChange={animatedBackground => update({ animatedBackground })}
              label="Animate the background"
            />
          </Setting>
          <Setting
            label="Your image"
            hint="Pick any picture from your computer. It's resized and kept on this device only."
          >
            <div className="image-picker">
              <span
                className="image-picker__thumb"
                style={image ? { backgroundImage: `url("${image}")` } : undefined}
              />
              <button type="button" className="ghost-button" onClick={() => fileInput.current?.click()}>
                <Icon name="image" size={18} /> {image ? 'Change' : 'Choose image'}
              </button>
              {image && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Remove image"
                  onClick={() => {
                    setImage(null)
                    if (a.background === 'image') update({ background: 'aurora' })
                  }}
                >
                  <Icon name="delete" size={20} />
                </button>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/png, image/jpeg, image/webp, image/gif, image/bmp"
                onChange={e => void pickImage(e)}
              />
            </div>
          </Setting>
          {a.background === 'image' && (
            <>
              <Setting label="Image blur" value={`${a.backgroundBlur}px`}>
                <Range
                  min={0}
                  max={40}
                  value={a.backgroundBlur}
                  onChange={backgroundBlur => update({ backgroundBlur })}
                />
              </Setting>
              <Setting label={a.mode === 'dark' ? 'Darken' : 'Lighten'} value={`${a.backgroundDim}%`}>
                <Range min={0} max={90} value={a.backgroundDim} onChange={backgroundDim => update({ backgroundDim })} />
              </Setting>
            </>
          )}
        </div>
      </section>

      <section className="shelf">
        <h2 className="shelf__title">Panels</h2>
        <div className="setting-grid">
          <Setting label="Surface" hint="Glass and Frosted look best over Mesh, Starfield or your own image.">
            <Segmented options={SURFACES} value={a.surface} onChange={surface => update({ surface })} />
          </Setting>
          <Setting label="Corner radius" value={`${a.radius}px`}>
            <Range min={0} max={28} value={a.radius} onChange={radius => update({ radius })} />
          </Setting>
          {(a.surface === 'glass' || a.surface === 'frosted') && (
            <>
              <Setting label="Glass blur" value={`${a.glassBlur}px`}>
                <Range min={0} max={48} value={a.glassBlur} onChange={glassBlur => update({ glassBlur })} />
              </Setting>
              <Setting label="Glass opacity" value={`${a.glassOpacity}%`}>
                <Range min={10} max={95} value={a.glassOpacity} onChange={glassOpacity => update({ glassOpacity })} />
              </Setting>
            </>
          )}
        </div>
      </section>

      <section className="shelf">
        <h2 className="shelf__title">Buttons</h2>
        <div className="setting-grid">
          <Setting label="Shape">
            <Segmented
              options={BUTTON_SHAPES}
              value={a.buttonShape}
              onChange={buttonShape => update({ buttonShape })}
            />
          </Setting>
          <Setting label="Style">
            <Segmented
              options={BUTTON_STYLES}
              value={a.buttonStyle}
              onChange={buttonStyle => update({ buttonStyle })}
            />
          </Setting>
          <Setting label="Preview">
            <div className="button-preview">
              <button type="button" className="big-play" aria-label="Sample play button">
                <Icon name="play" size={28} />
              </button>
              <button type="button" className="solid-button">
                Primary
              </button>
              <button type="button" className="ghost-button">
                Secondary
              </button>
              <span className="chips">
                <button type="button" className="chip is-active">
                  Chip
                </button>
                <button type="button" className="chip">
                  Chip
                </button>
              </span>
            </div>
          </Setting>
        </div>
      </section>

      <section className="shelf">
        <h2 className="shelf__title">Text & size</h2>
        <div className="setting-grid">
          <Setting label="Font">
            <div className="segmented">
              {FONTS.map(font => (
                <button
                  key={font}
                  type="button"
                  aria-pressed={a.font === font}
                  onClick={() => update({ font })}
                  style={{ fontFamily: FONT_SAMPLES[font] }}
                >
                  {LABELS[font] ?? font}
                </button>
              ))}
            </div>
          </Setting>
          <Setting label="Interface size" value={`${a.uiScale}%`}>
            <Range min={80} max={130} step={5} value={a.uiScale} onChange={uiScale => update({ uiScale })} />
          </Setting>
        </div>
      </section>

      <section className="shelf">
        <h2 className="shelf__title">Effects</h2>
        <div className="setting-grid">
          <Setting label="Glow" value={`${a.glow}%`}>
            <Range min={0} max={200} step={10} value={a.glow} onChange={glow => update({ glow })} />
          </Setting>
          <Setting label="Sakura petals" value={a.sakura ? String(a.petals) : 'Off'}>
            <div className="setting--row" style={{ display: 'flex', gap: 12 }}>
              <Toggle checked={a.sakura} onChange={sakura => update({ sakura })} label="Show sakura petals" />
              <Range min={4} max={40} value={a.petals} onChange={petals => update({ petals })} disabled={!a.sakura} />
            </div>
          </Setting>
          <Setting label="Animated mascot" row>
            <Toggle
              checked={a.mascotMotion}
              onChange={mascotMotion => update({ mascotMotion })}
              label="Animate Chomusuke"
            />
          </Setting>
          <Setting label="Splash screen on launch" row>
            <Toggle checked={a.splash} onChange={splash => update({ splash })} label="Show the splash screen" />
          </Setting>
        </div>
      </section>

      <section className="shelf">
        <h2 className="shelf__title">Share a theme</h2>
        <div className="setting-grid">
          <Setting
            label="This theme's code"
            hint="Copy it to keep or share your look. (Your background image isn't included.)"
          >
            <textarea
              className="theme-code"
              readOnly
              value={JSON.stringify(a)}
              onFocus={e => e.currentTarget.select()}
            />
          </Setting>
          <Setting label="Use a theme code">
            <textarea
              className="theme-code"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder='{"accent":"#3ec7ff", …}'
              spellCheck={false}
            />
            <div>
              <button type="button" className="solid-button" onClick={importCode} disabled={!code.trim()}>
                Apply code
              </button>
            </div>
          </Setting>
        </div>
        {message && (
          <p className={`torznab-form__status is-${message.kind}`} role="status">
            {message.kind === 'ok' ? <Icon name="check" size={18} /> : <Icon name="error" size={18} />}
            {message.text}
          </p>
        )}
      </section>
    </div>
  )
}

function PresetCard({
  values,
  name,
  blurb,
  active,
  onPick
}: {
  values: Appearance
  name: string
  blurb: string
  active: boolean
  onPick: () => void
}) {
  const { tokens } = computeTheme(values)
  const preview: CSSProperties = {
    background: `radial-gradient(120px 60px at 85% 110%, ${tokens['--accent']}55, transparent 70%), linear-gradient(135deg, ${tokens['--bg']}, ${tokens['--surface-raised']})`,
    border: `1px solid ${tokens['--surface-raised']}`
  }
  return (
    <button type="button" className={`preset ${active ? 'is-active' : ''}`} onClick={onPick} aria-pressed={active}>
      <span className="preset__preview" style={preview}>
        <b style={{ background: tokens['--gradient'] }} />
        <i style={{ background: tokens['--accent'] }} />
        <i style={{ background: tokens['--accent-2'] }} />
        <i style={{ background: tokens['--surface'] }} />
        <i style={{ background: tokens['--text'] }} />
      </span>
      <span className="preset__name">{name}</span>
      <span className="preset__blurb">{blurb}</span>
    </button>
  )
}

function Setting({
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

function Segmented<T extends string>({
  options,
  value,
  onChange
}: {
  options: readonly T[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <fieldset className="segmented">
      {options.map(option => (
        <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)}>
          {LABELS[option] ?? option}
        </button>
      ))}
    </fieldset>
  )
}

function Swatches({ colors, value, onChange }: { colors: string[]; value: string; onChange: (color: string) => void }) {
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

function Range({
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

function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => onChange(!checked)}
    >
      <span className="switch__knob" />
    </button>
  )
}
