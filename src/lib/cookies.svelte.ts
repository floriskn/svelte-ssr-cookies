import { dequal } from 'dequal/lite';
import jsCookie from 'js-cookie';

import { extractSchemaInfo } from './schema.ts';
import { isFailureResult, issuePathHasKey, type StandardSchemaV1 } from './standard-schema.ts';

class Cookies<Schema extends StandardSchemaV1> {
	/** Schema used for validation and type conversion */
	#schema: Schema;

	/**
	 * Object with schema keys for quick existence checks
	 * Format: { key1: true, key2: true, ... }
	 */
	#schemaShape: Record<string, true>;

	/**
	 * Map of schema keys to encoder functions for custom serialization
	 */
	#codecEncoders: Map<string, (value: unknown) => unknown>;

	/** Local cache of cookie values */
	#cookies: StandardSchemaV1.InferOutput<Schema> = $state();

	/**
	 * Create a cookie manager for a schema and initial values.
	 *
	 * The `cookies` argument should originate from the server-side
	 * extractor and only contain schema-defined keys.
	 */
	constructor(schema: Schema, cookies: StandardSchemaV1.InferOutput<Schema>) {
		this.#schema = schema;
		// Deep-cloned, not taken by reference — `$state()` wraps whatever object it's given in
		// place, so without this, `#cookies` would stay aliased to the caller's own object for
		// this instance's entire lifetime. If that object is itself held onto and later mutated
		// or replaced by the caller (or by whatever framework machinery produced it — e.g. a
		// page/layout `data` prop that gets its own object identity swapped as part of routing),
		// those changes leak straight into this reactive cache without ever going through
		// `#setValue` — an unexplained value change with no `.set()`/`.update()` call anywhere to
		// account for it. Cloning here makes `#cookies` fully owned: nothing outside this class
		// can change it, and it can only ever change through this class's own methods.
		//
		// Never let the reactive cache itself be `undefined`/`null` either — every downstream
		// read treats it as a plain object (`Object.entries`, property access), and a caller
		// passing an undefined/partial `cookies` argument (e.g. cookie data that hasn't resolved
		// yet) shouldn't be able to crash every subsequent `.get()`/`.set()` call over it.
		this.#cookies = cookies
			? structuredClone(cookies)
			: ({} as StandardSchemaV1.InferOutput<Schema>);

		const schemaInfo = extractSchemaInfo(schema);

		// Build shape map for fast key checks
		this.#schemaShape = schemaInfo.keys.reduce(
			(acc, key) => {
				acc[key] = true;
				return acc;
			},
			{} as Record<string, true>
		);

