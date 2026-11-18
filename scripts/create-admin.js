const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  const username = process.argv[2] || 'admin';
  const password = process.argv[3] || 'Password@123';
  const displayName = process.argv[4] || 'Administrator';

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.staffUser.upsert({
    where: { username },
    update: { passwordHash, isActive: true },
    create: {
      username,
      passwordHash,
      displayName,
      isActive: true,
    },
  });

  console.log('----------------------------------------');
  console.log('✅ Admin user created/updated successfully!');
  console.log(`Username: ${user.username}`);
  console.log(`Password: ${password}`);
  console.log('----------------------------------------');
}

main()
  .catch((e) => {
    console.error('❌ Error creating admin:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
