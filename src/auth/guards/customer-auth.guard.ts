import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedUser } from '../strategies/jwt.strategy';

/** Only a valid customer token may pass — a staff token is correctly rejected. */
@Injectable()
export class CustomerAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedUser>(err: unknown, user: AuthenticatedUser | false): TUser {
    if (err || !user || user.type !== 'customer') {
      throw new UnauthorizedException('Customer login required');
    }
    return user as TUser;
  }
}
