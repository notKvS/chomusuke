import { useLibrary } from '../useLibrary'
import { Icon } from './Icon'
import { LibraryAlbumRow, libraryStatus } from './LibraryAlbumRow'
import { Sticker } from './mascot/Sticker'

/** Albums kept on this computer to play offline. Sharing and storage settings live in Settings. */
export function SavedAlbumsView({ onOpen }: { onOpen: (infoHash: string) => void }) {
  const { library, error, remove } = useLibrary()

  if (!library) return <div className="page library" />
  const { sharing, items } = library

  return (
    <div className="page library">
      <h1 className="search__title">Saved albums</h1>
      <p className="sources__lead">
        Albums you save are downloaded in full and stay on this computer, so they play instantly — even offline.
      </p>
      {error && (
        <p className="section-error">
          <Icon name="error" size={18} />
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <div className="library__empty">
          <Sticker scene="library-empty" size={150}>
            <p>
              Open an album and press <strong>Save offline</strong> to add it here.
            </p>
          </Sticker>
        </div>
      ) : (
        <ul className="library__list">
          {items.map(item => (
            <LibraryAlbumRow
              key={item.infoHash}
              item={item}
              status={libraryStatus(item, sharing, sharing.seedLibrary)}
              onOpen={onOpen}
              onRemove={remove}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
