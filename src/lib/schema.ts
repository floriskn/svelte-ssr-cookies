import type { StandardSchemaV1 } from './standard-schema.ts';

/**
 * Schema information extracted from validation
 * @internal
 */
export interface SchemaInfo {
	/** All field names defined in the schema */
	keys: string[];
	/** Map of field names to their codec encoder functions (for serialization) */
	codecEncoders: Map<string, (value: unknown) => unknown>;
}

/**
 * Detect and extract codec encoder from a Zod schema field
 * Returns the encoder function if available, otherwise undefined
 * @internal
 */
function extractZodCodecEncoder(fieldSchema: unknown): ((value: unknown) => unknown) | undefined {
	const zodLike = fieldSchema as {
		def?: {
			type?: string;
			innerType?: { def?: { type?: string; reverseTransform?: (value: unknown) => unknown } };
			reverseTransform?: (value: unknown) => unknown;
		};
	};

	if (!zodLike.def) return undefined;

	if (zodLike.def.type === 'pipe' && typeof zodLike.def.reverseTransform === 'function') {
		return zodLike.def.reverseTransform;
	}

	if (
		zodLike.def.type === 'default' &&
		zodLike.def.innerType?.def?.type === 'pipe' &&
		typeof zodLike.def.innerType.def.reverseTransform === 'function'
	) {
		return zodLike.def.innerType.def.reverseTransform;
	}

	return undefined;
}

/**
 * Extract schema information (keys + codec encoders) from a StandardSchemaV1 schema
 * @internal
 */
export function extractSchemaInfo<Schema extends StandardSchemaV1>(schema: Schema): SchemaInfo {
	const validationResult = schema['~standard'].validate({});

	if (!validationResult || !('value' in validationResult)) {
		return { keys: [], codecEncoders: new Map() };
	}

	const defaultValues = validationResult.value as Record<string, unknown>;
	const keys = Object.keys(defaultValues);
	const codecEncoders = new Map<string, (value: unknown) => unknown>();

	const zodObjectSchema = schema as { shape?: Record<string, unknown> };
	if (zodObjectSchema.shape) {
		for (const [key, fieldSchema] of Object.entries(zodObjectSchema.shape)) {
			const encoder = extractZodCodecEncoder(fieldSchema);
			if (encoder) codecEncoders.set(key, encoder);
		}
	}

	return { keys, codecEncoders };
}
