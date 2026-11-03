/** Plain text and mentioned account ids from a comment body in Atlassian Document Format, the
 * shape REST v3 returns. A plain string (REST v2) passes through. */
export function adfText(body: unknown): { text: string; mentions: string[] } {
  const mentions: string[] = [];
  const parts: string[] = [];

  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const n = node as {
      type?: unknown;
      text?: unknown;
      attrs?: Record<string, unknown>;
      content?: unknown;
    };
    if (n.type === 'text' && typeof n.text === 'string') parts.push(n.text);
    else if (n.type === 'mention') {
      if (typeof n.attrs?.id === 'string') mentions.push(n.attrs.id);
      const name = typeof n.attrs?.text === 'string' ? n.attrs.text : '@someone';
      parts.push(name.startsWith('@') ? name : `@${name}`);
    } else if (n.type === 'hardBreak') parts.push('\n');
    if (Array.isArray(n.content)) n.content.forEach(walk);
    // Block nodes end a line, so paragraphs and list items do not run together.
    if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'listItem') parts.push('\n');
  }

  if (typeof body === 'string') return { text: body.trim(), mentions };
  walk(body);
  const text = parts
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, mentions };
}

/** Jira writes offsets without a colon (`+0100`); ISO 8601 as zod checks it wants `+01:00`. */
export function isoDate(jira: string): string {
  return jira.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
}
