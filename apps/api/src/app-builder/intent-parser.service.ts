import { Injectable } from '@nestjs/common';
import {
  AppBuilderAppType,
  AppBuilderControlMode,
  AppBuilderIntent,
  AppBuilderPhase,
  AppBuilderSourceType,
} from '@rawclaw/shared';

@Injectable()
export class IntentParserService {
  parse(input: {
    prompt: string;
    sourceType: AppBuilderSourceType;
    appType: AppBuilderAppType;
    controlMode: AppBuilderControlMode;
    templateId: string;
  }): AppBuilderIntent {
    const prompt = input.prompt.trim();
    const lower = prompt.toLowerCase();
    const domain = this.resolveDomain(lower, input.sourceType, input.appType);
    const templateConfidence = this.templateConfidence(domain, lower, input.sourceType);
    const recommendedGenerationMode = input.sourceType === 'imported'
      ? 'adapter'
      : templateConfidence < 0.72 || /\b(non-template|custom code|from scratch|not a template)\b/.test(lower)
        ? 'ai_scaffold'
        : 'template';
    const explicitControlActions = this.extractExplicitControlActions(lower);
    const explicitRuntimeEvents = this.extractExplicitRuntimeEvents(lower);
    return {
      prompt,
      sourceType: input.sourceType,
      appType: input.appType,
      controlMode: input.controlMode,
      templateId: input.templateId,
      domain,
      templateConfidence,
      recommendedGenerationMode,
      selectedGenerationMode: recommendedGenerationMode,
      summary: this.buildSummary(domain, prompt),
      requestedFeatures: this.extractRequestedFeatures(domain, lower),
      controlActions: explicitControlActions.length ? explicitControlActions : this.controlActionsForDomain(domain),
      runtimeEvents: explicitRuntimeEvents.length ? explicitRuntimeEvents : this.runtimeEventsForDomain(domain),
      authRequired: /\bauth\b|\blogin\b|\bsign in\b|\bapproval\b/.test(lower),
      dataMode: domain === 'crud' ? 'server' : 'client',
      requestedPhases: this.requestedPhases(lower),
    };
  }

  private templateConfidence(
    domain: AppBuilderIntent['domain'],
    prompt: string,
    sourceType: AppBuilderSourceType,
  ): number {
    if (sourceType === 'imported') return 1;
    if (domain === 'calculator') return 0.94;
    if (domain === 'dashboard' && /\bdashboard\b|\bapproval\b|\banalytics\b/.test(prompt)) return 0.86;
    if (domain === 'crud' && /\bcrud\b|\btable\b|\bform\b|\brecord\b/.test(prompt)) return 0.82;
    if (domain === 'ai_console') return 0.8;
    if (domain === 'generic_web' && /\bimage viewer\b|\bgallery\b|\bzoom\b|\brotate\b/.test(prompt)) return 0.78;
    return 0.55;
  }

  private resolveDomain(
    prompt: string,
    sourceType: AppBuilderSourceType,
    appType: AppBuilderAppType,
  ): AppBuilderIntent['domain'] {
    if (sourceType === 'imported') return 'imported_adapter';
    if (/\bimage viewer\b|\bimage viewing\b|\bgallery\b|\bmetadata panel\b|\bzoom\b|\brotate image\b/.test(prompt)) return 'generic_web';
    if (/\bdashboard\b|\banalytics\b|\bkpi\b|\bqueue\b|\bapproval dashboard\b|\bapprovals list\b/.test(prompt)) return 'dashboard';
    if (/\bcrud\b|\brecord\b|\btable\b|\bform\b/.test(prompt)) return 'crud';
    if (appType === 'ai_tool' || /\bai tool\b|\bprompt review\b|\beval\b|\boperator\b|\bconsole\b/.test(prompt)) return 'ai_console';
    if (this.isCalculatorPrompt(prompt)) return 'calculator';
    return 'generic_web';
  }

  private isCalculatorPrompt(prompt: string): boolean {
    if (/\bcalculator\b|\barithmetic\b|\bkeypad\b|\bexpression display\b|\bmath app\b/.test(prompt)) {
      return true;
    }
    if (/\b(addition|subtraction|multiplication|division)\b/.test(prompt)) {
      return true;
    }
    return /\b(add|subtract|multiply|divide)\b.+\b(numbers?|values?|digits?)\b/.test(prompt);
  }

