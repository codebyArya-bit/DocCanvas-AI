import assert from 'node:assert/strict'
import type { CanvasNode } from '@workspace/domain'
import { createCanvasNode, deleteCanvasNode, readCanvasNode, updateCanvasNode } from './canvas-node-crud'

function makeNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  const now = new Date('2020-01-01T00:00:00.000Z').toISOString()
  return {
    id: 'n-1',
    workspaceId: 'w-1',
    kind: 'text',
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    visible: true,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

{
  const created = createCanvasNode([], makeNode())
  assert.equal(created.ok, true)
  assert.equal(created.ok && created.value.length, 1)
}

{
  const created = createCanvasNode([makeNode({ id: 'dup' })], makeNode({ id: 'dup' }))
  assert.equal(created.ok, false)
}

{
  const read = readCanvasNode([makeNode({ id: 'read-me' })], 'read-me')
  assert.equal(read.ok, true)
  assert.equal(read.ok && read.value.id, 'read-me')
}

{
  const updated = updateCanvasNode([makeNode({ id: 'u-1', width: 50 })], 'u-1', { width: 60 })
  assert.equal(updated.ok, true)
  assert.equal(updated.ok && updated.value[0]?.width, 60)
}

{
  const updated = updateCanvasNode([makeNode({ id: 'u-2', width: 50 })], 'u-2', { width: -1 })
  assert.equal(updated.ok, false)
}

{
  const deleted = deleteCanvasNode([makeNode({ id: 'd-1' })], 'd-1')
  assert.equal(deleted.ok, true)
  assert.equal(deleted.ok && deleted.value.length, 0)
}

{
  const deleted = deleteCanvasNode([], 'missing')
  assert.equal(deleted.ok, false)
}
