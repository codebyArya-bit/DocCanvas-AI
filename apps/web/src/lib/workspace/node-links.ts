'use client'

export interface WorkspaceNodeLink {
  id: string
  fromNodeId: string
  toNodeId: string
  type: 'reference' | 'flow'
  createdAt: string
  updatedAt: string
}

export interface WorkspaceLinkingState {
  fromNodeId: string
  startX: number
  startY: number
  currentX: number
  currentY: number
}

export function buildWorkspaceNodeLink(fromNodeId: string, toNodeId: string, type: WorkspaceNodeLink['type'] = 'reference'): WorkspaceNodeLink {
  const now = new Date().toISOString()
  return {
    id: `workspace-link-${fromNodeId}-${toNodeId}-${Date.now()}`,
    fromNodeId,
    toNodeId,
    type,
    createdAt: now,
    updatedAt: now
  }
}
