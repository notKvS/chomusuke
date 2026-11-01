// Jamendo: ~300k Creative Commons albums from independent artists, mirrored on the Internet Archive.
import { archiveCollection } from './lib/archive-collection'

export default archiveCollection({
  scope: 'collection:(jamendo-albums)',
  categories: {
    week: ['*:*', 'week desc'],
    'all-time': ['*:*', 'downloads desc'],
    electronic: ['subject:(electronic)', 'week desc'],
    rock: ['subject:(rock)', 'week desc'],
    hiphop: ['subject:(hiphop OR rap)', 'week desc']
  }
})
