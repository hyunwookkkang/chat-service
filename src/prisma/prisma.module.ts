import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * PrismaModule
 * - @Global()로 선언하여 다른 모듈에서 별도 import 없이 PrismaService를 주입받을 수 있게 한다.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}