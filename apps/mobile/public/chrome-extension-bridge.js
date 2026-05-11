(() => {
  const STORAGE_KEY = 'documind:pendingChromeImport'

  function writePayload(payload) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: STORAGE_KEY,
          newValue: JSON.stringify(payload),
          storageArea: window.localStorage,
          url: window.location.href
        })
      )
      return true
    } catch {
      return false
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    const data = event.data
    if (!data || data.type !== 'DOCUMIND_IMPORT_FROM_EXTENSION' || !data.payload) return
    const ok = writePayload(data.payload)
    window.postMessage(
      {
        type: 'DOCUMIND_IMPORT_ACK',
        ok
      },
      window.location.origin
    )
  })
})()
