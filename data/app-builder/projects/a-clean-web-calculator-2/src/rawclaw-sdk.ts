export const rawClawManifest = {
  "appId": "a-clean-web-calculator-2-0-1-10",
  "name": "A Clean Web Calculator",
  "appType": "web_app",
  "sourceType": "generated",
  "version": "0.1.10",
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
      "id": "home",
      "path": "/",
      "label": "Calculator",
      "description": "Calculator workspace."
    }
  ],
  "capabilities": [
    {
      "id": "calculator_press_digit",
      "name": "press digit",
      "description": "Generated control action for A Clean Web Calculator.",
      "command": "calculator.press_digit",
      "requiresApproval": false,
      "inputSchema": {
        "digit": "string"
      },
      "outputSchema": null
    },
    {
      "id": "calculator_press_operator",
      "name": "press operator",
      "description": "Generated control action for A Clean Web Calculator.",
      "command": "calculator.press_operator",
      "requiresApproval": false,
      "inputSchema": {
        "operator": "string"
      },
      "outputSchema": null
    },
    {
      "id": "calculator_evaluate",
      "name": "evaluate",
      "description": "Generated control action for A Clean Web Calculator.",
      "command": "calculator.evaluate",
      "requiresApproval": false,
      "inputSchema": {},
      "outputSchema": null
    },
    {
      "id": "calculator_clear",
      "name": "clear",
      "description": "Generated control action for A Clean Web Calculator.",
      "command": "calculator.clear",
      "requiresApproval": false,
      "inputSchema": {},
      "outputSchema": null
    },
    {
      "id": "calculator_backspace",
      "name": "backspace",
      "description": "Generated control action for A Clean Web Calculator.",
      "command": "calculator.backspace",
      "requiresApproval": false,
      "inputSchema": {},
      "outputSchema": null
    },
    {
      "id": "calculator_percent",
      "name": "percent",
      "description": "Generated control action for A Clean Web Calculator.",
      "command": "calculator.percent",
      "requiresApproval": false,
      "inputSchema": {},
      "outputSchema": null
    },
    {
      "id": "calculator_get_state",
      "name": "get state",
      "description": "Generated control action for A Clean Web Calculator.",
      "command": "calculator.get_state",
      "requiresApproval": false,
      "inputSchema": {},
      "outputSchema": {
        "state": "object"
      }
    },
    {
      "id": "calculator_get_history",
      "name": "get history",
      "description": "Generated control action for A Clean Web Calculator.",
      "command": "calculator.get_history",
      "requiresApproval": false,
      "inputSchema": {},
      "outputSchema": {
        "state": "object"
      }
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
    "commands": "http://localhost:3000/api/app-builder/apps/a-clean-web-calculator-2-0-1-10/control",
    "events": "http://localhost:3000/api/app-builder/apps/a-clean-web-calculator-2-0-1-10/events/stream",
    "health": "http://localhost:3000/api/app-builder/apps/a-clean-web-calculator-2-0-1-10/health"
  },
  "envRequirements": [
    "RAWCLAW_API_URL"
  ],
  "deployment": {
    "target": "local_managed",
    "location": "E:\\2026 final projects\\rawclaw\\data\\app-builder\\projects\\a-clean-web-calculator-2"
  },
  "metadata": {
    "projectId": "cmonwqrnk000dwks5h2ndu18s",
    "templateId": "web-dashboard",
    "workspaceId": "default",
    "sourcePath": null,
    "domain": "calculator",
    "runtimeEvents": [
      "expression.changed",
      "result.calculated",
      "calculator.cleared"
    ],
    "uiSections": [
      "display",
      "keypad",
      "history"
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
