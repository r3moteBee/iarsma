/**
 * Tests for the wit-clean rule set. Implements F-3 test category 5: each
 * rule has at least one positive case (the violation fires) and one
 * negative case (clean code stays silent), plus an override case
 * (@migration-cost annotation suppresses the warning).
 *
 * Uses `RuleTester` from `@typescript-eslint/utils`.
 */

import * as tsParser from '@typescript-eslint/parser';
import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, it } from 'vitest';
import { noBranded } from '../no-branded.js';
import { noIntersection } from '../no-intersection.js';
import { noRefine } from '../no-refine.js';
import { noTransform } from '../no-transform.js';

// RuleTester reaches for the test runner's globals; vitest's API is compatible.
RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
});

// ──────────────────────────────────────────────────────────────────────────
// no-refine
// ──────────────────────────────────────────────────────────────────────────

tester.run('no-refine', noRefine, {
  valid: [
    // Clean schemas don't fire.
    `import { z } from 'zod'; z.string();`,
    `import { z } from 'zod'; z.object({ a: z.string() });`,
    // Override suppresses.
    `import { z } from 'zod'; z.string().refine(s => s.length > 0); // @migration-cost: legacy`,
  ],
  invalid: [
    {
      code: `import { z } from 'zod'; z.string().refine(s => s.length > 0);`,
      errors: [{ messageId: 'refineFound' }],
    },
    {
      code: `import { z } from 'zod'; z.object({ a: z.string() }).refine(o => true);`,
      errors: [{ messageId: 'refineFound' }],
    },
  ],
});

// ──────────────────────────────────────────────────────────────────────────
// no-transform
// ──────────────────────────────────────────────────────────────────────────

tester.run('no-transform', noTransform, {
  valid: [
    `import { z } from 'zod'; z.string();`,
    // z.coerce.* is WIT-clean, not a transform method call.
    `import { z } from 'zod'; z.coerce.date();`,
    `import { z } from 'zod'; z.string().transform(s => s); // @migration-cost: ok`,
  ],
  invalid: [
    {
      code: `import { z } from 'zod'; z.string().transform(s => s.toUpperCase());`,
      errors: [{ messageId: 'transformFound' }],
    },
  ],
});

// ──────────────────────────────────────────────────────────────────────────
// no-intersection
// ──────────────────────────────────────────────────────────────────────────

tester.run('no-intersection', noIntersection, {
  valid: [
    `import { z } from 'zod'; z.object({ a: z.string() });`,
    // .merge() is fine.
    `import { z } from 'zod'; z.object({ a: z.string() }).merge(z.object({ b: z.string() }));`,
    `import { z } from 'zod'; z.intersection(z.object({}), z.object({})); // @migration-cost: legacy`,
  ],
  invalid: [
    {
      code: `import { z } from 'zod'; z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() }));`,
      errors: [{ messageId: 'intersectionFound' }],
    },
  ],
});

// ──────────────────────────────────────────────────────────────────────────
// no-branded
// ──────────────────────────────────────────────────────────────────────────

tester.run('no-branded', noBranded, {
  valid: [
    `import { z } from 'zod'; z.string();`,
    // Casting at the consumption site is fine — that's not a .brand() call.
    `type ThreadId = string & { __brand: 'ThreadId' }; const id = 'x' as ThreadId;`,
    `import { z } from 'zod'; z.string().brand<'ThreadId'>(); // @migration-cost: legacy`,
  ],
  invalid: [
    {
      code: `import { z } from 'zod'; z.string().brand<'ThreadId'>();`,
      errors: [{ messageId: 'brandedFound' }],
    },
  ],
});
