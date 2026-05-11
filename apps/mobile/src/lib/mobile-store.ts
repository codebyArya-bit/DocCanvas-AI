import type { Bookmark, CanvasEdge, CanvasNode, Document, Excerpt, PageAnchor } from '@workspace/domain'

const DATABASE_NAME = 'document-intelligence-mobile'
const DATABASE_VERSION = 3
const DOCUMENT_STORE = 'documents'
const FOLDER_STORE = 'folders'
const WORKSPACE_STORE = 'workspaces'

export const MOBILE_WORKSPACE_ID = 'workspace-mobile-local'

export type MobileDocumentSourceKind = 'pdf' | 'web-clean' | 'web-visual'

export interface MobileDocumentRecord {
  document: Document
  bytes?: Uint8Array
  sourceKind?: MobileDocumentSourceKind
  folderId?: string
  sourceType?: 'pdf' | 'webpage'
  sourceUrl?: string
  importMode?: 'readable-text' | 'visual-full-page'
  html?: string
  sanitizedHtml?: string
  markdown?: string
  textContent?: string
  textChunksWithOffsets?: MobileTextChunk[]
  previewMode?: 'chrome' | 'html' | 'screenshot' | 'blocked' | 'error'
  finalUrl?: string
  thumbnailDataUrl?: string
  webContent?: MobileWebContent
  lastOpenedAt?: string
}

export interface MobileWebContent {
  title: string
  sourceUrl: string
  sections: MobileWebSection[]
}

export interface MobileWebSection {
  kind: 'heading' | 'paragraph' | 'list-item'
  text: string
  level?: number
}

export interface MobileTextChunk {
  index: number
  text: string
  startOffset: number
  endOffset: number
}

