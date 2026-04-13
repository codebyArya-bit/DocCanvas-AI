import * as Y from 'yjs'

export interface CollaborationBindings {
  documents: Y.Map<unknown>
  excerpts: Y.Map<unknown>
  nodes: Y.Map<unknown>
  edges: Y.Map<unknown>
  notes: Y.Map<unknown>
  sessions: Y.Map<unknown>
}

export function createCollaborationModule(workspaceId: string, user: { id: string; name: string; color: string }) {
  const doc = new Y.Doc({ gc: false })
  const socket = new WebSocket(`ws://localhost:8787/collaboration/${workspaceId}`)

  const bindings: CollaborationBindings = {
    documents: doc.getMap('documents'),
    excerpts: doc.getMap('excerpts'),
    nodes: doc.getMap('nodes'),
    edges: doc.getMap('edges'),
    notes: doc.getMap('notes'),
    sessions: doc.getMap('sessions')
  }

  let applyingRemote = false

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'presence', payload: user }))
    socket.send(Y.encodeStateAsUpdate(doc))
  })

  socket.addEventListener('message', async (event) => {
    if (typeof event.data === 'string') {
      const message = JSON.parse(event.data) as { type: 'presence'; payload: { id: string } }
      if (message.type === 'presence') {
        bindings.sessions.set(message.payload.id, message.payload)
      }
      return
    }

    const buffer = await new Response(event.data).arrayBuffer()
    applyingRemote = true
    Y.applyUpdate(doc, new Uint8Array(buffer), 'remote')
    applyingRemote = false
  })

  doc.on('update', (update, origin) => {
    if (applyingRemote || origin === 'remote' || socket.readyState !== WebSocket.OPEN) {
      return
    }
    socket.send(update)
  })

  return {
    doc,
    socket,
    bindings,
    setPresence(presence: Record<string, unknown>) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'presence', payload: { ...user, ...presence } }))
      }
    },
    destroy() {
      socket.close()
      doc.destroy()
    }
  }
}
