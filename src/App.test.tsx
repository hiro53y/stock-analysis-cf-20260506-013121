import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalysisResult, MarketDataResponse } from '../shared/types'

const apiMocks = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    status: number

    constructor(message: string, status: number) {
      super(message)
      this.name = 'ApiError'
      this.status = status
    }
  },
  buildInitialForm: vi.fn(),
  fetchAnalysisStatus: vi.fn(),
  fetchMarketPreview: vi.fn(),
  loadLastResult: vi.fn(),
  persistLastResult: vi.fn(),
  startAnalysis: vi.fn(),
}))

vi.mock('./lib/api', () => apiMocks)

import App from './App'

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  })
}

function createPreview(): MarketDataResponse {
  return {
    symbol: '7203',
    normalizedSymbol: '7203.T',
    companyName: 'トヨタ自動車',
    market: 'JP',
    latestDate: '2026-04-16T00:00:00.000Z',
    rows: [],
  }
}

function createResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  const base: AnalysisResult = {
    analysisId: 'analysis-1',
    request: {
      symbol: '7203',
      market: 'auto',
      buyThreshold: 0.6,
      sellThreshold: 0.4,
    },
    generatedAt: '2026-04-16T12:00:00.000Z',
    symbol: '7203',
    normalizedSymbol: '7203.T',
    companyName: 'トヨタ自動車',
    market: 'JP',
    latestDataDate: '2026-04-15T00:00:00.000Z',
    finalSignal: 'BUY',
    finalSignalLabel: '買い',
    upProbability: 0.71,
    expectedReturn: 0.043,
    agreementScore: 0.64,
    recentBacktestScore: 0.61,
    summaryCards: [
      {
        id: 'signal',
        label: '最終判定',
        value: '買い',
        subText: 'テスト結果',
        tone: 'positive',
      },
    ],
    priceSeries: [],
    forecastSeries: [],
    modelResults: [],
    backtestSummary: [
      {
        modelId: 'baseline',
        label: 'ベースライン',
        directionalAccuracy: 0.61,
        maeReturn: 0.02,
        recentScore: 0.61,
        foldCount: 5,
      },
    ],
    backtestFolds: {
      baseline: [],
    },
    featureImportance: [],
    localContributions: [],
    rationale: ['テスト理由'],
    riskFlags: [],
    progressSteps: [],
  }

  return {
    ...base,
    ...overrides,
    request: {
      ...base.request,
      ...(overrides.request ?? {}),
    },
  }
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    setNavigatorOnline(true)
    apiMocks.buildInitialForm.mockReturnValue({
      symbol: '7203',
      market: 'auto',
      buyThreshold: 0.6,
      sellThreshold: 0.4,
    })
    apiMocks.fetchMarketPreview.mockResolvedValue(createPreview())
    apiMocks.loadLastResult.mockReturnValue(null)
    apiMocks.persistLastResult.mockImplementation(() => undefined)
    apiMocks.startAnalysis.mockResolvedValue({
      analysisId: 'analysis-1',
      status: 'queued',
      cached: false,
    })
    apiMocks.fetchAnalysisStatus.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('初期メッセージを表示する', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: '株式意思決定支援アプリ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '分析を実行' })).toBeInTheDocument()
  })

  it('状態取得が一時失敗しても再試行して完了結果を反映する', async () => {
    const user = userEvent.setup()
    const result = createResult()

    apiMocks.fetchAnalysisStatus
      .mockRejectedValueOnce(new Error('一時的に取得できませんでした。'))
      .mockResolvedValueOnce({
        status: 'completed',
        progress: 100,
        progressMessage: '分析が完了しました。',
        cached: false,
        result,
      })

    render(<App />)

    await user.click(screen.getByRole('button', { name: '分析を実行' }))

    await waitFor(() => {
      expect(apiMocks.fetchAnalysisStatus).toHaveBeenCalledTimes(1)
      expect(apiMocks.fetchAnalysisStatus).toHaveBeenCalledWith('analysis-1')
      expect(screen.getByText('一時的に取得できませんでした。')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(apiMocks.fetchAnalysisStatus).toHaveBeenCalledTimes(2)
    }, { timeout: 3500 })
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '株式意思決定支援アプリ' })).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.queryByText('一時的に取得できませんでした。')).not.toBeInTheDocument()
    })
  })

  it('保存済み結果があってもタイトルは固定表示のまま', () => {
    const savedResult = createResult({
      analysisId: 'analysis-5451',
      request: {
        symbol: '5451',
        market: 'JP',
        buyThreshold: 0.7,
        sellThreshold: 0.3,
      },
      symbol: '5451',
      normalizedSymbol: '5451.T',
      companyName: '淀川製鋼所',
    })
    apiMocks.buildInitialForm.mockReturnValue(savedResult.request)
    apiMocks.loadLastResult.mockReturnValue(savedResult)

    render(<App />)

    expect(screen.getByRole('heading', { name: '株式意思決定支援アプリ' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('5451')).toBeInTheDocument()
    expect(screen.getByDisplayValue('JP')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '淀川製鋼所 / 5451.T' })).not.toBeInTheDocument()
  })

  it('404 の終端エラーでは再試行を止めて error 状態にする', async () => {
    const user = userEvent.setup()

    apiMocks.fetchAnalysisStatus.mockRejectedValueOnce(
      new apiMocks.ApiError('指定された分析ジョブが見つかりません。', 404),
    )

    render(<App />)

    await user.click(screen.getByRole('button', { name: '分析を実行' }))

    await waitFor(() => {
      expect(screen.getByText('指定された分析ジョブが見つかりません。')).toBeInTheDocument()
      expect(screen.getByText('分析状態の取得を終了しました。')).toBeInTheDocument()
    })

    await new Promise((resolve) => window.setTimeout(resolve, 2500))
    expect(apiMocks.fetchAnalysisStatus).toHaveBeenCalledTimes(1)
  })

  it('オンライン時は保存済み結果があってもオフラインバナーを出さない', () => {
    apiMocks.loadLastResult.mockReturnValue(createResult())

    render(<App />)

    expect(screen.queryByText('直近成功結果を表示中')).not.toBeInTheDocument()
  })

  it('オフライン時のみ保存済み結果バナーを表示する', async () => {
    apiMocks.loadLastResult.mockReturnValue(createResult())

    render(<App />)

    act(() => {
      setNavigatorOnline(false)
      window.dispatchEvent(new Event('offline'))
    })

    await waitFor(() => {
      expect(screen.getByText('直近成功結果を表示中')).toBeInTheDocument()
    })
  })

  it('再分析開始時に古い結果パネルを消してから新しい状態を待つ', async () => {
    const user = userEvent.setup()
    const savedResult = createResult({
      companyName: '保存済み結果株式会社',
      normalizedSymbol: '5451.T',
      symbol: '5451',
      request: {
        symbol: '5451',
        market: 'auto',
        buyThreshold: 0.6,
        sellThreshold: 0.4,
      },
    })
    apiMocks.buildInitialForm.mockReturnValue(savedResult.request)
    apiMocks.loadLastResult.mockReturnValue(savedResult)
    apiMocks.fetchAnalysisStatus.mockResolvedValue({
      status: 'running',
      progress: 10,
      progressMessage: '分析中です。',
      cached: false,
    })

    render(<App />)

    expect(screen.getByText('保存済み結果株式会社')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '分析を実行' }))

    await waitFor(() => {
      expect(screen.queryByText('保存済み結果株式会社')).not.toBeInTheDocument()
      expect(screen.getByText('分析中です。')).toBeInTheDocument()
    })
  })

  it('分析開始レスポンスに analysisId が無い場合はポーリングせずエラーにする', async () => {
    const user = userEvent.setup()
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    apiMocks.startAnalysis.mockResolvedValue({
      analysisId: '',
      status: 'queued',
      cached: false,
    })

    render(<App />)

    await user.click(screen.getByRole('button', { name: '分析を実行' }))

    await waitFor(() => {
      expect(screen.getByText('分析開始レスポンスに analysisId がありません。')).toBeInTheDocument()
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'analysisId missing after startAnalysis',
      expect.objectContaining({
        analysisId: '',
        status: 'queued',
        cached: false,
      }),
    )
    expect(apiMocks.fetchAnalysisStatus).not.toHaveBeenCalled()
  })

  it('running が続きすぎる場合はタイムアウトで停止する', async () => {
    vi.spyOn(window, 'setTimeout').mockImplementation(((callback: TimerHandler) => {
      if (typeof callback === 'function') {
        callback()
      }
      return 0 as ReturnType<typeof window.setTimeout>
    }) as typeof window.setTimeout)
    vi.spyOn(window, 'clearTimeout').mockImplementation(() => undefined)

    apiMocks.fetchAnalysisStatus.mockResolvedValue({
      status: 'running',
      progress: 50,
      progressMessage: '分析を継続しています。',
      cached: false,
    })

    render(<App />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '分析を実行' }))
    })

    expect(screen.getByText('分析がタイムアウトしました。しばらく待ってから再度お試しください。')).toBeInTheDocument()
  })

  it('開始レスポンスに completed result が含まれる場合はポーリングせず即時反映する', async () => {
    const user = userEvent.setup()
    apiMocks.startAnalysis.mockResolvedValue({
      analysisId: 'analysis-inline',
      status: 'completed',
      cached: false,
      result: createResult({
        analysisId: 'analysis-inline',
        companyName: '即時完了銘柄',
        normalizedSymbol: 'INLINE.T',
      }),
    })

    render(<App />)

    await user.click(screen.getByRole('button', { name: '分析を実行' }))

    await waitFor(() => {
      expect(screen.getByText('即時完了銘柄')).toBeInTheDocument()
    })
    expect(apiMocks.fetchAnalysisStatus).not.toHaveBeenCalled()
  })
})