export interface MobileFolder {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface MobileWorkspaceState {
  workspaceId: string
  nodes: CanvasNode[]
  anchors: PageAnchor[]
  excerpts: Excerpt[]
  bookmarks: Bookmark[]
  canvasEdges: CanvasEdge[]
  workspaceLinks: MobileWorkspaceLink[]
  workspaceViewport: MobileWorkspaceViewport
  toolMode?: ToolMode
  toolSettings: MobileToolSettings
  viewerStateByDocument: Record<string, MobileViewerState>
  viewerLayout: MobileViewerLayout
  settings: MobileAppSettings
  textHighlights?: TextHighlight[]
  freeformHighlights?: FreeformHighlight[]
  sourceTextboxes?: SourceTextbox[]
  inkStrokes?: InkStroke[]
  sourceBookmarks?: SourceBookmark[]
  pageEdits?: PageEdit[]
  activeHighlightGroupId?: string | null
  activeAnchorId?: string | null
  activeNodeId?: string | null
  activeTag?: string | null
  historyPast?: WorkspacePatch[]
  historyFuture?: WorkspacePatch[]
  activeDocumentId?: string
  updatedAt: string
}

export type ToolMode =
  | 'select'
  | 'freeform-highlight'
  | 'textbox'
  | 'pen'
  | 'pencil'
  | 'eraser'
  | 'page-edit'
  | 'document'
  | 'bookmark'

export type MobileToolSettings = {
  pen: { color: string; size: number }
  pencil: { color: string; size: number; opacity: number }
  highlight: { color: string; size: number; opacity: number; smoothed: boolean }
  eraser: { size: number }
}

export type MobileViewerState = {
  viewerZoom: number
  sourceZoom: number
  workspaceZoom: number
  zoom?: number
  scrollPosition: number
  activePage: number
}

export type MobileViewerLayout = {
  splitRatio: number
  sourceToolsOpen: boolean
  toolRailSide: 'left' | 'right'
  workspaceLocked?: boolean
  autoPositionComments?: boolean
}

export type MobileAppSettings = {
  syncEnabled: boolean
  displayDensity: 'comfortable' | 'compact'
}

export type MobileWorkspaceViewport = {
  panX: number
  panY: number
  zoom?: number
  workspaceZoom?: number
}

export type MobileWorkspaceLink = {
  id: string
  fromNodeId: string
  toNodeId: string
  type: 'reference'
  createdAt: string
}

export type SerializedRange = {
  startPath: number[]
  startOffset: number
  endPath: number[]
  endOffset: number
}

export type NormalizedRect = { x: number; y: number; w: number; h: number }
export type NormalizedPoint = { x: number; y: number }

export type TextHighlight = {
  id: string
  documentId: string
  range: SerializedRange
  rects?: NormalizedRect[]
  text?: string
  color: string
}

export type FreeformHighlight = {
  id: string
  documentId: string
  pageNumber?: number
  points: NormalizedPoint[]
  color: string
  size?: number
  opacity?: number
  mergedGroupId?: string
  smoothed?: boolean
}

export type SourceTextbox = {
  id: string
  documentId: string
  pageNumber?: number
  xNorm: number
  yNorm: number
  widthNorm?: number
  heightNorm?: number
  content: string
}

export type InkStroke = {
  id: string
  documentId: string
  pageNumber?: number
  tool?: 'pen' | 'pencil'
  points: NormalizedPoint[]
  color: string
  size?: number
  opacity?: number
}

export type SourceBookmark = {
  id: string
  documentId: string
  pageNumber?: number
  label: string
  xNorm?: number
  yNorm?: number
}

export type PageEdit = {
  id: string
  documentId: string
  pageNumber: number
  action: 'insert' | 'delete' | 'rotate'
  rotation?: 90 | -90 | 180
}

export type WorkspacePatch = {
  undo: WorkspacePatchOperation[]
  redo: WorkspacePatchOperation[]
}

export type WorkspacePatchOperation =
  | { collection: 'anchors'; op: 'add' | 'update'; value: PageAnchor }
  | { collection: 'anchors'; op: 'remove'; id: string }
  | { collection: 'bookmarks'; op: 'add' | 'update'; value: Bookmark }
  | { collection: 'bookmarks'; op: 'remove'; id: string }
  | { collection: 'excerpts'; op: 'add' | 'update'; value: Excerpt }
  | { collection: 'excerpts'; op: 'remove'; id: string }
  | { collection: 'nodes'; op: 'add' | 'update'; value: CanvasNode }
  | { collection: 'nodes'; op: 'remove'; id: string }
  | { collection: 'canvasEdges'; op: 'add' | 'update'; value: CanvasEdge }
  | { collection: 'canvasEdges'; op: 'remove'; id: string }
  | { collection: 'workspaceLinks'; op: 'add' | 'update'; value: MobileWorkspaceLink }
  | { collection: 'workspaceLinks'; op: 'remove'; id: string }
  | { collection: 'freeformHighlights'; op: 'add' | 'update'; value: FreeformHighlight }
  | { collection: 'freeformHighlights'; op: 'remove'; id: string }
  | { collection: 'sourceTextboxes'; op: 'add' | 'update'; value: SourceTextbox }
  | { collection: 'sourceTextboxes'; op: 'remove'; id: string }
  | { collection: 'inkStrokes'; op: 'add' | 'update'; value: InkStroke }
  | { collection: 'inkStrokes'; op: 'remove'; id: string }

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'))
      return
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DOCUMENT_STORE)) {
        db.createObjectStore(DOCUMENT_STORE, { keyPath: 'document.id' })
      }
      if (!db.objectStoreNames.contains(FOLDER_STORE)) {
        db.createObjectStore(FOLDER_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(WORKSPACE_STORE)) {
        db.createObjectStore(WORKSPACE_STORE, { keyPath: 'workspaceId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'))
  })
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    const request = run(store)
    let result: T | undefined

    if (request) {
      request.onsuccess = () => {
        result = request.result
      }
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
    }

    transaction.oncomplete = () => {
      db.close()
      resolve(result)
    }
    transaction.onerror = () => {
      db.close()
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
    }
    transaction.onabort = () => {
      db.close()
      reject(transaction.error ?? new Error('IndexedDB transaction aborted.'))
    }
  })
}

