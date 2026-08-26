import { describe, expect, it } from 'vitest';

import { useCookies } from './cookies.svelte.ts';
import type { StandardSchemaV1 } from './standard-schema.ts';

/**
 * Regression tests for the `'value' in result` discriminator bug: at least Valibot's
 * `~standard.validate()` sets an own `value` property on *both* success and failure results
 * (`undefined` for a top-level type mismatch, the echoed-back input for a field-level issue),
 * so `'value' in result` was always true and never actually detected a failure. These fake
 * schemas reproduce both of Valibot's real shapes directly, without depending on Valibot itself.
 */
describe('useCookies — failure result handling', () => {
	it('falls back to the schema default instead of throwing when the cache is undefined', () => {
		// Mirrors validating `undefined` against a Valibot object schema: `value` is present as
		// an own key, just `undefined` — this is exactly what broke the old check.
		const schema: StandardSchemaV1<{ enabled: boolean }> = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate(input) {
					if (typeof input !== 'object' || input === null) {
						return { issues: [{ message: 'expected object' }], value: undefined };
					}
					const record = input as Record<string, unknown>;
					const enabled = 'enabled' in record ? record.enabled : true;
					return { value: { enabled: enabled as boolean }, issues: undefined };
				}
			}
		};

		// A not-yet-resolved SSR payload — the exact shape that reached this package's `Cookies`
		// constructor and reproduced the crash.
		// @ts-expect-error — deliberately exercising the "cookies argument missing" case.
		const cookies = useCookies(schema, undefined);

		expect(() => cookies.enabled).not.toThrow();
		expect(cookies.enabled).toBe(true);
	});

	it('drops an invalid write instead of persisting it and crashing the next read', () => {
		// Mirrors a Valibot field-level issue: `value` is present (the echoed-back, still-
		// invalid input) and `path` entries are `{ key }` objects, not raw strings.
		const schema: StandardSchemaV1<{ enabled: boolean }> = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate(input) {
					const record = (input ?? {}) as Record<string, unknown>;
					const hasEnabled = 'enabled' in record;
					const raw = hasEnabled ? record.enabled : true;
					if (typeof raw !== 'boolean') {
						return {
							issues: [{ message: 'expected boolean', path: [{ key: 'enabled' }] }],
							value: undefined
						};
					}
					return { value: { enabled: raw }, issues: undefined };
				}
			}
		};

		const cookies = useCookies(schema, { enabled: true });

		expect(() => {
			// @ts-expect-error — deliberately invalid for this schema.
			cookies.enabled = 'not-a-boolean';
		}).not.toThrow();
		// The write was rejected — the cache still holds the last valid value, not a value that
		// failed its own schema.
		expect(cookies.enabled).toBe(true);
	});
});
