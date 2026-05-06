import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildInitialForm, fetchAnalysisStatus, loadLastResult, persistLastResult, startAnalysis } from './api'

describe('api helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('API エラー時に status 付き ApiError を投げる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: '見つかりません。' }),
      }),
    )

    await expect(fetchAnalysisStatus('missing-job')).rejects.toMatchObject({
      message: '見つかりません。',
      status: 404,
    })
  })

  it('startAnalysis は legacy な id フィールドを analysisId に正規化する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'analysis-legacy', status: 'queued', cached: false }),
      }),
    )

    await expect(
      startAnalysis({
        symbol: '7203',
        market: 'auto',
        buyThreshold: 0.6,
        sellThreshold: 0.4,
      }),
    ).resolves.toEqual({
      analysisId: 'analysis-legacy',
      status: 'queued',
      cached: false,
    })
  })

  it('startAnalysis は completed result をそのまま正規化する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          analysisId: 'analysis-1',
          status: 'completed',
          cached: false,
          result: {
            analysisId: 'analysis-1',
            request: {
              symbol: '7203',
              market: 'auto',
              buyThreshold: 0.6,
              sellThreshold: 0.4,
            },
            generatedAt: '2026-04-18T00:00:00.000Z',
            symbol: '7203',
            normalizedSymbol: '7203.T',
            companyName: 'トヨタ自動車',
            market: 'JP',
            latestDataDate: '2026-04-17T00:00:00.000Z',
            finalSignal: 'BUY',
            finalSignalLabel: '買い',
            upProbability: 0.7,
            expectedReturn: 0.04,
            agreementScore: 0.6,
            recentBacktestScore: 0.59,
            summaryCards: [],
            priceSeries: [],
            forecastSeries: [],
            modelResults: [],
            backtestSummary: [],
            backtestFolds: {},
            featureImportance: [],
            localContributions: [],
            rationale: [],
            riskFlags: [],
            progressSteps: [],
          },
        }),
      }),
    )

    await expect(
      startAnalysis({
        symbol: '7203',
        market: 'auto',
        buyThreshold: 0.6,
        sellThreshold: 0.4,
      }),
    ).resolves.toMatchObject({
      analysisId: 'analysis-1',
      status: 'completed',
      cached: false,
      result: {
        analysisId: 'analysis-1',
        companyName: 'トヨタ自動車',
      },
    })
  })

  it('startAnalysis レスポンスに analysisId が無いと raw payload をログして失敗する', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'queued', cached: false }),
      }),
    )

    await expect(
      startAnalysis({
        symbol: '7203',
        market: 'auto',
        buyThreshold: 0.6,
        sellThreshold: 0.4,
      }),
    ).rejects.toMatchObject({
      message: '分析開始レスポンスに analysisId がありません。',
      status: 500,
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'analysisId missing in startAnalysis response',
      { status: 'queued', cached: false },
    )
  })

  it('fetchAnalysisStatus は analysisId を path と query の両方へ載せる', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'queued',
        progress: 10,
        progressMessage: '分析中です。',
        cached: false,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchAnalysisStatus('analysis-1')

    expect(fetchMock).toHaveBeenCalledWith('/api/analyses/analysis-1?analysisId=analysis-1', undefined)
  })

  it('Storage が使えない環境でも結果保存で落ちない', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    expect(() =>
      persistLastResult({
        analysisId: 'analysis-1',
        request: {
          symbol: '7203',
          market: 'auto',
          buyThreshold: 0.6,
          sellThreshold: 0.4,
        },
        generatedAt: '2026-04-18T00:00:00.000Z',
        symbol: '7203',
        normalizedSymbol: '7203.T',
        companyName: 'トヨタ自動車',
        market: 'JP',
        latestDataDate: '2026-04-17T00:00:00.000Z',
        finalSignal: 'BUY',
        finalSignalLabel: '買い',
        upProbability: 0.7,
        expectedReturn: 0.04,
        agreementScore: 0.6,
        recentBacktestScore: 0.59,
        summaryCards: [],
        priceSeries: [],
        forecastSeries: [],
        modelResults: [],
        backtestSummary: [],
        backtestFolds: {},
        featureImportance: [],
        localContributions: [],
        rationale: [],
        riskFlags: [],
        progressSteps: [],
      }),
    ).not.toThrow()
  })

  it('Storage が読めない環境では null を返す', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })

    expect(loadLastResult()).toBeNull()
  })

  it('壊れた保存済み結果は破棄して null を返す', () => {
    localStorage.setItem('stock-analysis:last-result', JSON.stringify({
      generatedAt: 123,
      companyName: 'broken payload',
    }))

    expect(loadLastResult()).toBeNull()
    expect(localStorage.getItem('stock-analysis:last-result')).toBeNull()
  })

  it('保存済み結果があれば初期フォームへ復元する', () => {
    localStorage.setItem('stock-analysis:last-result', JSON.stringify({
      analysisId: 'analysis-5451',
      request: {
        symbol: '5451',
        market: 'JP',
        buyThreshold: 0.7,
        sellThreshold: 0.3,
      },
      generatedAt: '2026-04-18T00:00:00.000Z',
      symbol: '5451',
      normalizedSymbol: '5451.T',
      companyName: '淀川製鋼所',
      market: 'JP',
      latestDataDate: '2026-04-17T00:00:00.000Z',
      finalSignal: 'WATCH',
      finalSignalLabel: '様子見',
      upProbability: 0.52,
      expectedReturn: 0.01,
      agreementScore: 0.55,
      recentBacktestScore: 0.57,
      summaryCards: [],
      priceSeries: [],
      forecastSeries: [],
      modelResults: [],
      backtestSummary: [],
      backtestFolds: {},
      featureImportance: [],
      localContributions: [],
      rationale: [],
      riskFlags: [],
      progressSteps: [],
    }))

    expect(buildInitialForm()).toEqual({
      symbol: '5451',
      market: 'JP',
      buyThreshold: 0.7,
      sellThreshold: 0.3,
    })
  })
})
