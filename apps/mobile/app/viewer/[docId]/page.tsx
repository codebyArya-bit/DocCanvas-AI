'use client'

import { use } from 'react'
import { DocumentViewer } from '../../../src/components/DocumentViewer'

export default function Page({ params }: { params: Promise<{ docId: string }> }) {
  const { docId } = use(params)
  return <DocumentViewer docId={docId} />
}
