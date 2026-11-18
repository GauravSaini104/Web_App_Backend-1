const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  const username = process.argv[2] || 'admin';
  const password = process.argv[3] || 'Password@123';

  console.log('--------------------------------------------------');
  console.log(`🔍 Checking staff user: "${username}" with password: "${password}"`);
  console.log('--------------------------------------------------');

  const staff = await prisma.staffUser.findUnique({
    where: { username },
  });

  if (!staff) {
    console.log(`❌ User "${username}" was NOT FOUND in database!`);
    const allStaff = await prisma.staffUser.findMany({
      select: { username: true, displayName: true, isActive: true },
    });
    console.log('Current staff users in DB:', allStaff);
    return;
  }

  console.log(`✅ Found staff: "${staff.username}" (DisplayName: "${staff.displayName}")`);
  console.log(`   isActive: ${staff.isActive}`);

  if (!staff.isActive) {
    console.log(`❌ Account is INACTIVE! staffLogin requires isActive = true.`);
    return;
  }

  const isMatch = await bcrypt.compare(password, staff.passwordHash);
  if (!isMatch) {
    console.log(`❌ Password does NOT match the bcrypt hash in database!`);
  } else {
    console.log(`✅ PASSWORD MATCHES! Login credentials are 100% valid.`);
  }
  console.log('--------------------------------------------------');
}

main()
  .catch((e) => console.error('Database error:', e.message))
  .finally(() => prisma.$disconnect());

