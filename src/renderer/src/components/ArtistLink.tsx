import { createContext, type MouseEvent, useContext } from 'react'
import './ArtistLink.css'

/** Searches every source for an artist; provided once by the app shell. */
export const ArtistSearchContext = createContext<((artist: string) => void) | null>(null)

/**
 * An artist's name that searches all sources for them when clicked. Plain text where no search is available.
 * Must not be placed inside another button.
 */
export function ArtistLink({ name }: { name: string }) {
  const search = useContext(ArtistSearchContext)
  if (!search) return <>{name}</>
  const onClick = (event: MouseEvent) => {
    event.stopPropagation()
    search(name)
  }
  return (
    <button type="button" className="artist-link" onClick={onClick} title={`Search all sources for ${name}`}>
      {name}
    </button>
  )
}
