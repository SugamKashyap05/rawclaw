import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function normalizeWindowsPath(value) {
  return value.replace(/\//g, '\\').replace(/^\\+/, '');
}

function loadWorkspaceEnv() {
  const envPath = path.join(workspaceRoot, '.env');
  const values = {};
  if (!fs.existsSync(envPath)) {
    return values;
  }
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) {
      continue;
    }
    const [rawKey, ...rest] = line.split('=');
    const key = rawKey.trim();
    if (!key || values[key] !== undefined) {
      continue;
    }
    values[key] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

function resolveRuntimeConfig() {
  const envFile = loadWorkspaceEnv();
  const getValue = (name, fallback) => process.env[name] || envFile[name] || fallback;
  const redisUrl = getValue('RAWCLAW_REDIS_URL', getValue('REDIS_URL', 'redis://localhost:6379'));
  const chromaUrl = getValue(
    'RAWCLAW_CHROMA_URL',
    getValue('CHROMA_URL', `http://${getValue('CHROMA_HOST', 'localhost')}:${getValue('CHROMA_PORT', '8010')}`),
  );
  const allowDegradedStartup = String(getValue('RAWCLAW_ALLOW_DEGRADED_STARTUP', 'false')).toLowerCase() === 'true';
  return {
    allowDegradedStartup,
    redisUrl,
    chromaUrl,
  };
}

function canConnect(host, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finalize = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finalize(true));
    socket.once('timeout', () => finalize(false));
    socket.once('error', () => finalize(false));
    socket.connect(port, host);
  });
}

async function preflightRuntimeDependencies() {
  const runtime = resolveRuntimeConfig();
  const redis = new URL(runtime.redisUrl);
  const chroma = new URL(runtime.chromaUrl);
  const checks = [
    {
      name: 'Redis',
      host: redis.hostname,
      port: Number(redis.port || 6379),
      source: runtime.redisUrl,
    },
    {
      name: 'Chroma',
      host: chroma.hostname,
      port: Number(chroma.port || 8010),
      source: runtime.chromaUrl,
    },
  ];

  const results = [];
  for (const check of checks) {
    const ok = await canConnect(check.host, check.port);
    results.push({ ...check, ok });
  }

  console.log('RawClaw runtime dependency preflight');
  for (const result of results) {
    console.log(
      `  ${result.ok ? 'OK  ' : 'FAIL'} ${result.name.padEnd(6)} ${result.host}:${result.port} (${result.source})`,
    );
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length && !runtime.allowDegradedStartup) {
    console.error('Required runtime dependencies are unavailable. Start them with `docker compose up -d` or set RAWCLAW_ALLOW_DEGRADED_STARTUP=true to continue anyway.');
    process.exit(1);
  }

  if (failed.length) {
    console.warn('Proceeding with degraded startup because RAWCLAW_ALLOW_DEGRADED_STARTUP=true.');
  }
}

function cleanupWindowsRawClawProcesses() {
  const currentPid = process.pid;
  const workspace = normalizeWindowsPath(workspaceRoot);
  
  // Script to find processes by workspace path OR by specific ports
  const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$workspace = '${workspace.replace(/'/g, "''")}'
$currentPid = ${currentPid}
$ports = @(3000, 8001)

# 1. Targets by workspace path
$targetsByPath = Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $currentPid -and
  $_.CommandLine -and
  $_.CommandLine -like "*$workspace*" -and
  ($_.Name -in @('node.exe','python.exe','python3.exe','rawclaw.exe'))
}

# 2. Targets by port ownership
$targetsByPort = foreach ($port in $ports) {
  $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
  if ($conn) {
    foreach ($c in $conn) {
      if ($c.OwningProcess -and $c.OwningProcess -ne $currentPid) {
        Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
      }
    }
  }
}

$allTargets = ($targetsByPath + $targetsByPort) | Select-Object -Unique ProcessId, Name

foreach ($proc in $allTargets) {
  try {
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
    Write-Output ("Stopped stale RawClaw process {0} ({1})" -f $proc.ProcessId, $proc.Name)
  } catch {
    Write-Output ("Failed to stop process {0}: {1}" -f $proc.ProcessId, $_.Exception.Message)
  }
}
`;

  spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
    { stdio: 'inherit' },
  );
}

if (process.platform === 'win32') {
  cleanupWindowsRawClawProcesses();
}

await preflightRuntimeDependencies();

const turboBin = path.join(workspaceRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'turbo.cmd' : 'turbo');

console.log(`Starting RawClaw dev stack via ${path.basename(turboBin)}...`);

// On Windows with shell: true, we must quote the command path if it contains spaces
const command = process.platform === 'win32' ? `"${turboBin}"` : turboBin;

const child = spawn(command, ['run', 'dev'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  windowsHide: true,
  env: { ...process.env, TURBO_FORCE_GIT: '0' },
});


child.on('error', (err) => {
  console.error('Failed to start Turbo process:', err.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
