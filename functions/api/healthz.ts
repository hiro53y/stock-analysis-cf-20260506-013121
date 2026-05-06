import type { Env } from './lib/env'
import { jsonResponse } from './lib/http'
import { probeStorage } from './lib/store'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env } = context
  const kvAvailable = Boolean(env.ANALYSIS_KV)

  // KV が未バインドの場合、probeStorage はメモリ fallback で成功してしまい
  // ok: true を返すが実際には KV が使えない状態なので、ここで明示的に失敗扱いにする
  if (!kvAvailable) {
    const payload = {
      ok: false,
      env: { runtime: 'cloudflare-pages' },
      cloudflare: { kvAvailable: false, backgroundProcessing: false },
      storage: {
        ok: false,
        backgroundProcessing: false,
        error: 'ANALYSIS_KV binding が設定されていません。wrangler.toml の KV ID を確認してください。',
      },
      cache: { cacheApi: typeof caches !== 'undefined' },
    }
    return jsonResponse(payload, 503)
  }

  const storage = await probeStorage(env)

  const payload = {
    ok: storage.ok,
    env: {
      runtime: 'cloudflare-pages',
    },
    cloudflare: {
      kvAvailable,
      backgroundProcessing: false,
    },
    storage: {
      ok: storage.ok,
      backgroundProcessing: false,
      error: storage.error,
    },
    cache: {
      cacheApi: typeof caches !== 'undefined',
    },
  }

  return jsonResponse(payload, storage.ok ? 200 : 503)
}
