import { Injectable } from '@nestjs/common';
import {
  ChatStreamChunk,
  ChatStreamChunkType,
  CLIENT_VISIBLE_METADATA_FIELDS,
  CLIENT_VISIBLE_STREAM_FIELDS,
  EmissionFailure,
} from '@rawclaw/shared';

const TRANSCRIPT_MARKER_REGEX = /<turn\|>|<\|(?:user|assistant|system|model)\|>|\|>(?:user|assistant|model)|<start_of_turn>|<end_of_turn>/i;

@Injectable()
export class EmissionTransformerService {
  constructor() {
    this.assertClientVisibleContracts();
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private assertClientVisibleContracts(): void {
    if (!this.isRecord(CLIENT_VISIBLE_STREAM_FIELDS)) {
      throw new Error(
        'EmissionTransformerService requires CLIENT_VISIBLE_STREAM_FIELDS from @rawclaw/shared. ' +
        'Build packages/shared/dist or start the API with workspace alias resolution enabled.',
      );
    }
    if (!Array.isArray(CLIENT_VISIBLE_METADATA_FIELDS)) {
      throw new Error(
        'EmissionTransformerService requires CLIENT_VISIBLE_METADATA_FIELDS from @rawclaw/shared. ' +
        'Build packages/shared/dist or start the API with workspace alias resolution enabled.',
      );
    }
  }

  sanitizeAssistantContent(content: string, finalize = false): string {
    if (!content) {
      return '';
    }

    const trimmed = content.trim();
    if (
      /<\/?edit_suggestion>/i.test(content)
      || /^<edit/i.test(trimmed)
      || /^edit_suggestion>/i.test(trimmed)
      || /^_suggestion>/i.test(trimmed)
    ) {
      let repaired = trimmed;
      if (/^_suggestion>/i.test(repaired)) {
        repaired = `<edit${repaired}`;
      } else if (/^edit_suggestion>/i.test(repaired)) {
        repaired = `<${repaired}`;
      }
      return repaired;
    }

    let sanitized = content
      .replace(/<\/think>/gi, '')
      .replace(/<\/thinking>/gi, '')
      .replace(/<think>/gi, '')
      .replace(/<thinking>/gi, '')
      .replace(/<\/?skill_[a-z0-9-]+>/gi, '')
      .replace(/<\/?skill>/gi, '');

    sanitized = sanitized.replace(
      /^\s*>?\s*(?:\{[\s\S]*?"(?:tool|args|thought)"[\s\S]*?\}\s*)+/i,
      '',
    );

    const transcriptMatch = sanitized.match(TRANSCRIPT_MARKER_REGEX);
    if (transcriptMatch?.index !== undefined) {
      sanitized = sanitized.slice(0, transcriptMatch.index);
    }

    const rawLeakMatch = sanitized.match(
      />?\s*(?:\{"name":|>\{"tool":|>sequential_thinking\{|<\/skill>|<tool_code>|<invoke|minimax:tool_call)/i,
    );
    if (rawLeakMatch?.index !== undefined) {
      sanitized = sanitized.slice(0, rawLeakMatch.index);
    }

    sanitized = this.normalizeMalformedMarkdown(sanitized);

    if (!finalize) {
      return sanitized;
    }

    return this.normalizeAssistantReadability(sanitized, true);
  }

  toClientVisibleEvent(event: Record<string, unknown> | undefined | null): ChatStreamChunk {
    const normalizedEvent = this.isRecord(event) ? event : {};
    const type = String(normalizedEvent.type || '') as ChatStreamChunkType;
    if (!type || !(type in CLIENT_VISIBLE_STREAM_FIELDS)) {
      throw this.buildFailure(`Unsupported stream event type: ${type || 'unknown'}`, type || 'unknown');
    }

    const allowedFields = CLIENT_VISIBLE_STREAM_FIELDS[type];
    const payload: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(normalizedEvent, field)) {
        payload[field] = normalizedEvent[field];
      }
    }

    if (type === 'content' && typeof payload.content === 'string') {
      payload.content = this.sanitizeAssistantContent(payload.content, false);
    }

    if (type === 'metadata') {
      const metadata = this.isRecord(normalizedEvent.metadata) ? normalizedEvent.metadata : {};
      payload.metadata = this.allowClientVisibleMetadata(metadata);
    }

    this.validateClientVisiblePayload(type, payload);
    return payload as unknown as ChatStreamChunk;
  }

  private allowClientVisibleMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    const visible: Record<string, unknown> = {};
    for (const key of CLIENT_VISIBLE_METADATA_FIELDS) {
      if (key in metadata) {
        visible[key] = metadata[key];
      }
    }
    return visible;
  }

  private validateClientVisiblePayload(type: ChatStreamChunkType, payload: Record<string, unknown>): void {
    switch (type) {
      case 'content':
        if (typeof payload.content !== 'string') {
          throw this.buildFailure('Content events require string content.', type);
        }
        break;
      case 'thinking':
        if (typeof payload.thinking !== 'string') {
          throw this.buildFailure('Thinking events require string thinking content.', type);
        }
        break;
      case 'tool_call':
        if (!payload.tool_call) {
          throw this.buildFailure('Tool call events require tool_call payload.', type);
        }
        break;
      case 'tool_result':
        if (!payload.tool_result) {
          throw this.buildFailure('Tool result events require tool_result payload.', type);
        }
        break;
      case 'sources':
        if (!Array.isArray(payload.sources)) {
          throw this.buildFailure('Sources events require a sources array.', type);
        }
        break;
      case 'error':
        if (typeof payload.error !== 'string') {
          throw this.buildFailure('Error events require an error code.', type);
        }
        break;
      case 'metadata':
        if (!payload.metadata || typeof payload.metadata !== 'object') {
          throw this.buildFailure('Metadata events require metadata payload.', type);
        }
        break;
      case 'review_result':
        if (typeof payload.approved !== 'boolean' && typeof payload.feedback !== 'string') {
          throw this.buildFailure('Review result events require review outcome details.', type);
        }
        break;
      case 'harness':
        if (!payload.harness_log || typeof payload.harness_log !== 'object') {
          throw this.buildFailure('Harness events require harness_log payload.', type);
        }
        break;
      case 'approval_required':
        if (typeof payload.reason !== 'string' && typeof payload.message !== 'string') {
          throw this.buildFailure('Approval events require a reason or message.', type);
        }
        break;
      case 'activity_frame':
        if (!payload.activityFrame || typeof payload.activityFrame !== 'object') {
          throw this.buildFailure('Activity frame events require activityFrame payload.', type);
        }
        break;
      case 'heartbeat':
        if (typeof payload.ts !== 'number' && typeof payload.timestamp !== 'string') {
          throw this.buildFailure('Heartbeat events require ts or timestamp.', type);
        }
        break;
      case 'done':
      case 'provenance':
        break;
      default:
        throw this.buildFailure(`Unhandled stream event type: ${type}`, type);
    }
  }

  private buildFailure(reason: string, chunkType: string): EmissionFailure {
    return {
      transformer: 'emission',
      code: 'invalid_client_visible_event',
      reason,
      userFacingMessage: 'I could not safely format that response for the chat stream.',
      retryable: false,
      fallbackBehavior: 'abort-turn',
      chunkType,
    };
  }

  private normalizeAssistantReadability(content: string, finalize = false): string {
    if (!content) {
      return '';
    }

    let normalized = content
      .replace(/\r\n/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/\bIam(?=[A-Z])/g, 'I am ')
      .replace(/\bIve(?=[A-Z])/g, "I've ")
      .replace(/\bIll(?=[A-Z])/g, "I'll ")
      .replace(/\bId(?=[A-Z])/g, "I'd ")
      .replace(/\bYouve(?=[A-Z])/g, "You've ")
      .replace(/\bYoure(?=[A-Z])/g, "You're ")
      .replace(/\bDont(?=[A-Z])/g, "Don't ")
      .replace(/\bCant(?=[A-Z])/g, "Can't ")
      .replace(/\bWont(?=[A-Z])/g, "Won't ")
      .replace(/([,:;!?])([A-Za-z])/g, '$1 $2');

    normalized = this.collapseRepeatedContent(normalized);

    const alphaCount = (normalized.match(/[A-Za-z]/g) || []).length;
    const whitespaceCount = (normalized.match(/\s/g) || []).length;
    if (alphaCount >= 40 && whitespaceCount / Math.max(alphaCount, 1) < 0.08) {
      normalized = this.expandCompactedEnglish(normalized);
    }

    normalized = normalized.replace(/[ \t]{2,}/g, ' ');
    return finalize ? normalized.trim() : normalized;
  }

  private normalizeMalformedMarkdown(content: string): string {
    if (!content) {
      return '';
    }

    return content
      .replace(/\*\*(\d+)\.\s*/g, '$1. ')
      .replace(/([A-Za-z0-9)])\*\*(?=\s+[A-Z(])/g, '$1')
      .replace(/:\s+\*\s+(?=[A-Z0-9"])/g, ':\n- ')
      .replace(/([).])\s+\*\s+(?=[A-Z0-9"])/g, '$1\n- ')
      .replace(/\s+\*\*(\d+)\.\s*/g, '\n$1. ');
  }

  private collapseRepeatedContent(content: string): string {
    let collapsed = content;

    collapsed = collapsed.replace(/(.{50,180}?)(?:\s+\1){2,}/gis, '$1 ...');

    const words = collapsed.split(/\s+/).filter(Boolean);
    if (words.length < 40) {
      return collapsed;
    }

    const maxWindow = Math.min(24, Math.floor(words.length / 3));
    for (let size = maxWindow; size >= 10; size--) {
      const tail = words.slice(-size).join(' ').toLowerCase();
      if (tail.length < 60) {
        continue;
      }

      const body = words.slice(0, -size).join(' ').toLowerCase();
      const firstIndex = body.indexOf(tail);
      if (firstIndex === -1) {
        continue;
      }

      return `${words.slice(0, -size).join(' ')} ...`;
    }

    return collapsed;
  }

  private expandCompactedEnglish(content: string): string {
    return content
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([.!?])([A-Za-z])/g, '$1 $2');
  }
}
