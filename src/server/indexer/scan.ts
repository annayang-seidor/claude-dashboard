import { open, type FileHandle } from 'node:fs/promises';
import { newTally, tallyLine, type HacTally } from './hac';

const CHUNK = 64 * 1024;
const NEWLINE = 0x0a;
/** gitBranch value Claude Code records when detached or not in a git repo at all. */
const NO_BRANCH = 'HEAD';

/** Raw facts read from one transcript, before any path or naming rules are applied. */
export interface FileFacts {
  firstCwd: string | null;
  /** Text of the first real user prompt (not meta, not a tool result). */
  firstPrompt: string | null;
  customTitle: string | null;
  aiTitle: string | null;
  /** Legacy `summary` line whose leafUuid points at a message in this file. */
  summary: string | null;
  lastBranch: string | null;
  branchesSeen: string[];
  /** Epoch ms of the oldest / newest timestamp on a user or assistant line. */
  firstMessageAt: number | null;
  lastMessageAt: number | null;
}

interface Acc extends FileFacts {
  uuids: Set<string>;
  summaries: { leafUuid: string; summary: string }[];
}

type Line = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function isMessage(line: Line): boolean {
  return line.type === 'user' || line.type === 'assistant';
}

function messageTime(line: Line): number | null {
  if (!isMessage(line)) return null;
  const ts = str(line.timestamp);
  const ms = ts ? Date.parse(ts) : NaN;
  return Number.isNaN(ms) ? null : ms;
}

/** Prompt text of a user line, or null for meta lines and tool results. */
function promptText(line: Line): string | null {
  if (line.type !== 'user' || line.isMeta === true || line.isSidechain === true) return null;
  const content = (line.message as { content?: unknown } | undefined)?.content;
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter(
        (b): b is { type: 'text'; text: string } =>
          b?.type === 'text' && typeof b.text === 'string',
      )
      .map((b) => b.text)
      .join(' ');
  }
  text = text.trim();
  return text === '' ? null : text;
}

function apply(acc: Acc, line: Line): void {
  const cwd = str(line.cwd);
  if (cwd && acc.firstCwd === null) acc.firstCwd = cwd;

  const branch = str(line.gitBranch);
  if (branch && branch !== NO_BRANCH) {
    acc.lastBranch = branch;
    if (!acc.branchesSeen.includes(branch)) acc.branchesSeen.push(branch);
  }

  const uuid = str(line.uuid);
  if (uuid) acc.uuids.add(uuid);

  const ms = messageTime(line);
  if (ms !== null) {
    if (acc.firstMessageAt === null || ms < acc.firstMessageAt) acc.firstMessageAt = ms;
    if (acc.lastMessageAt === null || ms > acc.lastMessageAt) acc.lastMessageAt = ms;
  }

  if (acc.firstPrompt === null) acc.firstPrompt = promptText(line);

  switch (line.type) {
    case 'custom-title':
      acc.customTitle = str(line.customTitle) ?? acc.customTitle;
      break;
    case 'ai-title':
      acc.aiTitle = str(line.aiTitle) ?? acc.aiTitle;
      break;
    case 'summary': {
      const leafUuid = str(line.leafUuid);
      const summary = str(line.summary);
      if (leafUuid && summary) acc.summaries.push({ leafUuid, summary });
      break;
    }
  }
}

