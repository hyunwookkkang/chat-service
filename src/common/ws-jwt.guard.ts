import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
import { Role } from '@prisma/client';

/**
 * 소켓 인스턴스에 저장되는 인증 유저 정보
 */
export interface SocketUser {
  userId: string;
  role: Role;
}

/**
 * WsJwtGuard
 * - Socket.io 연결/이벤트에 대한 JWT 인증을 담당한다.
 * - 클라이언트는 연결 시 handshake.auth.token 또는 쿼리스트링(token)으로 JWT를 전달한다.
 */
@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * handshake에서 토큰을 추출한다.
   * - 우선순위: handshake.auth.token > handshake.query.token
   */
  private extractToken(client: Socket): string | undefined {
    const authToken = client.handshake?.auth?.token as string | undefined;
    if (authToken) {
      return authToken.replace(/^Bearer\s+/i, '');
    }
    const queryToken = client.handshake?.query?.token;
    if (typeof queryToken === 'string') {
      return queryToken;
    }
    return undefined;
  }

  /**
   * handleConnection에서 호출하는 인증 메서드.
   * - 검증 성공: socket.data.user에 { userId, role } 저장 후 true 반환
   * - 검증 실패: false 반환 (호출부에서 socket.disconnect() 처리)
   */
  authenticate(client: Socket): boolean {
    const token = this.extractToken(client);
    if (!token) {
      return false;
    }
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
      const user: SocketUser = { userId: payload.sub, role: payload.role };
      client.data.user = user;
      return true;
    } catch (error) {
      this.logger.warn(`WS JWT 검증 실패: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * 이벤트 핸들러 단위 가드로도 사용 가능.
   * - 이미 handleConnection에서 인증되어 socket.data.user가 있으면 통과
   * - 아니면 인증을 재시도한다.
   */
  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<Socket>();
    if (client.data?.user) {
      return true;
    }
    return this.authenticate(client);
  }
}