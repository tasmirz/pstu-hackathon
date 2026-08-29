import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsPositive, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class BillShareInputDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsInt()
  @IsPositive()
  amount_paisa!: number;
}

export class CreateBillDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => BillShareInputDto)
  shares!: BillShareInputDto[];
}
