// Public Domain Classical: Musopen and other classical recordings released into the public domain.
import { archiveCollection } from './lib/archive-collection'

export default archiveCollection({
  scope: 'collection:(musopen) OR (subject:(classical) AND licenseurl:*publicdomain*)',
  categories: {
    week: ['*:*', 'week desc'],
    'all-time': ['*:*', 'downloads desc'],
    musopen: ['collection:(musopen)', 'downloads desc'],
    piano: ['subject:(piano)', 'downloads desc']
  }
})
