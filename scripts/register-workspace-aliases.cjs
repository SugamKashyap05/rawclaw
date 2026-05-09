const fs = require('fs');
const path = require('path');
const Module = require('module');

const repoRoot = path.resolve(__dirname, '..');

const ALIAS_ROOTS = {
  '@rawclaw/shared': path.join(repoRoot, 'packages', 'shared', 'src'),
  '@rawclaw/app-sdk': path.join(repoRoot, 'packages', 'app-sdk', 'src'),
};

const originalResolveFilename = Module._resolveFilename;

function resolveAliasTarget(baseDir, remainder) {
  const normalizedRemainder = remainder.replace(/^\/+/, '');
  const baseTarget = normalizedRemainder
    ? path.join(baseDir, normalizedRemainder)
    : path.join(baseDir, 'index.ts');

  const candidates = [
    baseTarget,
    `${baseTarget}.ts`,
    `${baseTarget}.js`,
    path.join(baseTarget, 'index.ts'),
    path.join(baseTarget, 'index.js'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

Module._resolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
  for (const [alias, baseDir] of Object.entries(ALIAS_ROOTS)) {
    if (request === alias || request.startsWith(`${alias}/`)) {
      const remainder = request === alias ? '' : request.slice(alias.length + 1);
      const resolved = resolveAliasTarget(baseDir, remainder);
      if (resolved) {
        return resolved;
      }
    }
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};
