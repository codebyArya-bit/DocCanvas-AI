import assert from 'node:assert/strict'
import {
  buildLinkedCommentNodeAndEdge,
  buildWorkspaceNodeLinkText,
  findFirstAvailableWorkspacePosition,
  parseWorkspaceToolbarTags
} from './MobileWorkspaceCanvas'
import type { CanvasNode } from '@workspace/domain'
import { readFileSync } from 'node:fs'

assert.deepEqual(parseWorkspaceToolbarTags(' alpha, beta ,, gamma '), ['alpha', 'beta', 'gamma'])
assert.deepEqual(parseWorkspaceToolbarTags(''), [])

assert.equal(buildWorkspaceNodeLinkText({ id: 'node-1' }), 'node:node-1')
assert.equal(
  buildWorkspaceNodeLinkText({ id: 'node-1', sourceAnchorId: 'anchor-1' }),
  'anchor:anchor-1'
)

const sourceNode: CanvasNode = {
  id: 'excerpt-node-1',
  workspaceId: 'workspace-1',
  kind: 'excerpt',
  excerptId: 'excerpt-1',
  documentId: 'document-1',
  sourceAnchorId: 'anchor-1',
  selectionColor: '#ffd400',
  title: 'Excerpt',
  text: 'Selected text',
  tags: ['alpha'],
  textStyle: { fontSize: 18 },
  x: 100,
  y: 120,
  width: 280,
  height: 140,
  createdAt: '2026-05-08T00:00:00.000Z',
  updatedAt: '2026-05-08T00:00:00.000Z'
}

const linkedComment = buildLinkedCommentNodeAndEdge(sourceNode, [sourceNode])
assert.ok(linkedComment)
assert.equal(linkedComment.node.kind, 'comment')
assert.equal(linkedComment.node.title, 'Comment')
assert.equal(linkedComment.node.text, '')
assert.equal(linkedComment.node.sourceAnchorId, 'anchor-1')
assert.deepEqual(linkedComment.node.tags, ['alpha'])
assert.deepEqual(linkedComment.node.textStyle, { fontSize: 18 })
assert.equal(linkedComment.edge.sourceAnchorId, 'anchor-1')
assert.equal(linkedComment.edge.targetNodeId, linkedComment.node.id)
assert.equal(linkedComment.edge.kind, 'auto')

const occupied = { ...sourceNode, id: 'occupied', x: 408, y: 120, width: 300, height: 156 }
const position = findFirstAvailableWorkspacePosition(
  [
    { x: 408, y: 120, width: 300, height: 156 },
    { x: -228, y: 120, width: 300, height: 156 }
  ],
  [sourceNode, occupied]
)
assert.deepEqual(position, { x: -228, y: 120, width: 300, height: 156 })

const canvasSource = readFileSync(new URL('./MobileWorkspaceCanvas.tsx', import.meta.url), 'utf8')
assert.match(canvasSource, /const MIN_NODE_POSITION = -INFINITE_CANVAS_PADDING/)
assert.match(canvasSource, /const WORKSPACE_CANVAS_SURFACE_WIDTH = 2200/)
assert.match(canvasSource, /const WORKSPACE_CANVAS_SURFACE_HEIGHT = 1800/)
assert.match(canvasSource, /const WORKSPACE_INK_TOOL_MODES = new Set<ToolMode>\(\['pen', 'pencil', 'freeform-highlight', 'eraser'\]\)/)
assert.match(canvasSource, /workspace-canvas-viewport/)
assert.match(canvasSource, /className="mobile-canvas-grid workspace-canvas-surface"/)
assert.match(canvasSource, /width: WORKSPACE_CANVAS_SURFACE_WIDTH/)
assert.match(canvasSource, /height: WORKSPACE_CANVAS_SURFACE_HEIGHT/)
assert.match(canvasSource, /transform: `translate\(\$\{viewport\.panX\}px, \$\{viewport\.panY\}px\) scale\(\$\{viewport\.workspaceZoom\}\)`/)
assert.match(canvasSource, /function WorkspaceInkLayer/)
assert.match(canvasSource, /data-workspace-ink-canvas="true"/)
assert.match(canvasSource, /className="mobile-workspace-ink-canvas"/)
assert.match(canvasSource, /isWorkspaceInkMode \|\| event\.target !== event\.currentTarget/)
assert.match(canvasSource, /workspacePointFromPointer/)
assert.match(canvasSource, /event\.clientX - rect\.left - viewport\.panX/)
assert.match(canvasSource, /event\.clientY - rect\.top - viewport\.panY/)
assert.match(canvasSource, /drawLiveWorkspaceInkSegment/)
assert.match(canvasSource, /surface: 'workspace'/)
assert.match(canvasSource, /onWorkspaceEraseInk/)
assert.match(canvasSource, /Math\.max\(MIN_NODE_POSITION, dragging\.nodeX/)
assert.match(canvasSource, /Math\.max\(MIN_NODE_POSITION, x\)/)
assert.match(canvasSource, /onFocus=\{\(\) => \{\s*onActiveNodeChange\(node\.id\)\s*setToolbarNodeId\(node\.id\)/s)

console.log('Mobile workspace canvas toolbar helper tests passed')
