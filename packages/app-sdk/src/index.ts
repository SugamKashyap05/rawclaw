import {
  RawClawAppCapability,
  RawClawAppEvent,
  RawClawAppManifest,
  RawClawControlCommand,
  RawClawControlResponse,
  RawClawSdkCompatibility,
} from '@rawclaw/shared';

export * from '@rawclaw/shared';

export const RAWCLAW_APP_SDK_VERSION = '1.0.0';
export const RAWCLAW_APP_PROTOCOL_VERSION = 'v1';

export type ManifestValidationResult = {
  ok: boolean;
  errors: string[];
};

export function createCompatibility(
  partial?: Partial<RawClawSdkCompatibility>,
): RawClawSdkCompatibility {
  return {
    sdkVersion: partial?.sdkVersion || RAWCLAW_APP_SDK_VERSION,
    protocolVersion: partial?.protocolVersion || RAWCLAW_APP_PROTOCOL_VERSION,
    minimumRuntimeVersion: partial?.minimumRuntimeVersion || '0.1.0',
    supportedFeatures: partial?.supportedFeatures || ['http_commands', 'event_stream'],
    deprecatedFeatures: partial?.deprecatedFeatures || [],
  };
}

export function createCapability(
  capability: RawClawAppCapability,
): RawClawAppCapability {
  return {
    destructive: false,
    requiresApproval: false,
    inputSchema: null,
    outputSchema: null,
    ...capability,
  };
}

export function validateManifest(manifest: RawClawAppManifest): ManifestValidationResult {
  const errors: string[] = [];
  if (!manifest.appId?.trim()) errors.push('appId is required.');
  if (!manifest.name?.trim()) errors.push('name is required.');
  if (!manifest.version?.trim()) errors.push('version is required.');
  if (!manifest.controlEndpoints?.commands?.trim()) errors.push('controlEndpoints.commands is required.');
  if (!manifest.controlEndpoints?.events?.trim()) errors.push('controlEndpoints.events is required.');
  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
    errors.push('At least one capability is required.');
  }
  if (!Array.isArray(manifest.routes) || manifest.routes.length === 0) {
    errors.push('At least one route/view is required.');
  }
  if (!manifest.compatibility?.sdkVersion?.trim()) errors.push('compatibility.sdkVersion is required.');
  if (!manifest.compatibility?.protocolVersion?.trim()) errors.push('compatibility.protocolVersion is required.');
  return {
    ok: errors.length === 0,
    errors,
  };
}

export function createControlCommand(
  partial: Omit<RawClawControlCommand, 'requestedAt'> & { requestedAt?: string },
): RawClawControlCommand {
  return {
    ...partial,
    requestedAt: partial.requestedAt || new Date().toISOString(),
  };
}

export function createControlResponse(
  partial: Omit<RawClawControlResponse, 'respondedAt'> & { respondedAt?: string },
): RawClawControlResponse {
  return {
    ...partial,
    respondedAt: partial.respondedAt || new Date().toISOString(),
  };
}

export function createAppEvent(
  partial: Omit<RawClawAppEvent, 'timestamp'> & { timestamp?: string },
): RawClawAppEvent {
  return {
    ...partial,
    timestamp: partial.timestamp || new Date().toISOString(),
  };
}
