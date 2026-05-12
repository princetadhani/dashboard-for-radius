export type Host = {
  id: string;
  friendlyName: string;
  ipAddress: string;
  port: number;
  createdAt: string;
  updatedAt: string;
};

export type ServiceSnapshot = {
  healthy: boolean;
  status?: "running" | "stopped" | "unknown";
  active?: boolean;
  pid?: number;
  memory?: number;
  description?: string;
};

export type HostStatusUpdate = {
  hostId: string;
  reachable: boolean;
  service: ServiceSnapshot;
  ts: number;
};

export type ProvisionLog = {
  line: string;
  level: "info" | "stderr" | "system";
  ts: number;
};

export type ProvisionDone =
  | { success: true; host: Host }
  | { success: false; error: string };
