"""Copy Claude Code session files into fixtures, replacing all free text with lorem ipsum.

Keeps: structure, keys, numbers/bools, ids, timestamps, cwd, gitBranch, types/enums.
Usage: python3 -I scrub.py <dest_projects_dir> <src_session.jsonl>...
Copies <id>.jsonl plus the sibling <id>/ folder (subagents/, tool-results/), skipping memory/.
"""
import json, re, sys
from pathlib import Path

KEEP_KEYS = {
    'type', 'subtype', 'uuid', 'parentUuid', 'logicalParentUuid', 'sessionId', 'session_id',
    'timestamp', 'cwd', 'gitBranch', 'leafUuid', 'agentId', 'version', 'entrypoint', 'userType',
    'id', 'tool_use_id', 'toolUseId', 'sourceToolAssistantUUID', 'promptId', 'requestId',
    'messageId', 'role', 'model', 'requestedModel', 'advisorModel', 'canonicalModel', 'stop_reason',
    'operation', 'mode', 'permissionMode', 'prUrl', 'prRepository', 'querySource', 'shapeHash',
    'requestDigest', 'hash', 'agentType', 'requestShape', 'service_tier', 'speed', 'inference_geo',
    'effort', 'perTurnEffort', 'thinkingDisplay', 'renderedRole', 'live_cwd', 'branch', 'root',
    'platform', 'ttl', 'scope', 'decision', 'reasonType', 'name', 'level', 'provider', 'atis',
    'stop_sequence', 'promptSource', 'turnOrigin', 'turnPosition', 'pidDomain', 'kind',
}
KEEP_VALUE = re.compile(
    r'^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'  # uuid
    r'|\d{4}-\d\d-\d\dT[\d:.]+Z'                                      # ISO timestamp
    r'|[0-9a-f]{16,}|toolu_\w+|msg_\w+|req_\w+|agent-\w+|a[0-9a-f]{16}'  # hashes / api ids
    r'|-?\d+(\.\d+)?|true|false|null)$')
LOREM = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor '
         'incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud ')
CAP = 160


def lorem(s):
    n = min(len(s), CAP)
    return (LOREM * (n // len(LOREM) + 1))[:n]


def scrub_str(s, key):
    if not s or key in KEEP_KEYS or KEEP_VALUE.match(s):
        return s
    if s[:1] in '{[':
        try:
            return json.dumps(scrub(json.loads(s)), ensure_ascii=False, separators=(',', ':'))
        except ValueError:
            pass
    return lorem(s)


def scrub(v, key=None):
    if isinstance(v, dict):
        return {k: scrub(x, k) for k, x in v.items()}
    if isinstance(v, list):
        return [scrub(x, key) for x in v]
    if isinstance(v, str):
        return scrub_str(v, key)
    return v


def copy_file(src, dst):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.suffix == '.jsonl':
        out = []
        for line in src.read_text(encoding='utf-8').splitlines():
            if line.strip():
                out.append(json.dumps(scrub(json.loads(line)), ensure_ascii=False, separators=(',', ':')))
        dst.write_text('\n'.join(out) + '\n', encoding='utf-8')
    elif src.suffix == '.json':
        dst.write_text(json.dumps(scrub(json.loads(src.read_text(encoding='utf-8')))), encoding='utf-8')
    else:
        dst.write_text(lorem(src.read_text(encoding='utf-8', errors='replace')) + '\n', encoding='utf-8')


def main(dest, sources):
    dest = Path(dest)
    for s in map(Path, sources):
        proj = dest / s.parent.name
        copy_file(s, proj / s.name)
        side = s.with_suffix('')
        if side.is_dir():
            for f in side.rglob('*'):
                if f.is_file():
                    copy_file(f, proj / f.relative_to(s.parent))
        print('copied', s.parent.name, s.stem)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:])
