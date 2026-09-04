import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SmsService } from './sms.service';

describe('SmsService', () => {
  let service: SmsService;
  let configValues: Record<string, string | undefined>;

  const mockConfigService = {
    get: jest.fn((key: string) => configValues[key]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    configValues = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [SmsService, { provide: ConfigService, useValue: mockConfigService }],
    }).compile();

    service = module.get<SmsService>(SmsService);
  });

  describe('isConfigured', () => {
    it('is false when SMS_PROVIDER is unset', () => {
      expect(service.isConfigured()).toBe(false);
    });

    it('is false when SMS_PROVIDER is set but the API key is missing', () => {
      configValues.SMS_PROVIDER = 'fast2sms';
      expect(service.isConfigured()).toBe(false);
    });

    it('is true when both SMS_PROVIDER and FAST2SMS_API_KEY are set', () => {
      configValues.SMS_PROVIDER = 'fast2sms';
      configValues.FAST2SMS_API_KEY = 'test-key';
      expect(service.isConfigured()).toBe(true);
    });
  });

  describe('sendOtp', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('calls the Fast2SMS Quick SMS route with the expected parameters', async () => {
      configValues.FAST2SMS_API_KEY = 'test-key';
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ return: true, request_id: 'abc123' }),
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      await service.sendOtp('9876543210', '123456', 5);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = new URL(mockFetch.mock.calls[0][0] as string);
      expect(calledUrl.origin + calledUrl.pathname).toBe('https://www.fast2sms.com/dev/bulkV2');
      expect(calledUrl.searchParams.get('route')).toBe('q');
      expect(calledUrl.searchParams.get('numbers')).toBe('9876543210');
      expect(calledUrl.searchParams.get('message')).toContain('123456');
    });

    it('throws when Fast2SMS reports failure', async () => {
      configValues.FAST2SMS_API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ return: false, message: 'Invalid Authorization key' }),
      }) as unknown as typeof fetch;

      await expect(service.sendOtp('9876543210', '123456', 5)).rejects.toThrow(
        'Invalid Authorization key',
      );
    });

    it('throws when the HTTP response itself is not ok', async () => {
      configValues.FAST2SMS_API_KEY = 'test-key';
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ return: false, message: 'Invalid Authorization key' }),
      }) as unknown as typeof fetch;

      await expect(service.sendOtp('9876543210', '123456', 5)).rejects.toThrow();
    });
  });
});
