import type {
  FreeformHighlight,
  InkStroke,
  MobileWorkspaceState,
  NormalizedPoint,
  SourceTextbox,
  ToolMode,
  WorkspacePatch,
  WorkspacePatchOperation
} from './mobile-store'
import type { Bookmark, CanvasEdge, CanvasNode, Excerpt, PageAnchor } from '@workspace/domain'

const HIT_RADIUS = 0.025
const HISTORY_LIMIT = 100
type PatchCollection = WorkspacePatchOperation['collection']
type PatchValueByCollection = {
  anchors: PageAnchor
  bookmarks: Bookmark
  excerpts: Excerpt
  nodes: CanvasNode
  canvasEdges: CanvasEdge
  workspaceLinks: import('./mobile-store').MobileWorkspaceLink
  freeformHighlights: FreeformHighlight
  sourceTextboxes: SourceTextbox
  inkStrokes: InkStroke
}

export type InteractionAction =
  | { type: 'SET_TOOL_MODE'; mode: ToolMode }
  | { type: 'ADD_FREEFORM_HIGHLIGHT'; payload: FreeformHighlight }
  | { type: 'ADD_SOURCE_TEXTBOX'; payload: SourceTextbox }
  | { type: 'UPDATE_SOURCE_TEXTBOX'; payload: SourceTextbox }
  | { type: 'DELETE_SOURCE_TEXTBOX'; textboxId: string }
  | { type: 'ADD_INK_STROKE'; payload: InkStroke }
  | { type: 'CLEAR_PAGE_INK'; payload: { documentId: string; pageNumber: number } }
  | { type: 'COMMIT_SOURCE_SNAPSHOT'; before: MobileWorkspaceState; after: MobileWorkspaceState }
  | { type: 'ERASE_AT_POINT'; payload: { documentId: string; pageNumber?: number; point: NormalizedPoint; size?: number; anchorId?: string | null; canvasSize?: InkCanvasSize } }
  | { type: 'ERASE_WORKSPACE_INK_AT_POINT'; payload: { documentId: string; point: NormalizedPoint; size?: number } }
  | { type: 'ERASE_SURFACE_INK_AT_POINT'; payload: { documentId: string; surface: 'source-pane' | 'workspace'; point: NormalizedPoint; size?: number; canvasSize?: InkCanvasSize } }
  | { type: 'UNDO' }
  | { type: 'REDO' }

type InkCanvasSize = { width: number; height: number }

