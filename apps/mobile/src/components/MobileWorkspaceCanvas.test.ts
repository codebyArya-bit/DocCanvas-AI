import assert from 'node:assert/strict'
import {
  buildLinkedCommentNodeAndEdge,
  buildWorkspaceNodeLinkText,
  findFirstAvailableWorkspacePosition,
  resizeWorkspaceNodeBounds,
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
assert.equal(linkedComment.node.workspaceBoardId, 'default-board')
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

assert.deepEqual(
  resizeWorkspaceNodeBounds({
    direction: 'bottom-right',
    startX: 0,
    startY: 0,
    clientX: 60,
    clientY: 40,
    nodeX: 100,
    nodeY: 120,
    width: 280,
    height: 140,
    workspaceZoom: 2
  }),
  { x: 100, y: 120, width: 310, height: 160 }
)
assert.deepEqual(
  resizeWorkspaceNodeBounds({
    direction: 'top-left',
    startX: 0,
    startY: 0,
    clientX: 40,
    clientY: 20,
    nodeX: 100,
    nodeY: 120,
    width: 280,
    height: 140,
    workspaceZoom: 1
  }),
  { x: 140, y: 140, width: 240, height: 120 }
)
assert.deepEqual(
  resizeWorkspaceNodeBounds({
    direction: 'left',
    startX: 0,
    startY: 0,
    clientX: 200,
    clientY: 0,
    nodeX: 100,
    nodeY: 120,
    width: 280,
    height: 140,
    workspaceZoom: 1
  }),
  { x: 200, y: 120, width: 180, height: 140 }
)

const canvasSource = readFileSync(new URL('./MobileWorkspaceCanvas.tsx', import.meta.url), 'utf8')
assert.match(canvasSource, /const MIN_NODE_POSITION = -INFINITE_CANVAS_PADDING/)
assert.match(canvasSource, /const INFINITE_CANVAS_PADDING = 12000/)
assert.match(canvasSource, /const WORKSPACE_CANVAS_SURFACE_WIDTH = 12000/)
assert.match(canvasSource, /const WORKSPACE_CANVAS_SURFACE_HEIGHT = 9000/)
assert.match(canvasSource, /const WORKSPACE_INK_TOOL_MODES = new Set<ToolMode>\(\['pen', 'pencil', 'freeform-highlight', 'eraser'\]\)/)
assert.match(canvasSource, /workspace-canvas-viewport/)
assert.match(canvasSource, /className="mobile-canvas-grid workspace-canvas-surface"/)
assert.match(canvasSource, /width: WORKSPACE_CANVAS_SURFACE_WIDTH/)
assert.match(canvasSource, /height: WORKSPACE_CANVAS_SURFACE_HEIGHT/)
assert.match(canvasSource, /transform: `translate\(\$\{viewport\.panX\}px, \$\{viewport\.panY\}px\) scale\(\$\{viewport\.workspaceZoom\}\)`/)
assert.match(canvasSource, /function WorkspaceInkLayer/)
const workspaceInkLayerSource = canvasSource.slice(
  canvasSource.indexOf('function WorkspaceInkLayer'),
  canvasSource.indexOf('function resizeWorkspaceInkCanvas')
)
assert.match(workspaceInkLayerSource, /const pointerDownRef = useRef\(false\)/)
assert.match(workspaceInkLayerSource, /pointerDownRef\.current = true/)
assert.match(workspaceInkLayerSource, /if \(!active \|\| !settings \|\| !pointerDownRef\.current\) return/)
assert.match(workspaceInkLayerSource, /pointerDownRef\.current = false/)
assert.doesNotMatch(workspaceInkLayerSource, /event\.buttons !== 1/)
assert.match(canvasSource, /data-workspace-ink-canvas="true"/)
assert.match(canvasSource, /className="mobile-workspace-ink-canvas"/)
assert.match(canvasSource, /if \(locked \|\| isWorkspaceInkMode\) return/)
assert.match(canvasSource, /target\?\.closest\('\.mobile-canvas-node'\)/)
assert.match(canvasSource, /target\?\.closest\('\.workspace-switcher-panel'\)/)
assert.match(canvasSource, /event\.currentTarget\.setPointerCapture\(event\.pointerId\)/)
assert.match(canvasSource, /workspacePointFromPointer/)
assert.match(canvasSource, /event\.clientX - rect\.left - viewport\.panX/)
assert.match(canvasSource, /event\.clientY - rect\.top - viewport\.panY/)
assert.match(canvasSource, /drawWorkspaceInkFrame/)
assert.match(canvasSource, /getCoalescedPointerEvents\(event\.nativeEvent\)/)
assert.match(canvasSource, /getPredictedInkPoint\(draft\.points\)/)
assert.match(canvasSource, /const previewPoints = predicted \? \[\.\.\.draft\.points, predicted\] : draft\.points/)
assert.match(canvasSource, /surface: 'workspace'/)
assert.match(canvasSource, /onWorkspaceEraseInk/)
assert.match(canvasSource, /workspaceBoards\?: Array<\{ id: string; name: string; documentId\?: string \}>/)
assert.match(canvasSource, /activeWorkspaceBoardId\?: string \| null/)
assert.match(canvasSource, /onOpenWorkspaceSwitcher\?: \(\) => void/)
assert.match(canvasSource, /const activeBoardId = activeWorkspaceBoardId \?\? 'default-board'/)
assert.match(canvasSource, /\(node\.workspaceBoardId \?\? 'default-board'\) === activeBoardId/)
assert.match(canvasSource, /aria-label="Open Workspaces"/)
assert.match(canvasSource, /onOpenWorkspaceSwitcher\?\.\(\)/)
assert.doesNotMatch(canvasSource, /aria-label="Add Workspace Card"[\s\S]*onCreateNode\('comment'\)/)
assert.match(canvasSource, /aria-label="Add Workspace Textbox"/)
assert.match(canvasSource, /onCreateNode\('text'\)/)
assert.match(canvasSource, /Math\.max\(MIN_NODE_POSITION, dragging\.nodeX/)
assert.match(canvasSource, /Math\.max\(MIN_NODE_POSITION, x\)/)
assert.match(canvasSource, /onFocus=\{\(\) => \{\s*onActiveNodeChange\(node\.id\)\s*setToolbarNodeId\(node\.id\)/s)
assert.match(canvasSource, /function handleNodePointerDown\(/)
assert.match(canvasSource, /if \(linkingFrom\) commitLink\(node\.id\)/)
assert.match(canvasSource, /onPointerDown=\{\(event\) => handleNodePointerDown\(event, node\)\}/)
assert.match(canvasSource, /onPointerDown=\{\(event\) => \{\s*handleNodePointerDown\(event, node\)/s)
assert.match(canvasSource, /if \(linkingFrom\) \{\s*commitLink\(node\.id\)\s*return\s*\}/s)
assert.match(canvasSource, /const x1 = from\.x \+ from\.width\s*const y1 = from\.y\s*const x2 = to\.x \+ to\.width\s*const y2 = to\.y/s)
assert.doesNotMatch(canvasSource, /const x2 = to\.x\s*const y2 = to\.y \+ Math\.min\(to\.height \/ 2, 48\)/)
assert.match(canvasSource, /const \[linkPreviewPoint, setLinkPreviewPoint\] = useState<\{ x: number; y: number \} \| null>\(null\)/)
assert.match(canvasSource, /function updateLinkPreviewPoint\(clientX: number, clientY: number\)/)
assert.match(canvasSource, /if \(linkingFrom && !dragging\) \{\s*updateLinkPreviewPoint\(event\.clientX, event\.clientY\)\s*return\s*\}/s)
assert.match(canvasSource, /const previewFrom = linkingFrom \? documentNodes\.find\(\(node\) => node\.id === linkingFrom\) : null/)
assert.match(canvasSource, /className="workspace-node-link-visible workspace-node-link-preview"/)
assert.match(canvasSource, /setLinkPreviewPoint\(null\)/)
assert.match(canvasSource, /resizeWorkspaceNodeBounds\(\{/)
assert.match(canvasSource, /const resizeDirections: NodeResizeDirection\[\] = \['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'\]/)
assert.match(canvasSource, /className=\{`workspace-node-resize-handle workspace-node-resize-\$\{direction\}`\}/)
assert.match(canvasSource, /function MobileCommentEditor/)
const mobileCommentEditorSource = canvasSource.slice(
  canvasSource.indexOf('function MobileCommentEditor'),
  canvasSource.indexOf('function WorkspaceInkLayer')
)
assert.match(mobileCommentEditorSource, /const editorRef = useRef<HTMLDivElement \| null>\(null\)/)
assert.match(mobileCommentEditorSource, /useLayoutEffect\(\(\) => \{[\s\S]*document\.activeElement === editor[\s\S]*editor\.textContent !== text/s)
assert.match(mobileCommentEditorSource, /dir="ltr"/)
assert.match(mobileCommentEditorSource, /onInput=\{\(event\) => onTextChange\(event\.currentTarget\.textContent \?\? ''\)\}/)
assert.doesNotMatch(mobileCommentEditorSource, /\{text \?\? ''\}/)
assert.match(canvasSource, /const knownNodeIdsRef = useRef<Set<string>>\(new Set\(\)\)/)
assert.match(canvasSource, /function revealWorkspaceNode\(node: CanvasNode\)/)
assert.match(canvasSource, /const isNewActiveNode =[\s\S]*active &&[\s\S]*!knownNodeIdsRef\.current\.has\(active\.id\)[\s\S]*\(active\.kind === 'excerpt' \|\| active\.kind === 'comment' \|\| active\.kind === 'text'\)/)
assert.match(canvasSource, /revealWorkspaceNode\(active\)/)
assert.match(canvasSource, /onViewportChange\(clampWorkspaceViewport\(\{ \.\.\.viewport, panX: nextPanX, panY: nextPanY \}\)\)/)
assert.match(canvasSource, /focusNodeEditor\(node\.id\)/)

console.log('Mobile workspace canvas toolbar helper tests passed')
