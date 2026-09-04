import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { handlePrismaError } from '../common/utils/prisma-error.util';
import { SmsService } from './sms.service';
import { StaffRegisterDto } from './dto/staff-register.dto';
import { StaffLoginDto } from './dto/staff-login.dto';
import { AuthenticatedUser } from './strategies/jwt.strategy';
import {
  CUSTOMER_TOKEN_EXPIRY,
  OTP_EXPIRY_MINUTES,
  OTP_MAX_ATTEMPTS,
  STAFF_TOKEN_EXPIRY,
} from './auth.constants';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly smsService: SmsService,
  ) {}

  /**
   * The OTP itself is always fully real — generated, hashed, time-limited,
   * attempt-limited. What differs is delivery: if a real SMS provider is
   * configured (SMS_PROVIDER=fast2sms + FAST2SMS_API_KEY), it's actually
   * texted. Otherwise the code is returned directly in the response so the
   * flow can still be tested locally — deliberately suppressed outside
   * non-production environments so it can never leak in a real deployment.
   */
  async requestOtp(phone: string) {
    const code = this.generateOtpCode();
    const codeHash = this.hashOtp(code);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await this.prisma.otpRequest.create({ data: { phone, codeHash, expiresAt } });

    if (this.smsService.isConfigured()) {
      try {
        await this.smsService.sendOtp(phone, code, OTP_EXPIRY_MINUTES);
      } catch (error) {
        this.logger.error(`Failed to send OTP via SMS provider: ${(error as Error).message}`);
        throw new InternalServerErrorException(
          'Could not send OTP right now — please try again shortly',
        );
      }
      return { message: `OTP sent to ${phone}` };
    }

    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    return {
      message: `OTP sent to ${phone}`,
      ...(isProduction ? {} : { devOnlyOtp: code }),
    };
  }

  async verifyOtp(phone: string, code: string) {
    const otpRequest = await this.prisma.otpRequest.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRequest) {
      throw new BadRequestException('No active OTP for this number — request a new one');
    }
    if (otpRequest.attempts >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException('Too many incorrect attempts — request a new OTP');
    }

    if (this.hashOtp(code) !== otpRequest.codeHash) {
      await this.prisma.otpRequest.update({
        where: { id: otpRequest.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Incorrect code');
    }

    await this.prisma.otpRequest.update({
      where: { id: otpRequest.id },
      data: { consumedAt: new Date() },
    });

    const customer = await this.prisma.customer.upsert({
      where: { phone },
      update: { isPhoneVerified: true },
      create: { phone, isPhoneVerified: true },
    });

    const accessToken = await this.jwtService.signAsync(
      { sub: customer.id, type: 'customer' },
      { expiresIn: CUSTOMER_TOKEN_EXPIRY },
    );

    return { accessToken, customer };
  }

  /**
   * Open only until the first staff account exists — after that, creating
   * another one requires the bootstrap secret (an env var), not a public
   * self-registration flow.
   */
  async registerStaff(dto: StaffRegisterDto, bootstrapSecretHeader?: string) {
    const existingStaffCount = await this.prisma.staffUser.count();

    if (existingStaffCount > 0) {
      const bootstrapSecret = this.configService.get<string>('STAFF_BOOTSTRAP_SECRET');
      if (!bootstrapSecret || bootstrapSecretHeader !== bootstrapSecret) {
        throw new UnauthorizedException(
          'Staff registration is locked once an account exists — provide the bootstrap secret',
        );
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    try {
      return await this.prisma.staffUser.create({
        data: { username: dto.username, passwordHash, displayName: dto.displayName },
        select: { id: true, username: true, displayName: true, isActive: true, createdAt: true },
      });
    } catch (error) {
      handlePrismaError(error, 'Staff account');
    }
  }

  async staffLogin(dto: StaffLoginDto) {
    const staff = await this.prisma.staffUser.findUnique({ where: { username: dto.username } });
    if (!staff || !staff.isActive || !(await bcrypt.compare(dto.password, staff.passwordHash))) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const accessToken = await this.jwtService.signAsync(
      { sub: staff.id, type: 'staff' },
      { expiresIn: STAFF_TOKEN_EXPIRY },
    );

    return {
      accessToken,
      staff: { id: staff.id, username: staff.username, displayName: staff.displayName },
    };
  }

  async getCurrentUser(user: AuthenticatedUser) {
    if (user.type === 'customer') {
      const customer = await this.prisma.customer.findUnique({ where: { id: user.id } });
      if (!customer) {
        throw new NotFoundException('Customer not found');
      }
      return { type: 'customer' as const, ...customer };
    }

    const staff = await this.prisma.staffUser.findUnique({
      where: { id: user.id },
      select: { id: true, username: true, displayName: true, isActive: true },
    });
    if (!staff) {
      throw new NotFoundException('Staff account not found');
    }
    return { type: 'staff' as const, ...staff };
  }

  /**
   * FIXED_TEST_OTP lets a fixed, reusable code (e.g. "123456") stand in for
   * a real random one while manually testing — hard-gated to never apply
   * in production, regardless of what the env var is set to, so this can
   * never become a real "guess any account" hole in a live deployment.
   */
  private generateOtpCode(): string {
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    const fixedTestOtp = this.configService.get<string>('FIXED_TEST_OTP')?.trim();

    if (!isProduction && fixedTestOtp) {
      return fixedTestOtp;
    }

    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private hashOtp(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }
}