export function dispatchInteractionAction(state: MobileWorkspaceState, action: InteractionAction): MobileWorkspaceState {
  if (action.type === 'SET_TOOL_MODE') {
    return { ...state, toolMode: action.mode, updatedAt: new Date().toISOString() }
  }

  if (action.type === 'UNDO') {
    const patch = state.historyPast?.at(-1)
    if (!patch) return state
    return {
      ...applyPatch(state, patch.undo),
      historyPast: (state.historyPast ?? []).slice(0, -1),
      historyFuture: [patch, ...(state.historyFuture ?? [])],
      updatedAt: new Date().toISOString()
    }
  }

  if (action.type === 'REDO') {
    const patch = state.historyFuture?.[0]
    if (!patch) return state
    return {
      ...applyPatch(state, patch.redo),
      historyPast: [...(state.historyPast ?? []), patch],
      historyFuture: (state.historyFuture ?? []).slice(1),
      updatedAt: new Date().toISOString()
    }
  }

  if (action.type === 'ADD_FREEFORM_HIGHLIGHT') {
    const patch: WorkspacePatch = {
      redo: [{ collection: 'freeformHighlights', op: 'add', value: action.payload }],
      undo: [{ collection: 'freeformHighlights', op: 'remove', id: action.payload.id }]
    }
    return pushPatch(
      {
        ...applyPatch(state, patch.redo),
        activeHighlightGroupId: action.payload.mergedGroupId ?? action.payload.id
      },
      patch
    )
  }

  if (action.type === 'ADD_SOURCE_TEXTBOX') {
    const patch: WorkspacePatch = {
      redo: [{ collection: 'sourceTextboxes', op: 'add', value: action.payload }],
      undo: [{ collection: 'sourceTextboxes', op: 'remove', id: action.payload.id }]
    }
    return pushPatch(applyPatch(state, patch.redo), patch)
  }

  if (action.type === 'UPDATE_SOURCE_TEXTBOX') {
    const existing = (state.sourceTextboxes ?? []).find((textbox) => textbox.id === action.payload.id)
    if (!existing) return state
    const patch: WorkspacePatch = {
      redo: [{ collection: 'sourceTextboxes', op: 'update', value: action.payload }],
      undo: [{ collection: 'sourceTextboxes', op: 'update', value: existing }]
    }
    return pushPatch(applyPatch(state, patch.redo), patch)
  }

  if (action.type === 'DELETE_SOURCE_TEXTBOX') {
    const textbox = (state.sourceTextboxes ?? []).find((entry) => entry.id === action.textboxId)
    if (!textbox) return state
    const patch: WorkspacePatch = {
      redo: [{ collection: 'sourceTextboxes', op: 'remove', id: textbox.id }],
      undo: [{ collection: 'sourceTextboxes', op: 'add', value: textbox }]
    }
    return pushPatch(applyPatch(state, patch.redo), patch)
  }

  if (action.type === 'ADD_INK_STROKE') {
    const payload = { ...action.payload, tool: action.payload.tool ?? 'pen' }
    const patch: WorkspacePatch = {
      redo: [{ collection: 'inkStrokes', op: 'add', value: payload }],
      undo: [{ collection: 'inkStrokes', op: 'remove', id: payload.id }]
    }
    return pushPatch(applyPatch(state, patch.redo), patch)
  }

  if (action.type === 'CLEAR_PAGE_INK') {
    const matchingHighlights = (state.freeformHighlights ?? []).filter((entry) =>
      isSourceEntryMatch(entry, action.payload.documentId, action.payload.pageNumber)
    )
    const matchingInk = (state.inkStrokes ?? []).filter((entry) =>
      isSourceEntryMatch(entry, action.payload.documentId, action.payload.pageNumber)
    )
    if (matchingHighlights.length === 0 && matchingInk.length === 0) return state

    const patch: WorkspacePatch = {
      redo: [
        ...matchingHighlights.map((entry) => ({ collection: 'freeformHighlights', op: 'remove', id: entry.id }) as WorkspacePatchOperation),
        ...matchingInk.map((entry) => ({ collection: 'inkStrokes', op: 'remove', id: entry.id }) as WorkspacePatchOperation)
      ],
      undo: [
        ...matchingHighlights.map((entry) => ({ collection: 'freeformHighlights', op: 'add', value: entry }) as WorkspacePatchOperation),
        ...matchingInk.map((entry) => ({ collection: 'inkStrokes', op: 'add', value: entry }) as WorkspacePatchOperation)
      ]
    }

    return pushPatch(applyPatch(state, patch.redo), patch)
  }

  if (action.type === 'COMMIT_SOURCE_SNAPSHOT') {
    const patch = buildWorkspacePatch(action.before, action.after)
    if (patch.redo.length === 0) return state
    return pushPatch(applyPatch(state, patch.redo), patch)
  }

  if (action.type === 'ERASE_AT_POINT') {
    const sourceAnchors = state.anchors.filter((entry) => isSourceEntryMatch(entry, action.payload.documentId, action.payload.pageNumber))
    const directAnchor = action.payload.anchorId
      ? sourceAnchors.find((entry) => entry.id === action.payload.anchorId) ?? null
      : null
    const erased = directAnchor
      ? { kind: 'anchors' as const, id: directAnchor.id, value: directAnchor }
      : hitTest(
      action.payload.point,
      {
      freeformHighlights: state.freeformHighlights?.filter((entry) => isSourceEntryMatch(entry, action.payload.documentId, action.payload.pageNumber)) ?? [],
      inkStrokes: state.inkStrokes?.filter((entry) => isSourceEntryMatch(entry, action.payload.documentId, action.payload.pageNumber)) ?? [],
      sourceTextboxes: [],
      anchors: sourceAnchors,
      bookmarks: state.bookmarks.filter((entry) => isSourceEntryMatch(entry, action.payload.documentId, action.payload.pageNumber))
      },
      action.payload.size,
      action.payload.canvasSize
    )
    if (!erased) return state

    const patch = erased.kind === 'anchors'
      ? buildEraseAnchorPatch(state, erased.value as PageAnchor)
      : erased.kind === 'bookmarks'
        ? {
            redo: [{ collection: 'bookmarks', op: 'remove', id: erased.id }],
            undo: [{ collection: 'bookmarks', op: 'add', value: erased.value as Bookmark }]
          } satisfies WorkspacePatch
        : erased.kind === 'freeformHighlights'
          ? {
              redo: [{ collection: 'freeformHighlights', op: 'remove', id: erased.id }],
              undo: [{ collection: 'freeformHighlights', op: 'add', value: erased.value as FreeformHighlight }]
            } satisfies WorkspacePatch
          : erased.kind === 'inkStrokes'
            ? {
                redo: [{ collection: 'inkStrokes', op: 'remove', id: erased.id }],
                undo: [{ collection: 'inkStrokes', op: 'add', value: erased.value as InkStroke }]
              } satisfies WorkspacePatch
            : {
                redo: [{ collection: 'sourceTextboxes', op: 'remove', id: erased.id }],
                undo: [{ collection: 'sourceTextboxes', op: 'add', value: erased.value as SourceTextbox }]
              } satisfies WorkspacePatch
    if (patch.redo.length === 0) return state

    return pushPatch(applyPatch(state, patch.redo), patch)
  }

  if (action.type === 'ERASE_WORKSPACE_INK_AT_POINT') {
    const erased = hitTestWorkspaceInk(
      action.payload.point,
      {
        freeformHighlights: state.freeformHighlights?.filter((entry) => isWorkspaceInkEntry(entry, action.payload.documentId)) ?? [],
        inkStrokes: state.inkStrokes?.filter((entry) => isWorkspaceInkEntry(entry, action.payload.documentId)) ?? []
      },
      action.payload.size
    )
    if (!erased) return state

    const patch = erased.kind === 'freeformHighlights'
      ? {
          redo: [{ collection: 'freeformHighlights', op: 'remove', id: erased.id }],
          undo: [{ collection: 'freeformHighlights', op: 'add', value: erased.value as FreeformHighlight }]
        } satisfies WorkspacePatch
      : {
          redo: [{ collection: 'inkStrokes', op: 'remove', id: erased.id }],
          undo: [{ collection: 'inkStrokes', op: 'add', value: erased.value as InkStroke }]
        } satisfies WorkspacePatch

    return pushPatch(applyPatch(state, patch.redo), patch)
  }

  if (action.type === 'ERASE_SURFACE_INK_AT_POINT') {
    const elements = {
      freeformHighlights: state.freeformHighlights?.filter((entry) => isInkSurfaceEntry(entry, action.payload.documentId, action.payload.surface)) ?? [],
      inkStrokes: state.inkStrokes?.filter((entry) => isInkSurfaceEntry(entry, action.payload.documentId, action.payload.surface)) ?? []
    }
    const erased = action.payload.surface === 'workspace'
      ? hitTestWorkspaceInk(action.payload.point, elements, action.payload.size)
      : hitTestSurfaceInk(action.payload.point, elements, action.payload.size, action.payload.canvasSize)
    if (!erased) return state

    const patch = erased.kind === 'freeformHighlights'
      ? {
          redo: [{ collection: 'freeformHighlights', op: 'remove', id: erased.id }],
          undo: [{ collection: 'freeformHighlights', op: 'add', value: erased.value as FreeformHighlight }]
        } satisfies WorkspacePatch
      : {
          redo: [{ collection: 'inkStrokes', op: 'remove', id: erased.id }],
          undo: [{ collection: 'inkStrokes', op: 'add', value: erased.value as InkStroke }]
        } satisfies WorkspacePatch

    return pushPatch(applyPatch(state, patch.redo), patch)
  }

  return state
}

