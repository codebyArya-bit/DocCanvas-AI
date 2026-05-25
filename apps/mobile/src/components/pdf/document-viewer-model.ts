import type { CanvasEdge, CanvasNode, Excerpt, PageAnchor } from '@workspace/domain'
import {
  buildBookmark,
  buildExcerpt,
  buildPageAnchor,
  type SelectionArtifactInput
} from '../../lib/excerpts/pdf-selection'
import type {
  MobileDocumentRecord,
  MobileDocumentSourceKind,
  MobileViewerState,
  MobileWebSection,
  MobileWorkspaceState
} from '../../lib/mobile-store'

export { buildPageAnchor, type SelectionArtifactInput }

export type ViewerLayoutMode = 'desktop' | 'compact' | 'mobile'

const EXTREME_SPLIT_MIN = 0.02
const EXTREME_SPLIT_MAX = 0.98

export const clampViewerZoom = (value: number) => Math.max(0.3, Math.min(3, Number(value.toFixed(2))))
export const clampSplitRatio = (value: number) => Math.max(EXTREME_SPLIT_MIN, Math.min(EXTREME_SPLIT_MAX, Number(value.toFixed(3))))
export const resetSplitRatio = () => 0.54
export const getPageRotation = (viewerState: MobileViewerState, pageNumber: number) => viewerState.pageRotations?.[pageNumber] ?? 0

export function viewerGridTemplateColumns(splitRatio: number, layoutMode: ViewerLayoutMode) {
  const ratio = clampSplitRatio(splitRatio)
  if (layoutMode === 'mobile') return 'minmax(0, 1fr)'
  if (layoutMode === 'compact') return `96px minmax(28px, ${ratio}fr) 10px minmax(28px, ${1 - ratio}fr)`
  return `112px minmax(28px, ${ratio}fr) 10px minmax(28px, ${1 - ratio}fr)`
}

export function splitRatioFromPointer({
  clientX,
  clientY,
  rect,
  arrangement,
  leftHandLayout
}: {
  clientX: number
  clientY?: number
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>
  arrangement: 'horizontal' | 'vertical'
  leftHandLayout: boolean
}) {
  const rawRatio =
    arrangement === 'vertical'
      ? ((clientY ?? rect.top + rect.height * resetSplitRatio()) - rect.top) / Math.max(1, rect.height)
      : (clientX - rect.left) / Math.max(1, rect.width)
  return clampSplitRatio(arrangement === 'horizontal' && leftHandLayout ? 1 - rawRatio : rawRatio)
}

export function commitViewerStatePatch(
  workspace: MobileWorkspaceState,
  documentId: string,
  patch: Partial<MobileViewerState>
): MobileWorkspaceState {
  const current = workspace.viewerStateByDocument[documentId] ?? {
    viewerZoom: 1,
    sourceZoom: 1,
    workspaceZoom: 1,
    scrollPosition: 0,
    activePage: 1,
    pageRotations: {}
  }
  return {
    ...workspace,
    viewerStateByDocument: { ...workspace.viewerStateByDocument, [documentId]: { ...current, ...patch } },
    updatedAt: new Date().toISOString()
  }
}

export function upsertById<T extends { id: string }>(items: T[], item: T) {
  return items.some((entry) => entry.id === item.id)
    ? items.map((entry) => (entry.id === item.id ? item : entry))
    : [...items, item]
}

function nodePoint(viewportRatio: number) {
  return { x: 120 + Math.round(viewportRatio * 180), y: 96 + Math.round(viewportRatio * 520) }
}

