import type { Server as IOServer } from 'socket.io';

export type LogLevel = 'info' | 'stderr' | 'system';

// Covers standard CSI sequences AND DEC private sequences (\x1b[?25l etc.)
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
// wget progress: "filename N%[==>  ] size speed"
const WGET_PROGRESS_RE = /\d+%\[[\s=>-]*\]/;
// Docker compose "[+] up N/N" status line
const DOCKER_STATUS_RE = /^\[[\+\-!]\]\s+\S+\s+\d+\/\d+/;
// Docker compose spinner: "⠋ Container foo Creating 0.1s" or "✔ Container foo Started 0.8s"
const DOCKER_SPINNER_RE = /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✔✗]\s+(Container|Network|Volume)\s+\S+\s+(Creating|Starting|Started|Running|Stopping|Stopped|Removing|Removed)/;

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
    // Strip all ANSI/VT escape sequences (including DEC private like [?25l)
    const stripped = raw.replace(ANSI_RE, '');
    // For carriage-return based progress (apt, wget), keep only the last segment
    const crParts = stripped.split('\r');
    const line = crParts[crParts.length - 1]!.trim();

    if (line.length === 0) return;
    if (WGET_PROGRESS_RE.test(line)) return;
    if (DOCKER_STATUS_RE.test(line)) return;
    if (DOCKER_SPINNER_RE.test(line)) return;

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