export function normalizePointer(clientX: number, clientY: number, element: HTMLElement): NormalizedPoint {
  const rect = element.getBoundingClientRect()
  return {
    x: clamp01((clientX - rect.left) / Math.max(1, rect.width)),
    y: clamp01((clientY - rect.top) / Math.max(1, rect.height))
  }
}

export function toScreenPoint(point: NormalizedPoint, pageWidth: number, pageHeight: number, zoom: number) {
  return {
    x: point.x * pageWidth * zoom,
    y: point.y * pageHeight * zoom
  }
}

export function simplifyPath(points: NormalizedPoint[], tolerance = 0.008): NormalizedPoint[] {
  if (points.length <= 2) return points
  const first = points[0]
  const last = points[points.length - 1]
  let maxDistance = 0
  let index = 0

  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpendicularDistance(points[i], first, last)
    if (distance > maxDistance) {
      index = i
      maxDistance = distance
    }
  }

  if (maxDistance > tolerance) {
    const left = simplifyPath(points.slice(0, index + 1), tolerance)
    const right = simplifyPath(points.slice(index), tolerance)
    return [...left.slice(0, -1), ...right]
  }

  return [first, last]
}

export function hitTest(
  point: NormalizedPoint,
  elements: {
    freeformHighlights: FreeformHighlight[]
    inkStrokes: InkStroke[]
    sourceTextboxes: SourceTextbox[]
    anchors?: PageAnchor[]
    bookmarks?: Bookmark[]
  },
  eraserSize = 24,
  canvasSize?: InkCanvasSize
) {
  const textbox = [...elements.sourceTextboxes].reverse().find((entry) => {
    const width = entry.widthNorm ?? 0.28
    const height = entry.heightNorm ?? 0.16
    return point.x >= entry.xNorm && point.x <= entry.xNorm + width && point.y >= entry.yNorm && point.y <= entry.yNorm + height
  })
  if (textbox) return { kind: 'sourceTextboxes' as const, id: textbox.id, value: textbox }

  const radius = Math.max(HIT_RADIUS, eraserSize / 600)
  const ink = [...elements.inkStrokes].reverse().find((entry) => canvasSize ? pathNearPointInPixels(entry.points, point, eraserSize, canvasSize) : pathNearPoint(entry.points, point, radius))
  if (ink) return { kind: 'inkStrokes' as const, id: ink.id, value: ink }

  const highlight = [...elements.freeformHighlights].reverse().find((entry) => canvasSize ? pathNearPointInPixels(entry.points, point, eraserSize, canvasSize) : pathNearPoint(entry.points, point, radius))
  if (highlight) return { kind: 'freeformHighlights' as const, id: highlight.id, value: highlight }

  const bookmark = [...(elements.bookmarks ?? [])].reverse().find((entry) => {
    const anchor = elements.anchors?.find((candidate) => candidate.id === entry.sourceAnchorId)
    return anchor ? anchorContainsPoint(anchor, point) : false
  })
  if (bookmark) return { kind: 'bookmarks' as const, id: bookmark.id, value: bookmark }

  const anchor = [...(elements.anchors ?? [])].reverse().find((entry) => anchorContainsPoint(entry, point))
  if (anchor) return { kind: 'anchors' as const, id: anchor.id, value: anchor }

  return null
}

