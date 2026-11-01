// Netlabels: releases from online record labels that publish under Creative Commons.
import { archiveCollection } from './lib/archive-collection'

export default archiveCollection({
  scope: 'collection:(netlabels)',
  categories: {
    week: ['*:*', 'week desc'],
    'all-time': ['*:*', 'downloads desc'],
    ambient: ['subject:(ambient)', 'downloads desc'],
    techno: ['subject:(techno OR house)', 'downloads desc'],
    experimental: ['subject:(experimental)', 'downloads desc']
  }
})
