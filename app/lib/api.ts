import type { Host, HostStatusUpdate, SshActionCreds, SshActionType } from "./types";

export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${input}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function fetchHosts(): Promise<{
  hosts: Host[];
  statuses: HostStatusUpdate[];
}> {
  return jsonFetch("/api/hosts");
}

export async function fetchHost(id: string): Promise<Host> {
  return jsonFetch(`/api/hosts/${id}`);
}

export async function createHost(input: {
  friendlyName: string;
  ipAddress: string;
  port: number;
  tags: string[];
  sshPort: number;
  sshUsername: string;
  sshPassword: string;
}): Promise<{ sessionId: string }> {
  return jsonFetch("/api/hosts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateHost(
  id: string,
  input: {
    friendlyName?: string;
    ipAddress?: string;
    port?: number;
    tags?: string[];
  },
): Promise<Host> {
  return jsonFetch(`/api/hosts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteHost(id: string): Promise<void> {
  await jsonFetch(`/api/hosts/${id}`, { method: "DELETE" });
}

export async function runHostAction(
  id: string,
  action: SshActionType,
  creds: SshActionCreds,
): Promise<{ sessionId: string }> {
  return jsonFetch(`/api/hosts/${id}/actions`, {
    method: "POST",
    body: JSON.stringify({ action, ...creds }),
  });
}

export async function fetchLatestRelease(): Promise<{ version: string; scriptUrl: string } | null> {
  try {
    return await jsonFetch<{ version: string; scriptUrl: string }>("/api/releases/latest");
  } catch {
    return null;
  }
}

export async function copyConfig(
  sourceHostId: string,
  input: {
    targetHostId: string;
    source: { sshPort: number; sshUsername: string; sshPassword: string };
    target: { sshPort: number; sshUsername: string; sshPassword: string };
  },
): Promise<{ sessionId: string }> {
  return jsonFetch(`/api/hosts/${sourceHostId}/copy-config`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