function pushPatch(state: MobileWorkspaceState, patch: WorkspacePatch): MobileWorkspaceState {
  return {
    ...state,
    historyPast: [...(state.historyPast ?? []), patch].slice(-HISTORY_LIMIT),
    historyFuture: [],
    updatedAt: new Date().toISOString()
  }
}

function applyPatch(state: MobileWorkspaceState, operations: WorkspacePatchOperation[]): MobileWorkspaceState {
  return operations.reduce((nextState, operation) => {
    if (operation.collection === 'anchors') return applyCollectionOperation(nextState, 'anchors', operation)
    if (operation.collection === 'bookmarks') return applyCollectionOperation(nextState, 'bookmarks', operation)
    if (operation.collection === 'excerpts') return applyCollectionOperation(nextState, 'excerpts', operation)
    if (operation.collection === 'nodes') return applyCollectionOperation(nextState, 'nodes', operation)
    if (operation.collection === 'canvasEdges') return applyCollectionOperation(nextState, 'canvasEdges', operation)
    if (operation.collection === 'workspaceLinks') return applyCollectionOperation(nextState, 'workspaceLinks', operation)
    if (operation.collection === 'freeformHighlights') return applyCollectionOperation(nextState, 'freeformHighlights', operation)
    if (operation.collection === 'sourceTextboxes') return applyCollectionOperation(nextState, 'sourceTextboxes', operation)
    return applyCollectionOperation(nextState, 'inkStrokes', operation)
  }, state)
}

