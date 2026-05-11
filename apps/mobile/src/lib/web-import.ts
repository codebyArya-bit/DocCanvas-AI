import type { Document } from '@workspace/domain'
import {
  buildTextChecksum,
  MOBILE_WORKSPACE_ID,
  saveMobileDocument,
  type MobileDocumentRecord,
  type MobileWebSection
} from './mobile-store'

export type WebImportMode = 'readable-text' | 'visual-full-page' | 'hybrid'

export interface WebImportResponse {
  sourceUrl: string
  finalUrl?: string
  title: string
  sanitizedHtml?: string
  markdown?: string
  textContent?: string
  textChunksWithOffsets?: Array<{ index: number; text: string; startOffset: number; endOffset: number }>
  sections?: MobileWebSection[]
  bytesBase64?: string
  thumbnailDataUrl?: string | null
}

export async function saveImportedWebDocument({
  payload,
  mode,
  folderId,
  previewMode,
  documentId
}: {
  payload: WebImportResponse
  mode: WebImportMode
  folderId?: string | null
  previewMode?: 'chrome' | 'html' | 'screenshot' | 'blocked' | 'error'
  documentId?: string
}) {
  const now = new Date().toISOString()
  const nextDocumentId = documentId ?? crypto.randomUUID()
  const visualMode = mode === 'visual-full-page' || mode === 'hybrid'
  const visualBytes = visualMode && payload.bytesBase64 ? base64ToBytes(payload.bytesBase64) : undefined
  const textContent = payload.textContent ?? ''
  const sections = payload.sections ?? []
  const textChunksWithOffsets = payload.textChunksWithOffsets ?? buildTextChunksWithOffsets(sections, textContent)

  const document: Document = {
    id: nextDocumentId,
    workspaceId: MOBILE_WORKSPACE_ID,
    title: payload.title,
    storageKey: payload.sourceUrl,
    mimeType: visualMode ? 'application/pdf' : 'text/html',
    pageCount: visualMode ? 1 : Math.max(1, Math.ceil(sections.length / 12)),
    checksum: visualMode && visualBytes ? buildBinaryChecksum(visualBytes) : buildTextChecksum(textContent),
    createdAt: now,
    updatedAt: now
  }

  const record: MobileDocumentRecord = {
    document,
    bytes: visualBytes,
    sourceKind: visualMode ? 'web-visual' : 'web-clean',
    folderId: folderId ?? undefined,
    sourceType: 'webpage',
    sourceUrl: payload.sourceUrl,
    finalUrl: payload.finalUrl ?? payload.sourceUrl,
    importMode: visualMode ? 'visual-full-page' : 'readable-text',
    html: payload.sanitizedHtml,
    sanitizedHtml: payload.sanitizedHtml,
    markdown: payload.markdown,
    textContent,
    textChunksWithOffsets,
    previewMode,
    thumbnailDataUrl:
      visualMode
        ? payload.thumbnailDataUrl ?? generateTextThumbnail(payload.title)
        : payload.thumbnailDataUrl ??
          renderFirstViewport({
            title: payload.title,
            sourceUrl: payload.sourceUrl,
            sections
          }),
    webContent:
      sections.length || textContent
        ? {
            title: payload.title,
            sourceUrl: payload.sourceUrl,
            sections: sections.length ? sections : [{ kind: 'paragraph', text: textContent }]
          }
        : undefined,
    lastOpenedAt: now
  }

  await saveMobileDocument(record)
  return record
}

function buildTextChunksWithOffsets(sections: MobileWebSection[], fallbackText: string) {
  const sourceChunks = sections.length ? sections.map((section) => section.text) : fallbackText ? [fallbackText] : []
  let cursor = 0
  return sourceChunks.map((text, index) => {
    const startOffset = cursor
    const endOffset = startOffset + text.length
    cursor = endOffset + 2
    return { index, text, startOffset, endOffset }
  })
}

function renderFirstViewport(webContent: { title: string; sourceUrl: string; sections: MobileWebSection[] }) {
  try {
    return generateTextThumbnail(webContent.title, webContent.sections.slice(0, 3).map((section) => section.text).join(' '))
  } catch {
    return generateTextThumbnail(webContent.title)
  }
}

function generateTextThumbnail(title: string, snippet = '') {
  const safeTitle = escapeSvgText(title).slice(0, 48)
  const safeSnippet = escapeSvgText(snippet).slice(0, 110)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="560" viewBox="0 0 420 560"><rect width="420" height="560" rx="24" fill="#f8fafb"/><rect x="34" y="38" width="352" height="48" rx="12" fill="#0f766e"/><circle cx="62" cy="62" r="6" fill="#e6fffb"/><circle cx="84" cy="62" r="6" fill="#e6fffb"/><circle cx="106" cy="62" r="6" fill="#e6fffb"/><text x="34" y="148" fill="#18212b" font-family="Segoe UI,Arial" font-size="28" font-weight="700">${safeTitle}</text><rect x="34" y="190" width="300" height="16" rx="8" fill="#cfdae3"/><rect x="34" y="224" width="332" height="16" rx="8" fill="#cfdae3"/><rect x="34" y="258" width="260" height="16" rx="8" fill="#cfdae3"/></svg>`
  const withSnippet = safeSnippet
    ? svg.replace('</svg>', `<text x="34" y="322" fill="#647282" font-family="Segoe UI,Arial" font-size="18">${safeSnippet}</text></svg>`)
    : svg
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withSnippet)}`
}

function escapeSvgText(value: string) {
  return value.replace(/[<>&"']/g, '')
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function buildBinaryChecksum(bytes: Uint8Array) {
  return `${bytes.byteLength}-${bytes[0] ?? 0}-${bytes[Math.floor(bytes.length / 2)] ?? 0}-${bytes[bytes.length - 1] ?? 0}`
}
