import { useCallback, useSyncExternalStore } from "react";
import { statusStore } from "./status-store";
import type { HostStatusUpdate } from "./types";

export function useHostStatus(hostId: string): HostStatusUpdate | undefined {
  const subscribe = useCallback(
    (fn: () => void) => statusStore.subscribe(hostId, fn),
    [hostId],
  );
  const getSnapshot = useCallback(
    () => statusStore.get(hostId),
    [hostId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => undefined);
}