function applyCollectionOperation<C extends PatchCollection>(
  state: MobileWorkspaceState,
  collection: C,
  operation: Extract<WorkspacePatchOperation, { collection: C }>
) {
  const current = getCollection(state, collection)
  const nextItems =
    operation.op === 'remove'
      ? current.filter((entry) => entry.id !== operation.id)
      : upsertById(current, operation.value as PatchValueByCollection[C])
  return { ...state, [collection]: nextItems }
}

function getCollection<C extends PatchCollection>(state: MobileWorkspaceState, collection: C): PatchValueByCollection[C][] {
  return ((state[collection] as PatchValueByCollection[C][] | undefined) ?? []) as PatchValueByCollection[C][]
}

function upsertById<T extends { id: string }>(items: T[], value: T) {
  return items.some((entry) => entry.id === value.id)
    ? items.map((entry) => (entry.id === value.id ? value : entry))
    : [...items, value]
}

function buildWorkspacePatch(before: MobileWorkspaceState, after: MobileWorkspaceState): WorkspacePatch {
  const collections: PatchCollection[] = [
    'anchors',
    'bookmarks',
    'excerpts',
    'nodes',
    'canvasEdges',
    'workspaceLinks',
    'freeformHighlights',
    'sourceTextboxes',
    'inkStrokes'
  ]
  const redo = collections.flatMap((collection) => diffCollection(collection, getCollection(before, collection), getCollection(after, collection)))
  const undo = collections.flatMap((collection) => diffCollection(collection, getCollection(after, collection), getCollection(before, collection)))
  return { redo, undo }
}

function diffCollection<C extends PatchCollection>(
  collection: C,
  before: PatchValueByCollection[C][],
  after: PatchValueByCollection[C][]
): WorkspacePatchOperation[] {
  const beforeMap = new Map(before.map((entry) => [entry.id, entry]))
  const afterMap = new Map(after.map((entry) => [entry.id, entry]))
  const operations: WorkspacePatchOperation[] = []
  after.forEach((entry) => {
    const previous = beforeMap.get(entry.id)
    if (!previous) {
      operations.push({ collection, op: 'add', value: entry } as WorkspacePatchOperation)
      return
    }
    if (JSON.stringify(previous) !== JSON.stringify(entry)) {
      operations.push({ collection, op: 'update', value: entry } as WorkspacePatchOperation)
    }
  })
  before.forEach((entry) => {
    if (!afterMap.has(entry.id)) {
      operations.push({ collection, op: 'remove', id: entry.id } as WorkspacePatchOperation)
    }
  })
  return operations
}

function buildEraseAnchorPatch(state: MobileWorkspaceState, anchor: PageAnchor): WorkspacePatch {
  const linked = state.nodes.some((node) => node.sourceAnchorId === anchor.id) ||
    state.excerpts.some((excerpt) => excerpt.anchorId === anchor.id)
  const matchingBookmarks = state.bookmarks.filter((bookmark) => bookmark.sourceAnchorId === anchor.id)
  if (linked) {
    const updatedAnchor = {
      ...anchor,
      selectionColor: undefined,
      tags: [],
      updatedAt: new Date().toISOString()
    }
    return {
      redo: [
        { collection: 'anchors', op: 'update', value: updatedAnchor },
        ...matchingBookmarks.map((bookmark) => ({ collection: 'bookmarks', op: 'remove', id: bookmark.id }) as WorkspacePatchOperation)
      ],
      undo: [
        { collection: 'anchors', op: 'update', value: anchor },
        ...matchingBookmarks.map((bookmark) => ({ collection: 'bookmarks', op: 'add', value: bookmark }) as WorkspacePatchOperation)
      ]
    }
  }
  return {
    redo: [
      { collection: 'anchors', op: 'remove', id: anchor.id },
      ...matchingBookmarks.map((bookmark) => ({ collection: 'bookmarks', op: 'remove', id: bookmark.id }) as WorkspacePatchOperation)
    ],
    undo: [
      { collection: 'anchors', op: 'add', value: anchor },
      ...matchingBookmarks.map((bookmark) => ({ collection: 'bookmarks', op: 'add', value: bookmark }) as WorkspacePatchOperation)
    ]
  }
}

function isSourceEntryMatch(
  entry: { documentId: string; pageNumber?: number; surface?: 'source' | 'source-pane' | 'workspace' },
  documentId: string,
  pageNumber?: number
) {
  return entry.surface !== 'workspace' && entry.surface !== 'source-pane' && entry.documentId === documentId && (pageNumber == null || (entry.pageNumber ?? 1) === pageNumber)
}

