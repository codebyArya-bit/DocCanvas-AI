import './globals.css'
import type { ReactNode } from 'react'
import Script from 'next/script'

export const metadata = {
  title: 'Document Intelligence Mobile',
  description: 'Explorer-first document workspace for mobile and tablet SDK usage.'
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Script src="/chrome-extension-bridge.js" strategy="afterInteractive" />
        {children}
      </body>
    </html>
  )
}
