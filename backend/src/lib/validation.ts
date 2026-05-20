import { z } from 'zod';

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOSTNAME_RE =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

const address = z
  .string({ required_error: 'IP address or hostname is required' })
  .trim()
  .min(1, 'IP address or hostname is required')
  .max(253, 'IP address or hostname is too long')
  .refine((v) => IPV4_RE.test(v) || HOSTNAME_RE.test(v), {
    message: 'Must be a valid IPv4 address or hostname',
  });

const tag = z
  .string()
  .trim()
  .min(1, 'Tag cannot be empty')
  .max(32, 'Tag is too long (max 32 characters)')
  .regex(/^[a-zA-Z0-9_\-:.]+$/, 'Tags may contain letters, numbers, _ - : .');

const tagsArray = z
  .array(tag)
  .max(20, 'Too many tags (max 20)')
  .optional()
  .default([]);

const port = (label: string) =>
  z
    .number({ invalid_type_error: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .min(1, `${label} must be between 1 and 65535`)
    .max(65535, `${label} must be between 1 and 65535`);

const sshUsername = z
  .string({ required_error: 'SSH username is required' })
  .trim()
  .min(1, 'SSH username is required')
  .max(64, 'SSH username is too long (max 64 characters)');

const sshPassword = z
  .string({ required_error: 'SSH password is required' })
  .min(1, 'SSH password is required')
  .max(256, 'SSH password is too long (max 256 characters)');

const friendlyName = z
  .string({ required_error: 'Friendly name is required' })
  .trim()
  .min(1, 'Friendly name is required')
  .max(64, 'Friendly name is too long (max 64 characters)');

export const createHostSchema = z.object({
  friendlyName,
  ipAddress: address,
  port: port('Port').optional().default(9000),
  tags: tagsArray,
  sshPort: port('SSH port').optional().default(22),
  sshUsername,
  sshPassword,
});

export const updateHostSchema = z.object({
  friendlyName: friendlyName.optional(),
  ipAddress: address.optional(),
  port: port('Port').optional(),
  tags: z.array(tag).max(20, 'Too many tags (max 20)').optional(),
});

export const sshActionSchema = z.object({
  action: z.enum(['reinstall', 'restart-service', 'update-script'], {
    errorMap: () => ({ message: 'Unknown action' }),
  }),
  sshPort: port('SSH port').optional().default(22),
  sshUsername,
  sshPassword,
});

// const sshCreds = z.object({
//   sshPort: port('SSH port').optional().default(22),
//   sshUsername,
//   sshPassword,
// });

// export const copyConfigSchema = z.object({
//   targetHostId: z.string().min(1),
//   source: sshCreds,
//   target: sshCreds,
// });

export type CreateHostInput = z.infer<typeof createHostSchema>;
export type UpdateHostInput = z.infer<typeof updateHostSchema>;
export type SshActionInput = z.infer<typeof sshActionSchema>;

/**
 * Collapse a ZodError into a single human-readable sentence suitable for
 * surfacing to the user as an `error` field. Joins multiple issues with `; `.
 * Falls back to a generic message if zod produced nothing meaningful.
 */
export function formatZodError(err: z.ZodError): string {
  const messages = err.issues.map((i) => i.message).filter(Boolean);
  if (messages.length === 0) return 'Invalid input';
  return Array.from(new Set(messages)).join('; ');
}
