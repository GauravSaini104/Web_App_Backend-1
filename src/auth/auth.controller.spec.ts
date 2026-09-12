jest.mock('@nestjs/jwt', () => ({ JwtService: jest.fn() }));
jest.mock('@nestjs/passport', () => ({
  PassportStrategy: () => class {},
  AuthGuard: () => class {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { Request } from 'express';
import { AuthService } from './auth.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AuthController } = require('./auth.controller');

describe('AuthController', () => {
  let controller: any;
  let authService: Partial<AuthService>;

  beforeEach(async () => {
    authService = {
      requestOtp: jest.fn().mockResolvedValue({ message: 'OTP sent' }),
      verifyOtp: jest.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' }),
      staffLogin: jest.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' }),
      refreshToken: jest.fn().mockResolvedValue({ accessToken: 'new-access', refreshToken: 'new-refresh' }),
      logout: jest.fn().mockReturnValue({ message: 'Logged out successfully' }),
      getCurrentUser: jest.fn().mockResolvedValue({ id: 'cust_1', phone: '9876543210' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<any>(AuthController);
  });

  describe('logout', () => {
    it('calls authService.logout with bearer token and body refresh token', () => {
      const mockReq = {
        headers: {
          authorization: 'Bearer access-token-123',
        },
      } as unknown as Request;

      const dto = { refreshToken: 'refresh-token-456' };

      const result = controller.logout(mockReq, dto);

      expect(authService.logout).toHaveBeenCalledWith('access-token-123', 'refresh-token-456');
      expect(result).toEqual({ message: 'Logged out successfully' });
    });

    it('handles logout with no body and no auth header gracefully', () => {
      const mockReq = {
        headers: {},
      } as unknown as Request;

      const result = controller.logout(mockReq);

      expect(authService.logout).toHaveBeenCalledWith(undefined, undefined);
      expect(result).toEqual({ message: 'Logged out successfully' });
    });
  });
});
