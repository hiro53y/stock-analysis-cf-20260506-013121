import { FEATURE_LABELS, SIGNAL_LABELS } from './constants'
import type { FinalSignal } from './types'

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function stdDev(values: number[]): number {
  if (values.length <= 1) return 0
  const avg = mean(values)
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

export function formatProbability(value: number): string {
  return `${(clamp(value, 0, 1) * 100).toFixed(1)}%`
}

export function formatReturn(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${(value * 100).toFixed(1)}%`
}

export function formatCompactNumber(value: number): string {
  return value.toLocaleString('ja-JP', { maximumFractionDigits: 0 })
}

export function formatDateLabel(date: string): string {
  const parsed = new Date(date)
  return `${parsed.getMonth() + 1}/${parsed.getDate()}`
}

export function formatSignal(signal: FinalSignal): string {
  return SIGNAL_LABELS[signal]
}

export function toFeatureLabel(feature: string): string {
  return FEATURE_LABELS[feature] ?? feature
}

export function hashKey(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `k${(hash >>> 0).toString(16)}`
}

export function createUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function nextBusinessDays(fromDate: string, count: number): string[] {
  const values: string[] = []
  const cursor = new Date(fromDate)

  while (values.length < count) {
    cursor.setDate(cursor.getDate() + 1)
    const weekday = cursor.getDay()
    if (weekday === 0 || weekday === 6) {
      continue
    }
    values.push(cursor.toISOString())
  }

  return values
}

export function toContributionDirection(score: number): 'positive' | 'negative' | 'neutral' {
  if (Math.abs(score) < 1e-6) return 'neutral'
  return score >= 0 ? 'positive' : 'negative'
}
