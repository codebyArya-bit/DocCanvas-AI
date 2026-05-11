import type { Bookmark, CanvasEdge, CanvasNode, Document, Excerpt, Note, PageAnchor } from '@workspace/domain'
import type { WorkspaceNodeLink } from './node-links'

export interface PersistedPdfDocument {
  record: Document
  bytes: Uint8Array
}

export interface WorkspacePersistenceState {
  document: PersistedPdfDocument | null
  anchors: PageAnchor[]
  excerpts: Excerpt[]
  bookmarks: Bookmark[]
  canvasNodes: CanvasNode[]
  canvasEdges: CanvasEdge[]
  workspaceLinks: WorkspaceNodeLink[]
  activeAnchorId: string | null
  activeNote?: Note
}
