import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/**
 * 관리자(ADMIN) 시드 스크립트
 * - ADMIN 계정은 일반 회원가입(/api/auth/signup)으로 만들 수 없으므로 여기서 미리 생성한다.
 * - email: admin@test.com / password: admin1234
 * 실행: npx prisma db seed
 */
async function main(): Promise<void> {
  const email = 'admin@test.com';
  const rawPassword = 'admin1234';
  const password = await bcrypt.hash(rawPassword, 10);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      password,
      name: '관리자',
      role: Role.ADMIN,
    },
  });

  console.log(`Seeded ADMIN account: ${admin.email} (id=${admin.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });