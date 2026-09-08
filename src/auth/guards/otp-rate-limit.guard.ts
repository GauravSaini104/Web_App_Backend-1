import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';

interface RateLimitRecord {
  timestamps: number[];
}

@Injectable()
export class OtpRateLimitGuard implements CanActivate {
  private readonly phoneLimits = new Map<string, RateLimitRecord>();
  private readonly ipLimits = new Map<string, RateLimitRecord>();

  private readonly WINDOW_MS = 10 * 60 * 1000; // 10 minutes
  private readonly MAX_PER_PHONE = 3;
  private readonly MAX_PER_IP = 10;

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const now = Date.now();

    const phone = req.body?.phone?.toString()?.trim();
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || 'unknown';
    const ip = Array.isArray(rawIp) ? rawIp[0] : rawIp.split(',')[0].trim();

    if (phone) {
      this.checkAndRecordLimit(this.phoneLimits, phone, this.MAX_PER_PHONE, now, 'phone number');
    }

    if (ip && ip !== 'unknown') {
      this.checkAndRecordLimit(this.ipLimits, ip, this.MAX_PER_IP, now, 'IP address');
    }

    return true;
  }

  private checkAndRecordLimit(
    map: Map<string, RateLimitRecord>,
    key: string,
    maxLimit: number,
    now: number,
    limitType: string,
  ) {
    const record = map.get(key) ?? { timestamps: [] };
    // Filter timestamps within the rolling window
    record.timestamps = record.timestamps.filter((ts) => now - ts < this.WINDOW_MS);

    if (record.timestamps.length >= maxLimit) {
      const oldestTimestamp = record.timestamps[0];
      const retryAfterSeconds = Math.ceil((this.WINDOW_MS - (now - oldestTimestamp)) / 1000);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Too many OTP requests for this ${limitType}. Please try again in ${retryAfterSeconds} seconds.`,
          retryAfter: retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    record.timestamps.push(now);
    map.set(key, record);
  }
}
