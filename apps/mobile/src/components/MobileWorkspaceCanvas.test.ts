import assert from 'node:assert/strict'
import {
  buildLinkedCommentNodeAndEdge,
  buildWorkspaceNodeLinkText,
  findFirstAvailableWorkspacePosition,
  parseWorkspaceToolbarTags
} from './MobileWorkspaceCanvas'
import type { CanvasNode } from '@workspace/domain'

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

console.log('Mobile workspace canvas toolbar helper tests passed')
