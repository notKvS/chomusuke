// Offline tests for the tracker templates: fixtures shaped like each site's responses, with fetch stubbed.
// Nothing here talks to the real sites.
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import x1337x, { parseListing as parse1337x, parseMagnet } from '../src/1337x.ts'
import knaben from '../src/knaben.ts'
import { decodeEntities, parseRelease, parseSize, siteOrigin } from '../src/lib/torrent-kit.ts'
import limetorrents, { parseListing as parseLime } from '../src/limetorrents.ts'
import nyaa from '../src/nyaa.ts'
import thePirateBay from '../src/the-pirate-bay.ts'

const HASH = 'a'.repeat(40)
const HASH2 = 'b'.repeat(40)
const realFetch = globalThis.fetch
const requests: Array<{ url: string; init?: RequestInit }> = []

function stub(routes: Array<[RegExp, () => Response]>): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    requests.push({ url, init })
    const route = routes.find(([pattern]) => pattern.test(url))
    return route ? route[1]() : new Response('not found', { status: 404 })
  }) as typeof fetch
}

const html =
  (body: string, status = 200) =>
  () =>
    new Response(body, { status, headers: { 'content-type': 'text/html' } })
const json = (body: unknown) => () =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

afterEach(() => {
  globalThis.fetch = realFetch
  requests.length = 0
})

describe('torrent-kit', () => {
  it('parses release names', () => {
    assert.deepEqual(parseRelease('Daft Punk - Random Access Memories (2013) [FLAC 24-96]'), {
      artist: 'Daft Punk',
      title: 'Random Access Memories',
      year: '2013',
      tags: ['FLAC', 'Hi-Res']
    })
    const nyaaName = parseRelease('[FLAC] YOASOBI - THE BOOK 3 [2023.10.04]')
    assert.equal(nyaaName.artist, 'YOASOBI')
    assert.equal(nyaaName.title, 'THE BOOK 3')
    assert.equal(nyaaName.year, '2023')
    assert.equal(parseRelease('Taylor Swift - 1989 (2014) MP3 320').year, '2014')
    assert.equal(parseRelease('Some.Artist-Album.Name.2019.WEB.FLAC').tags?.[0], 'FLAC')
  })

  it('parses sizes and entities', () => {
    assert.equal(parseSize('1.5 GB'), Math.round(1.5 * 1024 ** 3))
    assert.equal(parseSize('700 MiB'), 700 * 1024 ** 2)
    assert.equal(parseSize('n/a'), undefined)
    assert.equal(decodeEntities('Rock &amp; Roll &#39;n&#x27; &quot;x&quot;'), `Rock & Roll 'n' "x"`)
  })

  it('only accepts declared mirrors', () => {
    assert.equal(siteOrigin({}, ['a.example', 'b.example']), 'https://a.example')
    assert.equal(siteOrigin({ mirror: 'https://B.example/' }, ['a.example', 'b.example']), 'https://b.example')
    assert.throws(() => siteOrigin({ mirror: 'evil.example' }, ['a.example']), /isn’t one of this extension’s mirrors/)
  })
})

