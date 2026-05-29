'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import {
  buildChecksum,
  buildMobileDocumentId,
  deleteMobileDocuments,
  listMobileDocuments,
  saveMobileDocument,
  saveMobileWorkspace,
  type MobileDocumentRecord
} from '../../lib/mobile-store'
import { buildImportedDmapProject, parseDmapProjectBundle } from '../../lib/dmap-project'
import { destroyPdfTask, openPdfDocument, type PdfLoadingTaskLike } from '../../lib/pdf-loader'
import { WebpageImportPanel } from '../WebpageImportPanel'

type ExplorerView = 'documents' | 'website' | 'cloud' | 'settings'

export function DocumentExplorer() {
  const router = useRouter()
  const [documents, setDocuments] = useState<MobileDocumentRecord[]>([])
  const [status, setStatus] = useState('Ready')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isRailCollapsed, setIsRailCollapsed] = useState(false)
  const [activeView, setActiveView] = useState<ExplorerView>('documents')
  const [isImporting, setIsImporting] = useState(false)

  const selectedCount = selectedIds.size
  const pdfCount = useMemo(() => documents.filter((entry) => entry.sourceType !== 'webpage').length, [documents])
  const webCount = useMemo(() => documents.filter((entry) => entry.sourceType === 'webpage').length, [documents])

  async function refreshDocuments() {
    setDocuments(await listMobileDocuments())
  }

  useEffect(() => {
    void refreshDocuments()
  }, [])

  async function importPdf(file: File) {
    setIsImporting(true)
    setStatus(`Importing ${file.name}...`)
    let openedTask: PdfLoadingTaskLike | null = null
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const opened = await openPdfDocument(bytes)
      openedTask = opened.task
      const now = new Date().toISOString()
      await saveMobileDocument({
        document: {
          id: buildMobileDocumentId(file.name, bytes),
          workspaceId: 'workspace-mobile-local',
          title: file.name,
          storageKey: file.name,
          mimeType: file.type || 'application/pdf',
          pageCount: opened.document.numPages,
          checksum: buildChecksum(bytes),
          createdAt: now,
          updatedAt: now
        },
        bytes,
        sourceType: 'pdf',
        sourceKind: 'pdf',
        lastOpenedAt: now
      })
      await destroyPdfTask(openedTask)
      openedTask = null
      await refreshDocuments()
      setStatus(`${file.name} imported.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not import PDF.')
    } finally {
      await destroyPdfTask(openedTask)
      setIsImporting(false)
    }
  }

  async function importDmap(file: File) {
    setIsImporting(true)
    setStatus(`Importing ${file.name}...`)
    let openedTask: PdfLoadingTaskLike | null = null
    try {
      const parsed = await parseDmapProjectBundle(new Uint8Array(await file.arrayBuffer()))
      const imported = await buildImportedDmapProject(parsed, { fileName: file.name })
      const opened = await openPdfDocument(imported.record.bytes ?? parsed.pdfBytes)
      openedTask = opened.task
      const record = {
        ...imported.record,
        document: {
          ...imported.record.document,
          pageCount: opened.document.numPages
        }
      }
      await saveMobileDocument(record)
      await saveMobileWorkspace(imported.workspace)
      await destroyPdfTask(openedTask)
      openedTask = null
      await refreshDocuments()
      setStatus(`${record.document.title} restored from .dmap.`)
      router.push(`/viewer/${record.document.id}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not import .dmap project.')
    } finally {
      await destroyPdfTask(openedTask)
      setIsImporting(false)
    }
  }

  async function deleteSelected() {
    const ids = Array.from(selectedIds)
    if (!ids.length) return
    await deleteMobileDocuments(ids)
    setSelectedIds(new Set())
    await refreshDocuments()
    setStatus(`${ids.length} document(s) deleted.`)
  }

  return (
    <main className={isRailCollapsed ? 'mobile-explorer is-rail-collapsed' : 'mobile-explorer'}>
      <aside className={isRailCollapsed ? 'mobile-source-rail is-collapsed' : 'mobile-source-rail'}>
        <div className="mobile-brand">
          <span>DM</span>
          {!isRailCollapsed ? <strong>Docu Mind</strong> : null}
        </div>
        <nav aria-label="Main sections">
          <button className={activeView === 'documents' ? 'is-active' : ''} type="button" onClick={() => setActiveView('documents')}>
            {isRailCollapsed ? 'D' : 'Documents'}
          </button>
          <button className={activeView === 'website' ? 'is-active' : ''} type="button" onClick={() => setActiveView('website')}>
            {isRailCollapsed ? 'W' : 'Website Integration'}
          </button>
          <button className={activeView === 'cloud' ? 'is-active' : ''} type="button" onClick={() => setActiveView('cloud')}>
            {isRailCollapsed ? 'C' : 'Cloud Services'}
          </button>
          <button className={activeView === 'settings' ? 'is-active' : ''} type="button" onClick={() => setActiveView('settings')}>
            {isRailCollapsed ? 'S' : 'Settings'}
          </button>
        </nav>
        <button
          className="mobile-rail-toggle"
          type="button"
          aria-label={isRailCollapsed ? 'Expand left sidebar' : 'Collapse left sidebar'}
          onClick={() => setIsRailCollapsed((current) => !current)}
        >
          {isRailCollapsed ? '›' : '‹'}
        </button>
      </aside>

      <section className="mobile-document-stage">
        <header className="mobile-explorer-header">
          <div>
            <p>{activeView === 'website' ? 'Unsigned browser import' : 'Mobile document workspace'}</p>
            <h1>{activeView === 'website' ? 'Website Integration' : activeView === 'documents' ? 'Documents' : activeView === 'cloud' ? 'Cloud Services' : 'Settings'}</h1>
          </div>
          <div className="mobile-header-actions">
            {selectedCount ? (
              <button className="mobile-danger-button" type="button" onClick={() => void deleteSelected()}>
                Delete {selectedCount}
              </button>
            ) : null}
            {activeView !== 'website' ? (
              <label className={isImporting ? 'mobile-secondary-button mobile-file-import-button is-disabled' : 'mobile-secondary-button mobile-file-import-button'}>
                Import .dmap
                <input
                  type="file"
                  accept=".dmap,application/zip,application/octet-stream"
                  disabled={isImporting}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) void importDmap(file)
                  }}
                />
              </label>
            ) : null}
            {activeView !== 'website' ? (
              <label className={isImporting ? 'mobile-primary-button mobile-file-import-button is-disabled' : 'mobile-primary-button mobile-file-import-button'}>
                Import PDF
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={isImporting}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) void importPdf(file)
                  }}
                />
              </label>
            ) : null}
          </div>
        </header>

        {activeView === 'documents' ? (
          <>
            <div className="mobile-folder-strip">
              <button className="is-active" type="button">All <span>{documents.length}</span></button>
              <button type="button">PDF <span>{pdfCount}</span></button>
              <button type="button">Web <span>{webCount}</span></button>
            </div>
            <DocumentGrid documents={documents} selectedIds={selectedIds} onSelectedIds={setSelectedIds} />
          </>
        ) : null}

        {activeView === 'website' ? (
          <WebpageImportPanel
            folderId={null}
            onImported={(record) => {
              setStatus(`${record.document.title} imported.`)
              setActiveView('documents')
              void refreshDocuments()
            }}
            onStatusChange={setStatus}
          />
        ) : null}

        {activeView === 'cloud' ? (
          <CloudServicesPanel />
        ) : null}

        {activeView === 'settings' ? (
          <div className="mobile-empty-state">
            <strong>Local-first workspace.</strong>
            <span>Documents, web imports, and annotations stay in browser storage.</span>
          </div>
        ) : null}

        {status !== 'Ready' ? <div className="mobile-status-toast" role="status">{status}</div> : null}
      </section>
    </main>
  )
}