/** Parses one JSONL line; unknown shapes and partial writes are skipped. */
function parse(bytes: Buffer): Line | null {
  if (bytes.length === 0) return null;
  try {
    const v: unknown = JSON.parse(bytes.toString('utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Line) : null;
  } catch {
    return null;
  }
}

/** Complete lines of `buf`, in order. */
function* lines(buf: Buffer): Generator<Buffer> {
  let start = 0;
  for (let nl = buf.indexOf(NEWLINE); nl !== -1; nl = buf.indexOf(NEWLINE, start)) {
    yield buf.subarray(start, nl);
    start = nl + 1;
  }
  if (start < buf.length) yield buf.subarray(start);
}

async function read(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.allocUnsafe(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}

/**
 * Reads forward until the first cwd and first user prompt are known.
 * Returns the byte offset just past the last line consumed.
 */
async function readHead(fh: FileHandle, size: number, acc: Acc): Promise<number> {
  let pos = 0;
  let pending: Buffer = Buffer.alloc(0);
  while (pos < size && (acc.firstCwd === null || acc.firstPrompt === null)) {
    const chunk = await read(fh, pos, Math.min(CHUNK, size - pos));
    if (chunk.length === 0) break;
    pos += chunk.length;
    const buf = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    const lastNl = buf.lastIndexOf(NEWLINE);
    const atEof = pos >= size;
    const body = atEof ? buf : buf.subarray(0, lastNl + 1);
    pending = atEof ? Buffer.alloc(0) : buf.subarray(lastNl + 1);
    for (const l of lines(body)) {
      const line = parse(l);
      if (line) apply(acc, line);
    }
  }
  return pos - pending.length;
}

/**
 * Reads backward from EOF (never before `floor`) until a chunk holds a timestamped
 * user/assistant line; the last lines are usually untimestamped (cost-state,
 * file-history-snapshot). Returns the lines in file order, unapplied, and the byte offset
 * where the first of them starts.
 */
async function readTail(
  fh: FileHandle,
  size: number,
  floor: number,
): Promise<{ lines: Line[]; start: number }> {
  const blocks: Line[][] = [];
  let end = size;
  let carry: Buffer = Buffer.alloc(0);
  let first = size;
  while (end > floor) {
    const start = Math.max(floor, end - CHUNK);
    const chunk = await read(fh, start, end - start);
    const buf = carry.length ? Buffer.concat([chunk, carry]) : chunk;
    end = start;
    let body = buf;
    if (start > floor) {
      // The bytes before the first newline may be the end of a line that starts earlier.
      const nl = buf.indexOf(NEWLINE);
      if (nl === -1) {
        carry = buf;
        continue;
      }
      carry = buf.subarray(0, nl);
      body = buf.subarray(nl + 1);
      first = start + nl + 1;
    } else {
      carry = Buffer.alloc(0);
      first = floor;
    }
    const block: Line[] = [];
    for (const l of lines(body)) {
      const line = parse(l);
      if (line) block.push(line);
    }
    blocks.unshift(block);
    if (block.some((line) => messageTime(line) !== null)) break;
  }
  return { lines: blocks.flat(), start: first };
}

const CUSTOM_TITLE = Buffer.from('"custom-title"');
const MIDDLE_CHUNK = 1024 * 1024;
/** Longer lines are never custom-title records (spike § 12: about 120 bytes), so they are
 * skipped instead of buffered; a 30 MB api-request-blob line would otherwise be copied per chunk. */
const MAX_TITLE_LINE = 64 * 1024;

/**
 * Searches the bytes between head and tail, `[from, to)`, for custom-title records: /rename
 * appends one wherever the session is at the time (spike § 12, ADR 0055). Only lines whose bytes
 * contain `"custom-title"` are parsed. `to` is the start of a line, so the range ends on one.
 */
async function readMiddle(fh: FileHandle, from: number, to: number, acc: Acc): Promise<void> {
  let pos = from;
  let pending: Buffer = Buffer.alloc(0);
  let skipping = false;
  while (pos < to) {
    const chunk = await read(fh, pos, Math.min(MIDDLE_CHUNK, to - pos));
    if (chunk.length === 0) break;
    pos += chunk.length;
    let buf = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    if (skipping) {
      const nl = buf.indexOf(NEWLINE);
      if (nl === -1) continue;
      buf = buf.subarray(nl + 1);
      skipping = false;
    }
    const atEnd = pos >= to;
    const lastNl = buf.lastIndexOf(NEWLINE);
    const body = atEnd ? buf : buf.subarray(0, lastNl + 1);
    pending = atEnd ? Buffer.alloc(0) : buf.subarray(lastNl + 1);
    if (pending.length > MAX_TITLE_LINE) {
      pending = Buffer.alloc(0);
      skipping = true;
    }
    for (let hit = body.indexOf(CUSTOM_TITLE); hit !== -1;) {
      const start = body.lastIndexOf(NEWLINE, hit) + 1;
      const nl = body.indexOf(NEWLINE, hit);
      const end = nl === -1 ? body.length : nl;
      const line = parse(body.subarray(start, end));
      if (line?.type === 'custom-title') apply(acc, line);
      hit = body.indexOf(CUSTOM_TITLE, end);
    }
  }
}

/** Reads the head and tail of a transcript of `size` bytes, and custom titles in between. */
export async function scanFile(path: string, size: number): Promise<FileFacts> {
  const acc: Acc = {
    firstCwd: null,
    firstPrompt: null,
    customTitle: null,
    aiTitle: null,
    summary: null,
    lastBranch: null,
    branchesSeen: [],
    firstMessageAt: null,
    lastMessageAt: null,
    uuids: new Set(),
    summaries: [],
  };
  const fh = await open(path, 'r');
  try {
    const headEnd = await readHead(fh, size, acc);
    if (headEnd < size) {
      const tail = await readTail(fh, size, headEnd);
      // File order, so the last custom title wins: head, middle, tail.
      if (headEnd < tail.start) await readMiddle(fh, headEnd, tail.start, acc);
      for (const line of tail.lines) apply(acc, line);
    }
  } finally {
    await fh.close();
  }

  const { uuids, summaries, ...facts } = acc;
  // Old-format summary lines can describe leaves in other sessions; keep only our own.
  const own = summaries.filter((s) => uuids.has(s.leafUuid));
  facts.summary = own.at(-1)?.summary ?? null;
  return facts;
}

/** Where a hac pass over one transcript stopped, so a grown file is read from there (ADR 0036). */
export interface HacProgress {
  /** Byte offset just past the last complete line counted. */
  offset: number;
  tally: HacTally;
}

const HAC_BYTES = Buffer.from('hac');

/**
 * Reads a transcript from `from.offset` (or the start) to EOF and counts its hac calls. Only lines
 * whose bytes contain "hac" are parsed. A last line without a newline is counted only when it
 * parses, so a line still being written is read again next time.
 */
export async function scanHac(
  path: string,
  size: number,
  from: HacProgress | null,
): Promise<HacProgress> {
  const resume = from && from.offset <= size ? from : null;
  // A copy: a scan that throws halfway must not leave the cached tally half-counted.
  const tally = resume ? structuredClone(resume.tally) : newTally();
  let pos = resume ? resume.offset : 0;
  let offset = pos;
  let pending: Buffer = Buffer.alloc(0);
  const fh = await open(path, 'r');
  try {
    while (pos < size) {
      const chunk = await read(fh, pos, Math.min(CHUNK, size - pos));
      if (chunk.length === 0) break;
      pos += chunk.length;
      const buf = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      const lastNl = buf.lastIndexOf(NEWLINE);
      pending = buf.subarray(lastNl + 1);
      if (lastNl === -1) continue;
      for (const l of lines(buf.subarray(0, lastNl + 1))) {
        if (!l.includes(HAC_BYTES)) continue;
        const line = parse(l);
        if (line) tallyLine(tally, line);
      }
      offset = pos - pending.length;
    }
  } finally {
    await fh.close();
  }
  if (pending.length) {
    const line = parse(pending);
    if (line) {
      if (pending.includes(HAC_BYTES)) tallyLine(tally, line);
      offset += pending.length;
    }
  }
  return { offset, tally };
}
