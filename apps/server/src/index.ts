import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import type { CreateExcerptInput } from '@workspace/domain'
import { CollaborationModule } from './collaboration/room-manager'
import { MemoryStorage } from './storage/storage'

const app = Fastify({ logger: true })
const collaboration = new CollaborationModule()
const storage = new MemoryStorage()

await app.register(cors, { origin: true })
await app.register(websocket)

app.get('/health', async () => ({ ok: true }))

app.get('/api/workspaces/:workspaceId', async (request) => {
  const { workspaceId } = request.params as { workspaceId: string }
  return storage.getWorkspace(workspaceId)
})

app.post('/api/excerpts', async (request, reply) => {
  const body = request.body as CreateExcerptInput
  await storage.createExcerpt(body)
  reply.code(201)
  return { ok: true }
})

app.post('/api/export/markdown', async (request) => {
  const { workspaceId, markdown } = request.body as { workspaceId: string; markdown: string }
  return storage.saveMarkdownReport(workspaceId, markdown)
})

app.get('/api/export/report/:workspaceId', async (request, reply) => {
  const { workspaceId } = request.params as { workspaceId: string }
  const snapshot = await storage.getWorkspace(workspaceId)

  const markdown = [
    `# Workspace Report`,
    '',
    `## Notes`,
    ...snapshot.notes.map((note) => `- ${note.title}`),
    '',
    `## Excerpts`,
    ...snapshot.excerpts.map((excerpt) => `- ${excerpt.extractedText}`)
  ].join('\n')

  reply.header('content-type', 'text/html; charset=utf-8')
  return `
    <html>
      <head>
        <title>Workspace Report</title>
        <style>
          body { font-family: "Segoe UI", sans-serif; margin: 48px auto; max-width: 820px; line-height: 1.6; }
          h1, h2 { margin-bottom: 0.4rem; }
          pre { white-space: pre-wrap; }
        </style>
      </head>
      <body>
        <script>window.onload = () => window.print()</script>
        <pre>${markdown}</pre>
      </body>
    </html>
  `
})

app.get('/collaboration/:workspaceId', { websocket: true }, (socket, request) => {
  const { workspaceId } = request.params as { workspaceId: string }
  collaboration.connect(workspaceId, socket)
})

await app.listen({ port: 8787, host: '0.0.0.0' })
