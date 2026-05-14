export type Host = {
  id: string;
  friendlyName: string;
  ipAddress: string;
  controlIp?: string | null;
  knownIps: string[];
  port: number;
  tags: string[];
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
  sessionId?: string;
};

export type ProvisionStep = {
  n: number;
  total: number;
  label: string;
  ts: number;
  sessionId?: string;
};

export type ProvisionDone =
  | { success: true; host?: Host; sessionId?: string }
  | { success: false; error: string; sessionId?: string };

export type SshActionType = "reinstall" | "restart-service" | "update-script";

export type SshActionCreds = {
  sshPort: number;
  sshUsername: string;
  sshPassword: string;
};