  private buildSummary(domain: AppBuilderIntent['domain'], prompt: string): string {
    switch (domain) {
      case 'calculator':
        return 'Interactive calculator with keypad, expression display, history, and RawClaw control hooks.';
      case 'dashboard':
        return 'Operational dashboard with analytics, queue visibility, and action-oriented panels.';
      case 'crud':
        return 'Structured CRUD-style application with records, forms, and detail views.';
      case 'ai_console':
        return 'AI operations console with prompt workflows, run history, and approval surfaces.';
      case 'imported_adapter':
        return 'RawClaw adapter layer for an imported external project.';
      default:
        return prompt;
    }
  }

  private extractRequestedFeatures(domain: AppBuilderIntent['domain'], prompt: string): string[] {
    const features = new Set<string>();
    if (domain === 'calculator') {
      ['addition', 'subtraction', 'multiplication', 'division', 'decimals', 'percent', 'history', 'keyboard input']
        .forEach((feature) => features.add(feature));
    }
    if (domain === 'dashboard') {
      ['analytics cards', 'queue table', 'approval inbox', 'activity timeline'].forEach((feature) => features.add(feature));
    }
    if (domain === 'crud') {
      ['record table', 'detail panel', 'create form', 'status filters'].forEach((feature) => features.add(feature));
    }
    if (domain === 'ai_console') {
      ['prompt composer', 'run history', 'approval rail', 'result inspector'].forEach((feature) => features.add(feature));
    }

    if (/\bhistory\b/.test(prompt)) features.add('history');
    if (/\bgallery\b|\bimage set\b|\bimage viewer\b|\bimage viewing\b/.test(prompt)) features.add('image gallery');
    if (/\bsingle image viewer\b|\bopen image\b|\bviewer\b/.test(prompt)) features.add('single image viewer');
    if (/\bmetadata\b|\bdetails panel\b|\bmetadata\/details\b/.test(prompt)) features.add('metadata details panel');
    if (/\breview history\b/.test(prompt)) features.add('review history panel');
    if (/\bzoom in\b|\bzoom out\b|\bfit to screen\b/.test(prompt)) features.add('zoom and fit controls');
    if (/\brotate image\b|\brotate\b/.test(prompt)) features.add('image rotation');
    if (/\bmark favorite\b|\bfavorite\b/.test(prompt)) features.add('favorites');
    if (/\bapprove image\b|\breject image\b/.test(prompt)) features.add('image review actions');
    if (/\bfilter\b.*\btag\b|\btag\b.*\bfilter\b/.test(prompt)) features.add('tag filters');
    if (/\bsearch\b.*\bfilename\b|\bfilename\b.*\bsearch\b/.test(prompt)) features.add('filename search');
    if (/\bkeyboard\b/.test(prompt)) features.add('keyboard input');
    if (/\bapproval\b/.test(prompt)) features.add('approval workflow');
    if (/\boverview dashboard\b/.test(prompt)) features.add('overview dashboard');
    if (/\bpending approvals?\b|\bpending approvals list\b/.test(prompt)) features.add('pending approvals list');
    if (/\bapproved\b.*\brejected\b.*\bhistory\b|\bhistory\b.*\bapproved\b.*\brejected\b/.test(prompt)) features.add('approved and rejected history');
    if (/\bitem detail\b|\bdetail panel\b/.test(prompt)) features.add('item detail panel');
    if (/\bfilter\b.*\bstatus\b|\bstatus\b.*\bfilter\b/.test(prompt)) features.add('status filters');
    if (/\bfilter\b.*\bpriority\b|\bpriority\b.*\bfilter\b/.test(prompt)) features.add('priority filters');
    if (/\bsearch\b.*\btitle\b|\btitle\b.*\bsearch\b/.test(prompt)) features.add('title search');
    if (/\bmark urgent\b|\burgent\b/.test(prompt)) features.add('urgent marking');
    if (/\bmock data\b|\blocal mock\b|\bno real backend\b/.test(prompt)) features.add('local mock data');
    if (/\bsdk hooks?\b|\bmanifest\b/.test(prompt)) features.add('RawClaw SDK hooks and manifest');
    if (/\bstructured state\b|\bstructured\b.*\bcontrol\b/.test(prompt)) features.add('structured control state');
    if (/\bpreview\b/.test(prompt)) features.add('local preview');
    return Array.from(features);
  }

