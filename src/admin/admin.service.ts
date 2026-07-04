import { Injectable } from '@nestjs/common';
import { ChatRoomStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AgentsService } from '../agents/agents.service';
import { QueueService } from '../chat/queue.service';

export interface DashboardResponse {
  waitingCount: number;
  onlineAgentCount: number;
  activeChatCount: number;
}

export interface AgentSummary {
  agentId: string;
  name: string;
  status: string;
  activeChatCount: number;
}

export interface StatsResponse {
  avgWaitTimeSeconds: number;
  avgChatDurationSeconds: number;
  totalChatsLast24h: number;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentsService: AgentsService,
    private readonly queueService: QueueService,
  ) {}

  /**
   * 대시보드 요약 지표
   * - waitingCount: 인메모리 대기열 길이
   * - onlineAgentCount: 인메모리 Map에서 ONLINE 상담사 수
   * - activeChatCount: DB에서 status=ACTIVE인 ChatRoom 수
   */
  async getDashboard(): Promise<DashboardResponse> {
    const activeChatCount = await this.prisma.chatRoom.count({
      where: { status: ChatRoomStatus.ACTIVE },
    });

    return {
      waitingCount: this.queueService.size(),
      onlineAgentCount: this.agentsService.getOnlineAgentCount(),
      activeChatCount,
    };
  }

  /**
   * 상담사 목록
   * - 인메모리 상태(status, activeChatCount)와 User.name을 조인해서 반환.
   */
  async getAgents(): Promise<AgentSummary[]> {
    const agents = this.agentsService.getAllAgents();
    if (agents.length === 0) {
      return [];
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: agents.map((a) => a.agentId) } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(users.map((u) => [u.id, u.name]));

    return agents.map((a) => ({
      agentId: a.agentId,
      name: nameMap.get(a.agentId) ?? 'Unknown',
      status: a.status,
      activeChatCount: a.activeChatCount,
    }));
  }

  /**
   * 통계 (최근 24시간 생성 ChatRoom 기준)
   * - avgWaitTimeSeconds: (matchedAt - createdAt) 평균
   * - avgChatDurationSeconds: (closedAt - matchedAt) 평균
   * - totalChatsLast24h: 최근 24시간 생성된 ChatRoom 수
   */
  async getStats(): Promise<StatsResponse> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const rooms = await this.prisma.chatRoom.findMany({
      where: { createdAt: { gte: since } },
      select: { createdAt: true, matchedAt: true, closedAt: true },
    });

    const totalChatsLast24h = rooms.length;

    // 평균 대기시간: matchedAt이 기록된 방들의 (matchedAt - createdAt)
    const waitDurations = rooms
      .filter((r) => r.matchedAt != null)
      .map((r) => (r.matchedAt!.getTime() - r.createdAt.getTime()) / 1000);

    // 평균 상담시간: matchedAt과 closedAt이 모두 있는 방들의 (closedAt - matchedAt)
    const chatDurations = rooms
      .filter((r) => r.matchedAt != null && r.closedAt != null)
      .map((r) => (r.closedAt!.getTime() - r.matchedAt!.getTime()) / 1000);

    return {
      avgWaitTimeSeconds: this.average(waitDurations),
      avgChatDurationSeconds: this.average(chatDurations),
      totalChatsLast24h,
    };
  }

  // 평균을 정수 초로 반올림해서 반환 (빈 배열이면 0)
  private average(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    const sum = values.reduce((acc, v) => acc + v, 0);
    return Math.round(sum / values.length);
  }
}