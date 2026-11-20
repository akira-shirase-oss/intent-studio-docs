// The snippets engine's own tests — the same cases that guard its promise: ids, secrets, times and
// hashes normalise away, shown addresses map onto the band under test, and a real difference still
// fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalise, matches, runnable, display, fences, shownBase, EXAMPLE_BASE } from './snippets.mjs';

const execFileAsync = promisify(execFile);

// A mapping with the band under test as `real`, as --base … would build it at run time.
const BAND = [
	{ shown: 'https://studio.example.com', real: 'http://127.0.0.1:58660' },
	{ shown: 'http://127.0.0.1:59400', real: 'http://127.0.0.1:58660' },
];

test('the example domain becomes the stack under test', () => {
	const code = runnable(`curl -i ${EXAMPLE_BASE}/v1/operator/leads`, BAND);
	assert.equal(code, 'curl -i http://127.0.0.1:58660/v1/operator/leads');
});

test('the local shown address becomes the band under test', () => {
	const code = runnable('curl -s http://127.0.0.1:59400/healthz', BAND);
	assert.equal(code, 'curl -s http://127.0.0.1:58660/healthz');
});

test('the scheme-less form a flag takes is rewritten too', () => {
	const bare = runnable('INTENT_BIND=127.0.0.1:59400 ./intent-server serve', BAND);
	assert.equal(bare, 'INTENT_BIND=127.0.0.1:58660 ./intent-server serve');
	// A port-shaped number that isn't the shown port stays literal.
	assert.equal(runnable('port=59401', BAND), 'port=59401');
});

test('the shown tenant name runs as a fresh one', () => {
	const code = runnable('curl -X POST /v1/operator/tenants -d \'{"name":"acme-plumbing"}\'', BAND);
	assert.match(code, /acme-plumbing-\d+/);
});

test('a run follows INTENT_STUDIO_REF while the page still clones the product', async () => {
	const self = new URL('./snippets.mjs', import.meta.url).pathname;
	const clone = 'git clone --depth 1 https://github.com/akira-shirase-oss/intent-studio';
	const { stdout } = await execFileAsync(
		process.execPath,
		['--input-type=module', '-e', `import { runnable } from '${self}'; console.log(runnable('${clone}'));`],
		{ env: { ...process.env, INTENT_STUDIO_REF: 'devin/intent-studio-next' } },
	);
	assert.equal(stdout.trim(), `${clone} --branch devin/intent-studio-next`);
});

test('JSON outputs compare as values — key order is not the shape', () => {
	// The CI failure: the server wrote the same fields in a different order.
	const page = {
		code: '{\n  "valid": true,\n  "brief_revision": 1,\n  "component_set": "quote-request@0",\n  "lint": "claim-lint v1",\n  "facts_checked": 0\n}',
	};
	assert.ok(
		matches('{"brief_revision":1,"component_set":"quote-request@0","facts_checked":0,"lint":"claim-lint v1","valid":true}', page),
		'reordered keys, same values',
	);
	assert.ok(
		!matches('{"brief_revision":2,"component_set":"quote-request@0","facts_checked":0,"lint":"claim-lint v1","valid":true}', page),
		'a changed value still fails — the diff report prints both normalised sides',
	);
	assert.ok(!matches('[1,2]', { code: '[2,1]' }), 'array order stays part of the shape');
	assert.ok(!matches('{"a":1,"b":2}', { code: '{"a":1}' }), 'a missing key still fails');
	assert.ok(
		matches('migrations applied', { code: 'migrations applied' }) && !matches('migrations applied', { code: 'migrations refused' }),
		'plain text still compares as text',
	);
});

test('an id, a session and a timestamp all normalise', () => {
	const a = normalise('{"id":"019a0000-0000-7000-8000-000000000000","name":"acme","created_at":"2026-11-18T10:00:00Z"}');
	const b = normalise('{"id":"019a9999-9999-7000-8000-999999999999","name":"acme","created_at":"2026-11-18T11:00:00Z"}');
	assert.equal(a, b, "the uuid and the timestamp differ run to run, the shape doesn't");
	const c = normalise('{"id":"x","name":"other","created_at":"2026-11-18T10:00:00Z"}');
	assert.notEqual(a, c, 'a real difference still fails');
});

