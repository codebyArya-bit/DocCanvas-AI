export type EntityId = string;
export type ISODateString = string;
export interface AuditFields {
    id: EntityId;
    createdAt: ISODateString;
    updatedAt: ISODateString;
}
export interface Document extends AuditFields {
    workspaceId: EntityId;
    title: string;
    sourceUrl?: string;
    storageKey: string;
    mimeType: 'application/pdf';
    pageCount: number;
    checksum: string;
}
export interface PageAnchor extends AuditFields {
    documentId: EntityId;
    pageNumber: number;
    boundingBox: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    quadPoints?: number[];
    viewportScale: number;
    textQuote: string;
}
export interface Excerpt extends AuditFields {
    workspaceId: EntityId;
    documentId: EntityId;
    anchorId: EntityId;
    extractedText: string;
    normalizedHash: string;
    sourceColor: string;
    noteIds: EntityId[];
    canvasNodeId?: EntityId;
}
export type CanvasNodeKind = 'excerpt' | 'note' | 'text' | 'document';
export interface CanvasNode extends AuditFields {
    workspaceId: EntityId;
    kind: CanvasNodeKind;
    x: number;
    y: number;
    width: number;
    height: number;
    documentId?: EntityId;
    excerptId?: EntityId;
    noteId?: EntityId;
    text?: string;
}
export interface CanvasEdge extends AuditFields {
    workspaceId: EntityId;
    sourceNodeId: EntityId;
    targetNodeId: EntityId;
    label?: string;
    semanticType: 'reference' | 'supports' | 'contradicts' | 'related';
}
export interface Note extends AuditFields {
    workspaceId: EntityId;
    title: string;
    documentIds: EntityId[];
    excerptIds: EntityId[];
    prosemirrorJson: Record<string, unknown>;
}
export interface UserSession extends AuditFields {
    workspaceId: EntityId;
    userId: EntityId;
    displayName: string;
    color: string;
    cursor?: {
        x: number;
        y: number;
    };
    activeDocumentId?: EntityId;
    activeNoteId?: EntityId;
    lastSeenAt: ISODateString;
}
export interface WorkspaceSnapshot {
    documents: Document[];
    anchors: PageAnchor[];
    excerpts: Excerpt[];
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    notes: Note[];
    sessions: UserSession[];
}
export interface CreateExcerptInput {
    workspaceId: EntityId;
    documentId: EntityId;
    pageNumber: number;
    extractedText: string;
    boundingBox: PageAnchor['boundingBox'];
    quadPoints?: number[];
    viewportScale: number;
}
