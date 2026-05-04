import { Injectable } from '@nestjs/common';
import { AppBuilderIntent, AppSpecJson } from '@rawclaw/shared';

@Injectable()
export class PlannerAiService {
  createSpec(intent: AppBuilderIntent, title: string): AppSpecJson {
    if (intent.domain === 'calculator') {
      return {
        title,
        summary: intent.summary,
        appType: intent.appType,
        templateId: intent.templateId,
        domain: intent.domain,
        routes: [{ id: 'home', path: '/', label: 'Calculator', description: 'Calculator workspace.' }],
        features: intent.requestedFeatures,
        uiSections: ['display', 'keypad', 'history'],
        dataModel: [{ id: 'history_entry', label: 'History entry', fields: ['expression', 'result', 'createdAt'] }],
        controlActions: intent.controlActions,
        runtimeEvents: intent.runtimeEvents,
        notes: ['Prefer client-side interaction and local state.', 'Expose structured calculator state for RawClaw control.'],
      };
    }

    if (intent.domain === 'ai_console') {
      return {
        title,
        summary: intent.summary,
        appType: intent.appType,
        templateId: intent.templateId,
        domain: intent.domain,
        routes: [{ id: 'console', path: '/', label: 'Console', description: 'Prompt and operations console.' }],
        features: intent.requestedFeatures,
        uiSections: ['prompt composer', 'run history', 'approval panel', 'result viewer'],
        dataModel: [{ id: 'run_entry', label: 'Run entry', fields: ['prompt', 'status', 'summary', 'createdAt'] }],
        controlActions: intent.controlActions,
        runtimeEvents: intent.runtimeEvents,
      };
    }

    if (intent.domain === 'crud') {
      return {
        title,
        summary: intent.summary,
        appType: intent.appType,
        templateId: intent.templateId,
        domain: intent.domain,
        routes: [
          { id: 'records', path: '/', label: 'Records', description: 'Record listing.' },
          { id: 'detail', path: '/detail', label: 'Detail', description: 'Selected record detail.' },
        ],
        features: intent.requestedFeatures,
        uiSections: ['table', 'filters', 'detail panel', 'create form'],
        dataModel: [{ id: 'record', label: 'Record', fields: ['title', 'status', 'owner'] }],
        controlActions: intent.controlActions,
        runtimeEvents: intent.runtimeEvents,
      };
    }

    return {
      title,
      summary: intent.summary,
      appType: intent.appType,
      templateId: intent.templateId,
      domain: intent.domain,
      routes: [{ id: 'home', path: '/', label: 'Home', description: 'Primary application route.' }],
      features: intent.requestedFeatures,
      uiSections: intent.domain === 'dashboard'
        ? ['hero', 'kpi cards', 'queue table', 'approval rail']
        : ['hero', 'content area', 'support panel'],
      dataModel: [],
      controlActions: intent.controlActions,
      runtimeEvents: intent.runtimeEvents,
    };
  }
}
