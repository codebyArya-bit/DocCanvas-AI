import assert from 'node:assert/strict'
import type { MobileDocumentRecord, MobileWorkspaceState } from './mobile-store'
import {
  buildDmapFileName,
  buildImportedDmapProject,
  createDmapProjectBundle,
  listZipEntryNames,
  parseDmapProjectBundle
} from './dmap-project'

const now = '2026-05-26T00:00:00.000Z'
const pdfBytes = new Uint8Array([37, 80, 68, 70, 45, 49])

const record: MobileDocumentRecord = {
  document: {
    id: 'doc-1',
    workspaceId: 'workspace-mobile-local',
    title: 'My Project.pdf',
    storageKey: 'My Project.pdf',
    mimeType: 'application/pdf',
    pageCount: 3,
    checksum: '6-37-70-49',
    createdAt: now,
    updatedAt: now
  },
  bytes: pdfBytes,
  sourceType: 'pdf',
  sourceKind: 'pdf',
  lastOpenedAt: now
}

const workspace: MobileWorkspaceState = {
  workspaceId: 'workspace-mobile-local',
  nodes: [{ id: 'node-1', workspaceId: 'workspace-mobile-local', documentId: 'doc-1', kind: 'comment', title: 'Comment', text: 'Hello', x: 1, y: 2, width: 3, height: 4, createdAt: now, updatedAt: now }],
  anchors: [{ id: 'anchor-1', workspaceId: 'workspace-mobile-local', documentId: 'doc-1', pageNumber: 1, boundingBox: { x: 1, y: 1, width: 1, height: 1 }, viewportScale: 1, textQuote: 'Quote', createdAt: now, updatedAt: now }],
  excerpts: [],
  bookmarks: [],
  canvasEdges: [],
  workspaceLinks: [{ id: 'link-1', fromNodeId: 'node-1', toNodeId: 'node-2', type: 'reference', createdAt: now }],
  workspaceBoards: [{ id: 'board-1', documentId: 'doc-1', name: 'Board', createdAt: now, updatedAt: now }],
  activeWorkspaceBoardId: 'board-1',
  workspaceViewport: { panX: 10, panY: 20, workspaceZoom: 1.2 },
  toolSettings: { pen: { color: '#111', size: 2 }, pencil: { color: '#222', size: 2, opacity: 0.5 }, highlight: { color: '#ff0', size: 8, opacity: 0.3, smoothed: true }, eraser: { size: 20 } },
  viewerStateByDocument: { 'doc-1': { viewerZoom: 1, sourceZoom: 1, workspaceZoom: 1, scrollPosition: 0, activePage: 2 } },
  viewerLayout: { splitRatio: 0.5, sourceToolsOpen: true, toolRailSide: 'left' },
  settings: { syncEnabled: false, displayDensity: 'comfortable' },
  textHighlights: [],
  freeformHighlights: [],
  inkStrokes: [],
  sourceTextboxes: [],
  sourceBookmarks: [],
  pageEdits: [],
  globalTags: [{ id: 'tag-1', category: 'Issue', name: 'Issue', color: '#f00', createdAt: now, updatedAt: now }],
  activeDocumentId: 'doc-1',
  updatedAt: now
}

const bundleBytes = await createDmapProjectBundle(record, workspace, { exportedAt: now })
const entryNames = listZipEntryNames(bundleBytes)
assert.deepEqual(entryNames.sort(), ['annotations.json', 'document.pdf', 'manifest.json', 'workspace.json'])

const parsed = await parseDmapProjectBundle(bundleBytes)
assert.equal(parsed.manifest.format, 'documind-project')
assert.equal(parsed.manifest.document.file, 'document.pdf')
assert.deepEqual(parsed.pdfBytes, pdfBytes)
assert.equal(parsed.workspace.nodes[0]?.id, 'node-1')
assert.equal(parsed.annotations.anchors[0]?.id, 'anchor-1')

await assert.rejects(
  () => parseDmapProjectBundle(new Uint8Array([1, 2, 3])),
  /Invalid \.dmap file/
)

const missingPdf = await createDmapProjectBundle({ ...record, bytes: undefined }, workspace, { exportedAt: now, includeDocumentPdf: false })
await assert.rejects(
  () => parseDmapProjectBundle(missingPdf),
  /document\.pdf is missing/
)

const imported = await buildImportedDmapProject(parsed, { fileName: 'backup.dmap', documentId: 'doc-imported', importedAt: now })
assert.equal(imported.record.document.id, 'doc-imported')
assert.deepEqual(imported.record.bytes, pdfBytes)
assert.equal(imported.workspace.activeDocumentId, 'doc-imported')
assert.equal(imported.workspace.nodes[0]?.documentId, 'doc-imported')
assert.equal(imported.workspace.anchors[0]?.documentId, 'doc-imported')
assert.equal(imported.workspace.workspaceBoards?.[0]?.documentId, 'doc-imported')
assert.ok(imported.workspace.viewerStateByDocument['doc-imported'])

assert.equal(buildDmapFileName('My Project.pdf'), 'my-project.dmap')

console.log('DMAP project bundle tests passed')
