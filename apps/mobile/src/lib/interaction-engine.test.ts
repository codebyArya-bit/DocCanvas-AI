import assert from 'node:assert/strict'
import type { CanvasEdge, CanvasNode, Excerpt, PageAnchor } from '@workspace/domain'
import {
  dispatchInteractionAction,
  normalizePointer
} from './interaction-engine'
import type {
  FreeformHighlight,
  InkStroke,
  MobileWorkspaceLink,
  MobileWorkspaceState,
  SourceTextbox
} from './mobile-store'

function workspace(overrides: Partial<MobileWorkspaceState> = {}): MobileWorkspaceState {
  return {
    workspaceId: 'workspace-test',
    nodes: [],
    anchors: [],
    excerpts: [],
    bookmarks: [],
    canvasEdges: [],
    workspaceLinks: [],
    workspaceViewport: { panX: 0, panY: 0 },
    toolMode: 'select',
    toolSettings: {
      pen: { color: '#111111', size: 4 },
      pencil: { color: '#444444', size: 3, opacity: 0.58 },
      highlight: { color: '#ffee00', size: 18, opacity: 0.42, smoothed: true },
      eraser: { size: 24 }
    },
    viewerStateByDocument: {},
    viewerLayout: { splitRatio: 0.54, sourceToolsOpen: false, toolRailSide: 'left' },
    settings: { syncEnabled: false, displayDensity: 'comfortable' },
    freeformHighlights: [],
    sourceTextboxes: [],
    inkStrokes: [],
    sourceBookmarks: [],
    pageEdits: [],
    activeHighlightGroupId: null,
    activeAnchorId: null,
    activeNodeId: null,
    activeTag: null,
    historyPast: [],
    historyFuture: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

const stroke: InkStroke = {
  id: 'ink-1',
  documentId: 'doc-1',
  pageNumber: 1,
  tool: 'pencil',
  points: [{ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.3 }],
  color: '#444444',
  size: 3
}

let state = dispatchInteractionAction(workspace(), { type: 'ADD_INK_STROKE', payload: stroke })
assert.equal(state.inkStrokes?.length, 1)
assert.equal(state.inkStrokes?.[0].tool, 'pencil')
assert.equal(state.historyPast?.length, 1)

state = dispatchInteractionAction(state, { type: 'UNDO' })
assert.equal(state.inkStrokes?.length, 0)
assert.equal(state.historyFuture?.length, 1)

state = dispatchInteractionAction(state, { type: 'REDO' })
assert.equal(state.inkStrokes?.length, 1)

const textbox: SourceTextbox = {
  id: 'textbox-1',
  documentId: 'doc-1',
  pageNumber: 1,
  xNorm: 0.2,
  yNorm: 0.2,
  widthNorm: 0.2,
  heightNorm: 0.1,
  content: ''
}

state = dispatchInteractionAction(state, { type: 'ADD_SOURCE_TEXTBOX', payload: textbox })
state = dispatchInteractionAction(state, {
  type: 'UPDATE_SOURCE_TEXTBOX',
  payload: { ...textbox, content: 'updated' }
})
assert.equal(state.sourceTextboxes?.find((entry) => entry.id === textbox.id)?.content, 'updated')
state = dispatchInteractionAction(state, { type: 'UNDO' })
assert.equal(state.sourceTextboxes?.find((entry) => entry.id === textbox.id)?.content, '')

const highlight: FreeformHighlight = {
  id: 'highlight-1',
  documentId: 'doc-1',
  pageNumber: 1,
  points: [{ x: 0.5, y: 0.5 }, { x: 0.55, y: 0.55 }],
  color: '#ffee00',
  size: 18,
  opacity: 0.42
}

state = dispatchInteractionAction(workspace(), { type: 'ADD_FREEFORM_HIGHLIGHT', payload: highlight })
state = dispatchInteractionAction(state, {
  type: 'ERASE_AT_POINT',
  payload: { documentId: 'doc-1', pageNumber: 1, point: { x: 0.5, y: 0.5 }, size: 24 }
})
assert.equal(state.freeformHighlights?.length, 0)
state = dispatchInteractionAction(state, { type: 'UNDO' })
assert.equal(state.freeformHighlights?.length, 1)

const pageClearState = dispatchInteractionAction(
  workspace({
    freeformHighlights: [
      highlight,
      { ...highlight, id: 'highlight-2', pageNumber: 2 },
      { ...highlight, id: 'source-pane-highlight-1', pageNumber: undefined, surface: 'source-pane', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] },
      { ...highlight, id: 'workspace-highlight-1', pageNumber: undefined, surface: 'workspace', points: [{ x: 120, y: 130 }, { x: 180, y: 160 }] }
    ],
    inkStrokes: [
      stroke,
      { ...stroke, id: 'ink-2', pageNumber: 2 },
      { ...stroke, id: 'source-pane-ink-1', pageNumber: undefined, surface: 'source-pane', points: [{ x: 0.3, y: 0.3 }, { x: 0.4, y: 0.4 }] },
      { ...stroke, id: 'workspace-ink-1', pageNumber: undefined, surface: 'workspace', points: [{ x: 100, y: 100 }, { x: 150, y: 150 }] }
    ]
  }),
  { type: 'CLEAR_PAGE_INK', payload: { documentId: 'doc-1', pageNumber: 1 } }
)
assert.deepEqual(pageClearState.freeformHighlights?.map((entry) => entry.id), ['highlight-2', 'source-pane-highlight-1', 'workspace-highlight-1'])
assert.deepEqual(pageClearState.inkStrokes?.map((entry) => entry.id), ['ink-2', 'source-pane-ink-1', 'workspace-ink-1'])
assert.equal(pageClearState.historyPast?.length, 1)
const restoredPageClearState = dispatchInteractionAction(pageClearState, { type: 'UNDO' })
assert.equal(restoredPageClearState.freeformHighlights?.length, 4)
assert.equal(restoredPageClearState.inkStrokes?.length, 4)

state = dispatchInteractionAction(workspace(), {
  type: 'ADD_INK_STROKE',
  payload: { ...stroke, id: 'workspace-ink-add', pageNumber: undefined, surface: 'workspace', points: [{ x: 20, y: 20 }, { x: 40, y: 40 }] }
})
assert.equal(state.inkStrokes?.[0].surface, 'workspace')
state = dispatchInteractionAction(workspace({
  inkStrokes: [
    { ...stroke, id: 'source-pixel-segment-erase', points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }] }
  ]
}), {
  type: 'ERASE_AT_POINT',
  payload: { documentId: 'doc-1', pageNumber: 1, point: { x: 0.5, y: 0.112 }, size: 12, canvasSize: { width: 1000, height: 1000 } }
})
assert.equal(state.inkStrokes?.length, 0)

