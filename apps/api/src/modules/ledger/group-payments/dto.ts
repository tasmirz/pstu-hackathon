import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class GroupPayItemDto {
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsInt()
  @IsPositive()
  amount_paisa!: number;
}

export class CreateGroupTransferDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => GroupPayItemDto)
  items!: GroupPayItemDto[];
}