export async function saveMobileDocument(record: MobileDocumentRecord) {
  await withStore(DOCUMENT_STORE, 'readwrite', (store) => store.put(record))
}

export async function deleteMobileDocuments(documentIds: string[]) {
  if (!documentIds.length) return
  await withStore(DOCUMENT_STORE, 'readwrite', (store) => {
    documentIds.forEach((documentId) => store.delete(documentId))
  })
}

export async function saveMobileFolder(folder: MobileFolder) {
  await withStore(FOLDER_STORE, 'readwrite', (store) => store.put(folder))
}

export async function listMobileFolders(): Promise<MobileFolder[]> {
  const folders = await withStore<MobileFolder[]>(FOLDER_STORE, 'readonly', (store) => store.getAll())
  return (folders ?? []).sort((left, right) => left.name.localeCompare(right.name))
}

export async function listMobileDocuments(): Promise<MobileDocumentRecord[]> {
  const records = await withStore<MobileDocumentRecord[]>(DOCUMENT_STORE, 'readonly', (store) => store.getAll())
  return (records ?? []).sort((left, right) => {
    const leftDate = left.lastOpenedAt ?? left.document.updatedAt
    const rightDate = right.lastOpenedAt ?? right.document.updatedAt
    return rightDate.localeCompare(leftDate)
  })
}

export async function loadMobileDocument(documentId: string): Promise<MobileDocumentRecord | null> {
  const record = await withStore<MobileDocumentRecord>(DOCUMENT_STORE, 'readonly', (store) => store.get(documentId))
  return record ?? null
}

export async function markMobileDocumentOpened(documentId: string) {
  const record = await loadMobileDocument(documentId)
  if (!record) return
  await saveMobileDocument({
    ...record,
    lastOpenedAt: new Date().toISOString()
  })
}

export async function loadMobileWorkspace(workspaceId = MOBILE_WORKSPACE_ID): Promise<MobileWorkspaceState> {
  const state = await withStore<MobileWorkspaceState>(WORKSPACE_STORE, 'readonly', (store) => store.get(workspaceId))
  return normalizeMobileWorkspaceState(state, workspaceId)
}

export async function saveMobileWorkspace(state: MobileWorkspaceState) {
  await withStore(WORKSPACE_STORE, 'readwrite', (store) =>
    store.put({
      ...state,
      updatedAt: new Date().toISOString()
    })
  )
}

export function buildMobileDocumentId(fileName: string, bytes: Uint8Array) {
  const normalizedName = fileName.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().replace(/^-|-$/g, '')
  return `mobile-document-${normalizedName || 'pdf'}-${bytes.byteLength}-${bytes[0] ?? 0}-${bytes[bytes.length - 1] ?? 0}`
}

export function buildMobileWebpageId(url: string, title: string) {
  const normalizedTitle = title.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().replace(/^-|-$/g, '').slice(0, 48)
  return `mobile-webpage-${normalizedTitle || 'page'}-${Math.abs(hashString(url))}`
}

export function buildChecksum(bytes: Uint8Array) {
  return `${bytes.byteLength}-${bytes[0] ?? 0}-${bytes[Math.floor(bytes.length / 2)] ?? 0}-${bytes[bytes.length - 1] ?? 0}`
}

export function buildTextChecksum(text: string) {
  return `${text.length}-${Math.abs(hashString(text))}`
}

