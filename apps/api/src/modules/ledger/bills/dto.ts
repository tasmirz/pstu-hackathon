import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class BillShareInputDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  amount_paisa?: number;
}

export class CreateBillDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsIn(['CUSTOM', 'EQUAL'])
  split_mode?: 'CUSTOM' | 'EQUAL';

  @IsOptional()
  @IsInt()
  @IsPositive()
  total_amount_paisa?: number;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => BillShareInputDto)
  shares!: BillShareInputDto[];
}

export class PayBillDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  amount_paisa?: number;
}