state = dispatchInteractionAction(workspace({
  inkStrokes: [
    { ...stroke, id: 'source-pixel-stroke-width-erase', size: 20, points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }] }
  ]
}), {
  type: 'ERASE_AT_POINT',
  payload: { documentId: 'doc-1', pageNumber: 1, point: { x: 0.5, y: 0.118 }, size: 8, canvasSize: { width: 1000, height: 1000 } }
})
assert.equal(state.inkStrokes?.length, 0)
state = dispatchInteractionAction(workspace({
  freeformHighlights: [{ ...highlight, id: 'workspace-highlight-erase', pageNumber: undefined, surface: 'workspace', points: [{ x: 200, y: 200 }, { x: 250, y: 250 }] }],
  inkStrokes: [
    { ...stroke, id: 'source-ink-safe', pageNumber: 1, surface: 'source', points: [{ x: 0.2, y: 0.2 }, { x: 0.25, y: 0.25 }] },
    { ...stroke, id: 'workspace-ink-erase', pageNumber: undefined, surface: 'workspace', points: [{ x: 20, y: 20 }, { x: 40, y: 40 }] }
  ]
}), {
  type: 'ERASE_WORKSPACE_INK_AT_POINT',
  payload: { documentId: 'doc-1', point: { x: 20, y: 20 }, size: 20 }
})
assert.deepEqual(state.inkStrokes?.map((entry) => entry.id), ['source-ink-safe'])
assert.equal(state.freeformHighlights?.length, 1)
state = dispatchInteractionAction(state, { type: 'UNDO' })
assert.equal(state.inkStrokes?.length, 2)

state = dispatchInteractionAction(workspace({
  inkStrokes: [
    { ...stroke, id: 'workspace-ink-segment-erase', pageNumber: undefined, surface: 'workspace', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }
  ]
}), {
  type: 'ERASE_WORKSPACE_INK_AT_POINT',
  payload: { documentId: 'doc-1', point: { x: 50, y: 8 }, size: 20 }
})
assert.equal(state.inkStrokes?.length, 0)

state = dispatchInteractionAction(workspace({
  inkStrokes: [
    { ...stroke, id: 'workspace-zoom-radius-erase', pageNumber: undefined, surface: 'workspace', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }
  ]
}), {
  type: 'ERASE_SURFACE_INK_AT_POINT',
  payload: { documentId: 'doc-1', surface: 'workspace', point: { x: 50, y: 3 }, size: 4 }
})
assert.equal(state.inkStrokes?.length, 0)

state = dispatchInteractionAction(workspace({
  inkStrokes: [
    { ...stroke, id: 'workspace-stroke-size-radius-erase', size: 20, pageNumber: undefined, surface: 'workspace', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }
  ]
}), {
  type: 'ERASE_SURFACE_INK_AT_POINT',
  payload: { documentId: 'doc-1', surface: 'workspace', point: { x: 50, y: 12 }, size: 4 }
})
assert.equal(state.inkStrokes?.length, 0)

