import { IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { AutomationJobStatus, AutomationKind, ContextForkMode } from '@rawclaw/shared';

const AUTOMATION_KINDS: AutomationKind[] = ['heartbeat', 'recurring_research', 'background_task'];
const AUTOMATION_STATUSES: AutomationJobStatus[] = ['active', 'paused', 'disabled'];
const CONTEXT_FORK_MODES: ContextForkMode[] = ['none', 'recent', 'compact_summary'];

export class UpdateAutomationJobDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(AUTOMATION_KINDS)
  kind?: AutomationKind;

  @IsOptional()
  @IsIn(AUTOMATION_STATUSES)
  status?: AutomationJobStatus;

  @IsOptional()
  @IsString()
  schedule?: string;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsString()
  workspaceId?: string;

  @IsOptional()
  @IsString()
  agentId?: string | null;

  @IsOptional()
  @IsString()
  sessionId?: string | null;

  @IsOptional()
  @IsString()
  bindingId?: string | null;

  @IsOptional()
  @IsString()
  surfaceType?: string | null;

  @IsOptional()
  @IsString()
  senderIdentifier?: string | null;

  @IsOptional()
  @IsString()
  threadKey?: string | null;

  @IsOptional()
  @IsString()
  channelKey?: string | null;

  @IsOptional()
  @IsArray()
  toolIds?: string[];

  @IsOptional()
  @IsString()
  model?: string | null;

  @IsOptional()
  @IsIn(CONTEXT_FORK_MODES)
  contextForkMode?: ContextForkMode;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxConcurrency?: number;

  @IsOptional()
  @IsInt()
  @Min(30)
  timeoutSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxRetries?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown> | null;
}
