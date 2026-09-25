/**
 * Dry run over a real Claude Code session: asks Jev what `/compact` would keep
 * and prints every decision, without touching the session.
 *
 *   npx tsx examples/dry-run.ts <session.jsonl> [--segment N] [--out file.txt] [--no-stubs]
 *
 * `--segment` picks the stretch between compactions (1 = before the first
 * `/compact`; default: the last, i.e. what the next `/compact` would see).
 * Key, endpoint and options come from the environment or ~/.claude/settings.json,
 * exactly as the hook reads them.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { compact, JevClient, reductionRatio, type Message, type ToolResult, type ToolUse } from '../src/index.js';

type Block = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown; is_error?: boolean };
type Entry = { type: string; subtype?: string; isSidechain?: boolean; message?: { id?: string; role?: string; content?: string | Block[] } };

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
if (!path) throw new Error('usage: dry-run.ts <session.jsonl> [--segment N] [--out file] [--no-stubs]');
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const settings = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8')) as {
  env?: Record<string, string>;
  pluginConfigs?: Record<string, { options?: Record<string, unknown> }>;
};
const env = (name: string) => process.env[name] || settings.env?.[name];
const options = settings.pluginConfigs?.['fast-jev-compaction@fast-jev-compaction']?.options ?? {};
const apiKey = env('TYPESAFE_API_KEY');
if (!apiKey) throw new Error('TYPESAFE_API_KEY is not configured');
const baseUrl = env('TYPESAFE_BASE_URL');

// Split the transcript at compact boundaries and pick one stretch.
const entries = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Entry);
const segments: Entry[][] = [[]];
for (const e of entries) {
  if (e.type === 'system' && e.subtype === 'compact_boundary') segments.push([]);
  else segments[segments.length - 1]!.push(e);
}
const segmentNo = Number(flag('--segment') ?? segments.length);
const segment = segments[segmentNo - 1];
if (!segment) throw new Error(`no segment ${segmentNo}; the session has ${segments.length}`);

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c: Block) => (c.type === 'text' ? c.text ?? '' : `[${c.type}]`)).join('');
  return '';
}

// One Message per API message: the transcript writes an assistant reply one block per line.
const messages: Message[] = [];
let lastAssistantId: string | undefined;
for (const e of segment) {
  if ((e.type !== 'user' && e.type !== 'assistant') || e.isSidechain || !e.message) continue;
  const content = e.message.content;
  const blocks: Block[] = typeof content === 'string' ? [{ type: 'text', text: content }] : content ?? [];
  if (e.type === 'assistant') {
    const same = e.message.id && e.message.id === lastAssistantId;
    const msg: Message = same ? messages[messages.length - 1]! : { role: 'assistant', text: '', toolUses: [] };
    for (const b of blocks) {
      if (b.type === 'text' && b.text) msg.text = msg.text ? `${msg.text}\n${b.text}` : b.text;
      if (b.type === 'tool_use') msg.toolUses.push({ tool_use_id: b.id!, tool: b.name!, input: b.input ?? {} });
    }
    if (!same) messages.push(msg);
    lastAssistantId = e.message.id;
    continue;
  }
  lastAssistantId = undefined;
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n');
  const toolResults: ToolResult[] = blocks
    .filter((b) => b.type === 'tool_result')
    .map((b) => ({ tool_use_id: b.tool_use_id!, text: resultText(b.content), isError: !!b.is_error }));
  const msg: Message = { role: 'user', text, toolUses: [] };
  if (toolResults.length) msg.toolResults = toolResults;
  if (text || toolResults.length) messages.push(msg);
}
// The engine attaches each result to its call; do the same.
const results = new Map(messages.flatMap((m) => m.toolResults ?? []).map((r) => [r.tool_use_id, r]));
for (const m of messages) for (const t of m.toolUses as ToolUse[]) {
  const r = results.get(t.tool_use_id);
  if (r) Object.assign(t, { text: r.text, isError: r.isError });
}

const client = new JevClient({ apiKey, ...(baseUrl ? { baseUrl } : {}) });
const result = await compact(messages, client, {
  ...(options as object),
  stubDroppedCalls: !args.includes('--no-stubs'),
});

const byId = new Map(messages.flatMap((m) => m.toolUses).map((t) => [t.tool_use_id, t]));
console.log(`segment ${segmentNo}/${segments.length}: ${messages.length} messages, ${result.stats.calls} tool calls`);
console.log(`endpoint: ${baseUrl ?? 'System One'} · keepThreshold ${options['keepThreshold'] ?? 0.5}\n`);
console.log('id    action        call  result  chars   tool  input');
const { collectToolCalls } = await import('../src/state.js');
const calls = new Map(collectToolCalls(messages, (options['preserveRecentMessages'] as number) ?? 6).map((c) => [c.id, c]));
for (const d of result.decisions) {
  const c = calls.get(d.id)!;
  const input = JSON.stringify(byId.get(c.tool_use_id)?.input ?? {}).slice(0, 70);
  const pinned = d.reason === 'pinned';
  console.log(
    `${d.id.padEnd(5)} ${(pinned ? 'keep (pinned)' : d.action).padEnd(13)} ${pinned ? '  -  ' : d.keepCall.toFixed(2)}  ${pinned ? '  -   ' : d.keepResult.toFixed(2)}  ${String(c.resultChars).padStart(6)}  ${d.tool}  ${input}`,
  );
}
const s = result.stats;
console.log(
  `\n${Math.round(reductionRatio(result) * 100)}% smaller (${s.charsBefore} → ${s.charsAfter} chars), messages ${s.messagesBefore} → ${s.messagesAfter}; ` +
    `${s.kept} kept, ${s.resultsDropped} truncated, ${s.callsDropped} dropped, ${s.pinned} pinned; ${s.requests} Jev request(s) in ${s.ms} ms`,
);
const min = (options['minReductionRatio'] as number) ?? 0.25;
console.log(reductionRatio(result) < min ? `→ below the ${min} minimum: /compact would fall back to the built-in summary` : '→ /compact would replace the history with this');

const out = flag('--out');
if (out) {
  const render = (m: Message) =>
    [
      `### ${m.role}`,
      m.text,
      ...m.toolUses.map((t) => `→ ${t.tool} ${JSON.stringify(t.input).slice(0, 300)}`),
      ...(m.toolResults ?? []).map((r) => `← result (${r.text.length} chars)\n${r.text}`),
    ]
      .filter(Boolean)
      .join('\n');
  writeFileSync(out, result.messages.map(render).join('\n\n'));
  console.log(`compacted transcript written to ${out}`);
}
