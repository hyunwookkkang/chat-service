import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type AgentStatus = 'ONLINE' | 'OFFLINE';

export interface AgentState {
  status: AgentStatus;
  activeChatCount: number;
}

/** 상담사 1인당 동시 상담 가능 인원 기본값 (환경변수 MAX_CONCURRENT_CHATS 미설정 시) */
export const DEFAULT_MAX_CONCURRENT_CHATS = 1;

/**
 * AgentsService
 * - 상담사의 실시간 상태(온라인 여부, 현재 배정 건수)를 인메모리 Map으로 관리한다.
 *   Map<agentId, { status, activeChatCount }>
 *
 * NOTE(중요): 이 인메모리 Map은 "단일 서버 프로세스" 전제이다.
 *   다중 서버(수평 확장) 환경에서는 프로세스 간 상태 공유가 불가능하므로
 *   반드시 Redis(또는 공유 저장소)로 교체해야 한다.
 *   현재 단계에서는 확장 계획이 없으므로 Redis를 도입하지 않는다.
 */
@Injectable()
export class AgentsService {
  private readonly agents = new Map<string, AgentState>();
  private readonly maxConcurrentChats: number;

  constructor(private readonly config: ConfigService) {
    const raw = this.config.get<string>('MAX_CONCURRENT_CHATS');
    const parsed = raw !== undefined ? Number.parseInt(raw, 10) : DEFAULT_MAX_CONCURRENT_CHATS;
    this.maxConcurrentChats =
      Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_MAX_CONCURRENT_CHATS;
  }

  getMaxConcurrentChats(): number {
    return this.maxConcurrentChats;
  }

  setAgentOnline(agentId: string): void {
    const existing = this.agents.get(agentId);
    if (existing) {
      existing.status = 'ONLINE';
    } else {
      this.agents.set(agentId, { status: 'ONLINE', activeChatCount: 0 });
    }
  }

  setAgentOffline(agentId: string): void {
    const existing = this.agents.get(agentId);
    if (existing) {
      existing.status = 'OFFLINE';
    } else {
      this.agents.set(agentId, { status: 'OFFLINE', activeChatCount: 0 });
    }
  }

  incrementActiveChat(agentId: string): void {
    const state = this.agents.get(agentId);
    if (state) {
      state.activeChatCount += 1;
    }
  }

  decrementActiveChat(agentId: string): void {
    const state = this.agents.get(agentId);
    if (state && state.activeChatCount > 0) {
      state.activeChatCount -= 1;
    }
  }

  getAgentState(agentId: string): AgentState | undefined {
    return this.agents.get(agentId);
  }

  // 현재 ONLINE 상태인 상담사 수
  getOnlineAgentCount(): number {
    let count = 0;
    for (const state of this.agents.values()) {
      if (state.status === 'ONLINE') {
        count += 1;
      }
    }
    return count;
  }

  // 인메모리 Map에 등록된 모든 상담사 상태 목록 (관리자 대시보드용)
  getAllAgents(): Array<{
    agentId: string;
    status: AgentStatus;
    activeChatCount: number;
  }> {
    return Array.from(this.agents.entries()).map(([agentId, state]) => ({
      agentId,
      status: state.status,
      activeChatCount: state.activeChatCount,
    }));
  }

  /**
   * findAvailableAgent
   * - ONLINE 상담사 중 activeChatCount가 maxConcurrentChats 미만인 상담사만 후보로 본다.
   * - 후보 중 activeChatCount가 가장 낮은 상담사를 선택한다.
   * - 선택하는 "즉시" 해당 상담사의 activeChatCount를 +1 하여 원자적으로 예약한다.
   *
   * [동시성 안전성 설명]
   * Node.js는 단일 스레드 이벤트 루프로 동작한다. 아래 로직에는 await(비동기 중단점)가
   * 전혀 없으므로, "탐색 -> +1"까지가 하나의 동기 코드 블록으로 원자적으로 실행된다.
   *
   * @returns 배정된 상담사 id, 없으면 null
   */
  findAvailableAgent(): string | null {
    let selectedId: string | null = null;
    let minCount = Number.POSITIVE_INFINITY;

    // --- 동기 블록 시작 (여기서는 절대 await 하지 않는다) ---
    for (const [agentId, state] of this.agents.entries()) {
      if (state.status !== 'ONLINE') {
        continue;
      }
      if (state.activeChatCount >= this.maxConcurrentChats) {
        continue;
      }
      if (state.activeChatCount < minCount) {
        minCount = state.activeChatCount;
        selectedId = agentId;
      }
    }

    if (selectedId !== null) {
      // 찾음과 동시에 즉시 +1 -> 원자적 예약
      this.agents.get(selectedId)!.activeChatCount += 1;
    }
    // --- 동기 블록 끝 ---

    return selectedId;
  }
}