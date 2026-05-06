// Cloudflare Pages Functions の環境変数バインディング定義
export interface Env {
  // KV Namespace（wrangler.toml の [[kv_namespaces]] で設定）
  ANALYSIS_KV: KVNamespace
}
