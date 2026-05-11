import type { CanvasNode } from '@workspace/domain'

export type CrudResult<T> = { ok: true; value: T } | { ok: false; error: string }

export type CanvasNodePatch = Partial<Omit<CanvasNode, 'id' | 'workspaceId' | 'createdAt'>>

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validateNodeBasics(node: CanvasNode): string | null {
  if (!node.id) {
    return 'CanvasNode.id is required'
  }
  if (!node.workspaceId) {
    return 'CanvasNode.workspaceId is required'
  }
  if (!isFiniteNumber(node.x) || !isFiniteNumber(node.y)) {
    return 'CanvasNode.x/y must be finite numbers'
  }
  if (!isFiniteNumber(node.width) || !isFiniteNumber(node.height)) {
    return 'CanvasNode.width/height must be finite numbers'
  }
  if (node.width <= 0 || node.height <= 0) {
    return 'CanvasNode.width/height must be > 0'
  }
  if (!node.createdAt || !node.updatedAt) {
    return 'CanvasNode.createdAt/updatedAt are required'
  }
  return null
}

/**
 * Adds a validated node while rejecting duplicate ids.
 */
export function createCanvasNode(nodes: CanvasNode[], node: CanvasNode): CrudResult<CanvasNode[]> {
  const error = validateNodeBasics(node)
  if (error) {
    return { ok: false, error }
  }

  if (nodes.some((entry) => entry.id === node.id)) {
    return { ok: false, error: `CanvasNode with id "${node.id}" already exists` }
  }

  return { ok: true, value: [...nodes, node] }
}

/**
 * Returns a single node by id with a clear not-found error.
 */
export function readCanvasNode(nodes: CanvasNode[], nodeId: string): CrudResult<CanvasNode> {
  if (!nodeId) {
    return { ok: false, error: 'nodeId is required' }
  }

  const node = nodes.find((entry) => entry.id === nodeId)
  if (!node) {
    return { ok: false, error: `CanvasNode with id "${nodeId}" not found` }
  }

  return { ok: true, value: node }
}

/**
 * Merges a patch onto an existing node and validates the result.
 */
export function updateCanvasNode(
  nodes: CanvasNode[],
  nodeId: string,
  patch: CanvasNodePatch
): CrudResult<CanvasNode[]> {
  const current = nodes.find((entry) => entry.id === nodeId)
  if (!current) {
    return { ok: false, error: `CanvasNode with id "${nodeId}" not found` }
  }

  const updated: CanvasNode = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  }

  const error = validateNodeBasics(updated)
  if (error) {
    return { ok: false, error }
  }

  return {
    ok: true,
    value: nodes.map((entry) => (entry.id === nodeId ? updated : entry))
  }
}

/**
 * Removes a node by id and preserves the remaining collection.
 */
export function deleteCanvasNode(nodes: CanvasNode[], nodeId: string): CrudResult<CanvasNode[]> {
  if (!nodeId) {
    return { ok: false, error: 'nodeId is required' }
  }

  if (!nodes.some((entry) => entry.id === nodeId)) {
    return { ok: false, error: `CanvasNode with id "${nodeId}" not found` }
  }

  return {
    ok: true,
    value: nodes.filter((entry) => entry.id !== nodeId)
  }
}
