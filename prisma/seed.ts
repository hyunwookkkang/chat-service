import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/**
 * 관리자(ADMIN) 시드 스크립트
 * - ADMIN 계정은 일반 회원가입(/api/auth/signup)으로 만들 수 없으므로 여기서 미리 생성한다.
 * - 계정 정보는 환경변수 ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD를 우선 사용하고,
 *   없으면 기본값(admin@test.com / admin1234)으로 fallback한다.
 *   [보안] 기본값은 로컬 개발/테스트 전용이다. 실제 배포 시에는 반드시 환경변수로 주입하거나
 *   시드 실행 후 비밀번호를 변경할 것.
 * 실행: npx prisma db seed
 */
async function main(): Promise<void> {
  const email = process.env.ADMIN_SEED_EMAIL ?? 'admin@test.com';
  const rawPassword = process.env.ADMIN_SEED_PASSWORD ?? 'admin1234';
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