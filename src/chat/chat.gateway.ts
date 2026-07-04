import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { ChatRoom, Role } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { WsJwtGuard, SocketUser } from '../common/ws-jwt.guard';
import { AgentsService } from '../agents/agents.service';
import { ChatService } from './chat.service';
import { QueueService } from './queue.service';

/**
 * ChatGateway
 * - Socket.io 기반 실시간 채팅 게이트웨이.
 * - JWT 인증, 상담 요청/대기열, 메시지, 상담 종료, 상담사 끊김 재배정을 처리한다.
 */
@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly wsJwtGuard: WsJwtGuard,
    private readonly agentsService: AgentsService,
    private readonly chatService: ChatService,
    private readonly queueService: QueueService,
  ) {}

  private roomName(chatRoomId: string): string {
    return `room:${chatRoomId}`;
  }

  private getUser(client: Socket): SocketUser {
    return client.data.user as SocketUser;
  }

  /**
   * handleConnection
   * - JWT 검증 실패 시 즉시 연결 종료.
   * - 상담사(AGENT)가 접속하면 ONLINE으로 전환하고, 대기 고객이 있으면 자동 매칭 시도.
   */
  handleConnection(client: Socket): void {
    const authenticated = this.wsJwtGuard.authenticate(client);
    if (!authenticated) {
      this.logger.warn(`인증 실패 -> 연결 차단: ${client.id}`);
      client.disconnect();
      return;
    }

    const user = this.getUser(client);
    this.logger.log(
      `연결됨: socket=${client.id}, userId=${user.userId}, role=${user.role}`,
    );

    if (user.role === Role.AGENT) {
      this.agentsService.setAgentOnline(user.userId);
      // 새 상담사가 온라인이 되었으니 대기열을 소진 시도 (fire-and-forget)
      void this.drainQueue();
    }
  }

  /**
   * handleDisconnect
   * - 고객: 대기 중이었다면 대기열에서 제거.
   * - 상담사: 오프라인 처리 후, 진행 중이던 상담을 재배정.
   */
  handleDisconnect(client: Socket): void {
    const user = client.data?.user as SocketUser | undefined;
    if (!user) {
      return;
    }

    this.logger.log(`연결 종료: socket=${client.id}, userId=${user.userId}`);

    if (user.role === Role.USER) {
      // 대기 중 이탈 시 대기열에서 제거
      this.queueService.remove(user.userId);
      return;
    }

    if (user.role === Role.AGENT) {
      this.agentsService.setAgentOffline(user.userId);
      // 상담사 갑작스러운 끊김 -> 진행 중 상담 재배정 (fire-and-forget)
      void this.handleAgentReassignment(user.userId);
    }
  }

  /**
   * request_consultation (고객 -> 서버)
   * - 상담사가 있으면 즉시 매칭(ChatRoom 생성 + join + chat_matched).
   * - 없으면 대기열에 등록하고 queued 이벤트로 순번 안내.
   */
  @SubscribeMessage('request_consultation')
  async handleRequestConsultation(@ConnectedSocket() client: Socket): Promise<void> {
    const user = this.getUser(client);
    if (user.role !== Role.USER) {
      throw new WsException('고객(USER)만 상담을 요청할 수 있습니다.');
    }

    const chatRoom = await this.chatService.matchAgent(user.userId);
    if (chatRoom && chatRoom.agentId) {
      await this.establishRoom(chatRoom);
      return;
    }

    // 상담 가능한 상담사가 없음 -> 대기열 등록
    const position = this.queueService.enqueue(user.userId, client.id);
    client.emit('queued', {
      position,
      message: `현재 모든 상담사가 상담 중입니다. 대기열 ${position}번으로 등록되었습니다.`,
    });
  }

  /**
   * send_message (양쪽 -> 서버 -> room 전체)
   */
  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { chatRoomId: string; content: string },
  ): Promise<void> {
    const user = this.getUser(client);
    const chatRoomId = payload?.chatRoomId;
    const content = payload?.content;
    if (!chatRoomId || !content) {
      throw new WsException('chatRoomId와 content가 필요합니다.');
    }

    const message = await this.chatService.saveMessage(
      chatRoomId,
      user.userId,
      content,
    );

    this.server.to(this.roomName(chatRoomId)).emit('receive_message', {
      id: message.id,
      chatRoomId: message.chatRoomId,
      senderId: message.senderId,
      content: message.content,
      createdAt: message.createdAt,
    });
  }

  /**
   * end_consultation (상담사 -> 서버)
   * - ChatRoom COMPLETED + 카운트 감소, chat_ended 전달 후 leave.
   * - 상담사 여유가 생겼으니 대기열 소진 시도.
   */
  @SubscribeMessage('end_consultation')
  async handleEndConsultation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { chatRoomId: string },
  ): Promise<void> {
    const user = this.getUser(client);
    if (user.role !== Role.AGENT) {
      throw new WsException('상담사(AGENT)만 상담을 종료할 수 있습니다.');
    }
    const chatRoomId = payload?.chatRoomId;
    if (!chatRoomId) {
      throw new WsException('chatRoomId가 필요합니다.');
    }

    const chatRoom = await this.chatService.endConsultation(chatRoomId);
    if (!chatRoom) {
      throw new WsException('존재하지 않는 상담방입니다.');
    }

    const room = this.roomName(chatRoomId);
    this.server.to(room).emit('chat_ended', {
      chatRoomId: chatRoom.id,
      status: chatRoom.status,
      closedAt: chatRoom.closedAt,
    });

    const sockets = await this.server.in(room).fetchSockets();
    for (const s of sockets) {
      s.leave(room);
    }

    // 상담사 슬롯이 비었으니 대기 고객 매칭 시도
    await this.drainQueue();
  }

  /**
   * establishRoom
   * - 매칭된 ChatRoom의 고객/상담사 소켓을 같은 room에 join시키고 chat_matched를 브로드캐스트.
   */
  private async establishRoom(chatRoom: ChatRoom): Promise<void> {
    const room = this.roomName(chatRoom.id);

    const userSockets = await this.findSocketsByUserId(chatRoom.userId);
    for (const s of userSockets) {
      await s.join(room);
    }

    if (chatRoom.agentId) {
      const agentSockets = await this.findSocketsByUserId(chatRoom.agentId);
      for (const s of agentSockets) {
        await s.join(room);
      }
    }

    this.server.to(room).emit('chat_matched', {
      chatRoomId: chatRoom.id,
      userId: chatRoom.userId,
      agentId: chatRoom.agentId,
      status: chatRoom.status,
      room,
    });
  }

  /**
   * drainQueue
   * - 상담 가능한 상담사가 있는 동안 대기열 맨 앞 고객부터 순차 매칭한다.
   * - 각 매칭의 상담사 선점+dequeue는 tryMatchFromQueue 내부 동기 블록에서 원자적으로 처리되므로,
   *   이 루프가 동시에 여러 번 호출돼도 중복 매칭이 발생하지 않는다.
   */
  private async drainQueue(): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await this.chatService.tryMatchFromQueue();
      if (!result) {
        break;
      }
      await this.establishRoom(result.chatRoom);
    }
  }

  /**
   * handleAgentReassignment
   * - 상담사가 갑자기 끊겼을 때 진행 중이던 ChatRoom들을 WAITING으로 되돌리고,
   *   각 고객을 대기열 "맨 앞"에 넣어 재배정 우선순위를 준다.
   * - 고객에게 agent_disconnected 알림을 보낸 뒤, 다른 상담사가 있으면 즉시 재매칭.
   */
  private async handleAgentReassignment(agentId: string): Promise<void> {
    const rooms = await this.chatService.reassignAgentRooms(agentId);

    for (const room of rooms) {
      const roomName = this.roomName(room.id);

      // 고객에게 재배정 안내
      this.server.to(roomName).emit('agent_disconnected', {
        chatRoomId: room.id,
        message: '상담사 연결이 끊겨 재배정 중입니다. 잠시만 기다려 주세요.',
      });

      // 고객을 대기열 맨 앞에 우선 등록
      const userSockets = await this.findSocketsByUserId(room.userId);
      const socketId = userSockets[0]?.id ?? '';
      this.queueService.enqueueFront(room.userId, socketId);

      // 기존 room 정리
      const sockets = await this.server.in(roomName).fetchSockets();
      for (const s of sockets) {
        s.leave(roomName);
      }
    }

    // 재배정 대상 고객들 매칭 시도 (다른 ONLINE 상담사가 있으면 즉시 매칭)
    await this.drainQueue();
  }

  /**
   * 특정 userId를 가진 소켓들을 찾는다(멀티 탭/기기 대비 배열 반환).
   *
   * NOTE: 다중 서버 환경에서는 fetchSockets()가 현재 서버 소켓만 조회하므로
   *   socket.io Redis 어댑터로 교체해야 전체 서버 소켓을 대상으로 동작한다.
   */
  private async findSocketsByUserId(userId: string): Promise<any[]> {
    const allSockets = await this.server.fetchSockets();
    return allSockets.filter(
      (s) => (s.data?.user as SocketUser | undefined)?.userId === userId,
    );
  }
}