function CloudServicesPanel() {
  const services = [
    { name: 'OneDrive', status: 'Connect', icon: <OneDriveIcon /> },
    { name: 'Google Drive', status: 'Connect', icon: <GoogleDriveIcon /> },
    { name: 'Box', status: 'Connect', icon: <BoxIcon /> },
    { name: 'Dropbox', status: 'Connect', icon: <DropboxIcon /> }
  ]

  return (
    <section className="mobile-cloud-services" aria-label="Cloud services">
      <div className="mobile-cloud-services-header">
        <strong>Cloud document sources</strong>
        <span>Connect storage accounts and bring documents into the workspace.</span>
      </div>
      <div className="mobile-integration-grid mobile-cloud-grid">
        {services.map((service) => (
          <button key={service.name} type="button" aria-label={`${service.name} connector`}>
            <span>{service.icon}</span>
            <strong>{service.name}</strong>
            <small>{service.status}</small>
          </button>
        ))}
      </div>
    </section>
  )
}

function OneDriveIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path fill="#0364b8" d="M25 25c4-8 16-9 22-2 6 1 11 6 11 13 0 7-6 13-13 13H18C11 49 6 44 6 38c0-6 5-11 11-11 2-2 5-3 8-2Z" />
      <path fill="#1490df" d="M17 27c3-7 10-12 18-12 8 0 15 5 18 12-2-2-5-4-9-4-7-8-19-6-23 3-1 0-3 0-4 1Z" />
      <path fill="#28a8ea" d="M18 49h27c7 0 13-6 13-13 0-2 0-4-1-5L38 42 20 28c-1 0-2-1-3-1C11 27 6 32 6 38c0 6 5 11 12 11Z" />
    </svg>
  )
}

function GoogleDriveIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path fill="#0f9d58" d="M24 8h16l20 34H44L24 8Z" />
      <path fill="#f4b400" d="M24 8 4 42l8 14 20-34L24 8Z" />
      <path fill="#4285f4" d="M12 56h40l8-14H20l-8 14Z" />
      <path fill="#188038" d="M32 22 44 42h16L40 8H24l8 14Z" />
    </svg>
  )
}

function BoxIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="12" fill="#0061d5" />
      <path fill="#fff" d="M18 42V18h9c5 0 8 3 8 7 0 2-1 4-3 5 3 1 5 3 5 6 0 4-3 6-8 6H18Zm7-14h3c2 0 3-1 3-3s-1-3-3-3h-3v6Zm0 10h4c2 0 3-1 3-3s-1-3-4-3h-3v6Zm21-20h-7v24h7V18Z" />
    </svg>
  )
}

function DropboxIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path fill="#0061ff" d="M19 10 4 20l15 10 15-10-15-10Zm26 0L30 20l15 10 15-10-15-10ZM19 34 4 44l15 10 15-10-15-10Zm26 0L30 44l15 10 15-10-15-10Z" />
      <path fill="#0061ff" d="m32 47-13 9 13 8 13-8-13-9Z" opacity=".75" />
    </svg>
  )
}

function DocumentGrid({
  documents,
  selectedIds,
  onSelectedIds
}: {
  documents: MobileDocumentRecord[]
  selectedIds: Set<string>
  onSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>
}) {
  if (!documents.length) {
    return (
      <div className="mobile-empty-state">
        <strong>No documents yet.</strong>
        <span>Import a PDF or use Website Integration.</span>
      </div>
    )
  }

  return (
    <div className="mobile-document-grid">
      {documents.map((record) => {
        const selected = selectedIds.has(record.document.id)
        return (
          <article key={record.document.id} className={selected ? 'mobile-document-card is-selected' : 'mobile-document-card'}>
            <button
              className="mobile-document-check"
              type="button"
              aria-label={selected ? 'Unselect document' : 'Select document'}
              onClick={() =>
                onSelectedIds((current) => {
                  const next = new Set(current)
                  if (next.has(record.document.id)) next.delete(record.document.id)
                  else next.add(record.document.id)
                  return next
                })
              }
            >
              {selected ? '✓' : ''}
            </button>
            <Link href={`/viewer/${record.document.id}`} className="mobile-document-thumb">
              {record.thumbnailDataUrl ? <img src={record.thumbnailDataUrl} alt="" /> : <span>{record.sourceType === 'webpage' ? 'WEB' : 'PDF'}</span>}
            </Link>
            <strong>{record.document.title}</strong>
            <span>{record.sourceType === 'webpage' ? 'Website import' : `${record.document.pageCount} page(s)`}</span>
          </article>
        )
      })}
    </div>
  )
}
