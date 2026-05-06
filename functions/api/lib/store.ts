import { ANALYSIS_CACHE_TTL_SECONDS } from '../../../shared/constants'
import type { AnalysisJobRecord, AnalysisResult } from '../../../shared/types'
import type { Env } from './env'

// ──────────────────────────────────────────
// メモリ fallback（KV 未接続のユニットテスト用）
// ──────────────────────────────────────────
const _mem = new Map<string, string>()

function memGet<T>(key: string): T | null {
  const v = _mem.get(key)
  return v ? (JSON.parse(v) as T) : null
}
function memSet(key: string, value: unknown): void {
  _mem.set(key, JSON.stringify(value))
}
function memDel(key: string): void {
  _mem.delete(key)
}

// ──────────────────────────────────────────
// 内部 KV 操作ヘルパー
// ──────────────────────────────────────────
const JOB_TTL_SECONDS = 60 * 60 * 6    // 6 時間
const INFLIGHT_TTL_SECONDS = 60 * 10   // 10 分

async function getJson<T>(env: Env | undefined, ns: string, key: string): Promise<T | null> {
  const kvKey = `${ns}:${key}`
  if (env?.ANALYSIS_KV) {
    return env.ANALYSIS_KV.get<T>(kvKey, 'json')
  }
  return memGet<T>(kvKey)
}

async function setJson<T>(
  env: Env | undefined,
  ns: string,
  key: string,
  value: T,
  ttlSeconds?: number,
): Promise<void> {
  const kvKey = `${ns}:${key}`
  if (env?.ANALYSIS_KV) {
    const opts: KVNamespacePutOptions = ttlSeconds ? { expirationTtl: ttlSeconds } : {}
    await env.ANALYSIS_KV.put(kvKey, JSON.stringify(value), opts)
    return
  }
  memSet(kvKey, value)
}

async function deleteJson(env: Env | undefined, ns: string, key: string): Promise<void> {
  const kvKey = `${ns}:${key}`
  if (env?.ANALYSIS_KV) {
    await env.ANALYSIS_KV.delete(kvKey)
    return
  }
  memDel(kvKey)
}

// ──────────────────────────────────────────
// キャッシュ鮮度チェック
// ──────────────────────────────────────────
interface CachedAnalysisEnvelope {
  storedAt: string
  result: AnalysisResult
}

function isCachedAnalysisEnvelope(v: unknown): v is CachedAnalysisEnvelope {
  if (!v || typeof v !== 'object') return false
  const c = v as Partial<CachedAnalysisEnvelope>
  return typeof c.storedAt === 'string' && Boolean(c.result)
}

function isFreshTimestamp(value: string, ttlSeconds: number): boolean {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return false
  return Date.now() - parsed <= ttlSeconds * 1000
}

// ──────────────────────────────────────────
// 公開 API
// ──────────────────────────────────────────
export async function getJob(env: Env, analysisId: string): Promise<AnalysisJobRecord | null> {
  return getJson<AnalysisJobRecord>(env, 'jobs', analysisId)
}

export async function setJob(env: Env, job: AnalysisJobRecord): Promise<void> {
  await setJson(env, 'jobs', job.analysisId, job, JOB_TTL_SECONDS)
}

export async function updateJob(
  env: Env,
  analysisId: string,
  patch: Partial<AnalysisJobRecord>,
): Promise<AnalysisJobRecord | null> {
  const current = await getJob(env, analysisId)
  if (!current) return null
  const next: AnalysisJobRecord = { ...current, ...patch, updatedAt: new Date().toISOString() }
  await setJob(env, next)
  return next
}

export async function getCachedAnalysis(
  env: Env,
  cacheKey: string,
): Promise<AnalysisResult | null> {
  const cached = await getJson<AnalysisResult | CachedAnalysisEnvelope>(env, 'cache', cacheKey)
  if (!cached) return null

  const envelope = isCachedAnalysisEnvelope(cached)
    ? cached
    : {
        storedAt: (cached as AnalysisResult).generatedAt,
        result: cached as AnalysisResult,
      }

  const freshnessKey = envelope.result.generatedAt || envelope.storedAt
  if (!isFreshTimestamp(freshnessKey, ANALYSIS_CACHE_TTL_SECONDS)) {
    await deleteJson(env, 'cache', cacheKey).catch(() => {})
    return null
  }
  return envelope.result
}

export async function setCachedAnalysis(
  env: Env,
  cacheKey: string,
  result: AnalysisResult,
): Promise<void> {
  await setJson<CachedAnalysisEnvelope>(
    env,
    'cache',
    cacheKey,
    { storedAt: new Date().toISOString(), result },
    ANALYSIS_CACHE_TTL_SECONDS,
  )
}

export async function getInFlightAnalysis(env: Env, cacheKey: string): Promise<string | null> {
  return getJson<string>(env, 'inflight', cacheKey)
}

export async function setInFlightAnalysis(
  env: Env,
  cacheKey: string,
  analysisId: string,
): Promise<void> {
  await setJson(env, 'inflight', cacheKey, analysisId, INFLIGHT_TTL_SECONDS)
}

export async function clearInFlightAnalysis(env: Env, cacheKey: string): Promise<void> {
  await deleteJson(env, 'inflight', cacheKey)
}

export async function getGenericStoreValue<T>(
  env: Env,
  storeName: string,
  key: string,
): Promise<T | null> {
  return getJson<T>(env, storeName, key)
}

export async function setGenericStoreValue<T>(
  env: Env,
  storeName: string,
  key: string,
  value: T,
  ttlSeconds?: number,
): Promise<void> {
  await setJson(env, storeName, key, value, ttlSeconds)
}

export async function deleteGenericStoreValue(
  env: Env,
  storeName: string,
  key: string,
): Promise<void> {
  await deleteJson(env, storeName, key)
}

export async function probeStorage(env: Env): Promise<{
  ok: boolean
  backgroundProcessing: boolean
  error?: string
}> {
  const key = `healthz:${Date.now()}`
  try {
    await setGenericStoreValue(env, 'healthz-probe', key, { checkedAt: new Date().toISOString() }, 60)
    await getGenericStoreValue(env, 'healthz-probe', key)
    await deleteGenericStoreValue(env, 'healthz-probe', key)
    return { ok: true, backgroundProcessing: false }
  } catch (error) {
    return {
      ok: false,
      backgroundProcessing: false,
      error: error instanceof Error ? error.message : 'storage probe failed',
    }
  }
}
