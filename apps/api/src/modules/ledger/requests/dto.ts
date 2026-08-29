import { IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export class CreateMoneyRequestDto {
  @IsString()
  @IsNotEmpty()
  from_phone!: string;

  @IsInt()
  @IsPositive()
  amount_paisa!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
