import { z } from 'zod';

const ipv4 = z
  .string()
  .regex(
    /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/,
    'Must be a valid IPv4 address',
  );

const tag = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[a-zA-Z0-9_\-:.]+$/, 'Tags may contain letters, numbers, _ - : .');

const tagsArray = z.array(tag).max(20).optional().default([]);

export const createHostSchema = z.object({
  friendlyName: z.string().trim().min(1).max(64),
  ipAddress: ipv4,
  port: z.number().int().min(1).max(65535).optional().default(9000),
  tags: tagsArray,
  sshPort: z.number().int().min(1).max(65535).optional().default(22),
  sshUsername: z.string().trim().min(1).max(64),
  sshPassword: z.string().min(1).max(256),
});

export const updateHostSchema = z.object({
  friendlyName: z.string().trim().min(1).max(64).optional(),
  ipAddress: ipv4.optional(),
  port: z.number().int().min(1).max(65535).optional(),
  tags: z.array(tag).max(20).optional(),
});

export const sshActionSchema = z.object({
  action: z.enum(['reinstall', 'restart-service', 'update-script']),
  sshPort: z.number().int().min(1).max(65535).optional().default(22),
  sshUsername: z.string().trim().min(1).max(64),
  sshPassword: z.string().min(1).max(256),
});

const sshCreds = z.object({
  sshPort: z.number().int().min(1).max(65535).optional().default(22),
  sshUsername: z.string().trim().min(1).max(64),
  sshPassword: z.string().min(1).max(256),
});

export const copyConfigSchema = z.object({
  targetHostId: z.string().min(1),
  source: sshCreds,
  target: sshCreds,
});

export type CreateHostInput = z.infer<typeof createHostSchema>;
export type UpdateHostInput = z.infer<typeof updateHostSchema>;
export type SshActionInput = z.infer<typeof sshActionSchema>;
