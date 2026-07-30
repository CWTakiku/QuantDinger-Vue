/**
 * Survives route changes so an in-flight backtest/factor-research HTTP call
 * is not tied to the BacktestCenter component instance.
 */

let session = createIdleSession()

function createIdleSession () {
  return {
    id: 0,
    mode: null,
    running: false,
    startedAt: 0,
    promise: null,
    result: null,
    error: null,
    formSnapshot: null,
    controller: null,
    cancelled: false
  }
}

export function getBacktestRunSession () {
  return session
}

export function isBacktestRunActive () {
  return Boolean(session.running && session.promise)
}

export function isBacktestRunCancelled (error) {
  if (session.cancelled) return true
  if (!error) return false
  if (error.code === 'ERR_CANCELED' || error.name === 'CanceledError' || error.name === 'AbortError') {
    return true
  }
  const message = String(error.message || '')
  return /cancel|abort/i.test(message)
}

export function startBacktestRunSession ({ mode, runner, formSnapshot }) {
  if (typeof runner !== 'function') {
    throw new Error('backtestRunSession.runnerRequired')
  }
  if (session.running && session.promise) {
    return session
  }
  const id = Number(session.id || 0) + 1
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  session = {
    id,
    mode: mode === 'factor' ? 'factor' : 'portfolio',
    running: true,
    startedAt: Date.now(),
    promise: null,
    result: null,
    error: null,
    formSnapshot: formSnapshot || null,
    controller,
    cancelled: false
  }
  session.promise = Promise.resolve()
    .then(() => runner(controller && controller.signal))
    .then((result) => {
      if (session.id !== id) return result
      if (session.cancelled) {
        const abortError = new Error('backtestRunSession.cancelled')
        abortError.code = 'ERR_CANCELED'
        abortError.name = 'CanceledError'
        throw abortError
      }
      session.result = result
      session.error = null
      session.running = false
      return result
    })
    .catch((error) => {
      if (session.id !== id) throw error
      session.error = error
      session.result = null
      session.running = false
      throw error
    })
  return session
}

export function stopBacktestRunSession (id) {
  if (!session.running) return false
  if (id && session.id !== id) return false
  session.cancelled = true
  if (session.controller) {
    try {
      session.controller.abort()
    } catch (e) { /* noop */ }
  }
  return true
}

export function clearBacktestRunSession (id) {
  if (id && session.id !== id) return
  session = createIdleSession()
}
