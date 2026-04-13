const DATABASE_NAME = 'document-intelligence-workspace'
const UPDATES_STORE = 'workspace-updates'
const STATE_STORE = 'workspace-state'

function cloneForIndexedDb<T>(value: T): T {
  if (value instanceof Uint8Array) {
    return value.slice() as T
  }

  if (value instanceof ArrayBuffer) {
    return value.slice(0) as T
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneForIndexedDb(item)) as T
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value).map(([key, entry]) => [key, cloneForIndexedDb(entry)])
    return Object.fromEntries(entries) as T
  }

  return value
}

export async function openWorkspaceCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 2)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(UPDATES_STORE)) {
        database.createObjectStore(UPDATES_STORE)
      }
      if (!database.objectStoreNames.contains(STATE_STORE)) {
        database.createObjectStore(STATE_STORE)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function persistWorkspaceUpdate(workspaceId: string, update: Uint8Array) {
  const database = await openWorkspaceCache()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(UPDATES_STORE, 'readwrite')
    transaction.objectStore(UPDATES_STORE).put(update.slice(), workspaceId)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

export async function loadWorkspaceUpdate(workspaceId: string): Promise<Uint8Array | null> {
  const database = await openWorkspaceCache()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(UPDATES_STORE, 'readonly')
    const request = transaction.objectStore(UPDATES_STORE).get(workspaceId)
    request.onsuccess = () => resolve((request.result as Uint8Array | undefined) ?? null)
    request.onerror = () => reject(request.error)
  })
}

export async function persistWorkspaceState<T>(workspaceId: string, state: T) {
  const database = await openWorkspaceCache()
  const safeState = cloneForIndexedDb(state)
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STATE_STORE, 'readwrite')
    transaction.objectStore(STATE_STORE).put(safeState, workspaceId)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

export async function loadWorkspaceState<T>(workspaceId: string): Promise<T | null> {
  const database = await openWorkspaceCache()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STATE_STORE, 'readonly')
    const request = transaction.objectStore(STATE_STORE).get(workspaceId)
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null)
    request.onerror = () => reject(request.error)
  })
}
