import type { CanvasNode, PageAnchor } from '@workspace/domain'
import {
  buildChecksum,
  normalizeMobileWorkspaceState,
  type FreeformHighlight,
  type InkStroke,
  type MobileDocumentRecord,
  type MobileWorkspaceBoard,
  type MobileWorkspaceState,
  type PageEdit,
  type SourceBookmark,
  type SourceTextbox,
  type TextHighlight
} from './mobile-store'

const DMAP_FORMAT = 'documind-project'
const DMAP_VERSION = 1
const DOCUMENT_FILE = 'document.pdf'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export type DmapManifest = {
  format: 'documind-project'
  version: 1
  app: 'DocuMind'
  exportedAt: string
  document: {
    title: string
    pageCount: number
    file: 'document.pdf'
  }
}

export type DmapWorkspacePayload = Pick<
  MobileWorkspaceState,
  | 'nodes'
  | 'canvasEdges'
  | 'workspaceLinks'
  | 'workspaceBoards'
  | 'activeWorkspaceBoardId'
  | 'workspaceViewport'
  | 'viewerStateByDocument'
  | 'viewerLayout'
  | 'settings'
>

export type DmapAnnotationsPayload = {
  anchors: MobileWorkspaceState['anchors']
  excerpts: MobileWorkspaceState['excerpts']
  bookmarks: MobileWorkspaceState['bookmarks']
  sourceBookmarks: MobileWorkspaceState['sourceBookmarks']
  textHighlights: MobileWorkspaceState['textHighlights']
  freeformHighlights: MobileWorkspaceState['freeformHighlights']
  inkStrokes: MobileWorkspaceState['inkStrokes']
  sourceTextboxes: MobileWorkspaceState['sourceTextboxes']
  pageEdits: MobileWorkspaceState['pageEdits']
  globalTags: MobileWorkspaceState['globalTags']
}

export type ParsedDmapProject = {
  manifest: DmapManifest
  pdfBytes: Uint8Array
  workspace: DmapWorkspacePayload
  annotations: DmapAnnotationsPayload
}

export async function createDmapProjectBundle(
  record: MobileDocumentRecord,
  workspace: MobileWorkspaceState,
  options: { exportedAt?: string; includeDocumentPdf?: boolean } = {}
) {
  if (options.includeDocumentPdf !== false && !record.bytes) {
    throw new Error('Current PDF bytes are unavailable for .dmap export.')
  }
  const manifest: DmapManifest = {
    format: DMAP_FORMAT,
    version: DMAP_VERSION,
    app: 'DocuMind',
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    document: {
      title: record.document.title,
      pageCount: record.document.pageCount,
      file: DOCUMENT_FILE
    }
  }
  const entries: Record<string, Uint8Array> = {
    'manifest.json': encodeJson(manifest),
    'workspace.json': encodeJson(buildWorkspacePayload(workspace)),
    'annotations.json': encodeJson(buildAnnotationsPayload(workspace))
  }
  if (options.includeDocumentPdf !== false) {
    entries[DOCUMENT_FILE] = record.bytes ?? new Uint8Array()
  }
  return createZipStore(entries)
}

export async function parseDmapProjectBundle(bytes: Uint8Array): Promise<ParsedDmapProject> {
  let entries: Record<string, Uint8Array>
  try {
    entries = readZipStore(bytes)
  } catch {
    throw new Error('Invalid .dmap file.')
  }

  const manifestBytes = entries['manifest.json']
  if (!manifestBytes) throw new Error('Invalid .dmap file: manifest.json is missing.')
  const manifest = decodeJson<DmapManifest>(manifestBytes)
  if (manifest.format !== DMAP_FORMAT || manifest.version !== DMAP_VERSION) {
    throw new Error('Unsupported .dmap project format.')
  }

  const pdfBytes = entries[manifest.document?.file ?? DOCUMENT_FILE]
  if (!pdfBytes) throw new Error('Invalid .dmap file: document.pdf is missing.')
  const workspaceBytes = entries['workspace.json']
  const annotationsBytes = entries['annotations.json']
  if (!workspaceBytes) throw new Error('Invalid .dmap file: workspace.json is missing.')
  if (!annotationsBytes) throw new Error('Invalid .dmap file: annotations.json is missing.')

  return {
    manifest,
    pdfBytes,
    workspace: decodeJson<DmapWorkspacePayload>(workspaceBytes),
    annotations: decodeJson<DmapAnnotationsPayload>(annotationsBytes)
  }
}

