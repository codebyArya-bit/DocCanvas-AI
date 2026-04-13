import type { CreateExcerptInput, WorkspaceSnapshot } from '@workspace/domain'

export interface StorageModule {
  getWorkspace(workspaceId: string): Promise<WorkspaceSnapshot>
  createExcerpt(input: CreateExcerptInput): Promise<void>
  saveMarkdownReport(workspaceId: string, markdown: string): Promise<{ storageKey: string }>
}

export class MemoryStorage implements StorageModule {
  private readonly workspaces = new Map<string, WorkspaceSnapshot>()

  async getWorkspace(workspaceId: string): Promise<WorkspaceSnapshot> {
    return (
      this.workspaces.get(workspaceId) ?? {
        documents: [],
        anchors: [],
        excerpts: [],
        bookmarks: [],
        nodes: [],
        edges: [],
        notes: [],
        sessions: []
      }
    )
  }

  async createExcerpt(_input: CreateExcerptInput): Promise<void> {}

  async saveMarkdownReport(workspaceId: string, _markdown: string) {
    return { storageKey: `reports/${workspaceId}.md` }
  }
}
