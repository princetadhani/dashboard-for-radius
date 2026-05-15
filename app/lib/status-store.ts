import type { HostStatusUpdate } from "./types";

type Listener = () => void;

const _data = new Map<string, HostStatusUpdate>();
const _listeners = new Map<string, Set<Listener>>();

function _notify(hostId: string) {
  _listeners.get(hostId)?.forEach((fn) => fn());
}

export const statusStore = {
  set(u: HostStatusUpdate): void {
    _data.set(u.hostId, u);
    _notify(u.hostId);
  },

  get(hostId: string): HostStatusUpdate | undefined {
    return _data.get(hostId);
  },

  delete(hostId: string): void {
    _data.delete(hostId);
    _listeners.get(hostId)?.forEach((fn) => fn());
    _listeners.delete(hostId);
  },

  subscribe(hostId: string, fn: Listener): () => void {
    if (!_listeners.has(hostId)) _listeners.set(hostId, new Set());
    _listeners.get(hostId)!.add(fn);
    return () => _listeners.get(hostId)?.delete(fn);
  },
};