describe('The Pirate Bay', () => {
  const items = [
    {
      id: '1',
      name: 'Pink Floyd - The Dark Side of the Moon (1973) [FLAC]',
      info_hash: HASH.toUpperCase(),
      seeders: '50',
      leechers: '3',
      size: '524288000',
      added: '1600000000',
      category: '104',
      status: 'vip'
    },
    {
      id: '2',
      name: 'Some Audiobook',
      info_hash: HASH2,
      seeders: '90',
      leechers: '1',
      size: '100',
      added: '1600000000',
      category: '102'
    },
    {
      id: '3',
      name: 'Pink Floyd - Animals (1977) MP3',
      info_hash: HASH2,
      seeders: '80',
      leechers: '1',
      size: '100',
      added: '1600000000',
      category: '101'
    }
  ]

  it('searches music categories, drops audiobooks and sorts by seeders', async () => {
    stub([[/apibay\.org\/q\.php/, json(items)]])
    const results = await thePirateBay.search({ query: 'pink floyd', options: {} })
    assert.match(requests[0].url, /q=pink\+floyd&cat=101%2C104/)
    assert.deepEqual(
      results.map(r => r.title),
      ['Animals', 'The Dark Side of the Moon']
    )
    const flac = results[1]
    assert.equal(flac.artist, 'Pink Floyd')
    assert.equal(flac.year, '1973')
    assert.equal(flac.seeders, 50)
    assert.deepEqual(flac.tags, ['FLAC', 'Trusted'])
    assert.match(flac.link ?? '', new RegExp(`^magnet:\\?xt=urn:btih:${HASH}&dn=.+&tr=udp`))
  })

  it('treats the all-zero placeholder as no results', async () => {
    stub([
      [
        /q\.php/,
        json([
          {
            id: '0',
            name: 'No results returned',
            info_hash: '0'.repeat(40),
            seeders: '0',
            leechers: '0',
            size: '0',
            category: '0'
          }
        ])
      ]
    ])
    assert.deepEqual(await thePirateBay.search({ query: 'zzzz', options: {} }), [])
  })

  it('browses the precompiled top lists', async () => {
    stub([[/precompiled\/data_top100_104\.json$/, json(items)]])
    const results = await thePirateBay.browse!({ category: 'top-flac', options: {} })
    assert.deepEqual(
      results.map(r => r.title),
      ['The Dark Side of the Moon']
    )
  })
})

const LISTING_1337X = `
<table class="table-list table table-responsive table-striped"><thead><tr><th class="coll-1 name">name</th></tr></thead><tbody>
<tr>
<td class="coll-1 name"><a href="/sub/23/0/" class="icon"><i class="flaticon-music"></i></a><a href="/torrent/5551234/Radiohead-OK-Computer-1997-FLAC/">Radiohead - OK Computer (1997) [FLAC]</a></td>
<td class="coll-2 seeds">1,204</td><td class="coll-3 leeches">31</td><td class="coll-date">Mar. 3rd &#039;21</td>
<td class="coll-4 size mob-uploader">512.4 MB<span class="seeds">1,204</span></td><td class="coll-5 uploader"><a href="/user/x/">x</a></td>
</tr>
<tr>
<td class="coll-1 name"><a href="/sub/22/0/" class="icon"><i class="flaticon-music"></i></a><a href="/torrent/5551235/Radiohead-Kid-A-Mnesia-2021-Deluxe-Edition-MP3-320/">Radiohead - Kid A Mnesia (2021) Delu...</a></td>
<td class="coll-2 seeds">88</td><td class="coll-3 leeches">2</td><td class="coll-date">Nov. 5th &#039;21</td>
<td class="coll-4 size mob-vip">300 MB<span class="seeds">88</span></td><td class="coll-5 vip"><a href="/user/y/">y</a></td>
</tr>
</tbody></table>`

