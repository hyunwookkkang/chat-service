import { Injectable } from '@nestjs/common';

/**
 * RefreshTokenStore
 * - 유저별 "현재 유효한" Refresh Token을 인메모리 Map으로 저장한다.
 *   Map<userId, refreshToken>
 * - rotation: 새 토큰을 save 하면 이전 토큰을 덮어써서 즉시 무효화된다.
 *   (isValid는 저장된 최신 토큰과의 일치 여부로 판단하므로, 회전된 옛 토큰은 재사용 불가)
 *
 * NOTE: agents.service.ts와 동일하게 "단일 서버 프로세스" 전제의 인메모리 저장이다.
 *   다중 서버(수평 확장) 환경에서는 프로세스 간 공유가 불가능하므로 Redis로 교체 필요.
 */
@Injectable()
export class RefreshTokenStore {
  private readonly tokens = new Map<string, string>();

  save(userId: string, refreshToken: string): void {
    this.tokens.set(userId, refreshToken);
  }

  // 저장된 최신 토큰과 일치하는지 검증 (재사용/회전 방지)
  isValid(userId: string, refreshToken: string): boolean {
    return this.tokens.get(userId) === refreshToken;
  }

  remove(userId: string): void {
    this.tokens.delete(userId);
  }
}