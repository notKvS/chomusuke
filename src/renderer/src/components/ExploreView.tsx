import { useEffect, useState } from 'react'
import { COUNTRIES, LANGUAGES } from '../../../shared/regions'
import type { ExploreOverview, ExploreSource, ProviderSection, SearchAlbum } from '../../../shared/types'
import { Icon } from './Icon'
import { Sticker } from './mascot/Sticker'
import { SectionBody } from './SearchView'
import './ExploreView.css'

type Shelf = { status: 'loading' } | { status: 'done'; section: ProviderSection } | { status: 'error'; error: string }

interface Props {
  onOpenAlbum: (album: SearchAlbum, autoplay: boolean) => void
  onManagePlugins: () => void
  onManageCharts: () => void
}

/** The enabled charts, by category; each entry plays by searching the providers for it. */
export function ExploreView({ onOpenAlbum, onManagePlugins, onManageCharts }: Props) {
  const [overview, setOverview] = useState<ExploreOverview | null>(null)

  useEffect(() => {
    void window.chomusuke.exploreSources().then(setOverview)
  }, [])

  return (
    <div className="page explore">
      <h1 className="search__title">Explore</h1>
      {overview?.charts.length === 0 && (
        <div className="search__message">
          <Sticker scene="no-sources">
            <p>Turn on a chart to see what's popular here.</p>
            <button type="button" className="solid-button" onClick={onManageCharts}>
              Manage charts
            </button>
          </Sticker>
        </div>
      )}
      {overview && overview.charts.length > 0 && !overview.canPlay && (
        <p className="section-error">
          <Icon name="error" size={18} />
          Charts play by searching your plugins, and none are on.
          <button type="button" className="ghost-button" onClick={onManagePlugins}>
            Turn one on
          </button>
        </p>
      )}
      {overview?.charts.map(source => (
        <ExploreShelf key={source.id} source={source} onOpenAlbum={onOpenAlbum} />
      ))}
    </div>
  )
}

/** What the country picker can be set to: the chart's own default, worldwide, a country (c:) or a language (l:). */
const DEFAULT_CHOICE = 'default'
const countryName = (code: string) =>
  code ? (COUNTRIES.find(c => c.code === code)?.name ?? code.toUpperCase()) : 'Worldwide'

/** The country (or "" for worldwide) a picker choice stands for; undefined keeps the chart's saved country. */
export function choiceRegion(choice: string): string | undefined {
  if (choice === 'worldwide') return ''
  if (choice.startsWith('c:')) return choice.slice(2)
  if (choice.startsWith('l:')) return LANGUAGES.find(l => l.id === choice.slice(2))?.country
  return undefined
}

const choiceKey = (sourceId: string) => `chomusuke.region.${sourceId}`

function storedChoice(source: ExploreSource): string {
  try {
    const saved = localStorage.getItem(choiceKey(source.id))
    const known = saved === 'worldwide' ? source.region?.worldwide === true : choiceRegion(saved ?? '') !== undefined
    return saved && known ? saved : DEFAULT_CHOICE
  } catch {
    return DEFAULT_CHOICE
  }
}

function RegionPicker({
  source,
  choice,
  onChoice
}: {
  source: ExploreSource
  choice: string
  onChoice: (choice: string) => void
}) {
  const worldwide = source.region?.worldwide ?? false
  return (
    <label className="explore__region">
      <span>Country</span>
      <select value={choice} onChange={e => onChoice(e.target.value)} aria-label={`${source.name} country`}>
        <option value={DEFAULT_CHOICE}>Default ({countryName(source.region?.current ?? '')})</option>
        {worldwide && <option value="worldwide">Worldwide</option>}
        <optgroup label="Country">
          {COUNTRIES.map(c => (
            <option key={c.code} value={`c:${c.code}`}>
              {c.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="Language (the country where it's most listened to)">
          {LANGUAGES.map(l => (
            <option key={l.id} value={`l:${l.id}`}>
              {l.name} — {countryName(l.country)}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  )
}

function ExploreShelf({ source, onOpenAlbum }: { source: ExploreSource; onOpenAlbum: Props['onOpenAlbum'] }) {
  const [category, setCategory] = useState(source.categories[0]?.id ?? '')
  const [shelf, setShelf] = useState<Shelf>({ status: 'loading' })
  const [choice, setChoice] = useState(() => storedChoice(source))
  const followsCountry =
    Boolean(source.region) && (source.region?.categories === undefined || source.region.categories.includes(category))
  const region = followsCountry ? choiceRegion(choice) : undefined

  const pick = (next: string) => {
    setChoice(next)
    try {
      localStorage.setItem(choiceKey(source.id), next)
    } catch {
      // Not remembered, still applied.
    }
  }

  useEffect(() => {
    let current = true
    setShelf({ status: 'loading' })
    void window.chomusuke.browse(source.id, category, 1, region).then(response => {
      if (!current) return
      setShelf(response.ok ? { status: 'done', section: response.section } : { status: 'error', error: response.error })
    })
    return () => {
      current = false
    }
  }, [source.id, category, region])

  return (
    <section className="shelf">
      <p className="shelf__eyebrow">Charts</p>
      <h2 className="shelf__title">{source.name}</h2>
      <p className="sources__help">Plays through your plugins — turn on more to find more.</p>
      <div className="chips" role="tablist" aria-label={`${source.name} categories`}>
        {source.categories.map(c => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={c.id === category}
            className={`chip ${c.id === category ? 'is-active' : ''}`}
            onClick={() => setCategory(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>
      {followsCountry && <RegionPicker source={source} choice={choice} onChoice={pick} />}
      {shelf.status === 'loading' && (
        <div className="song-list" aria-busy="true">
          {['a', 'b', 'c'].map(key => (
            <div key={key} className="skeleton-row" />
          ))}
        </div>
      )}
      {shelf.status === 'error' && (
        <p className="section-error">
          <Icon name="error" size={18} />
          {shelf.error}
        </p>
      )}
      {shelf.status === 'done' &&
        (shelf.section.albums.length === 0 && !shelf.section.error ? (
          <p className="sources__help">Nothing here right now.</p>
        ) : (
          <SectionBody
            section={shelf.section}
            onOpenAlbum={onOpenAlbum}
            fetchPage={page => window.chomusuke.browse(source.id, category, page, region)}
          />
        ))}
    </section>
  )
}
