/** Split buffered SSE text into complete events; returns their names and the unfinished rest.
 * Comments (`: keep-alive`) and events without an `event:` line are skipped. */
export function parseSse(buffer: string): { events: string[]; rest: string } {
  const blocks = buffer.replace(/\r\n?/g, '\n').split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: string[] = [];
  for (const block of blocks) {
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) events.push(line.slice(6).trim());
    }
  }
  return { events, rest };
}
