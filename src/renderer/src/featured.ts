export interface FeaturedAlbum {
  id: string
  title: string
  artist: string
  license: string
  source: string
  artwork: string
}

/**
 * Freely licensed albums hosted by the Internet Archive. Their torrents carry HTTP web seeds, so they
 * play even with no peers. Each was checked to stream: older archive.org torrents without padding files
 * can have tracks whose pieces overlap a since-edited _meta.xml and never verify (e.g. Classical_Sampler-9615).
 */
const archive = (id: string, title: string, artist: string, license: string): FeaturedAlbum => ({
  id,
  title,
  artist,
  license,
  source: `https://archive.org/download/${id}/${id}_archive.torrent`,
  artwork: `https://archive.org/services/img/${id}`
})

export const FEATURED: FeaturedAlbum[] = [
  archive('nineinchnails_ghosts_I_IV', 'Ghosts I–IV', 'Nine Inch Nails', 'CC BY-NC-SA'),
  archive('nine_inch_nails_the_slip', 'The Slip', 'Nine Inch Nails', 'CC BY-NC-SA'),
  archive('NS050', 'Another Day, Another Way', 'No-Source Netlabel', 'CC BY-NC-SA'),
  archive('badpanda018', 'Brick City Love Song', 'Riding Alone for Thousands of Miles', 'CC BY-NC-SA'),
  archive('Jazz_Sampler-9619', 'Jazz Sampler', 'Kevin MacLeod', 'CC BY'),
  archive('KevinMacLeod_2019-04_Discography', 'Complete Discography (2019)', 'Kevin MacLeod', 'CC BY')
]
