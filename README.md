# Document Intelligence Workspace

Document Intelligence Workspace is a LiquidText-inspired research and annotation environment for PDF documents. It combines a real `pdf.js` document viewer on the left with a spatial workspace on the right for excerpts, comments, bookmarks, and visual links.

The current implementation is focused on a local-first PDF workflow:

- import a local PDF or website Integration
- select real text from the PDF text layer
- create excerpts and comments anchored to source text
- jump back from workspace nodes to the original PDF location
- persist workspace state locally

## What It Does

- Real PDF rendering with `pdf.js`
- Text selection with anchor capture
- Selection action popup for:
  - `Auto Excerpt`
  - `Comment`
  - `Bookmark`
  - `Tag`
- Workspace nodes for excerpts and comments
- Bidirectional navigation between workspace and PDF source anchors
- Ink-style Bezier links from workspace nodes to the linked PDF text region
- Workspace-to-workspace node linking
- Draggable and resizable workspace cards
- Local persistence for documents, anchors, bookmarks, nodes, and links

## Current Product Shape

The app is designed around a split layout:

- Left column: PDF document viewer, selection, highlights, bookmarks
- Right column: workspace for excerpts, comments, and visual links

Core interaction flow:

1. Import a local PDF.
2. Select text in the document viewer.
3. Use the floating action popup to create an excerpt, comment, bookmark, or tag.
4. Manipulate excerpt/comment nodes in the workspace.
5. Use links and source arrows to navigate back to the exact PDF origin.

## Repository Structure

```text
document-intelligence-workspace/
├─ apps/
│  ├─ web/       # Next.js frontend
│  └─ server/    # Fastify backend
├─ packages/
│  ├─ domain/              # shared types and models
│  ├─ canvas-tldraw/       # canvas-related package work
│  ├─ editor-prosemirror/  # editor-related package work
│  ├─ sync-yjs/            # collaboration-related package work
│  └─ viewer-pdf/          # PDF-viewer-related package work
└─ README.md
```

## Tech Stack

- Next.js 15
- React 19
- TypeScript
- `pdfjs-dist`
- Fastify
- `tldraw`
- ProseMirror
- Yjs
- IndexedDB

## Implemented Features

### PDF Interaction

- Local PDF import
- Real `pdf.js` page rendering
- Selectable text layer
- Selection popup near highlighted text
- Persistent highlights and bookmarks
- Exact source jump from workspace nodes and bookmarks

### Workspace

- Excerpt cards
- Comment cards
- Rich text boxes with in-place ProseMirror editing
- Node dragging
- Node resizing
- Text formatting toolbar for selected nodes
- Node-to-node linking
- Bezier links from workspace to PDF anchors

### Data and Persistence

- Shared domain models in `packages/domain`
- Local-first persistence for:
  - active PDF metadata
  - anchors
  - excerpts
  - comments
  - bookmarks
  - workspace nodes
  - workspace links

## Development

### Requirements

- Node.js 20+
- npm

### Install

```bash
npm install
```

### Run the web app

```bash
npm run dev
```

That starts the frontend workspace. The default monorepo script delegates to the web app.

### Run the server

```bash
npm run dev --workspace @workspace/server
```

### Typecheck

```bash
npm run typecheck
```

### Unit Tests

```bash
npm test
```

This runs the focused assertion-based unit coverage for the note editor, workspace CRUD helpers, and textbox toolbar behavior.

### Production Verification

```bash
npm run build
```

Use `npm run dev` for local interaction checks and `npm run build` to verify the production bundle compiles cleanly.

## Monorepo Scripts

From the repository root:

- `npm run dev`
- `npm run dev:web`
- `npm run dev:server`
- `npm test`
- `npm run test:unit`
- `npm run build`
- `npm run typecheck`

## Textbox Toolbar Behavior

- The floating textbox toolbar stays open while interacting with native controls such as font selects, size inputs, and color pickers.
- Native control changes restore editor focus after the selection is applied so formatting can continue without collapsing the editing session.
- Toolbar formatting state normalizes font-size and color values to avoid invalid UI state during rapid edits or browser-specific color input behavior.

## Domain Model

The shared model lives in:

- `packages/domain/src/models.ts`

Key entities include:

- `Document`
- `PageAnchor`
- `Excerpt`
- `CanvasNode`
- `CanvasEdge`
- `Bookmark`
- `Note`

## Project Goals

This project is aimed at a document intelligence workflow rather than a plain PDF annotation tool. The intended experience is:

- extract evidence directly from source documents
- spatially organize thinking in a workspace
- maintain exact traceability back to source text
- support richer linking between ideas inside the workspace

## Known Focus Areas

The current product is centered on PDF-first behavior. Areas that are either evolving or intentionally deferred include:

- advanced collaboration flows
- cloud imports
- Office document ingestion
- export polish
- production hardening of every PDF edge case

## Status

This repository is an active implementation workspace. The core PDF-to-workspace flow is present, and the app is being iterated toward a more production-stable LiquidText-style experience.
