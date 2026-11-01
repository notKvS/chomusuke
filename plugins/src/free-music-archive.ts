// Free Music Archive: curated, freely licensed independent music, mirrored on the Internet Archive.
import { archiveCollection } from './lib/archive-collection'

export default archiveCollection({
  scope: 'collection:(freemusicarchive)',
  categories: {
    week: ['*:*', 'week desc'],
    'all-time': ['*:*', 'downloads desc'],
    recent: ['*:*', 'addeddate desc']
  }
})
