import { useEffect, useState } from 'react'
import type { ExploreOverview, ExploreSource, ProviderSection, SearchAlbum } from '../../../shared/types'
import { Icon } from './Icon'
import { Sticker } from './mascot/Sticker'
import { SectionBody } from './SearchView'

type Shelf = { status: 'loading' } | { status: 'done'; section: ProviderSection } | { status: 'error'; error: string }

interface Props {
  onOpenAlbum: (album: SearchAlbum, autoplay: boolean) => void
  onManageSources: () => void
}

/** The enabled charts, by category; each entry plays by searching the providers for it. */
export function ExploreView({ onOpenAlbum, onManageSources }: Props) {
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
            <button type="button" className="solid-button" onClick={onManageSources}>
              Manage sources
            </button>
          </Sticker>
        </div>
      )}
      {overview && overview.charts.length > 0 && !overview.canPlay && (
        <p className="section-error">
          <Icon name="error" size={18} />
          Charts play by searching your providers, and none are on.
          <button type="button" className="ghost-button" onClick={onManageSources}>
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

function ExploreShelf({ source, onOpenAlbum }: { source: ExploreSource; onOpenAlbum: Props['onOpenAlbum'] }) {
  const [category, setCategory] = useState(source.categories[0]?.id ?? '')
  const [shelf, setShelf] = useState<Shelf>({ status: 'loading' })

  useEffect(() => {
    let current = true
    setShelf({ status: 'loading' })
    void window.chomusuke.browse(source.id, category).then(response => {
      if (!current) return
      setShelf(response.ok ? { status: 'done', section: response.section } : { status: 'error', error: response.error })
    })
    return () => {
      current = false
    }
  }, [source.id, category])

  return (
    <section className="shelf">
      <p className="shelf__eyebrow">Charts</p>
      <h2 className="shelf__title">{source.name}</h2>
      <p className="sources__help">Plays through your providers — turn on more to find more.</p>
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
            fetchPage={page => window.chomusuke.browse(source.id, category, page)}
          />
        ))}
    </section>
  )
}
