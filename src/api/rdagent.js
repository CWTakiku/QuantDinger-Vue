import request from '@/utils/request'

/** Import can rewrite 10万+ score rows; allow long-running upsert. */
const IMPORT_TIMEOUT_MS = 600000

export function fetchRdagentStatus () {
  return request({ url: '/api/rdagent/status', method: 'get' })
}

export function fetchRdagentJobs () {
  return request({ url: '/api/rdagent/jobs', method: 'get' })
}

export function startRdagentJob (data) {
  return request({ url: '/api/rdagent/jobs', method: 'post', data })
}

export function stopRdagentJob (id) {
  return request({ url: `/api/rdagent/jobs/${id}/stop`, method: 'post' })
}

export function fetchRdagentJobLogs (id, params) {
  return request({ url: `/api/rdagent/jobs/${id}/logs`, method: 'get', params })
}

export function fetchRdagentSessions () {
  return request({ url: '/api/rdagent/sessions', method: 'get' })
}

export function deleteRdagentSession (id) {
  return request({ url: `/api/rdagent/sessions/${encodeURIComponent(id)}`, method: 'delete' })
}

export function fetchRdagentDataSources () {
  return request({ url: '/api/rdagent/data-sources', method: 'get' })
}

export function fetchRdagentLlmSync () {
  return request({ url: '/api/rdagent/llm-sync', method: 'get' })
}

export function startRdagentUi () {
  return request({ url: '/api/rdagent/ui/start', method: 'post' })
}

export function importFromSession (data) {
  return request({
    url: '/api/rdagent/import-from-session',
    method: 'post',
    data,
    timeout: IMPORT_TIMEOUT_MS
  })
}

export function fetchSessionDetail (id, include) {
  return request({
    url: `/api/rdagent/sessions/${encodeURIComponent(id)}/detail`,
    method: 'get',
    params: include ? { include } : undefined,
    timeout: 60000
  })
}

export function downloadSessionMetricsCsv (id) {
  return request({
    url: `/api/rdagent/sessions/${encodeURIComponent(id)}/metrics.csv`,
    method: 'get',
    responseType: 'blob',
    timeout: 60000
  })
}