test('a session cookie and a password hash normalise to their elisions', () => {
	assert.equal(normalise('set-cookie: intent_operator=9f2c1a4b7e8d0a3b6c5d4e3f; HttpOnly'), 'set-cookie: intent_operator=<session>; HttpOnly');
	assert.equal(normalise('set-cookie: __Host-intent_operator=abcdef0123456789; Secure'), 'set-cookie: __Host-intent_operator=<session>; Secure');
	assert.equal(normalise('hash: $argon2id$v=19$m=19456,t=2,p=1$abc$def'), 'hash: …');
	assert.notEqual(normalise('{"ok":true}'), normalise('{"ok":false}'));
});

test('JSON bodies compare by value, not by formatting', () => {
	assert.equal(normalise('{"a":{"x":[2,3]},"b":1}'), normalise('{\n  "a": {\n    "x": [2, 3]\n  },\n  "b": 1\n}'));
	assert.notEqual(normalise('{"v":45}'), normalise('{"v":46}'));
});

test('curl -i heads compare with dates and lengths stripped', () => {
	const one = normalise('HTTP/1.1 200 OK\ndate: Mon, 17 Nov 2026 10:00:00 GMT\ncontent-length: 12\n\n{"ok":true}');
	const two = normalise('HTTP/1.1 200 OK\ndate: Tue, 18 Nov 2026 10:00:01 GMT\ncontent-length: 99\n\n{"ok":true}');
	assert.equal(one, two);
});

test('match=lines accepts a stream whose order differs', () => {
	const expect = { code: '{"event":1}\n{"event":2}', info: 'match=lines' };
	assert.ok(matches('{"event":2}\n{"event":1}\n{"event":3}', expect), 'shown lines all arrived, in any order');
	assert.ok(!matches('{"event":1}', expect), 'a shown line that never arrived still fails');
});

test('display maps a real address back to what the page shows', () => {
	const got = display('HTTP/1.1 200 OK\n\n{"webhook_url":"http://127.0.0.1:59400/hook"}', 'src/content/docs/quick-start.mdx');
	assert.match(got, /127\.0\.0\.1:59400\/hook/);
	const hosted = display('{"url":"http://127.0.0.1:59400"}', 'src/content/docs/concepts.mdx');
	assert.match(hosted, /studio\.example\.com/);
});

test('a code fence inside indented markdown is still a block, not prose', () => {
	const page = `1. Step\n\n   \`\`\`sh run=quickstart\n   curl http://127.0.0.1:59400/healthz\n   \`\`\``;
	assert.equal(fences(page).length, 1);
});

test('coverage kinds are read from the info string, not inside other keys', () => {
	const page = `\`\`\`sh run=quickstart\ncurl example\n\`\`\`\n\`\`\`json output=quickstart\n{}\n\`\`\`\n\`\`\`text not-run="a systemd unit"\n[Unit]\n\`\`\`\n\`\`\`python\nprint("oops")\n\`\`\``;
	const kinds = fences(page).map((m) => (m[4].includes('not-run') ? 'not-run' : m[4].match(/(?:^|\s)run=/) ? 'run' : m[4].includes('output=') ? 'output' : 'unmarked'));
	assert.deepEqual(kinds, ['run', 'output', 'not-run', 'unmarked']);
});

test('shownBase picks the address a page pretends to use', () => {
	assert.equal(shownBase('src/content/docs/quick-start.mdx'), 'http://127.0.0.1:59400');
	assert.equal(shownBase('src/content/docs/self-hosting/configuration.mdx'), 'http://127.0.0.1:59400');
	assert.equal(shownBase('src/content/docs/concepts.mdx'), EXAMPLE_BASE);
});
