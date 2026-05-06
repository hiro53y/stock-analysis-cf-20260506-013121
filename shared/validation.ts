import { z } from 'zod'
import type { AnalysisRequestPayload, MarketCode } from './types'

export const analysisRequestSchema = z
  .object({
    symbol: z
      .string()
      .trim()
      .min(1, '銘柄コードを入力してください。')
      .max(16, '銘柄コードが長すぎます。')
      .regex(/^[A-Za-z0-9.^-]+$/, '銘柄コードの形式が正しくありません。'),
    market: z.enum(['auto', 'JP', 'US']).default('auto'),
    buyThreshold: z.number().min(0.5).max(0.95),
    sellThreshold: z.number().min(0.05).max(0.5),
  })
  .refine((value) => value.buyThreshold > value.sellThreshold, {
    message: '買い閾値は売り閾値より大きくしてください。',
    path: ['buyThreshold'],
  })

export function parseAnalysisRequest(value: unknown): AnalysisRequestPayload {
  return analysisRequestSchema.parse(value)
}

export function normalizeMarketInput(value: string | null | undefined): MarketCode {
  if (value === 'JP' || value === 'US') return value
  return 'auto'
}

export function validateSymbolInput(symbol: string): boolean {
  return analysisRequestSchema.shape.symbol.safeParse(symbol).success
}
