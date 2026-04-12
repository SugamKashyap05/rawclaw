import { IsString, IsOptional, IsArray, IsNotEmpty, MinLength, MaxLength } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsString()
  @IsOptional()
  agentId?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  toolIds?: string[] = [];

  @IsString()
  @IsOptional()
  schedule?: string;

  @IsString()
  @IsOptional()
  workspaceId?: string;
}
