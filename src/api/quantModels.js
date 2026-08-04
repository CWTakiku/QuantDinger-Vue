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
    url: '/api/quant-models',
    method: 'get',
    params
  })
}
