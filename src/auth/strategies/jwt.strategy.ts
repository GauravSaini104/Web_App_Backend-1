import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { AuthService } from '../auth.service';

export interface JwtPayload {
  sub: string;
  type: 'customer' | 'staff';
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  id: string;
  type: 'customer' | 'staff';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') ?? 'dev-secret-change-me',
      passReqToCallback: true,
    });
  }

  validate(req: Request, payload: JwtPayload): AuthenticatedUser {
    const authHeader = req.headers?.['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (
      (token && this.authService.isTokenRevoked(token)) ||
      this.authService.isUserRevoked(payload.sub, payload.iat)
    ) {
      throw new UnauthorizedException('Token has been revoked');
    }
    return { id: payload.sub, type: payload.type };
  }
}
