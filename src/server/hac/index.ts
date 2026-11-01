import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse, TomlError } from 'smol-toml';
import { HacEnv, HacName } from '../../shared/env';

/** hac's per-project config, one `<project>.toml` each (ADR 0035). Read only. */
export const HAC_PROJECTS_DIR = join(homedir(), '.hac', 'projects');

/**
 * Every env in every `<project>.toml`, as names and gate flags only. The parsed toml holds urls,
 * usernames and passwords: it never leaves this function, and nothing from it is logged except
 * file names and positions. smol-toml's error message quotes the offending line, so it is never
 * logged either. Never throws; an unreadable or invalid file is skipped with a log line.
 */
export async function readHacEnvs(
  dir = HAC_PROJECTS_DIR,
  log: (message: string) => void = (m) => console.warn(`[hac] ${m}`),
): Promise<HacEnv[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`cannot list ${dir}`);
    return [];
  }
  const envs: HacEnv[] = [];
  for (const file of files.filter((f) => f.endsWith('.toml')).sort()) {
    const project = file.slice(0, -'.toml'.length);
    if (!HacName.safeParse(project).success) {
      log(`${file}: not a usable project name; skipped`);
      continue;
    }
    envs.push(...(await readProject(join(dir, file), file, project, log)));
  }
  return envs;
}

async function readProject(
  path: string,
  file: string,
  project: string,
  log: (message: string) => void,
): Promise<HacEnv[]> {
  let doc: Record<string, unknown>;
  try {
    doc = parse(await readFile(path, 'utf8'));
  } catch (err) {
    log(
      err instanceof TomlError
        ? `${file}: not valid TOML (line ${err.line}, column ${err.column}); skipped`
        : `${file}: cannot read; skipped`,
    );
    return [];
  }
  const tables = doc.envs;
  if (!isTable(tables)) {
    log(`${file}: no [envs.<name>] tables; skipped`);
    return [];
  }
  const envs: HacEnv[] = [];
  for (const [name, table] of Object.entries(tables).sort(([a], [b]) => a.localeCompare(b))) {
    if (!isTable(table) || !HacName.safeParse(name).success) {
      log(`${file}: an [envs] entry is not a usable env table; skipped`);
      continue;
    }
    envs.push({
      project,
      name,
      readOnly: table.read_only === true,
      allowSqlCommit: table.allow_sql_commit === true,
      allowGroovyCommit: table.allow_groovy_commit === true,
      allowImpexImport: table.allow_impex_import === true,
    });
  }
  return envs;
}

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
