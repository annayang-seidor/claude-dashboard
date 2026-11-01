import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createIndexer } from './index';

const HOME = '/Users/dev';
const FILES = 500;
let root: string;

/** A plausible transcript: messages with blobs in between, untimestamped lines at the end. */
function transcript(i: number): string {
  const cwd = i % 2 ? `${HOME}/y/acme` : `${HOME}/o/tool-${i % 7}`;
  const branch = i % 3 ? `feature/ACME-${i}-thing` : 'HEAD';
  const lines: object[] = [{ type: 'mode', mode: 'default' }];
  for (let t = 0; t < 20; t++) {
    const timestamp = new Date(Date.UTC(2026, 9, 1 + (i % 20), 8, t)).toISOString();
    lines.push(
      {
        type: 'user',
        uuid: crypto.randomUUID(),
        timestamp,
        cwd,
        gitBranch: branch,
        message: { role: 'user', content: `prompt ${i}.${t}` },
      },
      { type: 'ai-title', aiTitle: `title ${i}` },
      { type: 'api-request-blob', blob: 'b'.repeat(2000) },
      {
        type: 'assistant',
        uuid: crypto.randomUUID(),
        timestamp,
        cwd,
        gitBranch: branch,
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      },
    );
  }
  lines.push(
    { type: 'last-prompt', lastPrompt: 'x' },
    { type: 'cost-state' },
    { type: 'file-history-snapshot' },
  );
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'indexer-bench-'));
  for (let d = 0; d < 10; d++) mkdirSync(join(root, `-proj-${d}`));
  for (let i = 0; i < FILES; i++) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    writeFileSync(join(root, `-proj-${i % 10}`, `${id}.jsonl`), transcript(i));
  }
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

it(`indexes ${FILES} synthetic files in under 1 s warm`, async () => {
  const indexer = createIndexer({ projectsRoot: root, home: HOME, findRepoRoot: () => null });
  const cold = performance.now();
  expect(await indexer.index()).toHaveLength(FILES);
  const coldMs = performance.now() - cold;

  const warm = performance.now();
  expect(await indexer.index()).toHaveLength(FILES);
  const warmMs = performance.now() - warm;

  console.log(`indexer: ${FILES} files cold ${coldMs.toFixed(0)} ms, warm ${warmMs.toFixed(0)} ms`);
  expect(warmMs).toBeLessThan(1000);
});
