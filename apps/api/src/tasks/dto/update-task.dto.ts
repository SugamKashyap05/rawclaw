import { IsString, IsOptional, IsArray, MaxLength, MinLength } from 'class-validator';

export class UpdateTaskDto {
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  agentId?: string | null;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  toolIds?: string[];

  @IsString()
  @IsOptional()
  schedule?: string | null;

  @IsString()
  @IsOptional()
  workspaceId?: string;
}
