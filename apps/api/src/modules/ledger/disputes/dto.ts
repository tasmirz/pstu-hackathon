import { IsIn, IsInt, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

export class RaiseDisputeDto {
  @IsInt()
  @IsPositive()
  txn_id!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class ResolveDisputeDto {
  @IsIn(['REVERSE', 'REJECT'])
  action!: 'REVERSE' | 'REJECT';

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  resolution!: string;
}
