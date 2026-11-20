// The route-sync check's own tests: the parser must find the server's routes and ignore its test
// module, and the comparison must fail in both directions (a route the spec forgot, and a path the
// spec invented).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serverRoutes, specRoutes, productionSource } from './check-openapi.mjs';

const ROUTER = `
fn router(app: App) -> Router {
	let router = Router::new()
		.route("/healthz", get(healthz))
		.route("/readyz", get(readyz))
		.route("/v1/sites/{site}/leads", post(intake::submit))
		.route("/v1/operator/session", post(sign_in).get(session).delete(sign_out))
		.route("/v1/operator/leads", get(inbox))
		.route("/v1/operator/tenants", get(tenants).post(create_tenant))
		.route("/v1/operator/tenants/{tenant}/briefs/{brief}", get(brief).put(revise_brief));
	router
}

#[cfg(test)]
mod tests {
	fn fake() {
		Router::new().route("/probe", axum::routing::post(post).get(probe));
	}
}
`;

test('the production route table parses, and the test module stays out', () => {
	const routes = serverRoutes(ROUTER);
	assert.equal(routes.length, 7);
	assert.deepEqual(
		routes.map(({ path }) => path),
		['/healthz', '/readyz', '/v1/sites/{site}/leads', '/v1/operator/session', '/v1/operator/leads', '/v1/operator/tenants', '/v1/operator/tenants/{tenant}/briefs/{brief}'],
	);
	assert.deepEqual(routes.find(({ path }) => path === '/v1/operator/session').methods, ['DELETE', 'GET', 'POST']);
	assert.ok(!routes.some(({ path }) => path === '/probe'), 'the test router must not be counted');
});

test('a route table without a test module parses whole', () => {
	const routes = serverRoutes(productionSource('Router::new().route("/healthz", get(healthz));'));
	assert.equal(routes.length, 1);
});

test('spec routes parse with their methods', () => {
	const routes = specRoutes({ paths: { '/v1/operator/tenants': { get: {}, post: {}, parameters: {} }, '/healthz': { get: {} } } });
	assert.deepEqual(
		routes.sort((a, b) => a.path.localeCompare(b.path)),
		[
			{ path: '/healthz', methods: ['GET'] },
			{ path: '/v1/operator/tenants', methods: ['GET', 'POST'] },
		],
	);
});
