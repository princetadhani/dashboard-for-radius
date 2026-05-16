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
  if (!HOSTNAME_RE.test(v)) return "Invalid hostname (letters, digits, dashes, dots only)";
  return null;
}

/**
 * Accepts either an IPv4 address or an RFC-1123 hostname.
 * Returns null when valid, otherwise an error message.
 */
export function validateAddress(value: string): string | null {
  const v = value.trim();
  if (!v) return "Address is required";

  // Check if it looks like an IP address (contains only digits and dots)
  const looksLikeIP = /^[\d.]+$/.test(v);

  if (looksLikeIP) {
    // Validate as IP address
    if (!IPV4_RE.test(v)) {
      // Check for specific issues with IP format
      const parts = v.split('.');

      if (parts.length !== 4) {
        return "IPv4 address must have exactly 4 octets (e.g., 10.0.0.1)";
      }

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part === '') {
          return "IPv4 octets cannot be empty";
        }
        const num = parseInt(part, 10);
        if (isNaN(num) || num < 0 || num > 255) {
          return `IPv4 octet must be between 0-255 (found: ${part})`;
        }
      }

      return "Invalid IPv4 address format";
    }
    return null; // Valid IP
  }

  // Validate as hostname
  if (v.length > 253) return "Hostname is too long (max 253 chars)";
  if (!HOSTNAME_RE.test(v))
    return "Invalid hostname format (use letters, digits, dots, hyphens)";
  return null;
}