export function normalizeMobileWorkspaceState(
  state: MobileWorkspaceState | null | undefined,
  workspaceId = MOBILE_WORKSPACE_ID
): MobileWorkspaceState {
  return {
    workspaceId,
    nodes: state?.nodes ?? [],
    anchors: state?.anchors ?? [],
    excerpts: state?.excerpts ?? [],
    bookmarks: state?.bookmarks ?? [],
    canvasEdges: state?.canvasEdges ?? [],
    workspaceLinks: state?.workspaceLinks ?? [],
    workspaceViewport: normalizeWorkspaceViewport(state?.workspaceViewport),
    toolMode: state?.toolMode ?? 'select',
    toolSettings: normalizeToolSettings(state?.toolSettings),
    viewerStateByDocument: state?.viewerStateByDocument ?? {},
    viewerLayout: normalizeViewerLayout(state?.viewerLayout),
    settings: {
      syncEnabled: state?.settings?.syncEnabled ?? false,
      displayDensity: state?.settings?.displayDensity ?? 'comfortable'
    },
    textHighlights: state?.textHighlights ?? [],
    freeformHighlights: state?.freeformHighlights ?? [],
    sourceTextboxes: state?.sourceTextboxes ?? [],
    inkStrokes: (state?.inkStrokes ?? []).map((stroke) => ({ ...stroke, tool: stroke.tool ?? 'pen' })),
    sourceBookmarks: state?.sourceBookmarks ?? [],
    pageEdits: state?.pageEdits ?? [],
    activeHighlightGroupId: state?.activeHighlightGroupId ?? null,
    activeAnchorId: state?.activeAnchorId ?? null,
    activeNodeId: state?.activeNodeId ?? null,
    activeTag: state?.activeTag ?? null,
    historyPast: state?.historyPast ?? [],
    historyFuture: state?.historyFuture ?? [],
    activeDocumentId: state?.activeDocumentId,
    updatedAt: state?.updatedAt ?? new Date().toISOString()
  }
}

export function normalizeWorkspaceViewport(viewport?: Partial<MobileWorkspaceViewport>): MobileWorkspaceViewport {
  return {
    panX: viewport?.panX ?? 72,
    panY: viewport?.panY ?? 48
  }
}

export function getDocumentSourceKind(record: MobileDocumentRecord): MobileDocumentSourceKind {
  if (record.sourceKind) return record.sourceKind
  if (record.sourceType === 'webpage' && record.importMode === 'visual-full-page') return 'web-visual'
  if (record.sourceType === 'webpage') return 'web-clean'
  return 'pdf'
}

export function normalizeToolSettings(settings?: Partial<MobileToolSettings>): MobileToolSettings {
  return {
    pen: {
      color: settings?.pen?.color ?? '#0f766e',
      size: settings?.pen?.size ?? 4
    },
    pencil: {
      color: settings?.pencil?.color ?? '#475569',
      size: settings?.pencil?.size ?? 3,
      opacity: settings?.pencil?.opacity ?? 0.58
    },
    highlight: {
      color: settings?.highlight?.color ?? '#ffe066',
      size: settings?.highlight?.size ?? 18,
      opacity: settings?.highlight?.opacity ?? 0.42,
      smoothed: settings?.highlight?.smoothed ?? true
    },
    eraser: {
      size: settings?.eraser?.size ?? 24
    }
  }
}

export function normalizeViewerLayout(layout?: Partial<MobileViewerLayout>): MobileViewerLayout {
  return {
    splitRatio: clamp(layout?.splitRatio ?? 0.54, 0.12, 0.88),
    sourceToolsOpen: layout?.sourceToolsOpen ?? false,
    toolRailSide: layout?.toolRailSide ?? 'left',
    workspaceLocked: layout?.workspaceLocked ?? false,
    autoPositionComments: layout?.autoPositionComments ?? true
  }
}

export function getDocumentViewerState(state: MobileWorkspaceState, documentId: string): MobileViewerState {
  const existing = state.viewerStateByDocument[documentId]
  return {
    viewerZoom: clamp(existing?.viewerZoom ?? 1, 0.3, 3),
    sourceZoom: clamp(existing?.sourceZoom ?? existing?.zoom ?? 1, 0.3, 3),
    workspaceZoom: clamp(existing?.workspaceZoom ?? state.workspaceViewport.workspaceZoom ?? state.workspaceViewport.zoom ?? 1, 0.3, 3),
    scrollPosition: existing?.scrollPosition ?? 0,
    activePage: existing?.activePage ?? 1
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function hashString(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }
  return hash
}
