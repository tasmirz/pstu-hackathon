import { IsInt, IsOptional, IsPositive, IsString, Matches, MaxLength } from 'class-validator';

export class CreateTransferDto {
  @IsString()
  @Matches(/^\+?[0-9]{6,15}$/, { message: 'to_phone must be a valid phone number' })
  to_phone!: string;

  // IsInt rejects a float like 250.5 outright (VAL-08) — never truncated.
  @IsInt({ message: 'amount_paisa must be an integer number of paisa' })
  @IsPositive({ message: 'amount_paisa must be greater than zero' })
  amount_paisa!: number;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;
}