function buildNode(selection: SelectionArtifactInput, kind: 'excerpt' | 'comment', viewportRatio: number, excerpt?: Excerpt): CanvasNode {
  const now = new Date().toISOString()
  const anchor = buildPageAnchor(selection)
  const point = nodePoint(Math.max(0, Math.min(1, viewportRatio)))
  return {
    id: `${kind}-node-${anchor.id}`,
    workspaceId: selection.workspaceId,
    kind,
    excerptId: excerpt?.id,
    documentId: selection.documentId,
    workspaceBoardId: selection.workspaceBoardId ?? 'default-board',
    sourceAnchorId: anchor.id,
    selectionColor: selection.selectionColor,
    nodeColor: undefined,
    title: kind === 'comment' ? 'Comment' : `Excerpt · Page ${selection.pageNumber}`,
    text: kind === 'comment' ? '' : selection.text,
    tags: selection.tags,
    x: point.x,
    y: point.y,
    width: kind === 'comment' ? 300 : 280,
    height: kind === 'comment' ? 156 : 140,
    createdAt: now,
    updatedAt: now
  }
}

function buildEdge(selection: SelectionArtifactInput, node: CanvasNode): CanvasEdge {
  const now = new Date().toISOString()
  const anchor = buildPageAnchor(selection)
  return {
    id: `edge-${anchor.id}-${node.id}`,
    workspaceId: selection.workspaceId,
    sourceAnchorId: anchor.id,
    targetNodeId: node.id,
    kind: 'auto',
    color: selection.selectionColor,
    createdAt: now,
    updatedAt: now
  }
}

export function applyExcerptSelection(workspace: MobileWorkspaceState, selection: SelectionArtifactInput, viewportRatio: number) {
  const anchor = buildPageAnchor(selection)
  const excerpt = buildExcerpt(selection)
  const node = buildNode(selection, 'excerpt', viewportRatio, excerpt)
  const edge = buildEdge(selection, node)
  return {
    ...workspace,
    anchors: upsertById(workspace.anchors, anchor),
    excerpts: upsertById(workspace.excerpts, excerpt),
    nodes: upsertById(workspace.nodes, node),
    canvasEdges: upsertById(workspace.canvasEdges, edge),
    activeAnchorId: anchor.id,
    activeNodeId: node.id,
    updatedAt: new Date().toISOString()
  }
}

export function applyCommentSelection(workspace: MobileWorkspaceState, selection: SelectionArtifactInput, viewportRatio: number) {
  const anchor = buildPageAnchor(selection)
  const node = buildNode(selection, 'comment', viewportRatio)
  const edge = buildEdge(selection, node)
  return {
    ...workspace,
    anchors: upsertById(workspace.anchors, anchor),
    nodes: upsertById(workspace.nodes, node),
    canvasEdges: upsertById(workspace.canvasEdges, edge),
    activeAnchorId: anchor.id,
    activeNodeId: node.id,
    updatedAt: new Date().toISOString()
  }
}

export function applyBookmarkSelection(workspace: MobileWorkspaceState, selection: SelectionArtifactInput) {
  const anchor = {
    ...buildPageAnchor(selection),
    selectionColor: undefined
  }
  return {
    ...workspace,
    anchors: upsertById(workspace.anchors, anchor),
    bookmarks: upsertById(workspace.bookmarks, buildBookmark(selection, workspace.bookmarks.length)),
    activeAnchorId: anchor.id,
    updatedAt: new Date().toISOString()
  }
}

export function applyTagSelection(workspace: MobileWorkspaceState, selection: SelectionArtifactInput, tags: string[]) {
  const anchor = buildPageAnchor({ ...selection, tags })
  const now = new Date().toISOString()
  const existingAnchor = workspace.anchors.find((entry) => entry.id === anchor.id)
  const shouldRemoveAnchor = tags.length === 0 && !existingAnchor?.selectionColor && !workspace.nodes.some((node) => node.sourceAnchorId === anchor.id) && !workspace.bookmarks.some((bookmark) => bookmark.sourceAnchorId === anchor.id)
  if (shouldRemoveAnchor) {
    return {
      ...workspace,
      anchors: workspace.anchors.filter((entry) => entry.id !== anchor.id),
      activeAnchorId: workspace.activeAnchorId === anchor.id ? null : workspace.activeAnchorId,
      updatedAt: now
    }
  }

  const nextAnchor = {
    ...(existingAnchor ?? anchor),
    ...anchor,
    selectionColor: selection.selectionColor || existingAnchor?.selectionColor,
    tags,
    updatedAt: now
  }
  return {
    ...workspace,
    anchors: upsertById(workspace.anchors, nextAnchor),
    nodes: workspace.nodes.map((node) => (node.sourceAnchorId === anchor.id ? { ...node, tags, updatedAt: now } : node)),
    bookmarks: workspace.bookmarks.map((bookmark) => (bookmark.sourceAnchorId === anchor.id ? { ...bookmark, tags, updatedAt: now } : bookmark)),
    activeAnchorId: anchor.id,
    updatedAt: now
  }
}

