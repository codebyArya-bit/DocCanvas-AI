import * as Y from 'yjs'

interface RoomState {
  document: Y.Doc
  clients: Set<any>
  flushTimer?: NodeJS.Timeout
}

export class CollaborationModule {
  private readonly rooms = new Map<string, RoomState>()

  getRoom(workspaceId: string): RoomState {
    const existing = this.rooms.get(workspaceId)
    if (existing) {
      return existing
    }

    const room = {
      document: new Y.Doc(),
      clients: new Set<WebSocket>()
    }
    this.rooms.set(workspaceId, room)
    return room
  }

  connect(workspaceId: string, socket: any) {
    const room = this.getRoom(workspaceId)
    room.clients.add(socket)

    socket.on('message', (message: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        const payload = message.toString()
        room.clients.forEach((client) => {
          if (client !== socket && client.readyState === 1) {
            client.send(payload)
          }
        })
        return
      }

      Y.applyUpdate(room.document, new Uint8Array(message), socket)
      this.scheduleBroadcast(room, socket)
    })

    socket.on('close', () => {
      room.clients.delete(socket)
    })
  }

  private scheduleBroadcast(room: RoomState, origin: any) {
    if (room.flushTimer) {
      clearTimeout(room.flushTimer)
    }

    room.flushTimer = setTimeout(() => {
      const update = Y.encodeStateAsUpdate(room.document)
      room.clients.forEach((client) => {
        if (client !== origin && client.readyState === 1) {
          client.send(update)
        }
      })
    }, 40)
  }
}
