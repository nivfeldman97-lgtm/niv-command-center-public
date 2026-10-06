import test from 'node:test'
import assert from 'node:assert/strict'
import { OUTLOOK_CATEGORY_PRESET_HEX, normalizeColorHex, outlookCategoryColors, outlookEventColor, outlookEventStyle } from '../src/lib/outlookColors.js'
import { normalizeGraphEvents, normalizeCachedEvents, eventCacheRow } from '../src/lib/microsoftModels.js'
import { fetchMicrosoftSnapshot } from '../src/lib/graph.js'

const masterCategories = [
  { displayName: 'Personal', color: 'preset8' },
  { displayName: 'Work', color: 'preset0' },
  { displayName: 'No color', color: 'none' },
  { displayName: 'Future color', color: 'preset99' },
  { displayName: 'Direct hex', color: '#ABCDEF' },
]
const colors = outlookCategoryColors(masterCategories)
const calendar = { id: 'default', hexColor: '#00ABa9', color: 'lightRed' }
const raw = { id: 'event', subject: 'Meeting', categories: ['Personal'], start: { dateTime: '2026-09-15T10:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-09-15T11:00:00', timeZone: 'UTC' } }
const range = { start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z' }

test('recognized category wins over calendar color; original category names remain intact', () => {
  const before = structuredClone(masterCategories)
  assert.equal(normalizeGraphEvents([raw], colors, calendar)[0].colorHex, '#8764b8')
  assert.equal(outlookEventColor({ categories: ['Direct hex'] }, colors, calendar), '#abcdef')
  assert.deepEqual(masterCategories, before)
  assert.deepEqual(raw.categories, ['Personal'])
})

test('uncategorized or unusable categories fall back to calendar hex, then calendar enum', () => {
  for (const categories of [undefined, [], ['Missing'], ['No color', 'Future color']]) {
    assert.equal(outlookEventColor({ categories }, colors, calendar), '#00aba9')
    assert.equal(outlookEventColor({ categories }, colors, { hexColor: '', color: 'lightBlue' }), '#cfe2f3')
  }
})

test('no usable category/calendar retains current CSS fallback; auto is not a color', () => {
  for (const metadata of [null, {}, { hexColor: '', color: 'auto' }, { hexColor: 'invalid', color: 'maxColor' }]) {
    const color = outlookEventColor({ categories: ['No color', 'Missing'] }, colors, metadata)
    assert.equal(color, null)
    assert.deepEqual(outlookEventStyle(color), {})
  }
})

test('multiple categories choose the first recognized color in event order', () => {
  assert.equal(outlookEventColor({ categories: ['Missing', 'No color', 'Future color', 'Work', 'Personal'] }, colors, calendar), '#e74856')
  assert.equal(outlookEventColor({ categories: ['Personal', 'Work'] }, colors, calendar), '#8764b8')
})

test('cache round trip retains final color without any Microsoft metadata or session', () => {
  const event = normalizeGraphEvents([raw], colors, calendar)[0]
  const row = eventCacheRow(event)
  assert.equal(row.color_hex, '#8764b8')
  assert.deepEqual(normalizeCachedEvents([row])[0], event)
  assert.equal(outlookEventStyle(normalizeCachedEvents([row])[0].colorHex).backgroundColor, '#8764b8')
})

test('null, absent and invalid legacy cache colors use existing defaults', () => {
  for (const color_hex of [undefined, null, '', 'transparent', 'url(https://invalid.test)', '#abcd']) {
    const event = normalizeCachedEvents([{ color_hex }])[0]
    assert.equal(event.colorHex, null)
    assert.deepEqual(outlookEventStyle(event.colorHex), {})
    assert.equal(eventCacheRow(event).color_hex, null)
  }
  assert.equal(normalizeColorHex('ABC'), '#aabbcc')
  assert.equal(normalizeColorHex(' #ABCDEF '), '#abcdef')
})

test('all 25 Outlook presets produce readable text with at least 4.5:1 contrast', () => {
  assert.equal(Object.keys(OUTLOOK_CATEGORY_PRESET_HEX).length, 25)
  for (let index = 0; index < 25; index++) {
    const value = outlookCategoryColors([{ displayName: 'Test', color: `Preset${index}` }]).get('Test')
    assert.match(value, /^#[0-9a-f]{6}$/)
    const style = outlookEventStyle(value)
    const rgb = [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255)
    const linear = rgb.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    const lum = linear.reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
    const contrast = style.color === '#000000' ? (lum + 0.05) / 0.05 : 1.05 / (lum + 0.05)
    assert.ok(contrast >= 4.5, `${value}: ${contrast}`)
  }
  assert.equal(outlookEventStyle('#ffffff').color, '#000000')
  assert.equal(outlookEventStyle('#000000').color, '#ffffff')
})

function graphFixture(events, { paginated = false, fail = '' } = {}) {
  const calls = []
  const fetcher = async (url, options) => {
    const { pathname, searchParams } = new URL(url)
    calls.push({ pathname, searchParams, method: options.method })
    if (pathname === fail) return new Response('', { status: 403 })
    if (pathname === '/v1.0/me/todo/lists') return Response.json({ value: [] })
    if (pathname === '/v1.0/me/calendarView') return Response.json({ value: events.slice(0, 1), '@odata.nextLink': 'https://graph.microsoft.com/v1.0/events-page-2' })
    if (pathname === '/v1.0/events-page-2') return Response.json({ value: events.slice(1) })
    if (pathname === '/v1.0/me/outlook/masterCategories') return Response.json(paginated
      ? { value: masterCategories.slice(1), '@odata.nextLink': 'https://graph.microsoft.com/v1.0/categories-page-2' }
      : { value: masterCategories })
    if (pathname === '/v1.0/categories-page-2') return Response.json({ value: masterCategories.slice(0, 1) })
    if (pathname === '/v1.0/me/calendar') return Response.json(calendar)
    throw new Error(`Unexpected Graph request: ${pathname}`)
  }
  return { calls, fetcher }
}

test('paginated events reuse one complete category list and one default calendar lookup', async () => {
  const events = [raw, ...Array.from({ length: 40 }, (_, index) => ({ ...raw, id: `event-${index}`, categories: [] }))]
  const { calls, fetcher } = graphFixture(events, { paginated: true })
  const snapshot = await fetchMicrosoftSnapshot('test-token', range, undefined, fetcher)
  assert.equal(snapshot.events.length, 41)
  assert.equal(snapshot.events[0].colorHex, '#8764b8')
  assert.ok(snapshot.events.slice(1).every((event) => event.colorHex === '#00aba9'))
  assert.equal(calls.filter((call) => call.pathname === '/v1.0/me/outlook/masterCategories').length, 1)
  assert.equal(calls.filter((call) => call.pathname === '/v1.0/categories-page-2').length, 1)
  assert.equal(calls.filter((call) => call.pathname === '/v1.0/me/calendar').length, 1)
  assert.ok(calls.every((call) => call.method === 'GET'))
  assert.equal(calls.find((call) => call.pathname === '/v1.0/me/calendar').searchParams.get('$select'), 'id,hexColor,color')
})

test('calendar metadata is skipped when categories cover events, or calendar is empty/cancelled', async () => {
  for (const rows of [[raw], [], [{ ...raw, categories: [], isCancelled: true }]]) {
    const { calls, fetcher } = graphFixture(rows)
    await fetchMicrosoftSnapshot('test-token', range, undefined, fetcher)
    assert.equal(calls.filter((call) => call.pathname === '/v1.0/me/calendar').length, 0)
    assert.equal(calls.filter((call) => call.pathname === '/v1.0/me/outlook/masterCategories').length, 1)
  }
})

test('metadata errors reject a partial sync so previously cached colors are not overwritten', async () => {
  for (const fail of ['/v1.0/me/outlook/masterCategories', '/v1.0/me/calendar', '/v1.0/categories-page-2']) {
    const { fetcher } = graphFixture([{ ...raw, categories: [] }], { fail, paginated: true })
    await assert.rejects(fetchMicrosoftSnapshot('test-token', range, undefined, fetcher), /403/)
  }
})

test('each sync refreshes colors so renamed categories, palette changes and account changes cannot leak stale metadata', async () => {
  const first = graphFixture([raw])
  assert.equal((await fetchMicrosoftSnapshot('first-account-token', range, undefined, first.fetcher)).events[0].colorHex, '#8764b8')
  const second = graphFixture([{ ...raw, categories: ['Unknown in second account'] }])
  assert.equal((await fetchMicrosoftSnapshot('second-account-token', range, undefined, second.fetcher)).events[0].colorHex, '#00aba9')
  assert.equal(second.calls.filter((call) => call.pathname === '/v1.0/me/outlook/masterCategories').length, 1)
})
