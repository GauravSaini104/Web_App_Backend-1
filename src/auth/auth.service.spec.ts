import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../database/prisma.service';
import { SmsService } from './sms.service';

// The installed @nestjs/jwt ships an ES module (its dist uses `import`
// syntax), which Jest's CommonJS runtime can't parse directly. Mocking the
// module at the boundary avoids ever loading the real file — this has no
// bearing on production, where Nest's own build pipeline handles it fine.
jest.mock('@nestjs/jwt', () => ({ JwtService: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JwtService } = require('@nestjs/jwt');

const mockPrismaService = {
  otpRequest: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  customer: { upsert: jest.fn() },
  staffUser: { count: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
};

const mockJwtService = { signAsync: jest.fn().mockResolvedValue('signed-token') };

const mockSmsService = { isConfigured: jest.fn(), sendOtp: jest.fn() };

describe('AuthService', () => {
  let service: AuthService;
  let configValues: Record<string, string | undefined>;
  const mockConfigService = { get: jest.fn((key: string) => configValues[key]) };

  beforeEach(async () => {
    jest.clearAllMocks();
    configValues = {};
    mockSmsService.isConfigured.mockReturnValue(false);
    mockPrismaService.otpRequest.create.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: SmsService, useValue: mockSmsService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('requestOtp — FIXED_TEST_OTP safety', () => {
    it('uses the fixed test OTP when set outside production', async () => {
      configValues.FIXED_TEST_OTP = '123456';
      configValues.NODE_ENV = 'development';

      const result = await service.requestOtp('9876543210');

      expect(result).toEqual(expect.objectContaining({ devOnlyOtp: '123456' }));
    });

    it('NEVER uses the fixed test OTP in production, even if it is set', async () => {
      configValues.FIXED_TEST_OTP = '123456';
      configValues.NODE_ENV = 'production';

      const result = await service.requestOtp('9876543210');

      // devOnlyOtp must not leak in production at all...
      expect(result).not.toHaveProperty('devOnlyOtp');

      // ...and the code actually stored/hashed must not be the fixed one.
      const storedHash = mockPrismaService.otpRequest.create.mock.calls[0][0].data.codeHash;
      const fixedHash = createHash('sha256').update('123456').digest('hex');
      expect(storedHash).not.toBe(fixedHash);
    });

    it('falls back to a random 6-digit code when no fixed OTP is configured', async () => {
      configValues.NODE_ENV = 'development';

      const result = await service.requestOtp('9876543210');

      expect(result).toEqual(
        expect.objectContaining({ devOnlyOtp: expect.stringMatching(/^\d{6}$/) }),
      );
    });

    it('never returns devOnlyOtp in production even without a fixed OTP set', async () => {
      configValues.NODE_ENV = 'production';

      const result = await service.requestOtp('9876543210');

      expect(result).not.toHaveProperty('devOnlyOtp');
    });
  });

  describe('requestOtp — real SMS provider', () => {
    it('sends via SmsService and omits devOnlyOtp when a provider is configured', async () => {
      configValues.NODE_ENV = 'development';
      mockSmsService.isConfigured.mockReturnValue(true);
      mockSmsService.sendOtp.mockResolvedValue(undefined);

      const result = await service.requestOtp('9876543210');

      expect(mockSmsService.sendOtp).toHaveBeenCalledWith(
        '9876543210',
        expect.any(String),
        expect.any(Number),
      );
      expect(result).not.toHaveProperty('devOnlyOtp');
    });
  });
});
