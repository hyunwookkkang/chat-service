import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { QueueService } from './queue.service';
import { AgentsModule } from '../agents/agents.module';
import { AuthModule } from '../auth/auth.module';
import { WsJwtGuard } from '../common/ws-jwt.guard';

@Module({
  // AuthModule은 JwtModule을 export하므로 WsJwtGuard가 JwtService를 주입받을 수 있다.
  imports: [AuthModule, AgentsModule],
  providers: [ChatGateway, ChatService, QueueService, WsJwtGuard],
  // AdminModule 등에서 대기열 상태(size 등)를 조회할 수 있도록 export
  exports: [QueueService],
})
export class ChatModule {}