export function applyRecolorSelection(workspace: MobileWorkspaceState, selection: SelectionArtifactInput, color: string) {
  const anchor = buildPageAnchor({ ...selection, selectionColor: color })
  const now = new Date().toISOString()
  return {
    ...workspace,
    anchors: upsertById(workspace.anchors, anchor),
    nodes: workspace.nodes.map((node) => (node.sourceAnchorId === anchor.id ? { ...node, selectionColor: color, updatedAt: now } : node)),
    bookmarks: workspace.bookmarks.map((bookmark) => (bookmark.sourceAnchorId === anchor.id ? { ...bookmark, selectionColor: color, updatedAt: now } : bookmark)),
    activeAnchorId: anchor.id,
    updatedAt: now
  }
}

export function applyClearSelectionColor(workspace: MobileWorkspaceState, selection: SelectionArtifactInput) {
  const anchor = buildPageAnchor(selection)
  const now = new Date().toISOString()
  
  const isUsedByExcerpt = workspace.nodes.some(node => node.sourceAnchorId === anchor.id)
  const isUsedByBookmark = workspace.bookmarks.some(b => b.sourceAnchorId === anchor.id)
  
  if (!isUsedByExcerpt && !isUsedByBookmark) {
    return {
      ...workspace,
      anchors: workspace.anchors.filter(a => a.id !== anchor.id),
      activeAnchorId: workspace.activeAnchorId === anchor.id ? null : workspace.activeAnchorId,
      updatedAt: now
    }
  }

  return {
    ...workspace,
    anchors: workspace.anchors.map((entry) => (entry.id === anchor.id ? { ...entry, selectionColor: undefined, tags: [], updatedAt: now } : entry)),
    bookmarks: workspace.bookmarks.filter((bookmark) => bookmark.sourceAnchorId !== anchor.id),
    updatedAt: now
  }
}

export function removeAnchorFromWorkspace(workspace: MobileWorkspaceState, anchorId: string) {
  const nodeIds = new Set(workspace.nodes.filter((node) => node.sourceAnchorId === anchorId).map((node) => node.id))
  return {
    ...workspace,
    anchors: workspace.anchors.filter((anchor) => anchor.id !== anchorId),
    excerpts: workspace.excerpts.filter((excerpt) => excerpt.anchorId !== anchorId),
    bookmarks: workspace.bookmarks.filter((bookmark) => bookmark.sourceAnchorId !== anchorId),
    nodes: workspace.nodes.filter((node) => node.sourceAnchorId !== anchorId),
    canvasEdges: workspace.canvasEdges.filter((edge) => edge.sourceAnchorId !== anchorId && !nodeIds.has(edge.targetNodeId)),
    activeAnchorId: workspace.activeAnchorId === anchorId ? null : workspace.activeAnchorId,
    activeNodeId: workspace.activeNodeId && nodeIds.has(workspace.activeNodeId) ? null : workspace.activeNodeId,
    updatedAt: new Date().toISOString()
  }
}

export function buildFreeNode({ kind, workspace, documentId }: { kind: 'text' | 'comment'; workspace: MobileWorkspaceState; documentId: string }): CanvasNode {
  const now = new Date().toISOString()
  return {
    id: `${kind}-node-${crypto.randomUUID()}`,
    workspaceId: workspace.workspaceId,
    kind,
    documentId,
    workspaceBoardId: workspace.activeWorkspaceBoardId ?? 'default-board',
    nodeColor: kind === 'comment' ? '#fff7d6' : '#ffffff',
    title: kind === 'comment' ? 'Comment' : 'Text',
    text: '',
    x: 160 - workspace.workspaceViewport.panX,
    y: 120 - workspace.workspaceViewport.panY,
    width: 280,
    height: 160,
    createdAt: now,
    updatedAt: now
  }
}