  private extractExplicitControlActions(prompt: string): string[] {
    return this.extractRawClawSectionItems(prompt, /expose actions?\s*:/i)
      .map((item) => item.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/i)?.[0]?.toLowerCase() || null)
      .filter((action): action is string => Boolean(action));
  }

  private extractExplicitRuntimeEvents(prompt: string): string[] {
    return this.extractRawClawSectionItems(prompt, /emit events when\s*:/i)
      .map((item) => this.normalizeRuntimeEvent(item))
      .filter((event): event is string => Boolean(event));
  }

  private extractRawClawSectionItems(prompt: string, heading: RegExp): string[] {
    const lines = prompt.split(/\r?\n/);
    const items: string[] = [];
    let inSection = false;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!inSection) {
        if (heading.test(line)) {
          inSection = true;
        }
        continue;
      }
      if (!line) {
        continue;
      }
      const nextHeading = line.replace(/^-+\s*/, '');
      if (/^[a-z][a-z\s/]+:\s*$/i.test(nextHeading)) {
        break;
      }
      if (/^(return structured state|add sdk hooks?|expose actions?|emit events when)\b/i.test(nextHeading)) {
        break;
      }
      const item = line.replace(/^[-*]\s*/, '').trim();
      if (item) {
        items.push(item);
      }
    }
    return Array.from(new Set(items));
  }

  private normalizeRuntimeEvent(item: string): string | null {
    const cleaned = item
      .toLowerCase()
      .replace(/[^a-z0-9_\s.]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return null;
    if (/^[a-z][a-z0-9]*(?:\.[a-z0-9]+)+$/.test(cleaned)) return cleaned;
    const words = cleaned.split(' ').filter(Boolean);
    if (words.length >= 2) {
      return `${words.slice(0, -1).join('_')}.${words[words.length - 1]}`;
    }
    return words[0] || null;
  }

  private controlActionsForDomain(domain: AppBuilderIntent['domain']): string[] {
    switch (domain) {
      case 'calculator':
        return [
          'calculator.press_digit',
          'calculator.press_operator',
          'calculator.evaluate',
          'calculator.clear',
          'calculator.backspace',
          'calculator.percent',
          'calculator.get_state',
          'calculator.get_history',
        ];
      case 'crud':
        return ['app.status', 'records.create', 'records.update', 'records.list'];
      case 'ai_console':
        return ['app.status', 'tool.run', 'runs.list', 'approvals.list'];
      case 'dashboard':
      case 'generic_web':
        return ['app.status', 'app.navigate'];
      case 'imported_adapter':
      default:
        return ['app.status', 'adapter.forward'];
    }
  }

  private runtimeEventsForDomain(domain: AppBuilderIntent['domain']): string[] {
    switch (domain) {
      case 'calculator':
        return ['expression.changed', 'result.calculated', 'calculator.cleared'];
      case 'crud':
        return ['records.changed', 'route.changed', 'action.completed'];
      case 'ai_console':
        return ['tool.run.completed', 'approval.updated', 'state.updated'];
      case 'dashboard':
      case 'generic_web':
        return ['route.changed', 'state.updated'];
      case 'imported_adapter':
      default:
        return ['adapter.forwarded', 'state.updated'];
    }
  }

  private requestedPhases(prompt: string): AppBuilderPhase[] {
    const phases: AppBuilderPhase[] = [];
    const mapping: Array<{ phase: AppBuilderPhase; pattern: RegExp }> = [
      { phase: 'plan', pattern: /\bplan\b|\barchitecture\b|\bspec\b/ },
      { phase: 'generate', pattern: /\bgenerate\b|\bbuild\b|\bcreate\b/ },
      { phase: 'integrate', pattern: /\bintegrat\b|\bwire\b/ },
      { phase: 'validate', pattern: /\bvalidate\b|\btypecheck\b|\blint\b|\btest\b/ },
      { phase: 'deploy', pattern: /\bdeploy\b|\bpreview\b|\brun locally\b/ },
      { phase: 'register', pattern: /\bregister\b|\bcontrol\b/ },
    ];
    for (const item of mapping) {
      if (item.pattern.test(prompt)) {
        phases.push(item.phase);
      }
    }
    return phases.length ? phases : ['plan', 'generate', 'validate'];
  }
}
