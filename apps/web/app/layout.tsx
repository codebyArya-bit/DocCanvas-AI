import './globals.css'
import type { ReactNode } from 'react'

export const metadata = {
  title: 'Document Intelligence Workspace',
  description: 'LiquidText-style document reasoning workspace built on pdf.js, tldraw, ProseMirror, and Yjs.'
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning on <html> and <body> prevents false-positive
    // hydration errors caused by browser extensions (Jetski, Antigravity, etc.)
    // that inject extra attributes (data-jetski-tab-id, className) into these
    // root elements before React's hydration pass runs.
    // This flag ONLY suppresses mismatches on the element it is placed on —
    // it does NOT suppress errors in any child component.
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
