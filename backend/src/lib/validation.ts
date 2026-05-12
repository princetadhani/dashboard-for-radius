import { z } from 'zod';

const ipv4 = z
  .string()
  .regex(
    /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/,
    'Must be a valid IPv4 address',
  );

export const createHostSchema = z.object({
  friendlyName: z.string().trim().min(1).max(64),
  ipAddress: ipv4,
  port: z.number().int().min(1).max(65535).optional().default(9000),
  sshPort: z.number().int().min(1).max(65535).optional().default(22),
  sshUsername: z.string().trim().min(1).max(64),
  sshPassword: z.string().min(1).max(256),
});

export const updateHostSchema = z.object({
  friendlyName: z.string().trim().min(1).max(64).optional(),
  ipAddress: ipv4.optional(),
  port: z.number().int().min(1).max(65535).optional(),
});

export type CreateHostInput = z.infer<typeof createHostSchema>;
export type UpdateHostInput = z.infer<typeof updateHostSchema>;
