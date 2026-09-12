jest.mock('@nestjs/jwt', () => ({ JwtService: jest.fn() }));
jest.mock('@nestjs/passport', () => ({
  PassportStrategy: () => class {},
}));

jest.mock('passport-jwt', () => ({
  ExtractJwt: {
    fromAuthHeaderAsBearerToken: jest.fn(() => (req: any) => {
      const authHeader = req?.headers?.authorization;
      return authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    }),
  },
  Strategy: class {},
}));

import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import type { AuthService } from '../auth.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JwtStrategy } = require('./jwt.strategy');

describe('JwtStrategy', () => {
  let strategy: any;
  let authService: Partial<AuthService>;
  let configService: Partial<ConfigService>;

  beforeEach(() => {
    authService = {
      isTokenRevoked: jest.fn().mockReturnValue(false),
      isUserRevoked: jest.fn().mockReturnValue(false),
    };
    configService = {
      get: jest.fn().mockReturnValue('test-secret'),
    };
    strategy = new JwtStrategy(configService as ConfigService, authService as AuthService);
  });

  it('validates and returns user when token is valid and not revoked', () => {
    const mockReq = {
      headers: {
        authorization: 'Bearer valid-jwt-token',
      },
    } as unknown as Request;

    const payload = { sub: 'cust_123', type: 'customer' as const, iat: 1000 };
    const result = strategy.validate(mockReq, payload);

    expect(result).toEqual({ id: 'cust_123', type: 'customer' });
    expect(authService.isTokenRevoked).toHaveBeenCalledWith('valid-jwt-token');
    expect(authService.isUserRevoked).toHaveBeenCalledWith('cust_123', 1000);
  });

  it('throws UnauthorizedException when token is revoked / blacklisted', () => {
    (authService.isTokenRevoked as jest.Mock).mockReturnValue(true);

    const mockReq = {
      headers: {
        authorization: 'Bearer revoked-jwt-token',
      },
    } as unknown as Request;

    const payload = { sub: 'cust_123', type: 'customer' as const };

    expect(() => strategy.validate(mockReq, payload)).toThrow(
      new UnauthorizedException('Token has been revoked'),
    );
    expect(authService.isTokenRevoked).toHaveBeenCalledWith('revoked-jwt-token');
  });

  it('throws UnauthorizedException when user session is revoked', () => {
    (authService.isUserRevoked as jest.Mock).mockReturnValue(true);

    const mockReq = {
      headers: {
        authorization: 'Bearer any-jwt-token',
      },
    } as unknown as Request;

    const payload = { sub: 'cust_123', type: 'customer' as const, iat: 500 };

    expect(() => strategy.validate(mockReq, payload)).toThrow(
      new UnauthorizedException('Token has been revoked'),
    );
    expect(authService.isUserRevoked).toHaveBeenCalledWith('cust_123', 500);
  });
});
