import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateBindingRuleDto {
  @IsString()
  @MaxLength(120)
  @IsOptional()
  name?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @IsInt()
  @Min(0)
  @IsOptional()
  priority?: number;

  @IsString()
  @IsOptional()
  workspaceId?: string | null;

  @IsString()
  @IsOptional()
  surfaceType?: string | null;

  @IsString()
  @IsOptional()
  senderIdentifier?: string | null;

  @IsString()
  @IsOptional()
  threadKey?: string | null;

  @IsString()
  @IsOptional()
  channelKey?: string | null;

  @IsString()
  @IsOptional()
  targetAgentId?: string | null;

  @IsString()
  @IsIn(['session', 'sender', 'thread', 'channel'])
  @IsOptional()
  affinityMode?: 'session' | 'sender' | 'thread' | 'channel';
}
