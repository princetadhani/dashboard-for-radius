import type { Host, HostStatusUpdate } from "./types";

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

export async function createHost(input: {
  friendlyName: string;
  ipAddress: string;
  port: number;
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
  input: { friendlyName?: string; ipAddress?: string; port?: number },
): Promise<Host> {
  return jsonFetch(`/api/hosts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteHost(id: string): Promise<void> {
  await jsonFetch(`/api/hosts/${id}`, { method: "DELETE" });
}
