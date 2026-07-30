/**
 * Format trading symbols for A-share friendly display.
 * Prefers backend enrichments: displaySymbol / name.
 */
export function formatSymbolDisplay (symbol, record) {
  const row = record && typeof record === 'object' ? record : null
  if (row && row.displaySymbol) return row.displaySymbol
  const raw = String(symbol || '').trim()
  if (!raw) return '-'
  const primary = raw.split('::')[0]
  const code = primary.includes(':') ? primary.split(':').slice(1).join(':') : primary
  if (row && row.name) return `${row.name} (${code || primary})`
  return code || primary
}

export function formatMoneyCny (value, { digits = 2, signed = false } = {}) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '-'
  const abs = Math.abs(number).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })
  if (signed) {
    const sign = number > 0 ? '+' : number < 0 ? '-' : ''
    return `${sign}¥${abs}`
  }
  return `¥${abs}`
}
