import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface Fast2SmsResponse {
  return: boolean;
  status_code?: number;
  request_id?: string;
  message?: string | string[];
}

/**
 * Sends OTP SMS via Fast2SMS's "Quick SMS" route (route=q) — this works
 * without a pre-approved DLT template, unlike Fast2SMS's dedicated OTP-
 * template route, which a brand-new account won't have set up yet. Trade-
 * off: Fast2SMS restricts this route to the number registered on the
 * account itself, so it's a real "send a real SMS" path, but only for
 * self-testing until a proper DLT-registered template is set up later.
 *
 * Inert unless SMS_PROVIDER=fast2sms and FAST2SMS_API_KEY are both set —
 * otherwise AuthService falls back to returning the OTP in the response
 * for local testing, exactly as before this integration existed.
 */
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
    const apiKey = this.configService.get<string>('FAST2SMS_API_KEY')!.trim();
    const message = `Your OTP is ${code}. It is valid for ${expiryMinutes} minutes. Do not share this code with anyone.`;

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
      this.logger.error(`Fast2SMS failed to send OTP to ${phone}: ${JSON.stringify(body)}`);
      throw new Error(
        `Fast2SMS rejected the request: ${Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? 'unknown error')}`,
      );
    }

    this.logger.log(`OTP sent via Fast2SMS to ${phone} (request_id=${body.request_id ?? 'n/a'})`);
  }
}
