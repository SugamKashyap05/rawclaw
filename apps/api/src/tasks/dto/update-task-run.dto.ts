import { IsString, IsOptional, IsArray, IsEnum } from 'class-validator';
import { RunStep, ProvenanceTrace } from '@rawclaw/shared';

export class UpdateTaskRunDto {
  @IsEnum(['queued', 'running', 'done', 'failed', 'cancelled'])
  status!: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

  @IsArray()
  @IsOptional()
  steps?: RunStep[];

  @IsOptional()
  provenance?: ProvenanceTrace;

  @IsString()
  @IsOptional()
  outputPath?: string;

  @IsString()
  @IsOptional()
  errorMessage?: string;
}
