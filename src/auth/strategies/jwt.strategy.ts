import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';

/**
 * JWT payload 구조
 * - sub: userId
 * - role: USER | AGENT
 */
export interface JwtPayload {
  sub: string;
  role: Role;
}

/**
 * 인증된 요청에서 사용할 유저 정보 형태
 */
export interface AuthUser {
  userId: string;
  role: Role;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') as string,
    });
  }

  // validate 반환값이 req.user 에 주입된다.
  async validate(payload: JwtPayload): Promise<AuthUser> {
    return { userId: payload.sub, role: payload.role };
  }
}