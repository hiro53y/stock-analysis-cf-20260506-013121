const CACHE_NAME = 'stock-analysis-shell-v3'
const APP_SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.svg', '/icons/icon-512.svg']
const ASSET_LINK_PATTERN = /(?:src|href)=["']([^"']+)["']/g

function isSameOrigin(url) {
  return url.origin === self.location.origin
}

function isApiRequest(url) {
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/functions/')
}

function isNavigationRequest(request) {
  return request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')
}

function normalizeSameOriginPath(entry) {
  try {
    const url = new URL(entry, self.location.origin)
    if (!isSameOrigin(url)) {
      return null
    }

    return `${url.pathname}${url.search}`
  } catch {
    return null
  }
}

async function warmAppShell(cache) {
  const response = await fetch('/', { cache: 'no-cache' })
  const html = await response.text()
  const discoveredAssets = Array.from(html.matchAll(ASSET_LINK_PATTERN))
    .map(([, assetPath]) => normalizeSameOriginPath(assetPath))
    .filter((assetPath) => assetPath && assetPath !== '/')

  const shellEntries = Array.from(new Set([...APP_SHELL, ...discoveredAssets]))
  await cache.addAll(shellEntries)
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      warmAppShell(cache).catch(() => cache.addAll(APP_SHELL)),
    ),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key)
          }
          return Promise.resolve(false)
        }),
      ),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return
  }

  const url = new URL(event.request.url)
  if (!isSameOrigin(url) || isApiRequest(url)) {
    return
  }

  if (isNavigationRequest(event.request)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
          }
          return response
        })
        .catch(async () => {
          const cached = await caches.match(event.request)
          return cached ?? caches.match('/')
        }),
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached
      return fetch(event.request).then((response) => {
        if (!response.ok || !response.url.startsWith(self.location.origin)) {
          return response
        }
        const copy = response.clone()
        void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
        return response
      })
    }),
  )
})
