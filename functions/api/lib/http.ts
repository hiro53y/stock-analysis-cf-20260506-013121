export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

export function errorResponse(message: string, status = 400, details?: unknown): Response {
  return jsonResponse({ error: message, details }, status)
}

export class HttpError extends Error {
  status: number
  details?: unknown

  constructor(message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.details = details
  }
}

export function errorResponseFromUnknown(
  error: unknown,
  fallbackMessage: string,
  fallbackStatus = 500,
): Response {
  if (error instanceof HttpError) {
    return errorResponse(error.message, error.status, error.details)
  }
  if (error instanceof Error) {
    return errorResponse(error.message, fallbackStatus)
  }
  return errorResponse(fallbackMessage, fallbackStatus)
}

/**
 * 外部サイトが返したHTTPステータスを取り出す。
 *
 * 呼び出し側にとって「404＝そのページが存在しない」と「500＝取得に失敗した」は意味が違う。
 * HttpError は利用者へ返すステータス（502など）に正規化してしまうため、
 * 上流の生のステータスは details に残しておく。
 */
export function upstreamStatusOf(error: unknown): number | undefined {
  if (!(error instanceof HttpError)) return undefined
  const details = error.details as { upstreamStatus?: unknown } | undefined
  return typeof details?.upstreamStatus === 'number' ? details.upstreamStatus : undefined
}

export function getClientIp(request: Request): string {
  const cfConnecting = request.headers.get('cf-connecting-ip')
  if (cfConnecting) return cfConnecting

  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()

  return 'anonymous'
}
