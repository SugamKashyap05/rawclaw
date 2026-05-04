import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { GatewayEvent } from '@rawclaw/shared';
import { GatewayControlPlaneService } from './gateway-control-plane.service';
import { GatewayEventsService } from './gateway-events.service';
import { KnowledgeGraphService } from './knowledge-graph.service';
import { ReflectionService } from './reflection.service';

@Injectable()
export class GatewayPhase3LifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GatewayPhase3LifecycleService.name);
  private unsubscribe: (() => Promise<void>) | null = null;
  private destroyed = false;
  private bootstrapPromise: Promise<void> | null = null;

  constructor(
    private readonly gatewayEvents: GatewayEventsService,
    private readonly controlPlane: GatewayControlPlaneService,
    private readonly knowledgeGraph: KnowledgeGraphService,
    private readonly reflection: ReflectionService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.bootstrapPromise) {
      this.bootstrapPromise = this.bootstrapSubscription();
    }
    void this.bootstrapPromise;
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.unsubscribe) {
      await this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private async bootstrapSubscription(): Promise<void> {
    let attempt = 0;
    while (!this.destroyed && !this.unsubscribe) {
      attempt += 1;
      try {
        this.unsubscribe = await this.gatewayEvents.subscribe(async (event) => {
          if (event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled') {
            void this.processTerminalRun(event);
          }
        });
        this.logger.log('Phase 3 lifecycle subscriber is online.');
        return;
      } catch (error) {
        this.logger.warn(
          `Phase 3 lifecycle subscriber waiting for Redis (attempt=${attempt}): ${error instanceof Error ? error.message : String(error)}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
    }
  }

  private async processTerminalRun(event: GatewayEvent): Promise<void> {
    if (!event.runId) {
      return;
    }
    try {
      const run = await this.controlPlane.getRun(event.runId);
      if (!run) {
        return;
      }
      const roleTrace = await this.controlPlane.getRoleTraceByRun(event.runId);
      const memory = run.sessionId
        ? await this.controlPlane.listShortTermMemory(run.sessionId, run.id, 50)
        : [];
      await this.knowledgeGraph.ingestTerminalRun({
        run,
        roleTrace,
        memory,
      });
      await this.reflection.maybeGenerateProposalsForRun(run);
    } catch (error) {
      this.logger.warn(
        `Phase 3 terminal-run processing failed for ${event.runId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
