import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_SECONDS } from '../../../shared/constants'
import type { Env } from './env'
import { HttpError } from './http'
import { getGenericStoreValue, setGenericStoreValue } from './store'

interface RateLimitBucket {
  count: number
  createdAt: string
}

/**
 * 固定ウィンドウの簡易レート制限。
 *
 * 既知の限界: 読み取り→加算→書き戻しの間に他のリクエストが割り込むと計数が漏れる。
 * KV は結果整合性なので、同一 IP からの同時アクセスでは上限を超えて通ることがある。
 * つまり「厳しすぎて正当な利用を弾く」方向ではなく「緩む」方向に倒れる設計。
 * 濫用を厳密に止めたい場合は Cloudflare 側の Rate Limiting ルールを使うこと。
 */
export async function enforceRateLimit(
  env: Env,
  path: string,
  clientId: string,
): Promise<void> {
  const bucketWindow = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SECONDS * 1000))
  const key = `${path}:${clientId}:${bucketWindow}`
  const current = await getGenericStoreValue<RateLimitBucket>(env, 'rate-limit', key)

  if (current && current.count >= RATE_LIMIT_MAX_REQUESTS) {
    throw new HttpError('アクセスが集中しています。少し待ってから再度お試しください。', 429)
  }

  await setGenericStoreValue<RateLimitBucket>(
    env,
    'rate-limit',
    key,
    {
      count: (current?.count ?? 0) + 1,
      createdAt: current?.createdAt ?? new Date().toISOString(),
    },
    RATE_LIMIT_WINDOW_SECONDS * 2,
  )
}
