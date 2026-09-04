import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Accepts any valid token — customer or staff. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
