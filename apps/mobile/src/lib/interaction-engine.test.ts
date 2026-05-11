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