state = dispatchInteractionAction(workspace({
  freeformHighlights: [{ ...highlight, id: 'source-pane-highlight-erase', pageNumber: undefined, surface: 'source-pane', points: [{ x: 0.2, y: 0.2 }, { x: 0.25, y: 0.25 }] }],
  inkStrokes: [
    { ...stroke, id: 'source-page-safe', pageNumber: 1, surface: 'source', points: [{ x: 0.2, y: 0.2 }, { x: 0.25, y: 0.25 }] },
    { ...stroke, id: 'source-pane-ink-erase', pageNumber: undefined, surface: 'source-pane', points: [{ x: 0.45, y: 0.45 }, { x: 0.5, y: 0.5 }] }
  ]
}), {
  type: 'ERASE_SURFACE_INK_AT_POINT',
  payload: { documentId: 'doc-1', surface: 'source-pane', point: { x: 0.45, y: 0.45 }, size: 24 }
})
assert.deepEqual(state.inkStrokes?.map((entry) => entry.id), ['source-page-safe'])
assert.equal(state.freeformHighlights?.length, 1)
state = dispatchInteractionAction(state, { type: 'UNDO' })
assert.equal(state.inkStrokes?.length, 2)

state = dispatchInteractionAction(workspace({
  inkStrokes: [
    { ...stroke, id: 'source-pane-stroke-size-radius-erase', size: 20, pageNumber: undefined, surface: 'source-pane', points: [{ x: 0.45, y: 0.45 }, { x: 0.5, y: 0.45 }] }
  ]
}), {
  type: 'ERASE_SURFACE_INK_AT_POINT',
  payload: { documentId: 'doc-1', surface: 'source-pane', point: { x: 0.47, y: 0.468 }, size: 8, canvasSize: { width: 1000, height: 1000 } }
})
assert.equal(state.inkStrokes?.length, 0)

const anchor: PageAnchor = {
  id: 'anchor-1',
  workspaceId: 'workspace-test',
  documentId: 'doc-1',
  pageNumber: 1,
  boundingBox: { x: 100, y: 100, width: 50, height: 30 },
  viewportScale: 1000,
  textQuote: 'linked',
  selectionColor: '#ff0000',
  tags: ['important'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}
const node: CanvasNode = {
  id: 'node-1',
  workspaceId: 'workspace-test',
  kind: 'excerpt',
  sourceAnchorId: anchor.id,
  documentId: 'doc-1',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}
state = dispatchInteractionAction(workspace({ anchors: [anchor], nodes: [node] }), {
  type: 'ERASE_AT_POINT',
  payload: { documentId: 'doc-1', pageNumber: 1, point: { x: 0.11, y: 0.11 }, size: 24 }
})
assert.equal(state.nodes.length, 1)
assert.equal(state.anchors.length, 1)
assert.equal(state.anchors[0].selectionColor, undefined)
assert.deepEqual(state.anchors[0].tags, [])

const excerpt: Excerpt = {
  id: 'excerpt-1',
  workspaceId: 'workspace-test',
  documentId: 'doc-1',
  pageNumber: 1,
  extractedText: 'text',
  boundingBox: { x: 0, y: 0, width: 10, height: 10 },
  viewportScale: 1,
  anchorId: anchor.id,
  normalizedHash: 'hash',
  selectionColor: '#ff0000',
  noteIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}
const edge: CanvasEdge = {
  id: 'edge-1',
  workspaceId: 'workspace-test',
  sourceAnchorId: anchor.id,
  targetNodeId: node.id,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}
const link: MobileWorkspaceLink = {
  id: 'link-1',
  fromNodeId: node.id,
  toNodeId: 'node-2',
  type: 'reference',
  createdAt: '2026-01-01T00:00:00.000Z'
}
state = dispatchInteractionAction(workspace(), {
  type: 'COMMIT_SOURCE_SNAPSHOT',
  before: workspace(),
  after: workspace({ anchors: [anchor], excerpts: [excerpt], nodes: [node], canvasEdges: [edge], workspaceLinks: [link] })
})
assert.equal(state.anchors.length, 1)
assert.equal(state.canvasEdges.length, 1)
assert.equal(state.workspaceLinks.length, 1)
state = dispatchInteractionAction(state, { type: 'UNDO' })
assert.equal(state.anchors.length, 0)
assert.equal(state.canvasEdges.length, 0)
assert.equal(state.workspaceLinks.length, 0)

state = workspace()
for (let index = 0; index < 105; index += 1) {
  state = dispatchInteractionAction(state, {
    type: 'ADD_INK_STROKE',
    payload: { ...stroke, id: `ink-${index}` }
  })
}
assert.equal(state.historyPast?.length, 100)

const page = {
  getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 })
} as HTMLElement
assert.deepEqual(normalizePointer(110, 70, page), { x: 0.5, y: 0.5 })
