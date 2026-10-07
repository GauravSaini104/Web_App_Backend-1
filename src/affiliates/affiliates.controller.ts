import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AffiliatePayoutStatus } from '@prisma/client';
import { AffiliatesService } from './affiliates.service';
import { CustomerAuthGuard } from '../auth/guards/customer-auth.guard';
import { StaffAuthGuard } from '../auth/guards/staff-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ApplyAffiliateDto } from './dto/apply-affiliate.dto';
import { UpdateAffiliateProfileDto } from './dto/update-affiliate-profile.dto';
import { RequestPayoutDto } from './dto/request-payout.dto';
import { ReviewAffiliateDto } from './dto/review-affiliate.dto';
import { ReviewPayoutDto } from './dto/review-payout.dto';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { QueryAffiliatesDto } from './dto/query-affiliates.dto';
import { AffiliateStatsQueryDto } from './dto/affiliate-stats-query.dto';
import { QueryEarningsDto } from './dto/query-earnings.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@Controller('affiliates')
export class AffiliatesController {
  constructor(private readonly affiliatesService: AffiliatesService) {}

  // ---------------------------------------------------------------------------
  // Public Route
  // ---------------------------------------------------------------------------

  @Get('resolve')
  resolveReferralCode(@Query('code') code: string) {
    return this.affiliatesService.resolveReferralCode(code);
  }

  // ---------------------------------------------------------------------------
  // Customer Routes (CustomerAuthGuard)
  // ---------------------------------------------------------------------------

  @Get('apply-eligibility')
  @UseGuards(CustomerAuthGuard)
  getApplyEligibility(@CurrentUser() user: AuthenticatedUser) {
    return this.affiliatesService.getApplyEligibility(user.id);
  }

  @Post('apply')
  @UseGuards(CustomerAuthGuard)
  apply(@CurrentUser() user: AuthenticatedUser, @Body() dto: ApplyAffiliateDto) {
    return this.affiliatesService.applyAffiliate(user.id, dto);
  }

  @Get('me')
  @UseGuards(CustomerAuthGuard)
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.affiliatesService.getMe(user.id);
  }

  @Patch('me')
  @UseGuards(CustomerAuthGuard)
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateAffiliateProfileDto) {
    return this.affiliatesService.updateMe(user.id, dto);
  }

  @Get('me/stats')
  @UseGuards(CustomerAuthGuard)
  getMeStats(@CurrentUser() user: AuthenticatedUser, @Query() dto: AffiliateStatsQueryDto) {
    return this.affiliatesService.getMeStats(user.id, dto);
  }

  @Get('me/earnings')
  @UseGuards(CustomerAuthGuard)
  getMeEarnings(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryEarningsDto) {
    return this.affiliatesService.getMeEarnings(user.id, query);
  }

  @Get('me/payouts')
  @UseGuards(CustomerAuthGuard)
  getMePayouts(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.affiliatesService.getMePayouts(user.id, query);
  }

  @Post('me/payouts')
  @UseGuards(CustomerAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  requestPayout(@CurrentUser() user: AuthenticatedUser, @Body() dto: RequestPayoutDto) {
    return this.affiliatesService.requestPayout(user.id, dto);
  }

  @Get('me/referrals')
  @UseGuards(CustomerAuthGuard)
  getMeReferrals(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQueryDto) {
    return this.affiliatesService.getMeReferrals(user.id, query);
  }

  // ---------------------------------------------------------------------------
  // Staff Routes (StaffAuthGuard) - Literal paths declared before :id
  // ---------------------------------------------------------------------------

  @Get('stats')
  @UseGuards(StaffAuthGuard)
  getStaffStats() {
    return this.affiliatesService.getStaffStats();
  }

  @Get('settings')
  @UseGuards(StaffAuthGuard)
  getSettings() {
    return this.affiliatesService.getOrCreateSettings();
  }

  @Patch('settings')
  @UseGuards(StaffAuthGuard)
  updateSettings(@Body() dto: UpdateSettingsDto) {
    return this.affiliatesService.updateSettings(dto);
  }

  @Get('reconciliation')
  @UseGuards(StaffAuthGuard)
  getReconciliation() {
    return this.affiliatesService.getReconciliation();
  }

  @Get('payouts')
  @UseGuards(StaffAuthGuard)
  findAllPayouts(
    @Query() query: PaginationQueryDto & { status?: AffiliatePayoutStatus },
  ) {
    return this.affiliatesService.findAllPayouts(query);
  }

  @Patch('payouts/:id')
  @UseGuards(StaffAuthGuard)
  reviewPayout(
    @Param('id') id: string,
    @Body() dto: ReviewPayoutDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.affiliatesService.reviewPayout(id, dto, user.id);
  }

  @Get()
  @UseGuards(StaffAuthGuard)
  findAll(@Query() query: QueryAffiliatesDto) {
    return this.affiliatesService.findAllAffiliates(query);
  }

  @Get(':id')
  @UseGuards(StaffAuthGuard)
  findOne(@Param('id') id: string) {
    return this.affiliatesService.findOneAffiliate(id);
  }

  @Patch(':id/status')
  @UseGuards(StaffAuthGuard)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: ReviewAffiliateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.affiliatesService.updateAffiliateStatus(id, dto, user.id);
  }

  @Post(':id/adjustment')
  @UseGuards(StaffAuthGuard)
  createAdjustment(
    @Param('id') id: string,
    @Body() dto: CreateAdjustmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.affiliatesService.createAdjustment(id, dto, user.id);
  }
}
