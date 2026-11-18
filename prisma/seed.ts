import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'Password@123';
  const displayName = process.env.ADMIN_DISPLAY_NAME || 'Super Admin';

  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.staffUser.upsert({
    where: { username },
    update: {
      passwordHash,
      isActive: true,
      displayName,
    },
    create: {
      username,
      passwordHash,
      displayName,
      isActive: true,
    },
  });

  console.log('--------------------------------------------------');
  console.log('✅ Staff/Admin Seeded Successfully on this server!');
  console.log(`👤 Username:     ${admin.username}`);
  console.log(`🔑 Password:     ${password}`);
  console.log(`🆔 ID:           ${admin.id}`);
  console.log(`📅 Created/Updated: ${admin.updatedAt}`);
  console.log('--------------------------------------------------');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
