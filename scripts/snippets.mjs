#!/usr/bin/env node
// Runs the docs' examples against a real Intent Studio and fails on any difference from what the
// pages show. The examples live in the MDX itself:
//
//   ```sh run=quickstart                  a command, run in order in one bash session per suite
//   ```sh run=cli exit=1                  a command the page shows failing: it must end with that status
//   ```sh run=cli stderr=1                its standard error is part of its output (an `error:` line)
//   ```text output=ops match=lines        a stream: every line shown must arrive, in any order
//   ```http output=quickstart             what the command before it prints; compared after
//                                          normalising ids, times, secrets and hashes
//   ```sh title="deploy.sh" run=ops file=deploy.sh   written to deploy.sh in the current directory
//   {/* snippet ops: snippets/deploy.sh */}   a script sourced at that point
//
// Every suite runs in one bash session, in the order of SUITES (later suites use what earlier ones
// export, such as INTENT_BASE); a page's blocks run in document order. A block with
// `step=NAME` in its info string can be left out with `--skip NAME`.
//
//   node scripts/snippets.mjs                       check every suite (CI: the quick start's own
//                                                   install block brings the stack up, PostgreSQL
//                                                   included, with Docker Compose)
//   node scripts/snippets.mjs --base http://127.0.0.1:58660 --skip stack,install
//                                                   against a stack already running elsewhere,
//                                                   on your own port band
//   node scripts/snippets.mjs --update ...          write what ran into the pages' output blocks
//   node scripts/snippets.mjs --list                print the steps without running them
//   node scripts/snippets.mjs --coverage            count every code block: run, a checked output,
//                                                   or `not-run="reason"`; fails on any other block
//
// Addresses. Hosted pages show https://studio.example.com, a reserved domain (RFC 2606). The pages
// that run on this machine show the server's own default address, http://127.0.0.1:59400 — the same
// port INTENT_BIND defaults to. PostgreSQL is not mapped: `stack.sh env` prints its real address
// (127.0.0.1:59432 locally) for both shown and run text.
//
// At run time the shown address is swapped for the real one with --base, so a developer's allotted
// port band is honoured and the outputs compare equal either way. The suite's own bash session
// starts with INTENT_BIND and INTENT_BASE set to the band address, so the server the examples
// start binds the band while the page keeps showing the product's default — a reader on a free
// machine runs exactly what the page shows.
//
// A block that can't run here (a systemd unit, a Cloudflare step, a shape rather than a command)
// says so in its info string, `not-run="why"`, so the gap is counted and visible, never silent. One
// that could run but isn't wired up yet says `not-run="todo: why"`, and is counted apart.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const DOCS = join(ROOT, 'src/content/docs');
/**
 * The address pages show. Examples use https://studio.example.com, a domain reserved for examples
 * (RFC 2606); the local pages show http://127.0.0.1:59400, the API's own default listen address,
 * where the reader really runs it.
 */
export const EXAMPLE_BASE = 'https://studio.example.com';
const DEFAULT_BASE = 'http://127.0.0.1:59400';

const LOCAL_PAGES = /content\/docs\/quick-start\.mdx$|content\/docs\/self-hosting\//;
/** The address a page shows its examples with. */
export const shownBase = (file) => (LOCAL_PAGES.test(file ?? '') ? DEFAULT_BASE : EXAMPLE_BASE);
/** Suites in the order they run; later suites build on the state earlier ones leave. */
const SUITES = ['quickstart', 'ops'];

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
	const at = args.indexOf(`--${name}`);
	return at === -1 ? fallback : args[at + 1];
};
const base = option('base', DEFAULT_BASE);

const skip = new Set((option('skip', '') || '').split(',').filter(Boolean));
const only = option('suite', '');
const workdir = resolve(option('cwd', join(ROOT, '.snippets/work')));

/** The host:port form a flag like --listen takes: no scheme, but the same shown address. */
const hostPort = (url) => new URL(url).host;

/** A {shown, real} pair; real may be a string or a thunk read at call time (tests pass their own). */
const realOf = ({ real }) => (typeof real === 'function' ? real() : real);

