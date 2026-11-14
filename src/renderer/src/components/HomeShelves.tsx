import { useEffect, useState } from 'react'
import type { HomeShelf, ProviderSection, SearchAlbum } from '../../../shared/types'
import { SectionBody } from './SearchView'

/** Albums on one row. */
const ROW_SIZE = 12

type Row = { status: 'loading' } | { status: 'done'; albums: SearchAlbum[] }

/** Where a row's albums come from: a search for an artist (all plugins, merged), a chart category, or suggestions. */
async function loadRow(shelf: HomeShelf): Promise<SearchAlbum[]> {
  if (shelf.source.kind === 'similar') return window.chomusuke.getSimilarSongs(shelf.source.artistMbid)
  if (shelf.source.kind === 'chart') {
    const response = await window.chomusuke.browse(shelf.source.sourceId, shelf.source.categoryId)
    return response.ok ? response.section.albums : []
  }
  const response = await window.chomusuke.search(shelf.source.query)
  if (!response.ok) return []
  // Interleave the plugins so one of them doesn't fill the whole row.
  const lists = response.results.sections.map(section => section.albums)
  const merged: SearchAlbum[] = []
  for (let i = 0; merged.length < ROW_SIZE && lists.some(list => i < list.length); i++) {
    for (const list of lists) if (i < list.length) merged.push(list[i])
  }
  return merged
}

/** The rows made from what you listen to (or, with nothing played yet, a popular chart). */
export function HomeShelves({ onOpenAlbum }: { onOpenAlbum: (album: SearchAlbum, autoplay: boolean) => void }) {
  const [shelves, setShelves] = useState<HomeShelf[]>([])

  useEffect(() => {
    let current = true
    void window.chomusuke.getHomeShelves().then(list => current && setShelves(list))
    return () => {
      current = false
    }
  }, [])

  return shelves.map(shelf => <HomeRow key={shelf.id} shelf={shelf} onOpenAlbum={onOpenAlbum} />)
}

function HomeRow({
  shelf,
  onOpenAlbum
}: {
  shelf: HomeShelf
  onOpenAlbum: (album: SearchAlbum, autoplay: boolean) => void
}) {
  const [row, setRow] = useState<Row>({ status: 'loading' })

  useEffect(() => {
    let current = true
    void loadRow(shelf)
      .catch(() => [])
      .then(albums => current && setRow({ status: 'done', albums: albums.slice(0, ROW_SIZE) }))
    return () => {
      current = false
    }
  }, [shelf])

  // A row that found nothing is left out rather than shown empty.
  if (row.status === 'done' && row.albums.length === 0) return null
  const section: ProviderSection = {
    id: shelf.id,
    name: shelf.title,
    layout: 'cards',
    albums: row.status === 'done' ? row.albums : []
  }
  return (
    <section className="shelf">
      {shelf.subtitle && <p className="shelf__eyebrow">{shelf.subtitle}</p>}
      <h2 className="shelf__title">{shelf.title}</h2>
      {row.status === 'loading' ? (
        <div className="song-list" aria-busy="true">
          {['a', 'b', 'c'].map(key => (
            <div key={key} className="skeleton-row" />
          ))}
        </div>
      ) : (
        <SectionBody section={section} onOpenAlbum={onOpenAlbum} />
      )}
    </section>
  )
}
