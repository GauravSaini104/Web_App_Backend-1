export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = 5;
export const OTP_MAX_ATTEMPTS = 5;

export const CUSTOMER_TOKEN_EXPIRY = '30d';
export const CUSTOMER_REFRESH_TOKEN_EXPIRY = '90d';
export const STAFF_TOKEN_EXPIRY = '12h';
export const STAFF_REFRESH_TOKEN_EXPIRY = '30d';

/** Indian mobile numbers: 10 digits, starting 6-9. */
export const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;
