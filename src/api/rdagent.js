import request from '@/utils/request'

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
  return request({ url: '/api/rdagent/import-from-session', method: 'post', data })
}