		this.#codecEncoders = schemaInfo.codecEncoders;
	}

	/**
	 * Read a typed value for a schema key from the reactive cache.
	 *
	 * The value is validated against the schema before returning.
	 */

	get<K extends keyof StandardSchemaV1.InferOutput<Schema>>(
		key: K & string
	): StandardSchemaV1.InferOutput<Schema>[K] {
		return this.#getTypedValue(key) as StandardSchemaV1.InferOutput<Schema>[K];
	}

	/**
	 * Set a schema key.
	 *
	 * This updates the reactive cache and persists the cookie
	 * in the browser after validation.
	 */
	set<K extends keyof StandardSchemaV1.InferOutput<Schema>>(
		key: K & string,
		value: StandardSchemaV1.InferOutput<Schema>[K]
	): void {
		this.#setValue(key, value);
	}

	/**
	 * Set a schema key with explicit cookie attributes.
	 *
	 * This behaves like `set`, but allows passing cookie options
	 * such as expiry, path, or sameSite.
	 */
	update<K extends keyof StandardSchemaV1.InferOutput<Schema>>(
		key: K & string,
		value: StandardSchemaV1.InferOutput<Schema>[K],
		options?: Cookies.CookieAttributes
	): void {
		this.#setValue(key, value, options);
	}

	/**
	 * Validate a full cookie object against the schema.
	 */
	validate(value: unknown): StandardSchemaV1.Result<StandardSchemaV1.InferOutput<Schema>> {
		return this.#schema['~standard'].validate(value) as StandardSchemaV1.Result<
			StandardSchemaV1.InferOutput<Schema>
		>;
	}

	/**
	 * Check whether a key exists in the schema.
	 */
	has(key: string): boolean {
		return key in this.#schemaShape;
	}

	/**
	 * Resolve a single schema key from the cache.
	 *
	 * If the full object fails validation, this attempts to:
	 * - fall back to schema defaults
	 * - ignore invalid keys
	 * - return the last valid value
	 */
	#getTypedValue<K extends keyof StandardSchemaV1.InferOutput<Schema>>(
		key: K & string
	): StandardSchemaV1.InferOutput<Schema>[K] | undefined {
		const paramsObject = (this.#cookies ?? {}) as Record<string, unknown>;
		const result = this.validate(paramsObject);

		if (result instanceof Promise) {
			throw new Error('Async validation not supported');
		}

		if (isFailureResult(result)) {
			const emptyResult = this.validate({});
			const defaultValues =
				!(emptyResult instanceof Promise) && !isFailureResult(emptyResult) ? emptyResult.value : {};
			const validParams = Object.fromEntries(
				Object.entries(paramsObject).filter(
					([k]) => !result.issues.some((issue) => issuePathHasKey(issue.path, k))
				)
			);
			return {
				...(typeof defaultValues === 'object' && defaultValues !== null ? defaultValues : {}),
				...validParams
			}[key] as StandardSchemaV1.InferOutput<Schema>[K];
		}

		return (result.value as Record<string, unknown>)[
			key
		] as StandardSchemaV1.InferOutput<Schema>[K];
	}

	/**
	 * Internal write path.
	 *
	 * - Skips unknown keys
	 * - Avoids unnecessary writes using deep equality
	 * - Runs codec encoders
	 * - Validates against the schema
	 * - Persists the value to cookies
	 * - Updates the reactive cache
	 */
	#setValue(key: string, value: unknown, options?: Cookies.CookieAttributes): void {
		if (!this.has(key)) return;

		const paramsObject = (this.#cookies ?? {}) as Record<string, unknown>;
		const currentValue = paramsObject[key];

		const isPrimitive =
			typeof currentValue !== 'object' &&
			typeof value !== 'object' &&
			currentValue !== null &&
			value !== null;

		if (isPrimitive ? currentValue === value : dequal(currentValue, value)) return;

		let valueForValidation = value;
		if (this.#codecEncoders.has(key)) {
			const encoder = this.#codecEncoders.get(key)!;
			try {
				valueForValidation = encoder(value);
			} catch (e) {
				console.error(`Error encoding value for "${key}"`, e);
			}
		}

		const newParamsObject = { ...paramsObject, [key]: valueForValidation };
		const result = this.validate(newParamsObject);

		if (result instanceof Promise) {
			throw new Error('Async validation not supported');
		}

		// Same discriminator fix as `#getTypedValue` — `'value' in result` was true even on
		// failure, so an invalid write used to persist the cookie and then crash reading
		// `result.value[key]` off an `undefined` (or otherwise unvalidated) `value`. A failed
		// write is now silently dropped instead, per this method's own "skips unknown/invalid"
		// contract.
		if (!isFailureResult(result)) {
			const validatedResult = result.value as Record<string, unknown>;
			jsCookie.set(key, JSON.stringify(value), options);
			(this.#cookies as Record<string, unknown>)[key] = validatedResult[key];
		}
	}
}

export type ReturnUseCookies<T extends StandardSchemaV1> = Cookies<T> &
	StandardSchemaV1.InferOutput<T>;

/**
 * Create a reactive cookie facade from a schema and server-provided values.
 *
 * This is the client-side companion to the server extractor.
 * The `cookies` argument must be the object returned from `pickCookies`.
 *
 * The returned object is a Proxy around an internal cookie manager:
 *
 * - Reading `cookies.someKey` returns the typed value.
 * - Writing `cookies.someKey = value`:
 *   - validates against the schema
 *   - updates reactive state
 *   - persists the cookie in the browser using default attributes.
 *
 * The instance can be placed in Svelte context to avoid prop drilling.
 *
 * ## Special: `update`
 *
 * In addition to property assignment, the returned object exposes an
 * `update` method for setting cookies with explicit attributes:
 *
 * ```ts
 * cookies.update('sessionId', value, {
 *   expires: 7,
 *   sameSite: 'lax'
 * });
 * ```
 *
 * This allows configuring cookie options such as `expires`, `path`,
 * `domain`, `secure`, and `sameSite`, which are not available through
 * simple property assignment.
 *
 * ## Example
 *
 * ```ts
 * const cookies = useCookies(schema, serverCookies);
 *
 * // read
 * cookies.sessionId;
 *
 * // write
 * cookies.isLoggedIn = true;
 *
 * // provide via context
 * setContext('cookies', cookies);
 * ```
 *
 * @typeParam Schema - Cookie schema definition
 * @param schema - Schema used for typing, defaults, and validation
 * @param cookies - Initial values extracted on the server
 * @returns Reactive proxy exposing schema keys as properties
 */
export function useCookies<Schema extends StandardSchemaV1>(
	schema: Schema,
	cookies: Partial<StandardSchemaV1.InferOutput<Schema>>
): ReturnUseCookies<Schema> {
	const store = new Cookies(schema, cookies);

	const handler: ProxyHandler<Cookies<Schema>> = {
		get(target, prop) {
			if (prop === 'update') {
				return function (
					key: keyof StandardSchemaV1.InferOutput<Schema> & string,
					value: StandardSchemaV1.InferOutput<Schema>[keyof StandardSchemaV1.InferOutput<Schema>],
					options?: Cookies.CookieAttributes
				) {
					return target.update(key, value, options);
				};
			}

			if (typeof prop === 'string' && target.has(prop)) {
				return target.get(prop as keyof StandardSchemaV1.InferOutput<Schema> & string);
			}

			return Reflect.get(target, prop);
		},

		set(target, prop, value) {
			if (typeof prop === 'string' && target.has(prop)) {
				target.set(prop as keyof StandardSchemaV1.InferOutput<Schema> & string, value);
				return true;
			}

			return Reflect.set(target, prop, value);
		}
	};

	return new Proxy(store, handler);
}
