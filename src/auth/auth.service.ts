import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenStore } from './refresh-token.store';

const SALT_ROUNDS = 10;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly refreshTokenStore: RefreshTokenStore,
  ) {}

  async signup(dto: SignupDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('이미 가입된 이메일입니다.');
    }

    const hashed = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.usersService.create({
      email: dto.email,
      password: hashed,
      name: dto.name,
      role: dto.role,
    });

    const { password: _password, ...result } = user;
    return result;
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    const tokens = await this.generateTokens(user.id, user.role);
    // 발급한 refresh token을 인메모리 스토어에 저장 (rotation 기준값)
    this.refreshTokenStore.save(user.id, tokens.refreshToken);

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  /**
   * refresh
   * - refreshToken을 검증하고, 저장된 최신 토큰과 일치하는 경우에만 새 토큰쌍을 발급한다.
   * - rotation: 발급 시마다 새 refreshToken으로 교체하여 이전 토큰을 무효화한다.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: { sub: string; role: Role };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('유효하지 않은 refresh token입니다.');
    }

    // 재사용 방지: 스토어에 저장된 최신 토큰과 일치해야 한다.
    if (!this.refreshTokenStore.isValid(payload.sub, refreshToken)) {
      throw new UnauthorizedException('이미 사용되었거나 만료된 refresh token입니다.');
    }

    const tokens = await this.generateTokens(payload.sub, payload.role);
    // rotation: 새 refresh token으로 교체 → 방금 사용한 토큰은 자동 무효화
    this.refreshTokenStore.save(payload.sub, tokens.refreshToken);
    return tokens;
  }

  // 로그아웃: 해당 유저의 refresh token을 스토어에서 제거
  logout(userId: string): void {
    this.refreshTokenStore.remove(userId);
  }

  /**
   * Access(15m) + Refresh(7d) 토큰쌍을 생성한다.
   * - Access는 기존 JWT_SECRET으로 서명 (JwtStrategy/WsJwtGuard가 동일 secret으로 검증)
   * - Refresh는 별도 JWT_REFRESH_SECRET으로 서명
   */
  private async generateTokens(userId: string, role: Role): Promise<TokenPair> {
    const payload = { sub: userId, role };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.config.get<string>('JWT_SECRET'),
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
    });

    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
    });

    return { accessToken, refreshToken };
  }
}