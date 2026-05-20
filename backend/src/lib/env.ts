import 'dotenv/config';

function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  port: num('PORT', 4000),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
  statusPollIntervalMs: num('STATUS_POLL_INTERVAL_MS', 15 * 60 * 1_000),
  statusHttpTimeoutMs: num('STATUS_HTTP_TIMEOUT_MS', 5_000),
  sshInstallTimeoutMs: num('SSH_INSTALL_TIMEOUT_MS', 1_800_000),
  sshPostInstallHealthcheckTimeoutMs: num('SSH_POSTINSTALL_HEALTHCHECK_TIMEOUT_MS', 180_000),
  installScriptUrl:
    process.env.INSTALL_SCRIPT_URL ??
    'https://raw.githubusercontent.com/princetadhani/my-app-for-radiusctrl/main/docker/one-click-install.sh',
};
