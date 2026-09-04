import { IsString, Matches } from 'class-validator';
import { INDIAN_MOBILE_REGEX } from '../auth.constants';

export class RequestOtpDto {
  @IsString()
  @Matches(INDIAN_MOBILE_REGEX, { message: 'phone must be a valid 10-digit Indian mobile number' })
  phone!: string;
}
