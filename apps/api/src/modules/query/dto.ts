import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsPositive, IsString, Max, Min } from 'class-validator';

export class TransactionListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  cursor?: number;

  @IsOptional()
  @IsIn(['sent', 'received', 'all'])
  direction: 'sent' | 'received' | 'all' = 'all';

  @IsOptional()
  @IsString()
  kind?: string;
}

export class UserLookupQueryDto {
  @IsString()
  phone!: string;
}
