import test from 'node:test';
import assert from 'node:assert/strict';

import { formatGitHubRequestLog } from './githubDiagnostics.js';

test('formats safe GitHub request diagnostics without exposing credentials', () => {
  const output = formatGitHubRequestLog({
    label: 'branchHead owner/repo:main',
    authenticated: true,
    status: 200,
    durationMs: 42,
    rateRemaining: '4998',
    rateReset: '1770000000',
  });

  assert.match(output, /\[GitHub\] branchHead owner\/repo:main/);
  assert.match(output, /auth=pat/);
  assert.match(output, /status=200/);
  assert.match(output, /duration_ms=42/);
  assert.match(output, /rate_remaining=4998/);
  assert.match(output, /rate_reset=1770000000/);
  assert.doesNotMatch(output, /token|Authorization|Bearer/i);
});

test('marks failed requests without logging an error payload', () => {
  const output = formatGitHubRequestLog({
    label: 'compareBranchRange owner/repo',
    authenticated: true,
    status: 404,
    durationMs: 15000,
  });

  assert.match(output, /status=404/);
  assert.match(output, /duration_ms=15000/);
  assert.doesNotMatch(output, /token|Authorization|Bearer|secret/i);
});
