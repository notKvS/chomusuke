// Offline tests for the tracker templates: fixtures shaped like each site's responses, with fetch stubbed.
// Nothing here talks to the real sites.
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import x1337x, { parseListing as parse1337x, parseMagnet } from '../src/1337x.ts'
import bitsearch, { MIRRORS as BITSEARCH_MIRRORS, parseListing as parseBitSearch } from '../src/bitsearch.ts'
import knaben from '../src/knaben.ts'
import {
  decodeEntities,
  getText,
  parseRelease,
  parseSize,
  percentEncodeCp1251,
  siteOrigin
} from '../src/lib/torrent-kit.ts'
import limetorrents, { parseListing as parseLime } from '../src/limetorrents.ts'
import nyaa from '../src/nyaa.ts'
import rutor, { parseListing as parseRutor, searchPath } from '../src/rutor.ts'
import rutracker, {
  isLoginPage,
  isMusicForum,
  loginBody,
  parseListing as parseRuTracker,
  parseMagnet as parseRuTrackerMagnet
} from '../src/rutracker.ts'
import type { Paged } from '../src/sdk.ts'
import thePirateBay from '../src/the-pirate-bay.ts'

/** The results of a search, whether or not the plugin pages them. */
const list = async <T>(paged: Promise<Paged<T>>): Promise<T[]> => {
  const value = await paged
  return Array.isArray(value) ? value : value.results
}

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
    assert.throws(() => siteOrigin({ mirror: 'evil.example' }, ['a.example']), /isn’t one of this plugin’s mirrors/)
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
    const results = await list(thePirateBay.search({ query: 'pink floyd', options: {} }))
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
    assert.deepEqual(await list(thePirateBay.search({ query: 'zzzz', options: {} })), [])
  })

  it('browses the precompiled top lists', async () => {
    stub([[/precompiled\/data_top100_104\.json$/, json(items)]])
    const results = await list(thePirateBay.browse!({ category: 'top-flac', options: {} }))
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
    const results = await list(x1337x.search({ query: 'radiohead', options: {} }))
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
    const results = await list(nyaa.search({ query: 'aimer', options: { trustedOnly: true } }))
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
    const results = await list(knaben.search({ query: 'metallica', options: {} }))
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
    const results = await list(limetorrents.search({ query: 'adele', options: { mirror: 'www.limetorrents.lol' } }))
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

// BitSearch's markup below is written from the upstream qBittorrent engine's regexes, not copied from the site.
const BS_CARD =
  'bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition duration-150 ease-in-out'
const BS_ROW = (
  name: string,
  size: string,
  seeders: string,
  leechers: string,
  hash: string
) => `<div class="${BS_CARD}">
  <h3 class="text-lg"><a href="/torrent/${hash}" class="hover:text-blue-600">
    ${name} </a></h3>
  <div class="flex"><i class="fa fa-download"></i> <span>${size}</span> <i class="fa fa-calendar"></i> <span>03/05/2021</span>
    <span class="font-medium">${seeders}</span> <span class="font-medium">${leechers}</span>
    <a href="magnet:?xt=urn:btih:${hash}&amp;dn=Adele" class="btn">Magnet</a></div>
</div> <!-- Mobile layout -->`
const BS_LISTING = `<html><body>${BS_ROW('Adele - 30 (2021) [FLAC]', '1.2 GB', '1,234', '56', HASH)}
${BS_ROW('<b>Rock &amp; Roll</b> Hits', '700.5 MB', '9', '0', HASH2)}
<div class="footer">not a card</div></body></html>`

describe('BitSearch', () => {
  it('parses cards: names, magnet, size in bytes, seeders and leechers', () => {
    const rows = parseBitSearch(BS_LISTING)
    assert.equal(rows.length, 2)
    assert.deepEqual(rows[0], {
      name: 'Adele - 30 (2021) [FLAC]',
      magnet: `magnet:?xt=urn:btih:${HASH}&dn=Adele`,
      size: Math.round(1.2 * 1024 ** 3),
      seeders: 1234,
      leechers: 56
    })
    assert.equal(rows[1].name, 'Rock & Roll Hits')
    assert.equal(rows[1].size, Math.round(700.5 * 1024 ** 2))
    assert.equal(parseBitSearch('<html>nothing here</html>').length, 0)
  })

  it('requests the music listing once and offers more pages', async () => {
    stub([[/bitsearch\.to\/search/, html(BS_LISTING)]])
    const paged = await bitsearch.search({ query: 'adele', page: 2, options: {} })
    assert.deepEqual(
      requests.map(r => r.url),
      ['https://bitsearch.to/search?q=adele&page=2&category=7&sortBy=relevance']
    )
    assert.ok(!Array.isArray(paged))
    assert.equal(paged.hasMore, true)
    assert.equal(paged.results.length, 2)
    assert.equal(paged.results[0].link, `magnet:?xt=urn:btih:${HASH}&dn=Adele`)
    assert.equal(paged.results[0].artist, 'Adele')
    assert.equal(paged.results[0].size, Math.round(1.2 * 1024 ** 3))
    assert.deepEqual(paged.results[0].tags, ['FLAC'])
  })

  it('defaults to page 1, stops at page 20 and skips blank queries', async () => {
    stub([[/bitsearch\.to\/search/, html(BS_LISTING)]])
    await bitsearch.search({ query: 'adele', options: {} })
    assert.match(requests[0].url, /&page=1&/)
    const last = await bitsearch.search({ query: 'adele', page: 20, options: {} })
    assert.ok(!Array.isArray(last))
    assert.equal(last.hasMore, false)
    requests.length = 0
    assert.deepEqual(await bitsearch.search({ query: '  ', options: {} }), [])
    assert.equal(requests.length, 0)
  })

  it('reports a bot check', async () => {
    stub([[/bitsearch\.to/, html('<title>Just a moment...</title>', 503)]])
    await assert.rejects(bitsearch.search({ query: 'adele', options: {} }), /bot check/)
  })

  it('self-test fails when the page has no torrents', async () => {
    stub([[/bitsearch\.to/, html('<html>redesigned</html>')]])
    await assert.rejects(bitsearch.test?.({ options: {} }), /no torrents/)
    stub([[/bitsearch\.to/, html(BS_LISTING)]])
    assert.equal(await bitsearch.test?.({ options: {} }), true)
  })

  it('declares its mirror list', () => {
    assert.deepEqual(BITSEARCH_MIRRORS, ['bitsearch.to'])
  })
})

// RuTracker's markup below is written from memory of the site, not copied from it.
const RT_LOGIN = `<html><body><form id="login-form-full" action="login.php" method="post">
<input type="text" name="login_username" /><input type="password" name="login_password" /></form></body></html>`
const RT_LISTING = `<table id="tor-tbl">
<tr class="tCenter hl-tr"><td class="row1 f-name-col"><div class="wbr"><a class="gen f" href="tracker.php?f=409">Зарубежный Rock (Lossless)</a></div></td>
<td class="row4 med tLeft t-title-col"><div class="wbr t-title"><a data-topic_id="111" class="med tLink bold" href="viewtopic.php?t=111">Coldplay - Parachutes - 2000, FLAC (tracks+.cue), lossless</a></div></td>
<td class="row4 small nowrap tor-size" data-ts_text="327155712"><a class="small f-dl dl-stub" href="dl.php?t=111">312&nbsp;MB &#8595;</a></td>
<td class="row4 nowrap" data-ts_text="154"><b class="seedmed">154</b></td><td class="row4 leechmed bold">7</td></tr>
<tr class="tCenter hl-tr"><td class="row1 f-name-col"><div class="wbr"><a class="gen f" href="tracker.php?f=1008">Игры для PC</a></div></td>
<td class="row4 med tLeft t-title-col"><div class="wbr t-title"><a data-topic_id="222" class="med tLink bold" href="viewtopic.php?t=222">Coldplay Fan Game</a></div></td>
<td class="row4 small nowrap tor-size"><a class="small f-dl dl-stub" href="dl.php?t=222">1.5&nbsp;GB &#8595;</a></td>
<td class="row4 nowrap"><b class="seedmed">3</b></td><td class="row4 leechmed bold">1</td></tr>
</table>`
const RT_TOPIC = (hash: string) =>
  `<a class="med magnet-link-16" href="magnet:?xt=urn:btih:${hash}&amp;tr=http%3A%2F%2Fbt.t-ru.org%2Fann%3Fmagnet">Magnet</a>`
/** The site sends windows-1251: the characters these fixtures use, as the bytes it would send. */
function toCp1251(text: string): Uint8Array {
  return Uint8Array.from(text, char => {
    const code = char.charCodeAt(0)
    if (code < 0x80) return code
    if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0
    return code === 0x401 ? 0xa8 : code === 0x451 ? 0xb8 : 0x3f
  })
}
const rt = (body: string) => () => new Response(toCp1251(body))
const cp1251 =
  (...bytes: number[]) =>
  () =>
    new Response(new Uint8Array(bytes))

describe('RuTracker', () => {
  const signedIn = { username: 'me', password: 'p@ss', mirror: '' }

  it('reads the listing: music forums, sizes, seeders', () => {
    const rows = parseRuTracker(RT_LISTING)
    assert.equal(rows.length, 2)
    assert.deepEqual(rows[0], {
      id: '111',
      title: 'Coldplay - Parachutes - 2000, FLAC (tracks+.cue), lossless',
      forum: 'Зарубежный Rock (Lossless)',
      size: 327155712,
      seeders: 154,
      leechers: 7
    })
    // No exact byte count on the second row: the size comes from the text.
    assert.equal(rows[1].size, Math.round(1.5 * 1024 ** 3))
    assert.equal(isMusicForum(rows[0].forum), true)
    assert.equal(isMusicForum(rows[1].forum), false)
    assert.equal(isMusicForum('Jazz and Blues (MP3)'), true)
    assert.equal(isMusicForum('Классическая и современная академическая музыка (Lossless)'), true)
    assert.equal(isMusicForum('Фильмы и сериалы'), false)
    assert.equal(
      parseRuTrackerMagnet(RT_TOPIC(HASH)),
      `magnet:?xt=urn:btih:${HASH}&tr=http%3A%2F%2Fbt.t-ru.org%2Fann%3Fmagnet`
    )
    assert.equal(isLoginPage(RT_LOGIN), true)
    assert.equal(isLoginPage(RT_LISTING), false)
  })

  it('writes text the way the site reads it: windows-1251, percent-encoded', () => {
    assert.equal(percentEncodeCp1251('Привет Ёж'), '%CF%F0%E8%E2%E5%F2+%A8%E6')
    assert.equal(percentEncodeCp1251('Beyoncé & Jay-Z'), 'Beyonce+%26+Jay-Z')
    assert.equal(percentEncodeCp1251('日本'), '%3F%3F')
    assert.equal(loginBody('me', 'p@ss word'), 'login_username=me&login_password=p%40ss+word&login=%C2%F5%EE%E4')
  })

  it('decodes windows-1251 pages', async () => {
    // "Музыка" as windows-1251 bytes.
    stub([[/page$/, cp1251(0xcc, 0xf3, 0xe7, 0xfb, 0xea, 0xe0)]])
    assert.equal(await getText('https://rutracker.org/page', 'RuTracker', undefined, 'windows-1251'), 'Музыка')
  })

  it('signs in when the site asks, then searches and takes magnets from the music topics', async () => {
    let tracker = 0
    stub([
      [/login\.php$/, html('<html>Welcome back</html>')],
      [
        /tracker\.php/,
        () => {
          tracker++
          return new Response(toCp1251(tracker === 1 ? RT_LOGIN : RT_LISTING))
        }
      ],
      [/viewtopic\.php\?t=111$/, rt(RT_TOPIC(HASH))]
    ])
    const results = await list(rutracker.search({ query: 'Coldplay Parachutes', options: signedIn }))
    assert.deepEqual(
      requests.map(r => `${r.init?.method ?? 'GET'} ${r.url}`),
      [
        'GET https://rutracker.org/forum/tracker.php?nm=Coldplay+Parachutes&o=10&s=2',
        'POST https://rutracker.org/forum/login.php',
        'GET https://rutracker.org/forum/tracker.php?nm=Coldplay+Parachutes&o=10&s=2',
        'GET https://rutracker.org/forum/viewtopic.php?t=111'
      ]
    )
    assert.equal(requests[1].init?.body, 'login_username=me&login_password=p%40ss&login=%C2%F5%EE%E4')
    // The games topic was left out and never fetched.
    assert.equal(results.length, 1)
    assert.equal(results[0].artist, 'Coldplay')
    assert.equal(results[0].seeders, 154)
    assert.deepEqual(results[0].tags?.slice(0, 2), ['FLAC', 'Lossless'])
    assert.match(results[0].link ?? '', new RegExp(`^magnet:\\?xt=urn:btih:${HASH}`))
  })

  it('keeps every forum when music-only is off, and skips signing in when already signed in', async () => {
    stub([
      [/tracker\.php/, rt(RT_LISTING)],
      [/viewtopic\.php\?t=111$/, rt(RT_TOPIC(HASH))],
      [/viewtopic\.php\?t=222$/, rt(RT_TOPIC(HASH2))]
    ])
    const results = await list(rutracker.search({ query: 'coldplay', options: { ...signedIn, musicOnly: false } }))
    assert.equal(results.length, 2)
    assert.ok(requests.every(r => !r.url.includes('login.php')))
  })

  it('says what went wrong: no details, a wrong password, a captcha, a changed layout', async () => {
    await assert.rejects(
      list(rutracker.search({ query: 'x', options: { username: '', password: '' } })),
      /Enter your RuTracker username and password/
    )
    assert.equal(requests.length, 0)

    stub([[/./, rt(RT_LOGIN)]])
    await assert.rejects(list(rutracker.search({ query: 'x', options: signedIn })), /didn’t accept that username/)
    stub([[/./, rt(`${RT_LOGIN}<input name="cap_sid" value="1">`)]])
    await assert.rejects(list(rutracker.search({ query: 'x', options: signedIn })), /captcha/)

    stub([[/./, html('<html><body>nothing here</body></html>')]])
    await assert.rejects(rutracker.test?.({ options: signedIn }) ?? Promise.resolve(), /layout may have changed/)
    await assert.rejects(
      rutracker.test?.({ options: { ...signedIn, mirror: 'evil.example' } }) ?? Promise.resolve(),
      /isn’t one of this plugin’s mirrors/
    )
  })
})

// Rutor's markup below is written from memory of the site, not copied from it.
const RUTOR_LISTING = `<table width="100%">
<tr><td class="header">Добавлен</td><td class="header">Название</td><td class="header">Размер</td><td class="header">Пиры</td></tr>
<tr class="gai"><td>01&nbsp;Ноя&nbsp;25</td>
<td ><a class="downgif" href="/download/1234567"><img src="/s/d.gif" alt="D" /></a><a href="magnet:?xt=urn:btih:${HASH}&amp;dn=rutor.info&amp;tr=udp://opentor.net:6969"><img src="/s/m.gif" alt="M" /></a><a href="/torrent/1234567/coldplay-parachutes-2000-flac">(Rock) Coldplay - Parachutes (2000) FLAC</a></td>
<td align="right">312.12&nbsp;MB</td>
<td align="center"><span class="green"><img src="/s/s.gif" alt="S" />&nbsp;154</span>&nbsp;<span class="red">7</span></td></tr>
<tr class="tum"><td>28&nbsp;Окт&nbsp;25</td>
<td ><a class="downgif" href="/download/7654321"><img src="/s/d.gif" alt="D" /></a><a href="magnet:?xt=urn:btih:${HASH2}&amp;dn=rutor.info"><img src="/s/m.gif" alt="M" /></a><a href="/torrent/7654321/adele-30">Adele - 30 (2021) MP3 320 &amp; extras</a></td>
<td align="right">12<img src="/s/c.gif" alt="C" /></td><td align="right">1.5&nbsp;GB</td>
<td align="center"><span class="green"><img src="/s/s.gif" alt="S" />&nbsp;9</span>&nbsp;<span class="red">0</span></td></tr>
<tr class="tum"><td>20&nbsp;Окт&nbsp;25</td><td><a href="/torrent/555/no-magnet-here">Row without a magnet</a></td><td align="right">1 GB</td><td></td></tr>
<tr class="tum"><td>20&nbsp;Окт&nbsp;25</td>
<td ><a href="magnet:?xt=urn:btih:${HASH}&amp;dn=again"><img src="/s/m.gif" alt="M" /></a><a href="/torrent/1234567/coldplay-parachutes-2000-flac">Same torrent listed again</a></td>
<td align="right">1 MB</td><td></td></tr>
</table>`

describe('Rutor', () => {
  it('reads rows: magnet, title, size (even after a comments cell), seeders, leechers', () => {
    const rows = parseRutor(RUTOR_LISTING)
    assert.deepEqual(rows, [
      {
        id: '1234567',
        title: '(Rock) Coldplay - Parachutes (2000) FLAC',
        magnet: `magnet:?xt=urn:btih:${HASH}&dn=rutor.info&tr=udp://opentor.net:6969`,
        size: Math.round(312.12 * 1024 ** 2),
        seeders: 154,
        leechers: 7
      },
      {
        id: '7654321',
        title: 'Adele - 30 (2021) MP3 320 & extras',
        magnet: `magnet:?xt=urn:btih:${HASH2}&dn=rutor.info`,
        size: Math.round(1.5 * 1024 ** 3),
        seeders: 9,
        leechers: 0
      }
    ])
    assert.deepEqual(parseRutor('<html>nothing</html>'), [])
  })

  it('searches the music category, most seeded first, in one request', async () => {
    stub([[/rutor\.is\/search\//, html(RUTOR_LISTING)]])
    const results = await list(rutor.search({ query: 'Coldplay Parachutes', options: { mirror: 'rutor.is' } }))
    assert.deepEqual(
      requests.map(r => r.url),
      ['https://rutor.is/search/0/2/000/2/Coldplay%20Parachutes']
    )
    assert.equal(results.length, 2)
    assert.equal(results[0].artist, 'Coldplay')
    assert.equal(results[0].title, 'Parachutes')
    assert.equal(results[0].year, '2000')
    assert.deepEqual(results[0].tags, ['FLAC'])
    assert.equal(results[0].seeders, 154)
    assert.match(results[0].link ?? '', new RegExp(`^magnet:\\?xt=urn:btih:${HASH}&dn=rutor\\.info`))
    assert.equal(results[1].year, '2021')
    assert.deepEqual(results[1].tags, ['MP3', '320'])
    assert.equal(searchPath('a b/c'), '/search/0/2/000/2/a%20b%2Fc')
  })

  it('uses the first mirror by default, ignores empty searches, and only accepts declared mirrors', async () => {
    stub([[/./, html(RUTOR_LISTING)]])
    await list(rutor.search({ query: 'adele', options: {} }))
    assert.match(requests[0].url, /^https:\/\/rutor\.info\/search\//)
    assert.deepEqual(await list(rutor.search({ query: '  ', options: {} })), [])
    assert.equal(requests.length, 1)
    await assert.rejects(
      rutor.search({ query: 'x', options: { mirror: 'evil.example' } }),
      /isn’t one of this plugin’s mirrors/
    )
  })

  it('says what went wrong: a bot check, a changed layout', async () => {
    stub([[/./, html('<html>Checking your browser… ddos-guard</html>', 403)]])
    await assert.rejects(rutor.search({ query: 'adele', options: {} }), /bot check/)
    stub([[/./, html('<html><body>nothing here</body></html>')]])
    await assert.rejects(rutor.test?.({ options: {} }) ?? Promise.resolve(), /layout may have changed/)
    stub([[/./, html(RUTOR_LISTING)]])
    assert.equal(await rutor.test?.({ options: {} }), true)
  })
})
