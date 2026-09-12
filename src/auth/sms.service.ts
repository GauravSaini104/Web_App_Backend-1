import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface Fast2SmsResponse {
  return: boolean;
  status_code?: number;
  request_id?: string;
  message?: string | string[];
}


@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return (
      this.configService.get<string>('SMS_PROVIDER')?.trim() === 'fast2sms' &&
      Boolean(this.configService.get<string>('FAST2SMS_API_KEY')?.trim())
    );
  }

  async sendOtp(phone: string, code: string, expiryMinutes: number): Promise<void> {
    const message = `Your OTP is ${code}. It is valid for ${expiryMinutes} minutes. Do not share this code with anyone.`;
    return this.sendMessage(phone, message);
  }

  
  async sendMessage(phone: string, message: string): Promise<void> {
    const rawApiKey = this.configService.get<string>('FAST2SMS_API_KEY')?.trim();
    if (!rawApiKey) {
      this.logger.log(`[DEV SMS] To ${phone}: ${message}`);
      return;
    }

    const apiKey = rawApiKey;
    const url = new URL('https://www.fast2sms.com/dev/bulkV2');
    url.searchParams.set('authorization', apiKey);
    url.searchParams.set('route', 'q');
    url.searchParams.set('message', message);
    url.searchParams.set('numbers', phone);
    url.searchParams.set('flash', '0');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { authorization: apiKey },
    });

    let body: Fast2SmsResponse;
    try {
      body = (await response.json()) as Fast2SmsResponse;
    } catch {
      throw new Error(`Fast2SMS returned a non-JSON response (HTTP ${response.status})`);
    }

    if (!response.ok || !body.return) {
      this.logger.error(`Fast2SMS failed to send SMS to ${phone}: ${JSON.stringify(body)}`);
      throw new Error(
        `Fast2SMS rejected the request: ${Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? 'unknown error')}`,
      );
    }

    this.logger.log(`SMS sent via Fast2SMS to ${phone} (request_id=${body.request_id ?? 'n/a'})`);
  }
}
