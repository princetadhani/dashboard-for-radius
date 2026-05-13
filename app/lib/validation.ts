// Mirrors the backend zod schemas so we can validate inline before submit.

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

const HOSTNAME_RE =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export function validateIPv4(value: string): string | null {
  if (!value) return "IP address is required";
  if (!IPV4_RE.test(value.trim())) return "Must be a valid IPv4 address (e.g. 10.0.0.1)";
  return null;
}

export function validateHostnameOptional(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.length > 253) return "Hostname is too long (max 253 chars)";
  if (!HOSTNAME_RE.test(v))
    return "Invalid hostname (letters, digits, dashes, dots only)";
  return null;
}
