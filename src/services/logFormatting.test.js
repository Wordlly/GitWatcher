import test from 'node:test';
import assert from 'node:assert/strict';

import { formatNzTimestamp } from './logFormatting.js';

test('formats a standard-time notification in Auckland time', () => {
  assert.equal(
    formatNzTimestamp(new Date('2026-09-14T12:57:00.000Z')),
    '15 Sept 2026, 12:57 am NZST',
  );
});

test('formats a daylight-saving notification with the correct NZ timezone', () => {
  assert.equal(
    formatNzTimestamp(new Date('2026-12-15T00:57:00.000Z')),
    '15 Dec 2026, 1:57 pm NZDT',
  );
});
