export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface Document {
  id: string
  workspaceId: string
  title: string
  storageKey: string
  mimeType: string
  pageCount: number
  checksum: string
  createdAt: string
  updatedAt: string
}

export interface PageAnchor {
  id: string
  workspaceId: string
  documentId: string
  pageNumber: number
  startSpanIndex?: number
  startOffset?: number
  endSpanIndex?: number
  endOffset?: number
  boundingBox: BoundingBox
  quadPoints?: number[]
  viewportScale: number
  textQuote: string
  selectionColor?: string
  tags?: string[]
  createdAt: string
  updatedAt: string
}

export interface CreateExcerptInput {
  workspaceId: string
  documentId: string
  pageNumber: number
  extractedText: string
  boundingBox: BoundingBox
  quadPoints?: number[]
  viewportScale: number
}

export interface Excerpt extends CreateExcerptInput {
  id: string
  anchorId: string
  normalizedHash: string
  selectionColor: string
  tags?: string[]
  noteIds: string[]
  createdAt: string
  updatedAt: string
}

export interface TextStyle {
  fontFamily?: string
  fontSize?: number
  fontWeight?: 'normal' | 'bold'
  fontStyle?: 'normal' | 'italic'
  underline?: boolean
  strikethrough?: boolean
  color?: string
  backgroundColor?: string
  preset?: 'body' | 'heading-1' | 'heading-2' | 'quote'
}

export interface CanvasNode {
  id: string
  workspaceId: string
  kind: 'excerpt' | 'comment' | 'note' | 'text'
  excerptId?: string
  documentId?: string
  sourceAnchorId?: string
  selectionColor?: string
  nodeColor?: string
  title?: string
  text?: string
  prosemirrorJson?: Record<string, unknown>
  tags?: string[]
  textStyle?: TextStyle
  x: number
  y: number
  width: number
  height: number
  visible?: boolean
  createdAt: string
  updatedAt: string
}

export interface CanvasEdge {
  id: string
  workspaceId: string
  sourceNodeId?: string
  sourceAnchorId: string
  targetNodeId: string
  kind?: 'auto' | 'manual'
  color?: string
  controlBias?: number
  label?: string
  createdAt: string
  updatedAt: string
}

export interface Note {
  id: string
  workspaceId: string
  title: string
  excerptIds: string[]
  documentIds: string[]
  prosemirrorJson: Record<string, unknown>
  x: number
  y: number
  width: number
  height: number
  createdAt: string
  updatedAt: string
}

export interface Bookmark {
  id: string
  workspaceId: string
  documentId: string
  sourceAnchorId: string
  bookmarkLabel: string
  documentOrder: number
  selectionColor: string
  tags?: string[]
  createdAt: string
  updatedAt: string
}

export interface UserSession {
  id: string
  workspaceId: string
  userId: string
  displayName?: string
  color?: string
  lastSeenAt: string
  createdAt: string
  updatedAt: string
}

export interface WorkspaceSnapshot {
  documents: Document[]
  anchors: PageAnchor[]
  excerpts: Excerpt[]
  bookmarks: Bookmark[]
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  notes: Note[]
  sessions: UserSession[]
}
