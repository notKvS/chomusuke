// Where a chart can be looked at: a country, or a language standing in for the country where it's most listened to
// (the chart sources publish per-country lists, not per-language ones).

export interface Country {
  /** Two-letter ISO code, lower case */
  code: string
  name: string
}

export interface Language {
  id: string
  name: string
  /** The country whose chart is mostly in this language */
  country: string
}

export const COUNTRIES: readonly Country[] = [
  { code: 'ar', name: 'Argentina' },
  { code: 'au', name: 'Australia' },
  { code: 'br', name: 'Brazil' },
  { code: 'ca', name: 'Canada' },
  { code: 'cl', name: 'Chile' },
  { code: 'co', name: 'Colombia' },
  { code: 'dk', name: 'Denmark' },
  { code: 'eg', name: 'Egypt' },
  { code: 'fi', name: 'Finland' },
  { code: 'fr', name: 'France' },
  { code: 'de', name: 'Germany' },
  { code: 'hk', name: 'Hong Kong' },
  { code: 'in', name: 'India' },
  { code: 'id', name: 'Indonesia' },
  { code: 'ie', name: 'Ireland' },
  { code: 'it', name: 'Italy' },
  { code: 'jp', name: 'Japan' },
  { code: 'ke', name: 'Kenya' },
  { code: 'my', name: 'Malaysia' },
  { code: 'mx', name: 'Mexico' },
  { code: 'nl', name: 'Netherlands' },
  { code: 'nz', name: 'New Zealand' },
  { code: 'ng', name: 'Nigeria' },
  { code: 'no', name: 'Norway' },
  { code: 'pk', name: 'Pakistan' },
  { code: 'ph', name: 'Philippines' },
  { code: 'pl', name: 'Poland' },
  { code: 'pt', name: 'Portugal' },
  { code: 'sa', name: 'Saudi Arabia' },
  { code: 'sg', name: 'Singapore' },
  { code: 'za', name: 'South Africa' },
  { code: 'kr', name: 'South Korea' },
  { code: 'es', name: 'Spain' },
  { code: 'se', name: 'Sweden' },
  { code: 'tw', name: 'Taiwan' },
  { code: 'th', name: 'Thailand' },
  { code: 'tr', name: 'Türkiye' },
  { code: 'ae', name: 'United Arab Emirates' },
  { code: 'gb', name: 'United Kingdom' },
  { code: 'us', name: 'United States' },
  { code: 'vn', name: 'Vietnam' }
]

export const LANGUAGES: readonly Language[] = [
  { id: 'arabic', name: 'Arabic', country: 'sa' },
  { id: 'english', name: 'English', country: 'us' },
  { id: 'french', name: 'French', country: 'fr' },
  { id: 'german', name: 'German', country: 'de' },
  { id: 'hindi', name: 'Hindi', country: 'in' },
  { id: 'indonesian', name: 'Indonesian', country: 'id' },
  { id: 'italian', name: 'Italian', country: 'it' },
  { id: 'japanese', name: 'Japanese', country: 'jp' },
  { id: 'korean', name: 'Korean', country: 'kr' },
  { id: 'portuguese', name: 'Portuguese', country: 'br' },
  { id: 'spanish', name: 'Spanish', country: 'mx' },
  { id: 'thai', name: 'Thai', country: 'th' },
  { id: 'turkish', name: 'Turkish', country: 'tr' },
  { id: 'vietnamese', name: 'Vietnamese', country: 'vn' }
]

/** What a chart is asked for: nothing for its own default, "" for worldwide, or a two-letter country code. */
const COUNTRY_CODE = /^[a-z]{2}$/

/** A region from the renderer: a country code, or "" when the chart has a worldwide list (`worldwide`). */
export function parseRegion(value: unknown, worldwide: boolean): string | undefined {
  if (value === undefined || value === null) return undefined
  if (value === '' && worldwide) return ''
  if (typeof value === 'string' && COUNTRY_CODE.test(value) && COUNTRIES.some(c => c.code === value)) return value
  return undefined
}
