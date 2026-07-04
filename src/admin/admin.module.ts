import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AgentsModule } from '../agents/agents.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  // AgentsModule -> AgentsService, ChatModule -> QueueService(export) 재사용
  imports: [AgentsModule, ChatModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}