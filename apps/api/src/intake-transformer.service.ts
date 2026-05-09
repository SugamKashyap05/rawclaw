import { Injectable } from '@nestjs/common';
import {
  ChatAttachment,
  ChatNluFrame,
  DocumentSelection,
  IntakeEnvelope,
  IntakeRejection,
  RetrievalPolicy,
} from '@rawclaw/shared';

type IntakeTransformInput = {
  latestUserContent: string;
  attachments?: ChatAttachment[];
  selection?: DocumentSelection | null;
  nluFrame?: ChatNluFrame | null;
};

type IntakeTransformResult =
  | {
      ok: true;
      envelope: IntakeEnvelope;
      normalized: {
        latestUserContent: string;
        selection: DocumentSelection | null;
        attachments: ChatAttachment[];
      };
    }
  | {
      ok: false;
      error: IntakeRejection;
    };

const WEB_MARKERS = [
  'web',
  'search',
  'search for',
  'fetch',
  'latest',
  'current',
  'news',
  'results',
  'winner',
  'who won',
  'seat tally',
  'open',
  'browse',
];

const MEMORY_MARKERS = [
  'memory',
  'remember',
  'recall',
  'what we discussed',
  'what you remember',
  'summarize memory',
  'summarise memory',
];

const SIMPLE_CONVERSATION_MARKERS = [
  'hello',
  'hi',
  'hii',
  'hey',
  'howdy',
  'greetings',
  'good morning',
  'good evening',
  'good afternoon',
  'how are you',
  'thanks',
  'thank you',
  'bye',
  'goodbye',
];

const MAX_LATEST_USER_CHARS = 40_000;
const MAX_SELECTION_CHARS = 20_000;
const MAX_ATTACHMENT_INLINE_CHARS = 50_000;
const MAX_TOTAL_INTAKE_CHARS = 180_000;

@Injectable()
export class IntakeTransformerService {
  transform(input: IntakeTransformInput): IntakeTransformResult {
    const normalizedLatestUserContent = this.normalizeText(input.latestUserContent || '');
    const normalizedSelection = input.selection
      ? {
          ...input.selection,
          text: this.normalizeText(input.selection.text || ''),
          contextBefore: this.normalizeText(input.selection.contextBefore || ''),
          contextAfter: this.normalizeText(input.selection.contextAfter || ''),
        }
      : null;
    const normalizedAttachments = (input.attachments || []).map((attachment) => ({
      ...attachment,
      filename: this.normalizeText(attachment.filename || ''),
    }));

    const selectionChars = normalizedSelection?.text.length || 0;
    const attachmentChars = normalizedAttachments.reduce((sum, attachment) => sum + (attachment.content?.length || 0), 0);
    const totalEstimatedChars = normalizedLatestUserContent.length + selectionChars + attachmentChars;

    if (normalizedLatestUserContent.length > MAX_LATEST_USER_CHARS) {
      return { ok: false, error: this.buildRejection('latestUserContent', 'latest_user_too_large') };
    }
    if (selectionChars > MAX_SELECTION_CHARS) {
      return { ok: false, error: this.buildRejection('selection', 'selection_too_large') };
    }
    const oversizedAttachment = normalizedAttachments.find((attachment) => (attachment.content?.length || 0) > MAX_ATTACHMENT_INLINE_CHARS);
    if (oversizedAttachment) {
      return { ok: false, error: this.buildRejection('attachment', 'attachment_too_large') };
    }
    if (totalEstimatedChars > MAX_TOTAL_INTAKE_CHARS) {
      return { ok: false, error: this.buildRejection('totalPayload', 'total_payload_too_large') };
    }

    const retrievalPolicy = this.deriveRetrievalPolicy(normalizedLatestUserContent, input.nluFrame);
    return {
      ok: true,
      envelope: {
        latestUserContent: normalizedLatestUserContent,
        selectionText: normalizedSelection?.text || null,
        attachmentSummaries: normalizedAttachments.map((attachment) => ({
          filename: attachment.filename,
          contentChars: attachment.content?.length || 0,
          truncated: attachment.isTruncated,
        })),
        totalEstimatedChars,
        retrievalPolicy,
      },
      normalized: {
        latestUserContent: normalizedLatestUserContent,
        selection: normalizedSelection,
        attachments: normalizedAttachments,
      },
    };
  }

  deriveRetrievalPolicy(content: string, nluFrame?: ChatNluFrame | null): RetrievalPolicy {
    const lower = (content || '').toLowerCase().trim();
    const hasUrl = /https?:\/\//i.test(content);
    const memoryIntent = nluFrame?.intent === 'memory_query' || MEMORY_MARKERS.some((marker) => lower.includes(marker));
    const explicitWebIntent = hasUrl || WEB_MARKERS.some((marker) => lower.includes(marker));
    const simpleConversation = this.isSimpleConversation(lower);

    if (simpleConversation) {
      return { web: 'forbidden', memory: 'forbidden' };
    }
    if (memoryIntent && explicitWebIntent) {
      return { web: 'allowed', memory: 'required' };
    }
    if (memoryIntent) {
      return { web: 'forbidden', memory: 'required' };
    }
    if (nluFrame?.intent === 'research' || explicitWebIntent) {
      return { web: 'required', memory: 'allowed' };
    }
    if (nluFrame?.intent === 'conversation') {
      return { web: 'forbidden', memory: 'forbidden' };
    }
    return { web: 'allowed', memory: 'allowed' };
  }

  private normalizeText(value: string): string {
    return String(value || '')
      .normalize('NFKC')
      .replace(/\r\n/g, '\n')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  }

  private isSimpleConversation(lower: string): boolean {
    const compact = lower.trim().replace(/[!?.]+$/g, '');
    if (!compact || compact.split(/\s+/).length > 5) {
      return false;
    }
    return SIMPLE_CONVERSATION_MARKERS.some((marker) => compact === marker || compact.startsWith(`${marker} `));
  }

  private buildRejection(rejectedField: IntakeRejection['rejectedField'], code: string): IntakeRejection {
    return {
      transformer: 'intake',
      code,
      reason: code,
      userFacingMessage: 'That request is too large to process safely in one turn.',
      retryable: false,
      fallbackBehavior: 'surface-to-user',
      rejectedField,
    };
  }
}
