/** The part of the Standard Schema interface this package relies on. Zod 4.2+ implements all of it. */
export interface StandardSchema<In = unknown, Out = In> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => ValidateResult<Out> | Promise<ValidateResult<Out>>;
    readonly types?: { readonly input: In; readonly output: Out } | undefined;
    readonly jsonSchema?: {
      readonly input: (options: { target: string }) => Record<string, unknown>;
      readonly output: (options: { target: string }) => Record<string, unknown>;
    };
  };
}

type ValidateResult<Out> =
  | { readonly value: Out; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<{ readonly message: string; readonly path?: ReadonlyArray<unknown> | undefined }> };

export type InferIn<S> = S extends StandardSchema<infer I, unknown> ? I : unknown;
export type InferOut<S> = S extends StandardSchema<unknown, infer O> ? O : unknown;

export type Kind = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown';

export interface FieldShape {
  kind: Kind;
  required: boolean;
  /** Allowed values, when the schema lists them. */
  options?: string[];
}

export type Shape = Record<string, FieldShape>;

export function isStandardSchema(value: unknown): value is StandardSchema {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { '~standard'?: { validate?: unknown } })['~standard']?.validate === 'function'
  );
}

function kindOf(prop: unknown): FieldShape['kind'] {
  if (typeof prop !== 'object' || prop === null) return 'unknown';
  const p = prop as Record<string, unknown>;
  const t = p.type;
  if (t === 'integer' || t === 'number') return 'number';
  if (t === 'string' || t === 'boolean' || t === 'array' || t === 'object') return t;
  if (Array.isArray(p.enum) && p.enum.length > 0 && p.enum.every((v) => typeof v === 'string')) return 'string';
  if (typeof p.const === 'string') return 'string';
  if (typeof p.const === 'number') return 'number';
  if (typeof p.const === 'boolean') return 'boolean';
  return 'unknown';
}

/**
 * The top-level fields of an object schema, or undefined when they cannot be worked out
 * (not an object, or the schema uses types that have no JSON Schema form).
 */
export function shapeOf(schema: unknown, io: 'input' | 'output'): Shape | undefined {
  let json: Record<string, unknown> | undefined;
  if (isStandardSchema(schema)) {
    try {
      json = schema['~standard'].jsonSchema?.[io]({ target: 'draft-2020-12' });
    } catch {
      return undefined;
    }
  } else if (typeof schema === 'object' && schema !== null && (schema as { type?: unknown }).type === 'object') {
    json = schema as Record<string, unknown>;
  }
  if (!json || json.type !== 'object' || typeof json.properties !== 'object' || json.properties === null) {
    return undefined;
  }
  const required = new Set(Array.isArray(json.required) ? (json.required as unknown[]).map(String) : []);
  const shape: Shape = Object.create(null) as Shape;
  for (const name of Object.keys(json.properties)) {
    const prop = (json.properties as Record<string, unknown>)[name];
    // On the input side a field with a default (or a fallback) does not have to be supplied.
    const hasDefault = io === 'input' && typeof prop === 'object' && prop !== null && 'default' in prop;
    const field: FieldShape = { kind: kindOf(prop), required: required.has(name) && !hasDefault };
    const options = (prop as { enum?: unknown } | null)?.enum;
    if (Array.isArray(options) && options.every((v) => typeof v === 'string')) field.options = options as string[];
    shape[name] = field;
  }
  return shape;
}

export type Validated = { ok: true; value: unknown } | { ok: false; issues: string[] };

/** Validate a value. Schemas that are plain JSON Schema objects cannot validate and pass through. */
export async function validate(schema: unknown, value: unknown): Promise<Validated> {
  if (!isStandardSchema(schema)) return { ok: true, value };
  const result = await schema['~standard'].validate(value);
  if (result.issues) {
    return {
      ok: false,
      issues: result.issues.map((i) => {
        const path = (i.path ?? [])
          .map((p) => (typeof p === 'object' && p !== null && 'key' in p ? String((p as { key: unknown }).key) : String(p)))
          .join('.');
        return path ? `${path}: ${i.message}` : i.message;
      }),
    };
  }
  return { ok: true, value: result.value };
}