function isWorkspaceInkEntry(
  entry: { documentId: string; surface?: 'source' | 'source-pane' | 'workspace' },
  documentId: string
) {
  return entry.surface === 'workspace' && entry.documentId === documentId
}

function isInkSurfaceEntry(
  entry: { documentId: string; surface?: 'source' | 'source-pane' | 'workspace' },
  documentId: string,
  surface: 'source-pane' | 'workspace'
) {
  return entry.surface === surface && entry.documentId === documentId
}

function hitTestWorkspaceInk(
  point: NormalizedPoint,
  elements: {
    freeformHighlights: FreeformHighlight[]
    inkStrokes: InkStroke[]
  },
  eraserSize = 24
) {
  const radius = Math.max(8, eraserSize)
  const ink = [...elements.inkStrokes].reverse().find((entry) => pathNearPoint(entry.points, point, radius))
  if (ink) return { kind: 'inkStrokes' as const, id: ink.id, value: ink }

  const highlight = [...elements.freeformHighlights].reverse().find((entry) => pathNearPoint(entry.points, point, radius))
  if (highlight) return { kind: 'freeformHighlights' as const, id: highlight.id, value: highlight }

  return null
}

function hitTestSurfaceInk(
  point: NormalizedPoint,
  elements: {
    freeformHighlights: FreeformHighlight[]
    inkStrokes: InkStroke[]
  },
  eraserSize = 24,
  canvasSize?: InkCanvasSize
) {
  const radius = Math.max(0.02, eraserSize / 600)
  const ink = [...elements.inkStrokes].reverse().find((entry) => canvasSize ? pathNearPointInPixels(entry.points, point, eraserSize, canvasSize) : pathNearPoint(entry.points, point, radius))
  if (ink) return { kind: 'inkStrokes' as const, id: ink.id, value: ink }

  const highlight = [...elements.freeformHighlights].reverse().find((entry) => canvasSize ? pathNearPointInPixels(entry.points, point, eraserSize, canvasSize) : pathNearPoint(entry.points, point, radius))
  if (highlight) return { kind: 'freeformHighlights' as const, id: highlight.id, value: highlight }

  return null
}

function anchorContainsPoint(anchor: PageAnchor, point: NormalizedPoint) {
  const scale = anchor.viewportScale || 1
  const x = anchor.boundingBox.x / scale
  const y = anchor.boundingBox.y / scale
  const width = anchor.boundingBox.width / scale
  const height = anchor.boundingBox.height / scale
  return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height
}

function pathNearPoint(points: NormalizedPoint[], target: NormalizedPoint, radius = HIT_RADIUS) {
  if (points.some((point) => distance(point, target) <= radius)) return true

  for (let index = 1; index < points.length; index += 1) {
    if (distanceToSegment(target, points[index - 1], points[index]) <= radius) return true
  }

  return false
}

function pathNearPointInPixels(points: NormalizedPoint[], target: NormalizedPoint, radiusPx: number, canvasSize: InkCanvasSize) {
  const pixelTarget = toPixelPoint(target, canvasSize)
  return pathNearPoint(points.map((point) => toPixelPoint(point, canvasSize)), pixelTarget, Math.max(1, radiusPx))
}

function toPixelPoint(point: NormalizedPoint, canvasSize: InkCanvasSize): NormalizedPoint {
  return {
    x: point.x * Math.max(1, canvasSize.width),
    y: point.y * Math.max(1, canvasSize.height)
  }
}

function distanceToSegment(point: NormalizedPoint, start: NormalizedPoint, end: NormalizedPoint) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (dx === 0 && dy === 0) return distance(point, start)

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy))
  )

  return distance(point, {
    x: start.x + t * dx,
    y: start.y + t * dy
  })
}

function perpendicularDistance(point: NormalizedPoint, lineStart: NormalizedPoint, lineEnd: NormalizedPoint) {
  const dx = lineEnd.x - lineStart.x
  const dy = lineEnd.y - lineStart.y
  if (dx === 0 && dy === 0) return distance(point, lineStart)
  return Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / Math.hypot(dx, dy)
}

function distance(left: NormalizedPoint, right: NormalizedPoint) {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}
