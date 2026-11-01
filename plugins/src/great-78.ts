// Great 78 Project: digitised 78 rpm records from 1898 to the 1950s.
import { archiveCollection } from './lib/archive-collection'

export default archiveCollection({
  scope: 'collection:(georgeblood)',
  categories: {
    week: ['*:*', 'week desc'],
    jazz: ['subject:(jazz)', 'downloads desc'],
    blues: ['subject:(blues)', 'downloads desc'],
    country: ['subject:(country)', 'downloads desc'],
    opera: ['subject:(opera OR classical)', 'downloads desc']
  }
})
