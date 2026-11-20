// check-urls.mjs's contract: what a page may show a reader and what it must never.
import test from 'node:test';
import assert from 'node:assert/strict';
import { problems } from './check-urls.mjs';
import { runnable, MAPPINGS, shownBase, EXAMPLE_BASE } from './snippets.mjs';

const localPage = 'src/content/docs/quick-start.mdx';
const hostedPage = 'src/content/docs/workspace.mdx';

test('a hosted page shows the example domain and the docs site', () => {
	assert.deepEqual(problems(`curl ${EXAMPLE_BASE}/v1/operator/tenants and https://docs.intent-studio.404human.dev/workspace/`, hostedPage), []);
});

test('a local page shows loopback; a hosted page may not', () => {
	const local = 'curl http://127.0.0.1:59400/healthz';
	assert.deepEqual(problems(local, localPage), []);
	assert.equal(problems(local, hostedPage).length, 1);
});

test('private IPv4 addresses are never a shown address', () => {
	for (const url of ['http://10.0.0.4:59400/healthz', 'http://192.168.1.20/v1/operator/leads', 'https://172.16.0.9:59400']) {
		assert.equal(problems(`see ${url}`, hostedPage).length, 1, url);
	}
	assert.deepEqual(problems('the route 203.0.113.10 is an example', hostedPage), []); // TEST-NET-3 is documentation space
});

test('a URL with a credential-looking query parameter fails', () => {
	assert.equal(problems(`GET ${EXAMPLE_BASE}/v1/operator/leads?token=abc123`, hostedPage).length, 1);
});

test('0.0.0.0 fails everywhere — it is a listen address, not one to visit', () => {
	assert.equal(problems('curl http://0.0.0.0:59400/healthz', localPage).length, 1);
});

test('plain http off the local pages fails', () => {
	assert.equal(problems('see http://internal.example.org/v1/operator/leads', hostedPage).length, 1);
});

test('runnable() swaps the shown address for the stack’s real one', () => {
	assert.match(runnable(`curl ${EXAMPLE_BASE}/v1/operator/leads`), /^curl http:\/\/127\.0\.0\.1:\d+\/v1\/operator\/leads$/);
	assert.equal(shownBase(localPage), 'http://127.0.0.1:59400');
	assert.equal(shownBase(hostedPage), EXAMPLE_BASE);
});

test('the example domain pretends to serve only the server’s own paths', () => {
	assert.equal(problems(`open ${EXAMPLE_BASE}/admin/console`, hostedPage).length, 1);
	assert.deepEqual(problems(`open ${EXAMPLE_BASE}/workspace`, hostedPage), []);
	assert.deepEqual(problems(`open ${EXAMPLE_BASE}/v1/operator/session`, hostedPage), []);
});

test('MAPPINGS covers the hosted name and the local default', () => {
	const shown = MAPPINGS.map((m) => m.shown);
	assert.ok(shown.includes(EXAMPLE_BASE));
	assert.ok(shown.includes('http://127.0.0.1:59400'));
});
