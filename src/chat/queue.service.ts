import { Injectable } from '@nestjs/common';

export interface QueueEntry {
  userId: string;
  socketId: string;
  enqueuedAt: number;
}

/**
 * QueueService
 * - 상담 가능한 상담사가 없을 때 고객을 인메모리 FIFO 대기열(배열)에 등록한다.
 *
 * NOTE: agents.service.ts / refresh-token.store.ts와 동일하게 "단일 서버 프로세스" 전제이다.
 *   다중 서버(수평 확장) 환경에서는 프로세스별 대기열이 분리되므로 Redis(List 등)로 교체 필요.
 *
 * [동시성 주의]
 * 아래 메서드들은 모두 await가 없는 "동기 메서드"이다. 호출부(ChatService)에서
 * findAvailableAgent()의 예약(+1)과 dequeue()를 같은 동기 블록에서 함께 호출하면
 * 상담사 선점과 고객 제거가 원자적으로 일어나 중복 매칭이 발생하지 않는다.
 */
@Injectable()
export class QueueService {
  private readonly queue: QueueEntry[] = [];

  /**
   * 대기열 맨 뒤에 추가하고 순번(1-based)을 반환한다.
   * - 이미 대기 중인 고객이면 소켓만 갱신하고 기존 순번을 반환(중복 등록 방지).
   */
  enqueue(userId: string, socketId: string): number {
    const existingIndex = this.queue.findIndex((e) => e.userId === userId);
    if (existingIndex !== -1) {
      this.queue[existingIndex].socketId = socketId;
      return existingIndex + 1;
    }
    this.queue.push({ userId, socketId, enqueuedAt: Date.now() });
    return this.queue.length;
  }

  /**
   * 대기열 맨 앞에 삽입한다(재배정 우선순위 부여).
   * - 이미 존재하면 제거 후 맨 앞으로 이동.
   */
  enqueueFront(userId: string, socketId: string): void {
    const existingIndex = this.queue.findIndex((e) => e.userId === userId);
    if (existingIndex !== -1) {
      this.queue.splice(existingIndex, 1);
    }
    this.queue.unshift({ userId, socketId, enqueuedAt: Date.now() });
  }

  // 맨 앞 고객을 꺼낸다(FIFO). 비어 있으면 undefined.
  dequeue(): QueueEntry | undefined {
    return this.queue.shift();
  }

  peek(): QueueEntry | undefined {
    return this.queue[0];
  }

  // 특정 고객을 대기열에서 제거(대기 중 연결 종료 등).
  remove(userId: string): boolean {
    const idx = this.queue.findIndex((e) => e.userId === userId);
    if (idx === -1) {
      return false;
    }
    this.queue.splice(idx, 1);
    return true;
  }

  // 현재 순번(1-based), 없으면 -1.
  getPosition(userId: string): number {
    const idx = this.queue.findIndex((e) => e.userId === userId);
    return idx === -1 ? -1 : idx + 1;
  }

  size(): number {
    return this.queue.length;
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }
}