/**
 * Full-URL shown→real pairs: the reserved example name on hosted pages, and the product's default
 * listen address on the local ones.
 */
export const MAPPINGS = [
	{ shown: EXAMPLE_BASE, real: () => base },
	{ shown: DEFAULT_BASE, real: () => base },
];
/** The pairs whose host:port and bare-port forms are also rewritten: loopback only — an https
 *  origin's bare port is empty, and a bare `studio.example.com` would match inside
 *  `pay.studio.example.com`. */
const localOf = (mappings) => mappings.filter(({ shown }) => new URL(shown).hostname === '127.0.0.1');

/** Tenant names must be unique, and a created one outlives a run, so the page's `acme-plumbing`
 * runs as a fresh name each time — a second run would otherwise hit the taken-name refusal. */
const SHOWN_SLUG = 'acme-plumbing';
const RUN_SLUG = `acme-plumbing-${process.pid}`;

/** The page's install step, verbatim: a reader clones the product's default branch. */
const PRODUCT_CLONE = 'git clone --depth 1 https://github.com/akira-shirase-oss/intent-studio';
/** A run may need another ref — CI follows the milestone branch until it merges — while the page
 * keeps telling the reader to clone the product. */
const PRODUCT_REF = process.env.INTENT_STUDIO_REF;

/**
 * A block's code as it runs: the example domain and the shown local address become the stack's.
 * Full URLs first, then the host:port form (`INTENT_BIND=127.0.0.1:59400`), then the bare port
 * whole-word — ordered longest-first so no replacement produces a later search string. A port like
 * 59400 could collide with a number in prose, but only code blocks are rewritten.
 */
export const runnable = (code, mappings = MAPPINGS, slug = RUN_SLUG) => {
	let out = code;
	for (const entry of mappings) out = out.replaceAll(entry.shown, realOf(entry));
	for (const entry of localOf(mappings)) out = out.replaceAll(hostPort(entry.shown), hostPort(realOf(entry)));
	for (const entry of localOf(mappings)) out = out.replace(new RegExp(`\\b${new URL(entry.shown).port}\\b`, 'g'), new URL(realOf(entry)).port);
	if (PRODUCT_REF) out = out.replaceAll(PRODUCT_CLONE, `${PRODUCT_CLONE} --branch ${PRODUCT_REF}`);
	return out.replaceAll(SHOWN_SLUG, slug);
};

// ---------------------------------------------------------------- reading the pages

function mdxFiles(dir) {
	return readdirSync(dir)
		.flatMap((name) => {
			const path = join(dir, name);
			return statSync(path).isDirectory() ? mdxFiles(path) : path.endsWith('.mdx') ? [path] : [];
		})
		.sort();
}

// The indent is spaces and tabs only: `\s` would let a match start on the blank line before a fence and
// then look for a closing fence after a blank line too, swallowing the blocks in between.
const FENCE = /^([ \t]*)(`{3,})([\w-]*)([^\n]*)\n([\s\S]*?)\n\1\2[ \t]*$/gm;
/** Every fenced block in a page's text: `[indent, fence, lang, info, body]` per match. */
export const fences = (text) => [...text.matchAll(FENCE)];
const COMMENT = /\{\/\*\s*snippet\s+([\w-]+):\s*(\S+)((?:\s+[^\s*]\S*)*)\s*\*\/\}/g;
// A key starts the info string or follows a space, so `run=` never matches inside `not-run=`.
const meta = (text, key) => text.match(new RegExp(`(?:^|\\s)${key}=("([^"]*)"|\\S+)`))?.[2] ?? text.match(new RegExp(`(?:^|\\s)${key}=(\\S+)`))?.[1];