export function anchorToHighlightRects(anchor: PageAnchor, sourceZoom: number) {
  const ratio = anchor.viewportScale > 0 ? sourceZoom / anchor.viewportScale : sourceZoom
  if (anchor.quadPoints && anchor.quadPoints.length >= 8) {
    const rects = []
    for (let index = 0; index < anchor.quadPoints.length; index += 8) {
      const xs = [anchor.quadPoints[index], anchor.quadPoints[index + 2], anchor.quadPoints[index + 4], anchor.quadPoints[index + 6]]
      const ys = [anchor.quadPoints[index + 1], anchor.quadPoints[index + 3], anchor.quadPoints[index + 5], anchor.quadPoints[index + 7]]
      rects.push({
        x: Math.min(...xs) * ratio,
        y: Math.min(...ys) * ratio,
        width: (Math.max(...xs) - Math.min(...xs)) * ratio,
        height: (Math.max(...ys) - Math.min(...ys)) * ratio
      })
    }
    return rects
  }
  return [{ x: anchor.boundingBox.x * ratio, y: anchor.boundingBox.y * ratio, width: anchor.boundingBox.width * ratio, height: anchor.boundingBox.height * ratio }]
}

export function anchorMarkerPosition(anchor: PageAnchor, sourceZoom: number) {
  return { top: Math.max(0, (anchorToHighlightRects(anchor, sourceZoom)[0]?.y ?? 0) - 4) }
}

export const visibleAnchorColor = (anchor: PageAnchor) => anchor.selectionColor ?? '#5d5df6'
export const pointsToPolyline = (points: Array<{ x: number; y: number }>) => points.map((point) => `${point.x},${point.y}`).join(' ')

export function fallbackSections(record: MobileDocumentRecord): MobileWebSection[] {
  const text = record.textContent ?? record.markdown ?? ''
  if (!text.trim()) return [{ kind: 'paragraph', text: 'No readable text found.' }]
  return text.split(/\n{2,}/).map((entry) => entry.replace(/\s+/g, ' ').trim()).filter(Boolean).map((text) => ({ kind: 'paragraph', text }))
}

export function sourceKindLabel(kind: MobileDocumentSourceKind) {
  if (kind === 'web-clean') return 'Readable web'
  if (kind === 'web-visual') return 'Visual web'
  return 'PDF'
}

type SearchHit = { text: string; pageNumber: number }

export function buildSemanticSearchIndex(record: MobileDocumentRecord | null, workspace?: MobileWorkspaceState | null): SearchHit[] {
  if (!record) return []
  const anchorHits = (workspace?.anchors ?? [])
    .filter((anchor) => anchor.documentId === record.document.id)
    .map((anchor) => ({
      text: [anchor.textQuote, ...(anchor.tags ?? [])].join(' ').toLowerCase(),
      pageNumber: anchor.pageNumber
    }))
  if (record.textChunksWithOffsets?.length) return [
    ...record.textChunksWithOffsets.map((chunk, index) => ({ text: chunk.text.toLowerCase(), pageNumber: index + 1 })),
    ...anchorHits
  ]
  const text = (record.textContent ?? record.markdown ?? record.webContent?.sections.map((section) => section.text).join('\n') ?? '').toLowerCase()
  return text ? [{ text, pageNumber: 1 }, ...anchorHits] : anchorHits
}

export function findSemanticSearchHit(index: SearchHit[], query: string) {
  const normalized = query.toLowerCase().trim()
  if (!normalized) return null
  const exact = index.find((entry) => entry.text.includes(normalized))
  if (exact) return exact
  return findBm25SearchHit(index, normalized)
}

