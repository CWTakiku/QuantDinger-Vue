import { timestampMillisecondsUtc } from './utcInstant.js'

const TIMEFRAME_ALIASES = {
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1H',
  '4h': '4H',
  '1d': '1D',
  '1w': '1W'
}

const TIMEFRAME_MILLISECONDS = {
  '1m': 60 * 1000,
  '3m': 3 * 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1H': 60 * 60 * 1000,
  '4H': 4 * 60 * 60 * 1000,
  '1D': 24 * 60 * 60 * 1000,
  '1W': 7 * 24 * 60 * 60 * 1000
}

const REVIEW_TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1H', '4H', '1D', '1W']

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value))

export const normalizeReviewTimeframe = (value) => {
  const normalized = String(value || '1d').trim().toLowerCase()
  return TIMEFRAME_ALIASES[normalized] || normalized
}

/** Normalize CNStock:600030@spot / CNStock:600030 → CNStock:600030 */
export const normalizeInstrumentKey = (raw) => {
  const text = String(raw || '').trim()
  if (!text) return ''
  const colon = text.indexOf(':')
  const market = colon > -1 ? text.slice(0, colon) : ''
  const rest = colon > -1 ? text.slice(colon + 1) : text
  const at = rest.lastIndexOf('@')
  const symbol = (at > -1 ? rest.slice(0, at) : rest).trim()
  if (!market) return symbol.toUpperCase()
  return `${market}:${symbol}`.toUpperCase()
}

export const collectTradesForSymbol = (trades, symbol) => {
  const key = normalizeInstrumentKey(symbol)
  if (!key) return []
  return (Array.isArray(trades) ? trades : [])
    .filter(item => normalizeInstrumentKey(item && item.symbol) === key)
    .slice()
    .sort((left, right) => {
      const a = timestampMillisecondsUtc(left.entry_time) || 0
      const b = timestampMillisecondsUtc(right.entry_time) || 0
      if (a !== b) return a - b
      return (timestampMillisecondsUtc(left.exit_time) || 0) - (timestampMillisecondsUtc(right.exit_time) || 0)
    })
}

export const collectExecutionsForSymbol = (executions, symbol) => {
  const key = normalizeInstrumentKey(symbol)
  if (!key) return []
  return (Array.isArray(executions) ? executions : [])
    .filter(item => normalizeInstrumentKey(item && item.symbol) === key)
    .slice()
    .sort((left, right) => {
      const a = timestampMillisecondsUtc(left.time || left.fill_time || left.signal_time) || 0
      const b = timestampMillisecondsUtc(right.time || right.fill_time || right.signal_time) || 0
      return a - b
    })
}

/** Slightly separate markers that share the same bar so labels don't stack invisibly. */
export const staggerMarkerPrice = (price, indexInBucket, bucketSize) => {
  const base = Number(price)
  if (!Number.isFinite(base) || bucketSize <= 1) return base
  const centered = indexInBucket - (bucketSize - 1) / 2
  const step = Math.max(Math.abs(base) * 0.012, 0.01)
  return base + centered * step
}

export const calculateTradeValueUsd = (trade = {}) => {
  const explicitValue = Number(trade.value_usd ?? trade.entry_notional ?? trade.notional)
  if (Number.isFinite(explicitValue)) return Math.abs(explicitValue)

  const quantity = Number(trade.quantity)
  const entryPrice = Number(trade.entry_price)
  if (!Number.isFinite(quantity) || !Number.isFinite(entryPrice)) return null
  return Math.abs(quantity * entryPrice)
}

export const resolveTradeReviewTimeframe = (trade = {}, timeframeValue = '1D', maxBars = 1000) => {
  const requested = normalizeReviewTimeframe(timeframeValue)
  const startIndex = REVIEW_TIMEFRAMES.indexOf(requested)
  const normalized = startIndex >= 0 ? requested : '1D'
  const entryTime = timestampMillisecondsUtc(trade.entry_time)
  const exitTime = timestampMillisecondsUtc(trade.exit_time)
  if (entryTime === null || exitTime === null) return normalized

  const duration = Math.abs(exitTime - entryTime)
  const limit = Math.max(180, Number(maxBars) || 1000)
  const candidates = REVIEW_TIMEFRAMES.slice(Math.max(0, REVIEW_TIMEFRAMES.indexOf(normalized)))
  for (const timeframe of candidates) {
    const interval = TIMEFRAME_MILLISECONDS[timeframe]
    const tradeBars = Math.max(1, Math.ceil(duration / interval) + 1)
    const paddingBars = clamp(Math.ceil(tradeBars * 0.75), 60, 180)
    if (tradeBars + paddingBars * 2 <= limit) return timeframe
  }
  return REVIEW_TIMEFRAMES[REVIEW_TIMEFRAMES.length - 1]
}

export const buildTradeReviewWindow = (trade = {}, timeframeValue = '1D') => {
  const entryTime = timestampMillisecondsUtc(trade.entry_time)
  const exitTime = timestampMillisecondsUtc(trade.exit_time)
  return buildTradeReviewWindowFromSpan(entryTime, exitTime, timeframeValue)
}

export const buildTradeReviewWindowFromSpan = (entryTime, exitTime, timeframeValue = '1D') => {
  const timeframe = normalizeReviewTimeframe(timeframeValue)
  const interval = TIMEFRAME_MILLISECONDS[timeframe] || TIMEFRAME_MILLISECONDS['1D']
  if (!Number.isFinite(entryTime) || !Number.isFinite(exitTime)) {
    return { beforeTime: null, limit: 480, entryTime, exitTime }
  }

  const start = Math.min(entryTime, exitTime)
  const end = Math.max(entryTime, exitTime)
  const tradeBars = Math.max(1, Math.ceil((end - start) / interval) + 1)
  const paddingBars = clamp(Math.ceil(tradeBars * 0.75), 60, 180)
  const limit = clamp(tradeBars + paddingBars * 2, 180, 1000)
  const beforeTime = Math.floor((end + paddingBars * interval) / 1000)

  return { beforeTime, limit, entryTime: start, exitTime: end }
}

export const buildSymbolTradesReviewWindow = (trades = [], timeframeValue = '1D', executions = []) => {
  const times = []
  for (const trade of trades) {
    const entry = timestampMillisecondsUtc(trade.entry_time)
    const exit = timestampMillisecondsUtc(trade.exit_time)
    if (Number.isFinite(entry)) times.push(entry)
    if (Number.isFinite(exit)) times.push(exit)
  }
  for (const execution of executions) {
    const filled = timestampMillisecondsUtc(execution.time || execution.fill_time || execution.signal_time)
    if (Number.isFinite(filled)) times.push(filled)
  }
  if (!times.length) {
    return buildTradeReviewWindowFromSpan(null, null, timeframeValue)
  }
  return buildTradeReviewWindowFromSpan(Math.min(...times), Math.max(...times), timeframeValue)
}

export const findNearestBarIndex = (rows, targetTimestamp) => {
  if (!Array.isArray(rows) || !rows.length || !Number.isFinite(targetTimestamp)) return -1
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY
  rows.forEach((row, index) => {
    const distance = Math.abs(Number(row.timestamp) - targetTimestamp)
    if (Number.isFinite(distance) && distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  })
  return bestIndex
}
