import request from '@/utils/request'

export function publishQuantModel (data) {
  return request({
    url: '/api/quant-models/publish',
    method: 'post',
    data
  })
}

export function fetchQuantModels (params) {
  return request({
    // Trailing slash required: Flask list route is `/` under `/api/quant-models`.
    // Without it, 308 Location drops the UI port (→ :80) and axios shows Network Error.
    url: '/api/quant-models/',
    method: 'get',
    params
  })
}

export function fetchQuantModel (modelKey) {
  return request({
    url: `/api/quant-models/${encodeURIComponent(modelKey)}`,
    method: 'get'
  })
}

export function ensureQuantModelScores (modelKey, data) {
  return request({
    url: `/api/quant-models/${encodeURIComponent(modelKey)}/ensure-scores`,
    method: 'post',
    data,
    timeout: 300000
  })
}
