import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { CustomerAuthGuard } from '../auth/guards/customer-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@Controller()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('orders/:id/pay')
  @UseGuards(CustomerAuthGuard)
  initiatePayment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.paymentsService.initiatePayment(user.id, id);
  }

  /**
   * Called by Razorpay itself, not a logged-in user — there is no guard
   * here. Authenticity instead comes from verifying the cryptographic
   * signature on the exact raw body Razorpay sent (see PaymentsService).
   */
  @Post('payments/webhook')
  @HttpCode(HttpStatus.OK)
  handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature?: string,
  ) {
    return this.paymentsService.handleWebhook(req.rawBody, signature, req.body);
  }
}
