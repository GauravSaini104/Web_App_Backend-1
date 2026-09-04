import { IsString, Length, Matches } from 'class-validator';
import { INDIAN_MOBILE_REGEX } from '../auth.constants';

export class VerifyOtpDto {
  @IsString()
  @Matches(INDIAN_MOBILE_REGEX, { message: 'phone must be a valid 10-digit Indian mobile number' })
  phone!: string;

  @IsString()
  @Length(6, 6, { message: 'code must be exactly 6 digits' })
  code!: string;
}
