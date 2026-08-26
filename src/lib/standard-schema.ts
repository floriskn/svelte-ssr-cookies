/** The Standard Schema interface. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
	/** The Standard Schema properties. */
	readonly '~standard': StandardSchemaV1.Props<Input, Output>;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace StandardSchemaV1 {
	/** The Standard Schema properties interface. */
	export interface Props<Input = unknown, Output = Input> {
		/** The version number of the standard. */
		readonly version: 1;
		/** The vendor name of the schema library. */
		readonly vendor: string;
		/** Validates unknown input values. */
		readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>;
		/** Inferred types associated with the schema. */
		readonly types?: Types<Input, Output> | undefined;
	}

	/** The result interface of the validate function. */
	export type Result<T> = SuccessResult<T> | FailureResult;

	/** The result interface if validation succeeds. */
	export interface SuccessResult<T> {
		/** The typed output value. */
		readonly value: T;
		/** The non-existent issues. */
		readonly issues?: undefined;
	}

	/** The result interface if validation fails. */
	export interface FailureResult {
		/** The issues of failed validation. */
		readonly issues: ReadonlyArray<Issue>;
	}

	/** The issue interface of the failure output. */
	export interface Issue {
		/** The error message of the issue. */
		readonly message: string;
		/** The path of the issue, if any. */
		readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
	}

	/** The path segment interface of the issue. */
	export interface PathSegment {
		/** The key representing a path segment. */
		readonly key: PropertyKey;
	}

	/** The Standard Schema types interface. */
	export interface Types<Input = unknown, Output = Input> {
		/** The input type of the schema. */
		readonly input: Input;
		/** The output type of the schema. */
		readonly output: Output;
	}

	/** Infers the input type of a Standard Schema. */
	export type InferInput<Schema extends StandardSchemaV1> = NonNullable<
		Schema['~standard']['types']
	>['input'];

	/** Infers the output type of a Standard Schema. */
	export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
		Schema['~standard']['types']
	>['output'];
}

/**
 * True when a `validate()` result failed.
 *
 * Not `'value' in result` — that was this package's original check, and it's unreliable: at
 * least Valibot's `~standard.validate()` sets an own `value` property (either the echoed-back
 * input, or `undefined` for a top-level type mismatch, e.g. an object schema validating
 * `undefined`) on *both* success and failure results, so `'value' in result` is true
 * unconditionally for Valibot and never actually distinguishes the two — silently disabling
 * every fallback path built on that check. `issues` is the actual Standard Schema discriminator
 * per the spec: present and non-empty only on a `FailureResult`.
 */
export function isFailureResult<T>(
	result: StandardSchemaV1.Result<T>
): result is StandardSchemaV1.FailureResult {
	return Array.isArray(result.issues) && result.issues.length > 0;
}

/**
 * Whether an issue's `path` names `key` — a path entry is either a raw `PropertyKey` or a
 * `{ key }` segment object per the spec (Valibot's own issues carry a richer object with a
 * `key` field, matching the latter). `path?.includes(key)` — this package's original check —
 * compares the array against a bare string with `===`, which never matches a segment object,
 * so it silently kept every "invalid" key instead of filtering it out.
 */
export function issuePathHasKey(path: StandardSchemaV1.Issue['path'], key: PropertyKey): boolean {
	return !!path?.some(
		(segment) => (typeof segment === 'object' && segment !== null ? segment.key : segment) === key
	);
}
