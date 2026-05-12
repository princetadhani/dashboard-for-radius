import type { Server as IOServer, Socket } from 'socket.io';

export function attachSocketHandlers(io: IOServer): void {
  io.on('connection', (socket: Socket) => {
    socket.on('provision:subscribe', (sessionId: string) => {
      if (typeof sessionId === 'string' && sessionId.length > 0) {
        socket.join(`provision:${sessionId}`);
      }
    });
    socket.on('provision:unsubscribe', (sessionId: string) => {
      if (typeof sessionId === 'string' && sessionId.length > 0) {
        socket.leave(`provision:${sessionId}`);
      }
    });
  });
}
