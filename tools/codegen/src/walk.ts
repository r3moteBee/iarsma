/**
 * Walk a Zod schema and produce the intermediate AST.
 *
 * The walker is intentionally exhaustive: any Zod feature it doesn't handle
 * throws `UnhandledZodKind` rather than silently producing wrong output.
 * This is the AST exhaustiveness guarantee from F-3 (see implementation plan,
 * Phase 0 work item 4a, test category 2).
 *
 * The walker also enforces the WIT-clean discipline (D-021/D-036) by failing
 * loud on `z.refine`, `z.transform`, `z.intersection`, and branded types.
 * Belt-and-suspenders: the lint rule warns at author time; the walker hard-fails
 * at codegen time. There is no path that produces a quietly-wrong artifact.
 */

import type { z } from 'zod';
import type { Field, TypeNode, VariantCase } from './types.js';

export class UnhandledZodKind extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnhandledZodKind';
  }
}

/**
 * Walk a Zod schema into a TypeNode. Throws UnhandledZodKind on unsupported
 * Zod features (including the WIT-clean violations).
 */
export function walkZod(schema: z.ZodTypeAny): TypeNode {
  // Zod's _def is the canonical introspection surface. We bind it to a local
  // unknown-typed const and narrow as we recognize each typeName.
  const def = schema._def as { typeName?: string } & Record<string, unknown>;
  const typeName = def.typeName;

  switch (typeName) {
    case 'ZodString':
      return { kind: 'string' };

    case 'ZodNumber': {
      const checks = (def.checks as { kind: string }[] | undefined) ?? [];
      const integer = checks.some((c) => c.kind === 'int');
      return { kind: 'number', integer };
    }

    case 'ZodBoolean':
      return { kind: 'boolean' };

    case 'ZodOptional':
    case 'ZodNullable': {
      const innerType = def.innerType as z.ZodTypeAny;
      return { kind: 'option', inner: walkZod(innerType) };
    }

    case 'ZodArray': {
      const elementType = def.type as z.ZodTypeAny;
      return { kind: 'list', element: walkZod(elementType) };
    }

    case 'ZodObject': {
      const shape = (schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
      const fields: Field[] = Object.entries(shape).map(([name, child]) => {
        const optional = child.isOptional();
        const description = child.description;
        // If the child is `ZodOptional` (not `ZodNullable`), unwrap to its
        // inner type for AST purposes. The Field's `optional: true` flag
        // captures the optionality; wrapping the type in `option<T>` too
        // would produce `name?: T | null` in TS (doubly-optional), since
        // `?` already means "or undefined." `ZodNullable` keeps wrapping
        // in `option<T>` because it's a type-level claim ("the value may
        // be `null`"), distinct from "the field may be absent."
        const childForType = unwrapOptional(child);
        const field: Field = optional && description !== undefined
          ? { name, type: walkZod(childForType), optional, description }
          : optional
            ? { name, type: walkZod(childForType), optional }
            : description !== undefined
              ? { name, type: walkZod(childForType), optional: false, description }
              : { name, type: walkZod(childForType), optional: false };
        return field;
      });
      return { kind: 'record', fields };
    }

    case 'ZodLiteral': {
      const value = def.value;
      if (typeof value !== 'string') {
        throw new UnhandledZodKind(
          `non-string literal (got ${typeof value}). Use z.enum or z.string for primitives.`,
        );
      }
      return { kind: 'enum', values: [value] };
    }

    case 'ZodEnum': {
      const values = def.values as readonly string[];
      return { kind: 'enum', values: [...values] };
    }

    case 'ZodDiscriminatedUnion': {
      const options = def.options as z.ZodTypeAny[];
      const discriminator = def.discriminator as string;
      const cases: VariantCase[] = options.map((opt) => {
        const ast = walkZod(opt);
        if (ast.kind !== 'record') {
          throw new UnhandledZodKind(
            `discriminated-union case is not an object (got ${ast.kind})`,
          );
        }
        const tagField = ast.fields.find((f) => f.name === discriminator);
        if (!tagField || tagField.type.kind !== 'enum' || tagField.type.values.length !== 1) {
          throw new UnhandledZodKind(
            `discriminated-union case missing literal tag for "${discriminator}"`,
          );
        }
        const remaining = ast.fields.filter((f) => f.name !== discriminator);
        return {
          tag: tagField.type.values[0]!,
          payload: remaining.length > 0 ? { kind: 'record', fields: remaining } : null,
          ...(opt.description !== undefined ? { description: opt.description } : {}),
        };
      });
      return { kind: 'variant', cases };
    }

    case 'ZodVoid':
    case 'ZodUndefined':
    case 'ZodNull':
      return { kind: 'unit' };

    // ──────────────────────────────────────────────────────────────────────
    // WIT-clean violations (D-036) — fail loud at codegen time.
    // ──────────────────────────────────────────────────────────────────────

    case 'ZodEffects': {
      const effect = def.effect as { type: string };
      const which = effect.type === 'refinement' ? 'z.refine' : 'z.transform';
      throw new UnhandledZodKind(
        `${which} is not WIT-clean (D-036). Move validation/transformation into ` +
        `implementation code, or annotate the contract with @migration-cost and ` +
        `accept the per-capability migration cost when porting to WIT.`,
      );
    }

    case 'ZodIntersection':
      throw new UnhandledZodKind(
        'z.intersection is not WIT-clean (D-036). Use .merge() for object combination.',
      );

    case 'ZodBranded':
      throw new UnhandledZodKind(
        'branded types in capability schemas are not WIT-clean (D-036). ' +
        'Apply branding at the consumption site (TS-only) instead of in the schema.',
      );

    case 'ZodUnion':
      throw new UnhandledZodKind(
        'z.union (non-discriminated) is not supported by the walker. ' +
        'Use z.discriminatedUnion to keep variant cases unambiguous in WIT.',
      );

    case 'ZodTuple':
      throw new UnhandledZodKind(
        'z.tuple is not supported. WIT prefers records (named fields) over tuples ' +
        '(positional). Use z.object({...}) instead.',
      );

    case 'ZodRecord':
      throw new UnhandledZodKind(
        'z.record (open-ended map) is not supported. WIT requires explicit field ' +
        'lists. Use z.object({...}) with declared keys instead.',
      );

    case 'ZodMap':
    case 'ZodSet':
      throw new UnhandledZodKind(
        `${typeName} has no WIT equivalent. Model as z.array(z.object({...})) ` +
        'with explicit key/value fields.',
      );

    case 'ZodDate':
    case 'ZodBigInt':
    case 'ZodNaN':
    case 'ZodSymbol':
    case 'ZodFunction':
    case 'ZodLazy':
    case 'ZodPromise':
    case 'ZodAny':
    case 'ZodUnknown':
    case 'ZodNever':
      throw new UnhandledZodKind(
        `${typeName} is not supported by the walker. Use a primitive WIT-clean ` +
        'type instead (e.g., z.string() for ISO dates).',
      );

    default:
      throw new UnhandledZodKind(`unhandled Zod kind: ${typeName ?? '<unknown>'}`);
  }
}

/**
 * If `schema` is `ZodOptional`, return its inner type; otherwise return
 * `schema` unchanged. Used inside `ZodObject` walking to keep optional
 * fields' types unwrapped — see the comment in the `ZodObject` case for
 * the rationale.
 */
function unwrapOptional(schema: z.ZodTypeAny): z.ZodTypeAny {
  const def = schema._def as { typeName?: string; innerType?: z.ZodTypeAny };
  if (def.typeName === 'ZodOptional' && def.innerType !== undefined) {
    return def.innerType;
  }
  return schema;
}
