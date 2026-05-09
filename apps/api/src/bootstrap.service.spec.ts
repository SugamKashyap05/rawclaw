import { BootstrapService } from './bootstrap.service';
import { DEFAULT_WORKSPACE_FILES } from './settings.service';

describe('BootstrapService', () => {
  const makeDeleteMany = () => jest.fn().mockResolvedValue({ count: 0 });

  const createService = () => {
    const appSetting = {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
      deleteMany: makeDeleteMany(),
    };

    const agentUpsert = jest.fn(async ({ where, create, update }: any) => ({
      id: `agent-${where.name.toLowerCase().replace(/\s+/g, '-')}`,
      name: where.name,
      ...(create || update),
    }));

    const prisma = {
      appSetting,
      agentProfile: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: agentUpsert,
        deleteMany: makeDeleteMany(),
      },
      childRun: { deleteMany: makeDeleteMany() },
      gatewayAutomationRun: { deleteMany: makeDeleteMany() },
      gatewayAutomationJob: { deleteMany: makeDeleteMany() },
      runStep: { deleteMany: makeDeleteMany() },
      taskRun: { deleteMany: makeDeleteMany() },
      taskDefinition: { deleteMany: makeDeleteMany() },
      toolConfirmation: { deleteMany: makeDeleteMany() },
      message: { deleteMany: makeDeleteMany() },
      sessionBinding: { deleteMany: makeDeleteMany() },
      session: { deleteMany: makeDeleteMany() },
      modelPreference: { deleteMany: makeDeleteMany() },
      promptImprovementProposal: { deleteMany: makeDeleteMany() },
      memoryEntry: { deleteMany: makeDeleteMany() },
      harnessProcess: { deleteMany: makeDeleteMany() },
      harnessRun: { deleteMany: makeDeleteMany() },
      document: { deleteMany: makeDeleteMany() },
      importedProjectAdapter: { deleteMany: makeDeleteMany() },
      appRegistryRecord: { deleteMany: makeDeleteMany() },
      appBuilderRun: { deleteMany: makeDeleteMany() },
      appBuilderManifest: { deleteMany: makeDeleteMany() },
      appBuilderProject: { deleteMany: makeDeleteMany() },
      appBuilderBlobRef: { deleteMany: makeDeleteMany() },
      bindingRule: { deleteMany: makeDeleteMany() },
      mcpServerConfig: { deleteMany: makeDeleteMany() },
      $transaction: jest.fn().mockResolvedValue(undefined),
    };

    const settingsService = {
      readWorkspaceFiles: jest.fn().mockReturnValue(DEFAULT_WORKSPACE_FILES),
      bootstrapWorkspace: jest.fn().mockResolvedValue({
        settings: { theme: 'dark' },
        workspaceFiles: {
          ...DEFAULT_WORKSPACE_FILES,
          user: 'User context',
        },
      }),
      resetWorkspaceFiles: jest.fn().mockReturnValue(DEFAULT_WORKSPACE_FILES),
    };

    const modelsService = {
      getHealth: jest.fn().mockResolvedValue({
        providers: { ollama: { status: 'up', error: null } },
        providerConfig: { ollama: { baseUrl: 'http://localhost:11434' } },
      }),
      getModels: jest.fn().mockResolvedValue([
        { id: 'ollama/qwen3-vl:8b', provider: 'ollama' },
      ]),
      getConfig: jest.fn().mockResolvedValue({
        routing: {
          low: 'ollama/gemma4:e4b',
          medium: 'ollama/gemma4:31b-cloud',
        },
      }),
    };

    const httpService = {
      post: jest.fn(),
    };

    const configService = {
      get: jest.fn((key: string) => (key === 'OLLAMA_BASE_URL' ? 'http://localhost:11434' : undefined)),
    };

    const service = new BootstrapService(
      prisma as any,
      settingsService as any,
      modelsService as any,
      httpService as any,
      configService as any,
    );

    return { service, prisma, settingsService, modelsService, httpService };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports fresh-start setup when workspace files are still placeholders', async () => {
    const { service } = createService();

    await expect(service.getStatus()).resolves.toEqual(
      expect.objectContaining({
        initialized: false,
        needsSetup: true,
        workspaceFiles: {
          user: false,
          soul: false,
          memory: false,
          tools: false,
        },
      }),
    );
  });

  it('creates background agents and a default main agent during bootstrap', async () => {
    const { service, prisma, settingsService } = createService();
    jest.spyOn(service, 'suggestMainAgentDraft').mockResolvedValue({
      name: 'Astra',
      description: 'Main operator',
      systemPrompt: 'You are Astra.',
      promptOverlay: 'Stay proactive.',
      modelId: 'ollama/gemma4:31b-cloud',
      skills: ['research', 'memory'],
      source: 'fallback',
      autofillModel: 'ollama/qwen3-vl:8b',
    });

    const result = await service.bootstrapSetup({
      user: 'Sugam builds local AI tools.',
      memory: 'Project starts fresh.',
      mainAgent: {
        name: 'Astra',
        description: 'Main operator',
        mode: 'auto',
      },
    });

    expect(settingsService.bootstrapWorkspace).toHaveBeenCalled();
    expect(prisma.agentProfile.updateMany).toHaveBeenCalledWith({ data: { isDefault: false } });
    expect(prisma.agentProfile.upsert).toHaveBeenCalledTimes(4);
    expect(result.createdAgents.backgroundAgentIds).toHaveLength(3);
    expect(result.createdAgents.mainAgentId).toBe('agent-astra');
    expect(prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'rawclaw.bootstrap.state' },
      }),
    );
  });

  it('clears persisted state and returns the app to setup mode on factory reset', async () => {
    const { service, prisma, settingsService } = createService();

    await expect(service.factoryReset()).resolves.toEqual({ reset: true, needsSetup: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(settingsService.resetWorkspaceFiles).toHaveBeenCalledTimes(1);
    expect(prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'rawclaw.bootstrap.state' },
      }),
    );
  });
});