export async function buildImportedDmapProject(
  parsed: ParsedDmapProject,
  options: { fileName?: string; documentId?: string; importedAt?: string } = {}
) {
  const now = options.importedAt ?? new Date().toISOString()
  const documentId = options.documentId ?? `mobile-document-dmap-${crypto.randomUUID()}`
  const title = parsed.manifest.document.title || options.fileName?.replace(/\.dmap$/i, '') || 'Imported project.pdf'
  const record: MobileDocumentRecord = {
    document: {
      id: documentId,
      workspaceId: 'workspace-mobile-local',
      title,
      storageKey: title,
      mimeType: 'application/pdf',
      pageCount: parsed.manifest.document.pageCount,
      checksum: buildChecksum(parsed.pdfBytes),
      createdAt: now,
      updatedAt: now
    },
    bytes: parsed.pdfBytes,
    sourceType: 'pdf',
    sourceKind: 'pdf',
    lastOpenedAt: now
  }

  const sourceDocumentIds = findSourceDocumentIds(parsed)
  const workspace = normalizeMobileWorkspaceState({
    workspaceId: 'workspace-mobile-local',
    ...parsed.workspace,
    ...parsed.annotations,
    nodes: remapDocumentItems(parsed.workspace.nodes ?? [], sourceDocumentIds, documentId),
    anchors: remapDocumentItems(parsed.annotations.anchors ?? [], sourceDocumentIds, documentId),
    excerpts: remapDocumentItems(parsed.annotations.excerpts ?? [], sourceDocumentIds, documentId),
    bookmarks: remapDocumentItems(parsed.annotations.bookmarks ?? [], sourceDocumentIds, documentId),
    canvasEdges: parsed.workspace.canvasEdges ?? [],
    workspaceLinks: parsed.workspace.workspaceLinks ?? [],
    workspaceBoards: remapDocumentItems(parsed.workspace.workspaceBoards ?? [], sourceDocumentIds, documentId),
    sourceBookmarks: remapDocumentItems(parsed.annotations.sourceBookmarks ?? [], sourceDocumentIds, documentId),
    textHighlights: remapDocumentItems(parsed.annotations.textHighlights ?? [], sourceDocumentIds, documentId),
    freeformHighlights: remapDocumentItems(parsed.annotations.freeformHighlights ?? [], sourceDocumentIds, documentId),
    inkStrokes: remapDocumentItems(parsed.annotations.inkStrokes ?? [], sourceDocumentIds, documentId),
    sourceTextboxes: remapDocumentItems(parsed.annotations.sourceTextboxes ?? [], sourceDocumentIds, documentId),
    pageEdits: remapDocumentItems(parsed.annotations.pageEdits ?? [], sourceDocumentIds, documentId),
    viewerStateByDocument: remapViewerState(parsed.workspace.viewerStateByDocument ?? {}, sourceDocumentIds, documentId),
    activeDocumentId: documentId,
    updatedAt: now
  } as MobileWorkspaceState)

  return { record, workspace }
}

export function buildDmapFileName(title: string) {
  return `${title.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'documind-project'}.dmap`
}

export function listZipEntryNames(bytes: Uint8Array) {
  return Object.keys(readZipStore(bytes))
}

function buildWorkspacePayload(workspace: MobileWorkspaceState): DmapWorkspacePayload {
  return {
    nodes: workspace.nodes,
    canvasEdges: workspace.canvasEdges,
    workspaceLinks: workspace.workspaceLinks,
    workspaceBoards: workspace.workspaceBoards,
    activeWorkspaceBoardId: workspace.activeWorkspaceBoardId,
    workspaceViewport: workspace.workspaceViewport,
    viewerStateByDocument: workspace.viewerStateByDocument,
    viewerLayout: workspace.viewerLayout,
    settings: workspace.settings
  }
}

function buildAnnotationsPayload(workspace: MobileWorkspaceState): DmapAnnotationsPayload {
  return {
    anchors: workspace.anchors,
    excerpts: workspace.excerpts,
    bookmarks: workspace.bookmarks,
    sourceBookmarks: workspace.sourceBookmarks ?? [],
    textHighlights: workspace.textHighlights ?? [],
    freeformHighlights: workspace.freeformHighlights ?? [],
    inkStrokes: workspace.inkStrokes ?? [],
    sourceTextboxes: workspace.sourceTextboxes ?? [],
    pageEdits: workspace.pageEdits ?? [],
    globalTags: workspace.globalTags ?? []
  }
}

