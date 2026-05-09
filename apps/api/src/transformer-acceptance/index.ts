import * as contextRegistry from './context.acceptance-registry';
import * as emissionRegistry from './emission.acceptance-registry';
import * as executionRegistry from './execution.acceptance-registry';
import * as intakeRegistry from './intake.acceptance-registry';
import * as persistenceRegistry from './persistence.acceptance-registry';

export const TRANSFORMER_ACCEPTANCE_REGISTRIES = {
  context: contextRegistry,
  emission: emissionRegistry,
  execution: executionRegistry,
  intake: intakeRegistry,
  persistence: persistenceRegistry,
};