/** Every step of every suite, in document order. */
function readSteps() {
	const steps = [];
	for (const file of mdxFiles(DOCS)) {
		const text = readFileSync(file, 'utf8');
		const found = [];
		for (const match of text.matchAll(FENCE)) {
			const [, indent, , lang, info, body] = match;
			const run = meta(info, 'run');
			const output = meta(info, 'output');
			if (!run && !output) continue;
			const code = body
				.split('\n')
				.map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
				.join('\n');
			found.push({ at: match.index, kind: run ? 'run' : 'output', suite: run ?? output, lang, info, code, file, start: match.index, end: match.index + match[0].length, indent });
		}
		for (const match of text.matchAll(COMMENT)) {
			found.push({ at: match.index, kind: 'script', suite: match[1], path: match[2], args: (match[3] ?? '').trim(), file });
		}
		found.sort((a, b) => a.at - b.at);
		for (const step of found) {
			if (step.kind === 'output') {
				const previous = steps.findLast((candidate) => candidate.suite === step.suite);
				if (!previous || previous.kind !== 'run' || previous.expect) throw new Error(`${relative(ROOT, file)}: an output block with no command before it`);
				previous.expect = step;
			} else {
				steps.push(step);
			}
		}
	}
	for (const step of steps) if (!SUITES.includes(step.suite)) throw new Error(`${relative(ROOT, step.file)}: unknown suite "${step.suite}"`);
	return steps;
}

// ---------------------------------------------------------------- normalising output

/** Split `curl -i` output into its head and body; anything else is all body. */
function split(text) {
	const normal = text.replace(/\r\n/g, '\n');
	if (/^HTTP\/[\d.]+ \d{3}/.test(normal)) {
		const at = normal.indexOf('\n\n');
		return at === -1 ? { head: normal.trimEnd(), body: '' } : { head: normal.slice(0, at), body: normal.slice(at + 2) };
	}
	return { head: null, body: normal };
}

/** JSON bodies are compared by value, and shown indented. */
function jsonBody(body) {
	const trimmed = body.trim();
	if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
	try {
		return JSON.parse(trimmed);
	} catch {
		return null;
	}
}

/** A JSON body indented, with every number exactly as the server wrote it (`45.0` stays `45.0`). */
function indent(body) {
	try {
		const exact = JSON.parse(body.trim(), (key, value, context) => (typeof value === 'number' ? JSON.rawJSON(context.source) : value));
		return JSON.stringify(exact, null, 2);
	} catch {
		return null;
	}
}


/** A credential the page must never spell out: a live session cookie value or a password hash.
 * The page writes `intent_operator=…`, and normalise() maps the real value to the same elision so
 * the comparison still proves the field was there and shaped right. */
