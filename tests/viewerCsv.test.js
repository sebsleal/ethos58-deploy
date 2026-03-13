import test from 'node:test';
import assert from 'node:assert/strict';
import { parseViewerCsv } from '../src/utils/viewerCsv.js';

test('parseViewerCsv handles BOM, quoted commas, and blank lines', () => {
  const csv = '\uFEFFtime,note,rpm\n0,"pull, 3rd gear",2500\n\n1,"steady",2600\n';
  const parsed = parseViewerCsv(csv);

  assert.ok(parsed);
  assert.deepEqual(parsed.headers, ['time', 'note', 'rpm']);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].note, 'pull, 3rd gear');
  assert.equal(parsed.rows[1].rpm, '2600');
});

test('parseViewerCsv returns null when there is no data row', () => {
  assert.equal(parseViewerCsv('time,rpm\n'), null);
});

test('parseViewerCsv returns null when header shape is invalid for viewer', () => {
  assert.equal(parseViewerCsv('onlyone\nvalue\n'), null);
});
