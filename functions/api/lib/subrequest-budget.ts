import { SUBREQUEST_BUDGET, SUBREQUEST_COST_PER_FETCH } from '../../../shared/constants'
import { HttpError } from './http'

/**
 * Cloudflare Workers の subrequest 上限に当たる前に、自分で取得を打ち切るためのカウンタ。
 *
 * 上限（無料プラン 50）を超えると Cloudflare 側で例外が発生し、
 * ハンドラ全体が 502 になって「候補を取得できませんでした」しか出せなくなる。
 * それより、予算を使い切った時点で取得をやめ、集まった分を部分結果として返す方がよい。
 *
 * 外部取得 1 件のコストは fetch + Cache API の match/put で 3 と数える。
 */
export class SubrequestBudget {
  private used = 0
  private readonly limit: number

  constructor(limit: number = SUBREQUEST_BUDGET) {
    this.limit = limit
  }

  get spent(): number {
    return this.used
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.used)
  }

  canAfford(cost: number = SUBREQUEST_COST_PER_FETCH): boolean {
    return this.used + cost <= this.limit
  }

  /** 予算内なら消費して true。足りなければ消費せず false。 */
  trySpend(cost: number = SUBREQUEST_COST_PER_FETCH): boolean {
    if (!this.canAfford(cost)) return false
    this.used += cost
    return true
  }

  /** 予算内なら消費、足りなければ BudgetExhaustedError を投げる。 */
  spend(cost: number = SUBREQUEST_COST_PER_FETCH): void {
    if (!this.trySpend(cost)) {
      throw new BudgetExhaustedError()
    }
  }

  /** この予算で実行できる外部取得の残り回数。 */
  affordableFetches(cost: number = SUBREQUEST_COST_PER_FETCH): number {
    return Math.floor(this.remaining / cost)
  }
}

export class BudgetExhaustedError extends HttpError {
  constructor() {
    super('1リクエストあたりの外部取得上限に達したため、取得を打ち切りました。', 503)
    this.name = 'BudgetExhaustedError'
  }
}

export function isBudgetExhausted(error: unknown): boolean {
  return error instanceof BudgetExhaustedError
}
