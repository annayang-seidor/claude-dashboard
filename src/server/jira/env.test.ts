import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ConfigError } from '../config';
import { readAtlassianApp } from './env';

const dir = mkdtempSync(join(tmpdir(), 'jira-env-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const envFile = (name: string, text: string) => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};

describe('readAtlassianApp', () => {
  it('reads both keys, trimmed, and leaves process.env alone', async () => {
    const path = envFile(
      'ok',
      '# app\nATLASSIAN_CLIENT_ID= id-1 \nATLASSIAN_CLIENT_SECRET="s3cret"\n',
    );
    expect(await readAtlassianApp(path)).toEqual({ clientId: 'id-1', clientSecret: 's3cret' });
    expect(process.env.ATLASSIAN_CLIENT_SECRET).toBeUndefined();
  });

  it('is null when the file is missing or both keys are blank', async () => {
    expect(await readAtlassianApp(join(dir, 'missing'))).toBeNull();
    expect(
      await readAtlassianApp(envFile('blank', 'ATLASSIAN_CLIENT_ID=\nATLASSIAN_CLIENT_SECRET=\n')),
    ).toBeNull();
  });

  it('stops the start when only one key is set, naming the missing one', async () => {
    const path = envFile('half', 'ATLASSIAN_CLIENT_ID=id-1\n');
    await expect(readAtlassianApp(path)).rejects.toThrow(ConfigError);
    await expect(readAtlassianApp(path)).rejects.toThrow(/ATLASSIAN_CLIENT_SECRET is empty/);
  });
});
