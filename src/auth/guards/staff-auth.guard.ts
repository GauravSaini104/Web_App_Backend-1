import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedUser } from '../strategies/jwt.strategy';

/** Only a valid staff token may pass — a customer token is correctly rejected. */
@Injectable()
export class StaffAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedUser>(err: unknown, user: AuthenticatedUser | false): TUser {
    if (err || !user || user.type !== 'staff') {
      throw new UnauthorizedException('Staff login required');
    }
    return user as TUser;
  }
}