const SECRET = /\b((?:__Host-)?intent_operator=)[^;\s]+|\$argon2[^\s"']*/g;
const mask = (text) => text.replace(SECRET, '$1…');

/** What the page shows: headers as they came, a JSON body indented, local addresses as the page writes them, secrets elided. */
export function display(text, file) {
	const local = LOCAL_PAGES.test(file ?? '');
	let swapped = text.replaceAll(RUN_SLUG, SHOWN_SLUG);
	for (const entry of MAPPINGS) swapped = swapped.replace(new RegExp(escape(realOf(entry)), 'g'), local ? shownLocalOf(entry.shown) : hostedOf(entry.shown));
	const { head, body } = split(swapped);
	const json = jsonBody(body);
	const shownBody = json === null ? mask(body.trimEnd()) : (indent(mask(body)) ?? JSON.stringify(json, null, 2));
	return head === null ? shownBody : shownBody === '' ? mask(head) : `${mask(head)}\n\n${shownBody}`;
}

/** What a local page shows for an origin whose real address was substituted. */
const shownLocalOf = (shown) => (shown === EXAMPLE_BASE ? DEFAULT_BASE : shown);

/** The hosted form of a shown address: the API on its example name. */
const hostedOf = (shown) => (shown === DEFAULT_BASE || shown === EXAMPLE_BASE ? EXAMPLE_BASE : shown);

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What is compared: values that differ on every run become placeholders. */
export function normalise(text) {
	let swapped = text.replaceAll(RUN_SLUG, SHOWN_SLUG);
	for (const entry of MAPPINGS) swapped = swapped.replace(new RegExp(escape(realOf(entry)), 'g'), `<${name(entry.shown)}>`);
	for (const { shown } of MAPPINGS) swapped = swapped.replaceAll(shown, `<${name(shown)}>`);
	swapped = swapped.replaceAll(workdir, '<work>');
	const { head, body } = split(swapped);
	const json = jsonBody(body);
	const flatBody = json === null ? body.trim() : JSON.stringify(json);
	const all = mask(`${head ?? ''}\n\n${flatBody}`)
		.replace(/"(id|tenant|tenant_id|fact|fact_id|brief|brief_id|asset|asset_id|site|site_id|session|secret|password_hash|operator|lead|lead_id|hash)":\s*"[^"]*?"/g, '"$1":"<id>"')
		.replace(/\bin \d+m?s\b/g, 'in <n>ms') // npm's "added 1 package … in 128ms"
		.replace(/"(created_at|updated_at|approved_at|withdrawn_at|received_at|notified_at|deadline|epoch|seq|attempts|count|total|uncertain|pending|sent|failed|dead|retry_after|line_count|from|to)":\s*\d+/g, '"$1":<n>')
		.replace(/\b[0-9a-f]{64}\b/g, '<hex64>') // generated keys (openssl rand -hex 32), raw secrets
		.replace(/"(finished_at|expires_at|created_at|circuit_open_until)":\s*"?\d{4}-?\d\d-?\d\d[^",\s]*"?/g, '"$1":"<time>"')
		.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<uuid>')
		.replace(/\b[0-9a-f]{32}\b/g, '<hex32>')
		.replace(/sha256:[0-9a-f]{64}/g, 'sha256:<hash>')
		.replace(/\b[0-9a-f]{40}\b/g, '<commit>')
		.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, '<time>')
		.replace(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:?\d\d)?/g, '<time>')
		.replace(/^date: .*$/gim, 'date: <date>')
		.replace(/^content-length: \d+$/gim, 'content-length: <n>')
		.replace(/^retry-after: \d+$/gim, 'retry-after: <seconds>')
		.replace(/^(set-cookie: .*(?:__Host-)?intent_operator=)[^;]+/gim, '$1<session>')
		.replace(/\(commit [^,)]+, built \d{4}-\d\d-\d\d\)/g, '(commit <commit>, built <day>)')
		.replace(/[ \t]+$/gm, '');
	return all.trim();
}

const name = (shown) => (shown === EXAMPLE_BASE || shown === DEFAULT_BASE ? 'base' : 'other');

/**
 * Whether what ran matches the page's output block. Normally the whole normalised text must be equal. With
 * `match=lines` (a stream, whose frames a server may merge or add to), every line the page shows must be
 * among the lines that arrived, in any order: the page shows real frames, and losing one still fails.
 */
export function matches(actual, expect) {
	if (meta(expect.info ?? '', 'match') !== 'lines') return normalise(actual) === normalise(expect.code);
	const seen = new Set(normalise(actual).split('\n'));
	return normalise(expect.code)
		.split('\n')
		.filter((line) => line.trim() !== '')
		.every((line) => seen.has(line));
}

// ---------------------------------------------------------------- running a suite

