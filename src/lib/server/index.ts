import type { Cookies } from '@sveltejs/kit';
import type { StandardSchemaV1 } from '../standard-schema.ts';

/** Cache to avoid repeated schema validation */
const schemaKeysCache = new WeakMap<StandardSchemaV1, string[]>();

/** Get top-level keys of a schema, cached for performance */
function getCachedKeys<Schema extends StandardSchemaV1>(schema: Schema): string[] {
	if (schemaKeysCache.has(schema)) return schemaKeysCache.get(schema)!;

	const result = schema['~standard'].validate({});
	const keys =
		result && 'value' in result ? Object.keys(result.value as Record<string, unknown>) : [];
	schemaKeysCache.set(schema, keys);
	return keys;
}

/**
 * Pick cookies that match the keys defined in a schema.
 *
 * Reads from a SvelteKit `Cookies` object and returns only the cookies
 * specified in the provided schema. Invalid JSON values are ignored.
 *
 * Can accept an optional `opts` object to pass to `cookies.get`.
 *
 * Intended for safely passing a subset of cookies (defined by schema)
 * from server code to client/SSR.
 *
 * @typeParam Schema - A `StandardSchemaV1` defining which cookie keys to include
 * @param cookies - The SvelteKit `Cookies` object
 * @param schema - The schema defining allowed cookie keys
 * @param opts - Options passed directly to [`cookie.parse`](https://github.com/jshttp/cookie#cookieparsestr-options)
 * @returns An object containing only the schema-defined cookies
 */
export function pickCookies<Schema extends StandardSchemaV1>(
	cookies: Cookies,
	schema: Schema,
	opts?: Parameters<Cookies['get']>[1]
) {
	const keys = getCachedKeys(schema);
	const picked: Partial<Record<string, unknown>> = {};

	for (const key of keys) {
		const encodedKey = encodeURIComponent(key)
			.replace(/%(2[346B]|5E|60|7C)/g, decodeURIComponent)
			.replace(/[()]/g, escape);

		const raw = cookies.get(encodedKey, opts);
		if (raw === undefined) continue;

		try {
			picked[key] = JSON.parse(raw);
		} catch {
			// ignore invalid JSON
		}
	}

	return picked as Partial<StandardSchemaV1.InferOutput<Schema>>;
}
