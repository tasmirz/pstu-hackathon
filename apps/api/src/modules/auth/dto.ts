import { IsIn, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

const phonePattern = /^\+?[0-9]{6,15}$/;
const pinPattern = /^[0-9]{4,12}$/;

export class RegisterDto {
  @IsString()
  @Matches(phonePattern, { message: 'phone must be a valid phone number' })
  phone!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsString()
  @Matches(pinPattern, { message: 'pin must contain 4 to 12 digits' })
  pin!: string;
}

export class LoginDto {
  @IsString()
  phone!: string;

  @IsString()
  pin!: string;
}

export class RefreshTokenDto {
  @IsString()
  @MinLength(10)
  refresh_token!: string;
}

export class ChangePinDto {
  @IsString()
  current_pin!: string;

  @IsString()
  @Matches(pinPattern, { message: 'new_pin must contain 4 to 12 digits' })
  new_pin!: string;
}

export class StepUpDto {
  @IsIn(['PIN', 'TOTP'])
  method!: 'PIN' | 'TOTP';

  @ValidateIf((value: StepUpDto) => value.method === 'PIN')
  @IsString()
  pin?: string;

  @ValidateIf((value: StepUpDto) => value.method === 'TOTP')
  @IsString()
  code?: string;
}

export class VerifyTotpDto {
  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'code must be a 6-digit number' })
  code!: string;
}
