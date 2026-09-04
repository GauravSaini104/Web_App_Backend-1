import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;
  type: 'customer' | 'staff';
}

export interface AuthenticatedUser {
  id: string;
  type: 'customer' | 'staff';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') ?? 'dev-secret-change-me',
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    return { id: payload.sub, type: payload.type };
  }
}
