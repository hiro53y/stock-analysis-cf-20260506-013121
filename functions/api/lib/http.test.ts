import { describe, expect, it } from 'vitest'
import { HttpError, upstreamStatusOf } from './http'

describe('upstreamStatusOf', () => {
  it('外部サイトが返したステータスを取り出す', () => {
    // 404（そのページが存在しない）と 500（取得に失敗した）を呼び出し側で区別するため
    const error = new HttpError('データ取得に失敗しました。HTTP 404', 502, { upstreamStatus: 404 })
    expect(upstreamStatusOf(error)).toBe(404)
  })

  it('上流ステータスを持たないエラーでは undefined', () => {
    expect(upstreamStatusOf(new HttpError('boom', 502))).toBeUndefined()
    expect(upstreamStatusOf(new Error('boom'))).toBeUndefined()
    expect(upstreamStatusOf(null)).toBeUndefined()
  })
})
