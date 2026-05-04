export const rawClawManifest = {
  "appId": "a-content-approval-dashboard-2-0-1-13",
  "name": "A Content Approval Dashboard",
  "appType": "ai_tool",
  "sourceType": "generated",
  "version": "0.1.13",
  "compatibility": {
    "sdkVersion": "1.0.0",
    "protocolVersion": "v1",
    "minimumRuntimeVersion": "0.1.0",
    "supportedFeatures": [
      "http_commands",
      "event_stream",
      "app_registry"
    ],
    "deprecatedFeatures": []
  },
  "controlMode": "assist_only",
  "routes": [
    {
      "id": "console",
      "path": "/",
      "label": "Console",
      "description": "Prompt and operations console."
    }
  ],
  "capabilities": [
    {
      "id": "app_status",
      "name": "status",
      "description": "Generated control action for A Content Approval Dashboard.",
      "command": "app.status",
      "requiresApproval": false,
      "inputSchema": null,
      "outputSchema": {
        "state": "object"
      }
    },
    {
      "id": "tool_run",
      "name": "run",
      "description": "Generated control action for A Content Approval Dashboard.",
      "command": "tool.run",
      "requiresApproval": true,
      "inputSchema": {},
      "outputSchema": null
    },
    {
      "id": "runs_list",
      "name": "list",
      "description": "Generated control action for A Content Approval Dashboard.",
      "command": "runs.list",
      "requiresApproval": true,
      "inputSchema": {},
      "outputSchema": null
    },
    {
      "id": "approvals_list",
      "name": "list",
      "description": "Generated control action for A Content Approval Dashboard.",
      "command": "approvals.list",
      "requiresApproval": false,
      "inputSchema": {},
      "outputSchema": null
    }
  ],
  "permissions": {
    "required": [
      "project.read",
      "project.control"
    ],
    "dangerous": [
      "project.deploy"
    ],
    "approvalRequired": true
  },
  "controlEndpoints": {
    "commands": "http://localhost:3000/api/app-builder/apps/a-content-approval-dashboard-2-0-1-13/control",
    "events": "http://localhost:3000/api/app-builder/apps/a-content-approval-dashboard-2-0-1-13/events/stream",
    "health": "http://localhost:3000/api/app-builder/apps/a-content-approval-dashboard-2-0-1-13/health"
  },
  "envRequirements": [
    "RAWCLAW_API_URL"
  ],
  "deployment": {
    "target": "local_managed",
    "location": "E:\\2026 final projects\\rawclaw\\data\\app-builder\\projects\\a-content-approval-dashboard-2"
  },
  "metadata": {
    "projectId": "cmopqhlwf0000sss5p4db5ged",
    "templateId": "web-dashboard",
    "workspaceId": "default",
    "sourcePath": null,
    "domain": "ai_console",
    "runtimeEvents": [
      "tool.run.completed",
      "approval.updated",
      "state.updated"
    ],
    "uiSections": [
      "prompt composer",
      "run history",
      "approval panel",
      "result viewer"
    ]
  }
} as const;

export function emitRawClawEvent(type: string, payload: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent('rawclaw:event', {
    detail: { type, payload, timestamp: new Date().toISOString() },
  }));
}

export async function sendRawClawCommand(command: string, payload?: Record<string, unknown>) {
  const response = await fetch(rawClawManifest.controlEndpoints.commands, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: crypto.randomUUID(),
      appId: rawClawManifest.appId,
      command,
      payload: payload || null,
      requestedAt: new Date().toISOString(),
    }),
  });
  return response.json();
}
