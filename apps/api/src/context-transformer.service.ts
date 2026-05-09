import { Injectable } from '@nestjs/common';
import { ChatMessage, ContextCompactionError, ContextEnvelope, ContextSummaryBlock, SummaryItem } from '@rawclaw/shared';

const COMPACTION_TRIGGER_CHARS = 126_000;
const PRESERVED_RECENT_NON_SYSTEM_MESSAGES = 6;

@Injectable()
export class ContextTransformerService {
  compactIfNeeded(messages: ChatMessage[], estimatedTotalChars: number): ContextEnvelope | ContextCompactionError {
    if (estimatedTotalChars < COMPACTION_TRIGGER_CHARS) {
      return {
        messages: messages.map((message) => ({
          id: message.id || null,
          role: message.role,
          content: message.content,
          name: message.name,
          attachments: message.attachments,
          selection: message.selection,
          toolResults: message.toolResults,
          memoryRecall: message.memoryRecall,
        })),
        summary: this.emptySummary(),
        totalEstimatedChars: estimatedTotalChars,
        compacted: false,
      };
    }

    try {
      const systemMessages = messages.filter((message) => message.role === 'system');
      const nonSystemMessages = messages.filter((message) => message.role !== 'system');
      const preservedRecent = nonSystemMessages.slice(-PRESERVED_RECENT_NON_SYSTEM_MESSAGES);
      const olderMessages = nonSystemMessages.slice(0, Math.max(0, nonSystemMessages.length - preservedRecent.length));
      const summary = this.buildSummary(olderMessages, preservedRecent);
      const summaryLines = this.renderSummary(summary);
      const summaryMessage = summaryLines.length
        ? [{
            id: 'context-summary',
            role: 'system' as const,
            content: summaryLines.join('\n'),
          }]
        : [];

      const compactedMessages = [
        ...systemMessages.map((message) => ({
          id: message.id || null,
          role: message.role,
          content: message.content,
          name: message.name,
          attachments: message.attachments,
          selection: message.selection,
          toolResults: message.toolResults,
          memoryRecall: message.memoryRecall,
        })),
        ...summaryMessage,
        ...preservedRecent.map((message) => ({
          id: message.id || null,
          role: message.role,
          content: message.content,
          name: message.name,
          attachments: message.attachments,
          selection: message.selection,
          toolResults: message.toolResults,
          memoryRecall: message.memoryRecall,
        })),
      ];

      return {
        messages: compactedMessages,
        summary,
        totalEstimatedChars: compactedMessages.reduce((sum, message) => sum + (message.content?.length || 0), 0),
        compacted: true,
      };
    } catch (error: any) {
      return {
        transformer: 'context',
        code: 'context_compaction_failed',
        reason: error?.message || String(error),
        userFacingMessage: 'I could not compact the earlier conversation safely, so I kept the existing prompt budgeting path.',
        retryable: false,
        fallbackBehavior: 'log-and-continue',
        operation: 'compact_messages',
      };
    }
  }

  private buildSummary(olderMessages: ChatMessage[], preservedRecent: ChatMessage[]): ContextSummaryBlock {
    const summary = this.emptySummary();
    this.collectSummary(summary, olderMessages, olderMessages, true);
    this.collectSummary(summary, preservedRecent, preservedRecent, false);
    return summary;
  }

  private collectSummary(
    summary: ContextSummaryBlock,
    messages: ChatMessage[],
    allMessages: ChatMessage[],
    includeResolvedTopics: boolean,
  ): void {
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      const messageIndex = allMessages.findIndex((candidate) => candidate.id === message.id);
      const followingMessages = allMessages.slice(messageIndex >= 0 ? messageIndex + 1 : index + 1);
      const nextUserMessage = followingMessages.find((candidate) => candidate.role === 'user');
      const nextAssistantMessage = followingMessages.find((candidate) => candidate.role === 'assistant');
      const sourceTurnIds = [message.id || `turn-${index}`];
      const normalized = (message.content || '').trim();
      if (!normalized) {
        continue;
      }
      const compactText = this.compactText(normalized);

      if (this.isUserPreference(normalized)) {
        summary.userPreferences.push({ text: compactText, sourceTurnIds });
      }
      if (this.isOpenCommitment(normalized)) {
        summary.openCommitments.push({ text: compactText, sourceTurnIds });
      }
      if (this.isUnresolvedQuestion(message, nextUserMessage, nextAssistantMessage)) {
        summary.unresolvedQuestions.push({ text: compactText, sourceTurnIds });
      } else if (includeResolvedTopics) {
        summary.resolvedTopics.push({ text: compactText, sourceTurnIds });
      }

      for (const entity of this.extractNamedEntities(normalized, sourceTurnIds)) {
        if (!summary.namedEntities.some((item) => item.text === entity.text)) {
          summary.namedEntities.push(entity);
        }
      }
    }
  }

  private renderSummary(summary: ContextSummaryBlock): string[] {
    const sections: Array<[string, SummaryItem[]]> = [
      ['Resolved topics', summary.resolvedTopics],
      ['Open commitments', summary.openCommitments],
      ['Named entities', summary.namedEntities],
      ['Unresolved questions', summary.unresolvedQuestions],
      ['User preferences', summary.userPreferences],
    ];

    const lines: string[] = [];
    for (const [title, items] of sections) {
      if (!items.length) {
        continue;
      }
      lines.push(`${title}:`);
      for (const item of items) {
        lines.push(`- ${item.text}`);
      }
    }
    return lines;
  }

  private isUserPreference(text: string): boolean {
    return /\b(i prefer|please use|remember that i prefer|my preference is)\b/i.test(text);
  }

  private isOpenCommitment(text: string): boolean {
    return /\b(i will|i'll|we will|i can follow up|i can check back)\b/i.test(text);
  }

  private isUnresolvedQuestion(
    message: ChatMessage,
    nextUserMessage?: ChatMessage,
    nextAssistantMessage?: ChatMessage,
  ): boolean {
    if (message.role !== 'user') {
      return false;
    }
    const content = message.content || '';
    if (!/[?]/.test(content)) {
      return false;
    }
    if (/\bunresolved|still open|pending\b/i.test(content)) {
      return true;
    }
    if (nextAssistantMessage && /\bstill|waiting|pending|unresolved|not yet|to be confirmed|follow[\s-]?up\b/i.test(nextAssistantMessage.content || '')) {
      return true;
    }
    if (!nextUserMessage) {
      return true;
    }
    return /\?|actually|correction|about that|what about|and\b/i.test(nextUserMessage.content || '');
  }

  private extractNamedEntities(text: string, sourceTurnIds: string[]): SummaryItem[] {
    const matches = text.match(/\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g) || [];
    return matches
      .filter((value) => value.length > 2)
      .slice(0, 6)
      .map((value) => ({ text: value, sourceTurnIds }));
  }

  private compactText(text: string): string {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    if (collapsed.length <= 220) {
      return collapsed;
    }
    return `${collapsed.slice(0, 217).trim()}...`;
  }

  private emptySummary(): ContextSummaryBlock {
    return {
      resolvedTopics: [],
      openCommitments: [],
      namedEntities: [],
      unresolvedQuestions: [],
      userPreferences: [],
    };
  }
}
