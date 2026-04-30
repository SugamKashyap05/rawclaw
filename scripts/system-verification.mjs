import { spawn } from 'node:child_process';
import process from 'node:process';

const root = process.cwd();
const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';
const pythonCmd = isWindows ? 'python' : 'python3';
const liveWebEnabled = process.argv.includes('--live-web');

const suites = [
  {
    name: 'Python Gateway/Research Regression',
    command: pythonCmd,
    args: [
      '-m',
      'pytest',
      'apps/agent/tests/test_agent_profiles.py',
      'apps/agent/tests/test_session_manager.py',
      'apps/agent/tests/test_gateway_service.py',
      'apps/agent/tests/test_research_stages.py',
      'apps/agent/tests/test_workflow_matrix.py',
      'apps/agent/tests/test_single_session_chat_smoke.py',
      '-q',
    ],
  },
  {
    name: 'API Control-Plane Jest',
    command: npmCmd,
    args: [
      'test',
      '--workspace',
      '@rawclaw/api',
      '--',
      'gateway-routing.service.spec.ts',
      'operator.service.spec.ts',
      'gateway-automation.service.spec.ts',
      'gateway-subagent.service.spec.ts',
    ],
  },
  {
    name: 'Web Operator Vitest',
    command: npmCmd,
    args: ['test', '--workspace', '@rawclaw/web', '--', 'Operator.test.tsx'],
  },
  {
    name: 'Web Operator E2E',
    command: npmCmd,
    args: ['run', 'test:e2e', '--workspace', '@rawclaw/web'],
  },
  {
    name: 'API Typecheck',
    command: npmCmd,
    args: ['run', 'check-types', '--workspace', '@rawclaw/api'],
  },
  {
    name: 'Web Typecheck',
    command: npmCmd,
    args: ['run', 'check-types', '--workspace', '@rawclaw/web'],
  },
  {
    name: 'Desktop Typecheck',
    command: npmCmd,
    args: ['run', 'check-types', '--workspace', '@rawclaw/desktop'],
  },
  {
    name: 'Web Production Build',
    command: npmCmd,
    args: ['run', 'build', '--workspace', '@rawclaw/web'],
  },
];

if (liveWebEnabled) {
  suites.splice(1, 0, {
    name: 'Python Live Web Regression',
    command: pythonCmd,
    args: [
      '-m',
      'pytest',
      'apps/agent/tests/test_web_extract_live.py',
      'apps/agent/tests/test_single_session_chat_live.py',
      '-q',
    ],
    env: { RAWCLAW_RUN_LIVE_WEB: '1' },
  });
}

function banner(text) {
  const line = '='.repeat(72);
  console.log(`\n${line}\n${text}\n${line}`);
}

function quoteCmdArg(value) {
  const text = String(value ?? '');
  if (text === '') {
    return '""';
  }
  if (!/[ \t"&()^<>|]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '\\"')}"`;
}

function runSuite(suite) {
  return new Promise((resolve) => {
    const started = Date.now();
    const env = {
      ...process.env,
      ...(suite.env || {}),
    };
    const child = isWindows
      ? spawn(
          'cmd.exe',
          ['/d', '/s', '/c', [quoteCmdArg(suite.command), ...suite.args.map(quoteCmdArg)].join(' ')],
          {
            cwd: root,
            stdio: 'inherit',
            env,
          },
        )
      : spawn(suite.command, suite.args, {
          cwd: root,
          stdio: 'inherit',
          env,
        });

    child.on('close', (code) => {
      resolve({
        ...suite,
        code: code ?? 1,
        durationMs: Date.now() - started,
      });
    });
    child.on('error', (error) => {
      console.error(`Failed to start ${suite.name}: ${error.message}`);
      resolve({
        ...suite,
        code: 1,
        durationMs: Date.now() - started,
      });
    });
  });
}

async function main() {
  banner(`RawClaw System Verification${liveWebEnabled ? ' (Live Web Enabled)' : ''}`);
  const results = [];

  for (const suite of suites) {
    banner(`Running: ${suite.name}`);
    const result = await runSuite(suite);
    results.push(result);
    const seconds = (result.durationMs / 1000).toFixed(2);
    console.log(`\n[${result.code === 0 ? 'PASS' : 'FAIL'}] ${suite.name} (${seconds}s)`);
    if (result.code !== 0) {
      break;
    }
  }

  banner('Verification Summary');
  for (const result of results) {
    const seconds = (result.durationMs / 1000).toFixed(2);
    console.log(`- ${result.code === 0 ? 'PASS' : 'FAIL'} ${result.name} (${seconds}s)`);
  }

  const failed = results.find((result) => result.code !== 0);
  if (failed) {
    process.exitCode = failed.code || 1;
    return;
  }

  console.log('\nAll verification suites passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