describe('1337x', () => {
  it('parses listing rows, rebuilding shortened names from the URL', () => {
    const rows = parse1337x(LISTING_1337X)
    assert.equal(rows.length, 2)
    assert.deepEqual(rows[0], {
      path: '/torrent/5551234/Radiohead-OK-Computer-1997-FLAC/',
      name: 'Radiohead - OK Computer (1997) [FLAC]',
      seeders: 1204,
      leechers: 31,
      size: Math.round(512.4 * 1024 ** 2),
      sub: '23'
    })
    assert.equal(rows[1].name, 'Radiohead Kid A Mnesia 2021 Deluxe Edition MP3 320')
  })

  it('searches the Music category and resolves magnets from detail pages', async () => {
    stub([
      [/sort-category-search\/radiohead\/Music\/seeders\/desc\/1\/$/, html(LISTING_1337X)],
      [
        /\/torrent\/5551234\//,
        html(
          `<ul><li><a class="btn" href="magnet:?xt=urn:btih:${HASH}&amp;dn=OK+Computer&amp;tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337">Magnet</a></li></ul>`
        )
      ],
      [/\/torrent\/5551235\//, html('<p>removed</p>')]
    ])
    const results = await x1337x.search({ query: 'radiohead', options: {} })
    assert.equal(requests[0].url, 'https://1337x.to/sort-category-search/radiohead/Music/seeders/desc/1/')
    assert.equal(results.length, 1)
    assert.equal(results[0].title, 'OK Computer')
    assert.deepEqual(results[0].tags, ['Lossless', 'FLAC'])
    assert.equal(
      results[0].link,
      `magnet:?xt=urn:btih:${HASH}&dn=OK+Computer&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337`
    )
    assert.equal(parseMagnet('<a href="/x">no</a>'), undefined)
  })

  it('uses the chosen mirror and explains Cloudflare checks', async () => {
    stub([
      [
        /x1337x\.eu/,
        html('<html><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/x"></script></html>', 403)
      ]
    ])
    await assert.rejects(x1337x.test!({ options: { mirror: 'x1337x.eu' } }), /bot check \(Cloudflare\)/)
  })
})

const NYAA_FEED = `<?xml version="1.0" encoding="utf-8"?>
<rss xmlns:atom="http://www.w3.org/2005/Atom" xmlns:nyaa="https://nyaa.si/xmlns/nyaa" version="2.0">
<channel><title>Nyaa - Home - Torrent File RSS</title>
<item>
<title>[FLAC] Aimer - Open α Door [2023.07.26]</title>
<link>https://nyaa.si/download/1700001.torrent</link>
<guid isPermaLink="true">https://nyaa.si/view/1700001</guid>
<pubDate>Wed, 26 Jul 2023 10:00:00 -0000</pubDate>
<nyaa:seeders>42</nyaa:seeders><nyaa:leechers>1</nyaa:leechers><nyaa:downloads>900</nyaa:downloads>
<nyaa:infoHash>${HASH}</nyaa:infoHash><nyaa:categoryId>2_1</nyaa:categoryId><nyaa:category>Audio - Lossless</nyaa:category>
<nyaa:size>1.1 GiB</nyaa:size><nyaa:trusted>Yes</nyaa:trusted><nyaa:remake>No</nyaa:remake>
</item>
<item>
<title>Bad link &amp; no hash</title>
<link>https://evil.example/x.torrent</link>
</item>
</channel></rss>`

describe('Nyaa', () => {
  it('parses the RSS feed into torrent results', async () => {
    stub([[/nyaa\.si\/\?page=rss/, html(NYAA_FEED)]])
    const results = await nyaa.search({ query: 'aimer', options: { trustedOnly: true } })
    assert.equal(requests[0].url, 'https://nyaa.si/?page=rss&q=aimer&c=2_0&f=2&s=seeders&o=desc')
    assert.equal(results.length, 2)
    const [first, second] = results
    assert.equal(first.artist, 'Aimer')
    assert.equal(first.title, 'Open α Door')
    assert.equal(first.link, 'https://nyaa.si/download/1700001.torrent')
    assert.equal(first.hash, HASH)
    assert.equal(first.seeders, 42)
    assert.deepEqual(first.tags, ['Lossless', 'FLAC', 'Trusted'])
    // Off-site links are dropped; with no hash either, the app's sanitizer discards the result.
    assert.equal(second.link, undefined)
    assert.equal(second.hash, undefined)
  })

  it('browses lossless by seeders', async () => {
    stub([[/page=rss/, html(NYAA_FEED)]])
    await nyaa.browse!({ category: 'lossless-top', options: {} })
    assert.equal(requests[0].url, 'https://nyaa.si/?page=rss&c=2_1&f=0&s=seeders&o=desc')
  })
})

describe('Knaben', () => {
  const hits = {
    hits: [
      {
        title: 'Metallica - Master of Puppets (1986) [FLAC]',
        hash: HASH,
        magnetUrl: `magnet:?xt=urn:btih:${HASH}`,
        bytes: 400000000,
        seeders: 70,
        peers: 4,
        date: '2020-05-01T00:00:00',
        tracker: '1337x',
        categoryId: [1000000, 1002000]
      },
      { title: 'Some Audiobook', hash: HASH2, seeders: 10, peers: 0, categoryId: [1000000, 1003000] },
      { title: 'Metallica - Live (2009) MP3', hash: HASH2, seeders: 5, peers: 0, categoryId: [1000000, 1001000] }
    ]
  }

  it('POSTs a JSON search and maps hits', async () => {
    stub([[/api\.knaben\.org\/v1$/, json(hits)]])
    const results = await knaben.search({ query: 'metallica', options: {} })
    const body = JSON.parse(String(requests[0].init?.body))
    assert.equal(requests[0].init?.method, 'POST')
    assert.equal(body.query, 'metallica')
    assert.deepEqual(body.categories, [1000000])
    assert.equal(body.order_by, 'seeders')
    assert.deepEqual(
      results.map(r => r.title),
      ['Master of Puppets', 'Live']
    )
    assert.deepEqual(results[0].tags, ['Lossless', 'FLAC', '1337x'])
    assert.equal(results[0].link, `magnet:?xt=urn:btih:${HASH}`)
    assert.match(results[1].link ?? '', /^magnet:\?xt=urn:btih:b{40}&dn=/)
  })
})

const LIME_LISTING = `
<table class="table2" cellpadding="6" cellspacing="0" width="100%">
<tr><th class="thleft">Torrent Name</th><th>Added</th><th>Size</th><th>Seed</th><th>Leech</th><th>Health</th></tr>
<tr bgcolor="#F4F4F4">
<td class="tdleft"><div class="tt-name"><a href="http://itorrents.org/torrent/${HASH.toUpperCase()}.torrent?title=Adele-30-2021" rel="nofollow" class="csprite_dl14"></a><a href="/Adele-30-(2021)-[FLAC]-torrent-23456789.html">Adele - 30 (2021) [FLAC]</a></div></td>
<td class="tdnormal">2 years ago - in Music</td><td class="tdnormal">601.2 MB</td><td class="tdseed">1,532</td><td class="tdleech">12</td><td class="tdright"><div class="hb10"></div></td>
</tr>
<tr bgcolor="#FFFFFF">
<td class="tdleft"><div class="tt-name"><a href="/Adele-25-torrent-23456790.html">Adele - 25</a></div></td>
<td class="tdnormal">5 years ago - in Music</td><td class="tdnormal">90 MB</td><td class="tdseed">7</td><td class="tdleech">0</td><td class="tdright"></td>
</tr>
</table>`

describe('LimeTorrents', () => {
  it('parses rows, taking the hash from the itorrents link', () => {
    const rows = parseLime(LIME_LISTING)
    assert.equal(rows.length, 2)
    assert.deepEqual(rows[0], {
      path: '/Adele-30-(2021)-[FLAC]-torrent-23456789.html',
      name: 'Adele - 30 (2021) [FLAC]',
      hash: HASH.toUpperCase(),
      size: Math.round(601.2 * 1024 ** 2),
      seeders: 1532,
      leechers: 12
    })
    assert.equal(rows[1].hash, undefined)
  })

  it('only fetches detail pages for rows without a hash', async () => {
    stub([
      [/\/search\/music\/adele\/seeds\/1\/$/, html(LIME_LISTING)],
      [
        /Adele-25-torrent-23456790\.html$/,
        html(`<a class="csprite_dltorrent" href="magnet:?xt=urn:btih:${HASH2}&amp;dn=Adele">Magnet</a>`)
      ]
    ])
    const results = await limetorrents.search({ query: 'adele', options: { mirror: 'www.limetorrents.lol' } })
    assert.deepEqual(
      requests.map(r => r.url),
      [
        'https://www.limetorrents.lol/search/music/adele/seeds/1/',
        'https://www.limetorrents.lol/Adele-25-torrent-23456790.html'
      ]
    )
    assert.equal(results.length, 2)
    assert.match(results[0].link ?? '', /^magnet:\?xt=urn:btih:a{40}&dn=/)
    assert.equal(results[1].link, `magnet:?xt=urn:btih:${HASH2}&dn=Adele`)
  })
})
