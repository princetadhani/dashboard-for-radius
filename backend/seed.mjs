import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const h = await prisma.host.upsert({
  where: { ipAddress: '10.76.191.233' },
  update: {},
  create: { friendlyName: 'Demo Lab', ipAddress: '10.76.191.233', port: 9000 },
});
console.log(JSON.stringify(h, null, 2));
await prisma.$disconnect();
