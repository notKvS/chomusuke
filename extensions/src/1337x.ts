// 1337x: HTML scraping of the Music category. Search pages list no info hashes, so the top rows' detail pages
// are fetched for their magnet links. 1337x often sits behind Cloudflare; if the self-test reports a bot
// check, pick another mirror or reach it through a Torznab indexer that can pass the check.
// Template: off by default and not tested against the live site.
import type { Extension, TorrentResult } from "./sdk.ts";
import {
	cleanQuery,
	elements,
	getText,
	mapLimit,
	parseCount,
	parseRelease,
	parseSize,
	siteOrigin,
	stripTags,
} from "./lib/torrent-kit.ts";

/** Must match "hosts" in index.json. */
export const MIRRORS = [
	"1337x.to",
	"1337x.st",
	"x1337x.ws",
	"x1337x.eu",
	"x1337x.cc",
];
const SITE = "1337x";
/** Detail pages fetched per search (one request each). */
const RESOLVE = 15;

/** 1337x music sub-categories (/sub/<id>/) → tag. */
const SUBCATEGORIES: Record<string, string> = {
	"22": "MP3",
	"23": "Lossless",
	"24": "DVD",
	"25": "Video",
	"26": "Radio",
	"53": "Album",
	"58": "Box set",
	"59": "Discography",
	"60": "Single",
	"68": "Concert",
	"69": "AAC",
};

const BROWSE: Record<string, string> = {
	"popular-today": "/popular-music",
	"popular-week": "/popular-music-week",
	"top-100": "/top-100-music",
	latest: "/cat/Music/1/",
};

export interface Row {
	path: string;
	name: string;
	seeders?: number;
	leechers?: number;
	size?: number;
	sub?: string;
}

/** Rows of a 1337x listing table (search, category, popular and top-100 pages share the layout). */
export function parseListing(html: string): Row[] {
	return elements(html, "tr").flatMap((row) => {
		const link = /<a href="(\/torrent\/\d+\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(
			row,
		);
		if (!link) return [];
		const cell = (cls: string) =>
			new RegExp(
				`<td class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)</td>`,
				"i",
			).exec(row)?.[1];
		// The size cell also holds a hidden seed count: "1.2 GB<span class="seeds">12</span>".
		const sizeCell = cell("coll-4")?.replace(/<span[\s\S]*$/i, "");
		// Long names are shortened with "..." in the link text; the URL slug has the full name.
		let name = stripTags(link[2]);
		if (name.endsWith("..."))
			name =
				decodeURIComponent(link[1].split("/")[3] ?? "").replace(/-/g, " ") ||
				name;
		return [
			{
				path: link[1],
				name,
				seeders: parseCount(stripTags(cell("coll-2") ?? "")),
				leechers: parseCount(stripTags(cell("coll-3") ?? "")),
				size: sizeCell ? parseSize(stripTags(sizeCell)) : undefined,
				sub: /href="\/sub\/(\d+)\//i.exec(row)?.[1],
			},
		];
	});
}

/** The magnet link on a torrent's detail page. */
export function parseMagnet(html: string): string | undefined {
	const href = /href="(magnet:\?xt=urn:btih:[^"]+)"/i.exec(html)?.[1];
	return href?.replace(/&amp;/g, "&");
}

async function resolve(origin: string, rows: Row[]): Promise<TorrentResult[]> {
	return mapLimit(rows.slice(0, RESOLVE), 4, async (row) => {
		const link = parseMagnet(await getText(new URL(row.path, origin), SITE));
		if (!link) return undefined;
		const release = parseRelease(row.name);
		const sub = row.sub ? SUBCATEGORIES[row.sub] : undefined;
		return {
			...release,
			link,
			size: row.size,
			seeders: row.seeders,
			leechers: row.leechers,
			tags: [
				...new Set([...(sub ? [sub] : []), ...(release.tags ?? [])]),
			].slice(0, 4),
		};
	});
}

async function listing(origin: string, path: string): Promise<TorrentResult[]> {
	const rows = parseListing(await getText(new URL(path, origin), SITE));
	return resolve(origin, rows);
}

const extension: Extension = {
	async test({ options }) {
		const origin = siteOrigin(options, MIRRORS);
		if (
			parseListing(await getText(new URL(BROWSE.latest, origin), SITE))
				.length === 0
		) {
			throw new Error(
				"1337x answered, but the page had no torrents — the site layout may have changed.",
			);
		}
		return true;
	},

	async search({ query, options }) {
		const q = cleanQuery(query);
		if (!q) return [];
		const origin = siteOrigin(options, MIRRORS);
		return listing(
			origin,
			`/sort-category-search/${encodeURIComponent(q)}/Music/seeders/desc/1/`,
		);
	},

	async browse({ category, options }) {
		return listing(
			siteOrigin(options, MIRRORS),
			BROWSE[category] ?? BROWSE["popular-week"],
		);
	},
};

export default extension;
