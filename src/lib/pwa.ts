export async function registerServiceWorker(): Promise<void> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !import.meta.env.PROD
  ) {
    return
  }

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })
}
