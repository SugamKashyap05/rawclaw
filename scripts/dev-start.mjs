import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function normalizeWindowsPath(value) {
  return value.replace(/\//g, '\\').replace(/^\\+/, '');
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