function findSourceDocumentIds(parsed: ParsedDmapProject) {
  const ids = new Set<string>()
  const collect = (items: Array<{ documentId?: string }> | undefined) => items?.forEach((item) => item.documentId ? ids.add(item.documentId) : undefined)
  collect(parsed.workspace.nodes)
  collect(parsed.workspace.workspaceBoards)
  collect(parsed.annotations.anchors)
  collect(parsed.annotations.excerpts)
  collect(parsed.annotations.bookmarks)
  collect(parsed.annotations.sourceBookmarks)
  collect(parsed.annotations.textHighlights)
  collect(parsed.annotations.freeformHighlights)
  collect(parsed.annotations.inkStrokes)
  collect(parsed.annotations.sourceTextboxes)
  collect(parsed.annotations.pageEdits)
  Object.keys(parsed.workspace.viewerStateByDocument ?? {}).forEach((id) => ids.add(id))
  return ids
}

function remapDocumentItems<T extends { documentId?: string }>(items: T[], sourceIds: Set<string>, documentId: string): T[] {
  return items.map((item) => item.documentId && sourceIds.has(item.documentId) ? { ...item, documentId } : item)
}

function remapViewerState(viewerState: MobileWorkspaceState['viewerStateByDocument'], sourceIds: Set<string>, documentId: string) {
  const next: MobileWorkspaceState['viewerStateByDocument'] = {}
  for (const [key, value] of Object.entries(viewerState)) {
    next[sourceIds.has(key) ? documentId : key] = value
  }
  return next
}

function encodeJson(value: unknown) {
  return textEncoder.encode(JSON.stringify(value, null, 2))
}

function decodeJson<T>(bytes: Uint8Array): T {
  try {
    return JSON.parse(textDecoder.decode(bytes)) as T
  } catch {
    throw new Error('Invalid .dmap file: JSON entry could not be parsed.')
  }
}

function createZipStore(entries: Record<string, Uint8Array>) {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const [name, data] of Object.entries(entries)) {
    const nameBytes = textEncoder.encode(name)
    const crc = crc32(data)
    const local = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(8, 0, true)
    localView.setUint32(14, crc, true)
    localView.setUint32(18, data.byteLength, true)
    localView.setUint32(22, data.byteLength, true)
    localView.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    localParts.push(local, data)

    const central = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, data.byteLength, true)
    centralView.setUint32(24, data.byteLength, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    centralParts.push(central)

    offset += local.byteLength + data.byteLength
  }

  const centralOffset = offset
  const centralSize = centralParts.reduce((total, part) => total + part.byteLength, 0)
  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer)
  eocdView.setUint32(0, 0x06054b50, true)
  eocdView.setUint16(8, centralParts.length, true)
  eocdView.setUint16(10, centralParts.length, true)
  eocdView.setUint32(12, centralSize, true)
  eocdView.setUint32(16, centralOffset, true)

  return concatBytes([...localParts, ...centralParts, eocd])
}

function readZipStore(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocdOffset = -1
  for (let index = bytes.byteLength - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocdOffset = index
      break
    }
  }
  if (eocdOffset < 0) throw new Error('Missing ZIP directory.')

  const entryCount = view.getUint16(eocdOffset + 10, true)
  let centralOffset = view.getUint32(eocdOffset + 16, true)
  const entries: Record<string, Uint8Array> = {}

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(centralOffset, true) !== 0x02014b50) throw new Error('Invalid ZIP directory.')
    const method = view.getUint16(centralOffset + 10, true)
    if (method !== 0) throw new Error('Unsupported compressed .dmap entry.')
    const compressedSize = view.getUint32(centralOffset + 20, true)
    const nameLength = view.getUint16(centralOffset + 28, true)
    const extraLength = view.getUint16(centralOffset + 30, true)
    const commentLength = view.getUint16(centralOffset + 32, true)
    const localOffset = view.getUint32(centralOffset + 42, true)
    const name = textDecoder.decode(bytes.slice(centralOffset + 46, centralOffset + 46 + nameLength))
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('Invalid ZIP entry.')
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength
    entries[name] = bytes.slice(dataOffset, dataOffset + compressedSize)
    centralOffset += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

const crcTable = new Uint32Array(256).map((_, tableIndex) => {
  let value = tableIndex
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return value >>> 0
})

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}
