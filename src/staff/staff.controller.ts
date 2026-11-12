import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { StaffService } from './staff.service';
import { StaffAuthGuard } from '../auth/guards/staff-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { QueryStaffDto } from './dto/query-staff.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Controller('staff')
@UseGuards(StaffAuthGuard)
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Post(['change-password', 'me/change-password'])
  @HttpCode(HttpStatus.OK)
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.staffService.changePassword(user.id, dto);
  }

  @Patch(['change-password', 'me/change-password'])
  @HttpCode(HttpStatus.OK)
  changePasswordPatch(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.staffService.changePassword(user.id, dto);
  }

  @Post()
  create(@Body() dto: CreateStaffDto) {
    return this.staffService.create(dto);
  }

  @Get()
  findAll(@Query() query: QueryStaffDto) {
    return this.staffService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.staffService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStaffDto) {
    return this.staffService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.staffService.remove(id, user?.id);
  }
}
