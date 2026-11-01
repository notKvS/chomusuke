// Live Music Archive: concert recordings from bands that allow taping and trading (etree), on the Internet Archive.
import { archiveCollection } from './lib/archive-collection'

export default archiveCollection({
  scope: 'collection:(etree)',
  mediatype: 'mediatype:(etree OR audio)',
  categories: {
    week: ['*:*', 'week desc'],
    recent: ['*:*', 'addeddate desc'],
    'all-time': ['*:*', 'downloads desc']
  },
  optionClause: options =>
    options.soundboardOnly === true ? '(title:(sbd) OR identifier:(sbd) OR source:(soundboard))' : '',
  tags: doc => (/sbd|soundboard/i.test(`${doc.identifier} ${String(doc.title)}`) ? ['SBD'] : ['AUD'])
})
