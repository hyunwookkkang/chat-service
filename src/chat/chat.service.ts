import { Injectable } from '@nestjs/common';
import { ChatRoom, ChatRoomStatus, Message } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AgentsService } from '../agents/agents.service';
import { QueueService, QueueEntry } from './queue.service';

/**
 * ChatService
 * - 상담사 배정, 대기열 매칭, 메시지 저장, 상담 종료, 재배정 등 채팅 도메인 핵심 로직.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentsService: AgentsService,
    private readonly queueService: QueueService,
  ) {}

  /**
   * matchAgent
   * - findAvailableAgent()로 상담사를 찾는다(찾는 즉시 activeChatCount +1 원자 예약).
   * - 있으면 ChatRoom을 ACTIVE로 생성해 반환, 없으면 null.
   */
  async matchAgent(userId: string): Promise<ChatRoom | null> {
    const agentId = this.agentsService.findAvailableAgent();
    if (!agentId) {
      return null;
    }

    try {
      const chatRoom = await this.prisma.chatRoom.create({
        // 즉시 매칭이므로 matchedAt을 생성 시점에 기록 (WAITING -> ACTIVE 전환 시각)
        data: {
          userId,
          agentId,
          status: ChatRoomStatus.ACTIVE,
          matchedAt: new Date(),
        },
      });
      return chatRoom;
    } catch (error) {
      this.agentsService.decrementActiveChat(agentId);
      throw error;
    }
  }

  /**
   * tryMatchFromQueue
   * - 대기열 맨 앞 고객을 상담 가능한 상담사와 1건 매칭한다.
   * - 매칭 성공 시 { chatRoom, entry } 반환, 실패(대기열 비었거나 상담사 없음) 시 null.
   *
   * [동시성 안전성]
   * 아래 "예약 블록"에는 await가 전혀 없다. Node.js 단일 스레드 이벤트 루프 특성상
   * 이 블록(상담사 선점 +1 및 dequeue)은 원자적으로 실행되어, 여러 트리거
   * (상담 종료 / 상담사 ONLINE)가 거의 동시에 발생해도 같은 상담사나 같은 고객이
   * 중복 매칭되지 않는다. DB 생성(await)은 예약이 끝난 뒤에만 수행한다.
   */
  async tryMatchFromQueue(): Promise<{ chatRoom: ChatRoom; entry: QueueEntry } | null> {
    // --- 동기 예약 블록 시작 (여기서는 절대 await 하지 않는다) ---
    if (this.queueService.isEmpty()) {
      return null;
    }
    const agentId = this.agentsService.findAvailableAgent(); // 있으면 즉시 +1
    if (!agentId) {
      return null;
    }
    const entry = this.queueService.dequeue(); // 맨 앞 고객 제거
    // --- 동기 예약 블록 끝 ---

    if (!entry) {
      // 방어적 처리: 예약했던 상담사 카운트 롤백
      this.agentsService.decrementActiveChat(agentId);
      return null;
    }

    try {
      const chatRoom = await this.prisma.chatRoom.create({
        data: {
          userId: entry.userId,
          agentId,
          status: ChatRoomStatus.ACTIVE,
          matchedAt: new Date(),
        },
      });
      return { chatRoom, entry };
    } catch (error) {
      // 롤백: 상담사 카운트 감소 + 고객을 대기열 맨 앞으로 복귀
      this.agentsService.decrementActiveChat(agentId);
      this.queueService.enqueueFront(entry.userId, entry.socketId);
      throw error;
    }
  }

  async saveMessage(
    chatRoomId: string,
    senderId: string,
    content: string,
  ): Promise<Message> {
    return this.prisma.message.create({
      data: { chatRoomId, senderId, content },
    });
  }

  /**
   * endConsultation
   * - ChatRoom을 COMPLETED로 변경(closedAt 기록)하고 상담사 카운트를 감소시킨다.
   */
  async endConsultation(chatRoomId: string): Promise<ChatRoom | null> {
    const chatRoom = await this.prisma.chatRoom.findUnique({
      where: { id: chatRoomId },
    });
    if (!chatRoom) {
      return null;
    }

    const updated = await this.prisma.chatRoom.update({
      where: { id: chatRoomId },
      data: { status: ChatRoomStatus.COMPLETED, closedAt: new Date() },
    });

    if (chatRoom.agentId) {
      this.agentsService.decrementActiveChat(chatRoom.agentId);
    }
    return updated;
  }

  /**
   * reassignAgentRooms
   * - 특정 상담사가 진행 중이던 모든 ACTIVE ChatRoom을 조회하여
   *   상태를 WAITING으로 되돌리고 agentId를 비운다(재배정 대상).
   * - 끊긴 상담사의 활성 카운트 정합성도 함께 보정한다.
   * - 되돌린 방들의 원본 정보를 반환하여 호출부(Gateway)가 고객을 재큐잉할 수 있게 한다.
   */
  async reassignAgentRooms(agentId: string): Promise<ChatRoom[]> {
    const activeRooms = await this.prisma.chatRoom.findMany({
      where: { agentId, status: ChatRoomStatus.ACTIVE },
    });

    for (const room of activeRooms) {
      await this.prisma.chatRoom.update({
        where: { id: room.id },
        // 재배정 대상으로 되돌리므로 매칭 시각도 초기화
        data: { status: ChatRoomStatus.WAITING, agentId: null, matchedAt: null },
      });
      this.agentsService.decrementActiveChat(agentId);
    }

    return activeRooms;
  }

  getChatRoom(chatRoomId: string): Promise<ChatRoom | null> {
    return this.prisma.chatRoom.findUnique({ where: { id: chatRoomId } });
  }
}