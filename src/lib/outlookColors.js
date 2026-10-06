// Graph defines color families, not exact RGB values; Outlook clients vary.
// Keep the Outlook-style palette here, in Microsoft's documented preset order:
// https://learn.microsoft.com/en-us/graph/api/resources/outlookcategory?view=graph-rest-1.0
export const OUTLOOK_CATEGORY_PRESET_HEX = Object.freeze({
  preset0: '#e74856', // Red
  preset1: '#ff8c00', // Orange
  preset2: '#a47a3c', // Brown
  preset3: '#ffeb3b', // Yellow
  preset4: '#78b833', // Green
  preset5: '#00aba9', // Teal
  preset6: '#a3b367', // Olive
  preset7: '#0078d4', // Blue
  preset8: '#8764b8', // Purple
  preset9: '#c239b3', // Cranberry
  preset10: '#a0aeb2', // Steel
  preset11: '#5d6b6d', // Dark steel
  preset12: '#bfbfbf', // Gray
  preset13: '#666666', // Dark gray
  preset14: '#262626', // Black
  preset15: '#a4262c', // Dark red
  preset16: '#ca5010', // Dark orange
  preset17: '#7a5c2e', // Dark brown
  preset18: '#b7a200', // Dark yellow
  preset19: '#0b6a0b', // Dark green
  preset20: '#038387', // Dark teal
  preset21: '#6b7d2c', // Dark olive
  preset22: '#004e8c', // Dark blue
  preset23: '#5c2d91', // Dark purple
  preset24: '#8e236b', // Dark cranberry
})

const CALENDAR_COLOR_HEX = Object.freeze({
  lightBlue: '#cfe2f3', lightGreen: '#d9ead3', lightOrange: '#fce5cd',
  lightGray: '#e7e6e6', lightYellow: '#fff2cc', lightTeal: '#d0e0e3',
  lightPink: '#ead1dc', lightBrown: '#ddc3a5', lightRed: '#f4cccc',
})

// Only opaque RGB colors may cross the Graph/cache/rendering boundaries.
export function normalizeColorHex(value) {
  if (typeof value !== 'string') return null
  const hex = value.trim().replace(/^#/, '')
  if (/^[\da-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`
  if (/^[\da-f]{3}$/i.test(hex)) return `#${[...hex].map((part) => part + part).join('').toLowerCase()}`
  return null
}

export function outlookCategoryColors(categories) {
  return new Map(categories.filter((category) => typeof category.displayName === 'string').map((category) => [
    category.displayName,
    normalizeColorHex(category.color) || OUTLOOK_CATEGORY_PRESET_HEX[String(category.color).toLowerCase()] || null,
  ]))
}

export function outlookEventColor(event, categoryColors, calendar = null) {
  for (const name of event.categories || []) {
    const color = normalizeColorHex(categoryColors.get(name))
    if (color) return color
  }
  return normalizeColorHex(calendar?.hexColor) || normalizeColorHex(CALENDAR_COLOR_HEX[calendar?.color])
}

export function outlookEventStyle(colorHex) {
  const backgroundColor = normalizeColorHex(colorHex)
  if (!backgroundColor) return {} // Retain the existing timed/all-day CSS defaults.
  const channels = backgroundColor.slice(1).match(/../g).map((hex) => {
    const value = parseInt(hex, 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  // Choose whichever gives greater WCAG contrast (at least 4.5:1).
  const color = (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff'
  return { backgroundColor, color }
}
