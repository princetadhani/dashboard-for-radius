import type { Server as IOServer } from 'socket.io';

export type LogLevel = 'info' | 'stderr' | 'system';

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
const WGET_PROGRESS_RE = /\d+%\[[=>\s]*\]\s+\d+(\.\d+)?[KMGTP]?\s+\d+(\.\d+)?[KMGTP]?B\/s/;
const STEP_BRACKET_RE = /\[(\d+)\/(\d+)\]\s+(.+)/;
const STEP_STAGE_RE = /Stage\s+(\d+)\/(\d+)\s*[:\-]?\s*(.+)/i;

export function makeEmitter(io: IOServer, room: string) {
  const sessionId = room.startsWith('provision:') ? room.slice('provision:'.length) : room;

  const emitLog = (line: string, level: LogLevel = 'info') => {
    io.to(room).emit('provision:log', { line, level, ts: Date.now(), sessionId });
  };
  const emitStep = (n: number, total: number, label: string) => {
    io.to(room).emit('provision:step', { n, total, label, sessionId, ts: Date.now() });
  };

  /** Classify and emit a single output line: drops noise, splits steps from logs. */
  const handleLine = (raw: string, defaultLevel: LogLevel = 'info') => {
    const line = raw.replace(ANSI_RE, '').trim();
    if (line.length === 0) return;
    if (WGET_PROGRESS_RE.test(line)) return;

    const m = line.match(STEP_BRACKET_RE) || line.match(STEP_STAGE_RE);
    if (m) {
      const n = parseInt(m[1]!, 10);
      const total = parseInt(m[2]!, 10);
      const label = m[3]!.trim().replace(/\.\.\.$/, '');
      emitStep(n, total, label);
      return;
    }
    emitLog(line, defaultLevel);
  };

  return { emitLog, emitStep, handleLine, sessionId };
}
