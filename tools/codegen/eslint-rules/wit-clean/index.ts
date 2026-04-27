/**
 * `wit-clean` — local ESLint rule set enforcing the WIT-clean discipline
 * (D-036) on capability schemas at author time.
 *
 * Walker-level enforcement (`src/walk.ts`) is the source of truth — it hard
 * fails at codegen time. These rules are belt-and-suspenders: they warn at
 * edit-time so authors discover the violation before they run codegen.
 *
 * All rules emit *warnings*, never errors, per D-021/D-036. The user can
 * override per-occurrence with an `// @migration-cost: <reason>` annotation
 * on the same line, in which case the rule does not fire.
 *
 * Loaded from the project's `eslint.config.js` (flat config). Not published
 * to npm — these rules encode an architectural decision specific to Iarsma,
 * not general Zod best practices.
 */

import { noBranded } from './no-branded.js';
import { noIntersection } from './no-intersection.js';
import { noRefine } from './no-refine.js';
import { noTransform } from './no-transform.js';

export const rules = {
  'no-refine': noRefine,
  'no-transform': noTransform,
  'no-intersection': noIntersection,
  'no-branded': noBranded,
};

export { noRefine, noTransform, noIntersection, noBranded };

export default { rules };
