import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminService } from './admin.service';

/**
 * 관리자 대시보드 API
 * - JwtAuthGuard(인증) + RolesGuard(@Roles(ADMIN)) 조합으로 ADMIN만 접근 가능.
 */
@Controller('api/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // GET /api/admin/dashboard
  @Get('dashboard')
  getDashboard() {
    return this.adminService.getDashboard();
  }

  // GET /api/admin/agents
  @Get('agents')
  getAgents() {
    return this.adminService.getAgents();
  }

  // GET /api/admin/stats
  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }
}