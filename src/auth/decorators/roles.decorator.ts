import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

// 특정 역할만 접근 가능한 핸들러에 사용: @Roles(Role.AGENT)
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);