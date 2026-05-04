import { Injectable } from '@nestjs/common';
import { HealingAttempt, ValidationSession } from '@rawclaw/shared';

type SelfHealingInput = {
  initialSession: ValidationSession;
  maxAttempts: number;
  determineFailedFiles: (session: ValidationSession) => string[];
  regenerate: (failedFiles: string[], attempt: number, session: ValidationSession) => Promise<void>;
  rerunValidation: (attempts: number) => Promise<ValidationSession>;
  storeAttempt?: (attempt: HealingAttempt) => Promise<void>;
};

@Injectable()
export class SelfHealingLoopService {
  async recover(input: SelfHealingInput): Promise<{ session: ValidationSession; healingAttempts: HealingAttempt[] }> {
    const healingAttempts: HealingAttempt[] = [];
    let session = input.initialSession;

    for (let attempt = 1; attempt <= input.maxAttempts && !session.ok; attempt += 1) {
      const failedFiles = input.determineFailedFiles(session);
      const healingAttempt: HealingAttempt = {
        attempt,
        ok: false,
        failedFiles,
        summary: `Regenerating ${failedFiles.join(', ')} after validation failure.`,
        logs: session.commands
          .filter((command) => command.status === 'failed')
          .map((command) => command.output || '')
          .filter(Boolean),
        createdAt: new Date().toISOString(),
      };

      if (input.storeAttempt) {
        await input.storeAttempt(healingAttempt);
      }
      healingAttempts.push(healingAttempt);

      await input.regenerate(failedFiles, attempt, session);
      session = await input.rerunValidation(attempt + 1);
      healingAttempt.ok = session.ok;
    }

    return { session, healingAttempts };
  }
}