function runAll(steps) {
	const dir = join(ROOT, '.snippets', 'run');
	mkdirSync(dir, { recursive: true });
	mkdirSync(workdir, { recursive: true });
	// Aliases work as in an interactive shell (the CLI page defines one), so each block is sourced
	// from its own file: a later line sees what an earlier one defined.
	const lines = [
		'set -euo pipefail',
		'shopt -s expand_aliases',
		// However the run ends — a failing step, an early stop — the servers and handlers it
		// started are its own children; reap them so a stopped suite never leaves a stale port.
		"trap 'kill $(jobs -p) 2>/dev/null || true' EXIT",
		`cd ${JSON.stringify(workdir)}`,
		`export BASE=${JSON.stringify(base)}`,
		`export SNIPPET_HOME=${JSON.stringify(workdir)}`,
		// The band, in the product's own variables: the servers the examples start bind these,
		// while the page keeps showing the defaults a reader would use.
		`export INTENT_BIND=${JSON.stringify(hostPort(base))}`,
		`export INTENT_BASE=${JSON.stringify(base)}`,
	];
	steps.forEach((step, index) => {
		const out = join(dir, `${index}.out`);
		const marker = `echo "=== step ${index}: ${relative(ROOT, step.file)}" >&2`;
		if (step.kind === 'script') {
			// A script may read what the command before it printed, as $SNIPPET_LAST.
			const last = steps.slice(0, index).findLast((earlier) => earlier.kind === 'run' && !meta(earlier.info, 'file'));
			const lastOut = last ? join(dir, `${steps.indexOf(last)}.out`) : '/dev/null';
			lines.push(marker, `export SNIPPET_LAST=${JSON.stringify(lastOut)}`, `source ${JSON.stringify(join(ROOT, step.path))}${step.args ? ` ${step.args}` : ''}`);
			return;
		}
		const code = runnable(step.code);
		const file = meta(step.info, 'file');
		if (file) {
			lines.push(marker, `cat > ${JSON.stringify(file)} <<'DOCS_SNIPPET_EOF'`, code, 'DOCS_SNIPPET_EOF');
			return;
		}
		if (skip.has(meta(step.info, 'step') ?? '')) {
			lines.push(`echo "=== step ${index}: skipped (${meta(step.info, 'step')})" >&2`);
			return;
		}
		const source = join(dir, `${index}.sh`);
		writeFileSync(source, `${code}\n`);
		// `exit=N`: a command the page shows failing; it must end with that status. `stderr=1`: what
		// it prints on standard error is part of its output too (an `error:` line, a summary).
		const expected = meta(step.info, 'exit');
		const streams = meta(step.info, 'stderr') === '1' ? ' 2>&1' : '';
		if (expected === undefined) {
			lines.push(marker, `source ${JSON.stringify(source)} > ${JSON.stringify(out)}${streams}`);
		} else {
			lines.push(
				marker,
				'set +e',
				`source ${JSON.stringify(source)} > ${JSON.stringify(out)}${streams}`,
				'__status=$?',
				'set -e',
				`[[ $__status == ${Number(expected)} ]] || { echo "step ${index}: exit $__status, the page says ${Number(expected)}" >&2; cat ${JSON.stringify(out)} >&2; exit 1; }`,
			);
		}
	});
	const script = join(dir, 'suite.sh');
	writeFileSync(script, `${lines.join('\n')}\n`);
	const result = spawnSync('bash', [script], { stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
	if (result.status !== 0) {
		console.error(`snippets: the run stopped (exit ${result.status}); its script is ${relative(ROOT, script)}`);
		return false;
	}
	let ok = true;
	steps.forEach((step, index) => {
		if (step.kind !== 'run' || !step.expect) return;
		// A step skipped this run leaves no .out; its output stays unchecked rather than "empty".
		if (skip.has(meta(step.info, 'step') ?? '')) return;
		const outFile = join(dir, `${index}.out`);
		// A suite that stopped early leaves no .out for the steps it never reached — count them
		// as differences (the run already failed) instead of crashing on the missing file.
		const actual = statSync(outFile, { throwIfNoEntry: false }) ? readFileSync(outFile, 'utf8') : '';
		step.actual = actual;
		// Masking maps a real credential to its elision on BOTH sides, so a block written before a
		// mask existed would match while still leaking the secret. The page must never carry one.
		if (SECRET.test(step.expect.code)) {
			ok = false;
			console.error(`snippets: ${relative(ROOT, step.file)}: an output block carries an unmasked credential — write intent_operator=… instead`);
		}
		if (!matches(actual, step.expect)) {
			ok = false;
			console.error(`\nsnippets: ${relative(ROOT, step.file)}: the output differs from the page for:\n${step.code}\n--- the page (normalised)\n${normalise(step.expect.code)}\n--- the server (normalised)\n${normalise(actual)}\n`);
		}
	});
	return ok;
}

function update(steps) {
	const byFile = new Map();
	for (const step of steps) {
		// Only blocks whose output really differs are rewritten, so ids and dates don't churn.
		if (step.kind === 'run' && step.expect && step.actual !== undefined && !skip.has(meta(step.info, 'step') ?? '') && !matches(step.actual, step.expect)) {
			const list = byFile.get(step.file) ?? [];
			list.push(step.expect.end === undefined ? null : step);
			byFile.set(step.file, list);
		}
	}
	for (const [file, list] of byFile) {
		let text = readFileSync(file, 'utf8');
		for (const step of list.sort((a, b) => b.expect.start - a.expect.start)) {
			const { indent, info, lang, start, end } = step.expect;
			const fence = '```';
			const body = display(step.actual, step.file)
				.split('\n')
				.map((line) => (line === '' ? '' : `${indent}${line}`))
				.join('\n');
			text = `${text.slice(0, start)}${indent}${fence}${lang}${info}\n${body}\n${indent}${fence}${text.slice(end)}`;
		}
		writeFileSync(file, text);
		console.log(`snippets: wrote ${list.length} output block(s) into ${relative(ROOT, file)}`);
	}
}

// ---------------------------------------------------------------- coverage

/** Every fenced block on every page, by what happens to it. */
export function coverage() {
	const pages = [];
	for (const file of mdxFiles(DOCS)) {
		const text = readFileSync(file, 'utf8');
		const page = { file: relative(DOCS, file), run: 0, output: 0, notRun: 0, todo: 0, unmarked: [] };
		for (const match of text.matchAll(FENCE)) {
			const info = match[4];
			if (meta(info, 'run')) page.run++;
			else if (meta(info, 'output')) page.output++;
			else if (meta(info, 'not-run')?.startsWith('todo:')) page.todo++;
			else if (meta(info, 'not-run')) page.notRun++;
			else page.unmarked.push(text.slice(0, match.index).split('\n').length);
		}
		if (page.run + page.output + page.notRun + page.todo + page.unmarked.length > 0) pages.push(page);
	}
	return pages;
}

function printCoverage() {
	const pages = coverage();
	const sum = (key) => pages.reduce((total, page) => total + (Array.isArray(page[key]) ? page[key].length : page[key]), 0);
	for (const page of pages) {
		console.log(`${page.file.padEnd(36)} run ${String(page.run).padStart(3)}  output ${String(page.output).padStart(3)}  not-run ${String(page.notRun).padStart(3)}  todo ${String(page.todo).padStart(3)}${page.unmarked.length ? `  UNMARKED at lines ${page.unmarked.join(', ')}` : ''}`);
	}
	const all = sum('run') + sum('output') + sum('notRun') + sum('todo') + sum('unmarked');
	console.log(`snippets coverage: ${all} blocks; ${sum('run')} run, ${sum('output')} outputs checked, ${sum('notRun')} can't run here (with a reason), ${sum('todo')} could run but aren't wired yet (not-run="todo: …"), ${sum('unmarked')} unmarked`);
	process.exit(sum('unmarked') > 0 ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();

function main() {
	if (flag('coverage')) printCoverage();
	const steps = readSteps();
	const suites = SUITES.filter((name) => (only ? name === only : true)).map((name) => [name, steps.filter((step) => step.suite === name)]);
	if (flag('list')) {
		for (const [name, list] of suites) {
			console.log(`${name}: ${list.length} steps`);
			for (const step of list) console.log(`  ${step.kind.padEnd(6)} ${relative(ROOT, step.file)} ${step.kind === 'script' ? step.path : (step.code.split('\n')[0] ?? '').slice(0, 100)}${step.expect ? '  [checked]' : ''}`);
		}
		process.exit(0);
	}
	const ordered = suites.flatMap(([name, list]) => {
		if (list.length > 0) console.log(`snippets: suite ${name}, ${list.length} steps`);
		return list;
	});
	const failed = !runAll(ordered);
	if (flag('update')) update(steps);
	const checked = steps.filter((step) => step.expect && step.actual !== undefined).length;
	console.log(`snippets: ${checked} outputs checked${failed ? ', with differences' : ', all match'}`);
	process.exit(failed && !flag('update') ? 1 : 0);
}