export function findBm25SearchHit(index: SearchHit[], query: string) {
  const queryTerms = tokenizeSearchText(query)
  if (queryTerms.length === 0 || index.length === 0) return null

  const documents = index.map((entry) => ({ entry, terms: tokenizeSearchText(entry.text) }))
  const averageLength = documents.reduce((sum, document) => sum + document.terms.length, 0) / Math.max(1, documents.length)
  const documentFrequency = new Map<string, number>()
  documents.forEach((document) => {
    new Set(document.terms).forEach((term) => documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1))
  })

  const k1 = 1.2
  const b = 0.75
  let bestEntry: SearchHit | null = null
  let bestScore = 0
  documents.forEach((document) => {
    const termCounts = new Map<string, number>()
    document.terms.forEach((term) => termCounts.set(term, (termCounts.get(term) ?? 0) + 1))
    const score = queryTerms.reduce((total, term) => {
      const frequency = termCounts.get(term) ?? 0
      if (frequency === 0) return total
      const df = documentFrequency.get(term) ?? 0
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5))
      const denominator = frequency + k1 * (1 - b + b * (document.terms.length / Math.max(1, averageLength)))
      return total + idf * ((frequency * (k1 + 1)) / denominator)
    }, 0)
    if (score > bestScore) {
      bestEntry = document.entry
      bestScore = score
    }
  })
  return bestEntry
}

function tokenizeSearchText(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((term) => term.length > 1)
}

export function decideNavigation({
  pageInput,
  query,
  tagInput,
  navigateScope,
  record,
  workspace,
  documents
}: {
  pageInput: string
  query: string
  tagInput: string
  navigateScope: 'current-doc' | 'all-docs'
  record: MobileDocumentRecord | null
  workspace: MobileWorkspaceState | null
  documents: MobileDocumentRecord[]
}) {
  const pageNumber = Number(pageInput)
  if (Number.isFinite(pageNumber) && pageNumber > 0) return { type: 'page' as const, pageNumber: Math.floor(pageNumber) }
  const tag = tagInput.trim().replace(/^#/, '')
  if (tag && workspace) {
    const anchor = workspace.anchors.find((entry) => (entry.tags ?? []).includes(tag) && (!record || entry.documentId === record.document.id))
    if (anchor) return { type: 'anchor' as const, anchorId: anchor.id, pageNumber: anchor.pageNumber, activeTag: tag }
  }
  const trimmedQuery = query.trim().toLowerCase()
  if (trimmedQuery) {
    const anchor = workspace?.anchors.find((entry) => entry.textQuote.toLowerCase().includes(trimmedQuery) && (!record || entry.documentId === record.document.id))
    if (anchor) return { type: 'anchor' as const, anchorId: anchor.id, pageNumber: anchor.pageNumber }
    if (navigateScope === 'all-docs') {
      const document = documents.find((entry) => entry.document.title.toLowerCase().includes(trimmedQuery))
      if (document) return { type: 'document' as const, documentId: document.document.id }
    }
    return { type: 'text' as const, query: trimmedQuery }
  }
  return { type: 'none' as const }
}

export function buildProjectBundle(record: MobileDocumentRecord, documents: MobileDocumentRecord[], workspace: MobileWorkspaceState) {
  return {
    format: 'liquid-text-mobile-project',
    version: 1,
    exportedAt: new Date().toISOString(),
    activeDocumentId: record.document.id,
    documents: documents.map((entry) => ({ ...entry, bytes: undefined })),
    workspace
  }
}

export function buildProjectBundleFileName(title: string) {
  return `${title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'project'}.ltproj.json`
}

export function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function buildPrintableRows(record: MobileDocumentRecord, workspace: MobileWorkspaceState) {
  const rows = workspace.excerpts
    .filter((excerpt) => excerpt.documentId === record.document.id)
    .map((excerpt) => `<section><small>Page ${excerpt.pageNumber}</small><p>${escapeHtml(excerpt.extractedText)}</p></section>`)
    .join('')
  return rows || '<section><p>No excerpts yet.</p></section>'
}
