import { defineRule } from "@oxlint/plugins";

import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

/** The two ways Effect's array module gets imported, both of which this rule follows.
 *
 *  `import { Array as Arr } from "effect"` is what every site in this repo uses and what the rule
 *  was originally blind to; `import * as Arr from "effect/Array"` is the deep-import form. Only the
 *  array module: the plugin is named for arrays and the message names `Array` functions, so
 *  accepting `effect/Record` here would make both the name and the advice lie. */
const ARRAY_SUBMODULE = "effect/Array";
const EFFECT_BARREL = "effect";
const ARRAY_EXPORT = "Array";

/** How many nested calls it takes before nesting is worse than `pipe`.
 *
 *  Two is not a defect: `Array.sort(Array.filter(xs, f), Order.String)` reads fine, and upstream's
 *  `effecttsgo/missed-pipeable-opportunity` firing at two is exactly why that rule is "off" here —
 *  it reports every `Schema.optional(Schema.Array(…))`, where the nested constructor IS the idiom.
 *  Three is where the reader has to hold two pending calls in their head to find the data, which is
 *  the thing `pipe` fixes. Deliberately not configurable: a project that disagrees turns the rule
 *  off, which is one decision rather than a dial nobody knows how to set. */
const MIN_CHAIN = 3;

/** Bound on the recursion, for the same reason `receiver.ts` has one: stopping early returns a
 *  shorter chain, and a shorter chain is the silent answer. */
const MAX_CHAIN = 16;

/** The variable `name` resolves to at `scope`, or undefined if nothing binds it.
 *
 *  Duplicated from `receiver.ts` rather than exported from it: that module's copy is part of the
 *  "prove this is an array" story and is not otherwise this rule's business. */
function lookup(scope: Scope | null, name: string): Variable | undefined {
    for (let current = scope; current !== null; current = current.upper) {
        const found = current.set.get(name);
        if (found !== undefined) return found;
    }
    return undefined;
}

/** True when `node` names Effect's array module, however it was imported.
 *
 *  Resolved through the scope rather than by matching the name `Array` or `Arr`, so any alias works
 *  and — the point of doing it this way — a local binding that shadows the import disqualifies the
 *  name instead of being mistaken for it. This is `receiver.ts`'s shadowing trap in the other
 *  direction: there an unbound `Array` is the global, here only an import counts, so the global
 *  `Array` can never satisfy this.
 *
 *  Both import forms are accepted deliberately. Checking only the deep import would have made the
 *  rule silent on every site in this repo, which all take `Array` off the `effect` barrel. */
function isEffectArrayNamespace(node: ESTree.Node, sourceCode: SourceCode): boolean {
    if (node.type !== "Identifier") return false;
    const variable = lookup(sourceCode.getScope(node), node.name);
    if (variable === undefined) return false;
    return variable.defs.some((definition) => {
        if (definition.type !== "ImportBinding") return false;
        if (definition.parent?.type !== "ImportDeclaration") return false;
        const source = definition.parent.source.value;

        // `import * as Arr from "effect/Array"`
        if (definition.node.type === "ImportNamespaceSpecifier") return source === ARRAY_SUBMODULE;

        // `import { Array as Arr } from "effect"` — the alias is `local`, so the name that has to
        // match is `imported`, which is `Array` whatever the binding ended up being called.
        if (definition.node.type === "ImportSpecifier") {
            const imported = definition.node.imported;
            return source === EFFECT_BARREL && imported.type === "Identifier" && imported.name === ARRAY_EXPORT;
        }
        return false;
    });
}

/** How many `Array.*` calls this node chains through its DATA position.
 *
 *  Only argument 0 is followed, because that is what makes a nest a pipeline: in
 *  `Array.appendAll(xs, Array.map(ys, f))` the inner call is a second operand, not a step the data
 *  passes through, and rewriting it as `pipe` would not remove the nesting. Following argument 0
 *  alone is also what keeps a callback body — `Array.map(xs, (x) => Array.map(x, f))` — from
 *  counting: that inner call operates on a different value. */
function chainLength(node: ESTree.Node, sourceCode: SourceCode, depth = 0): number {
    if (depth >= MAX_CHAIN) return depth;
    if (node.type !== "CallExpression") return 0;
    const callee = node.callee;
    if (callee.type !== "MemberExpression" || callee.computed) return 0;
    if (callee.property.type !== "Identifier") return 0;
    if (!isEffectArrayNamespace(callee.object, sourceCode)) return 0;

    const first = node.arguments[0];
    // A spread argument is not a value this can follow into.
    if (first === undefined || first.type === "SpreadElement") return 1;
    return 1 + chainLength(first, sourceCode, depth + 1);
}

/** Suggest `pipe` for deeply nested `effect/Array` calls.
 *
 *  Sibling to the other two rules by subject rather than by form: they report native methods that
 *  should be `Array` calls, and this reports what those conversions tend to produce. Data-first
 *  `Array` calls nest inside-out, so a chain of them puts the data — the thing a reader is looking
 *  for — furthest from where the expression starts.
 *
 *  Upstream's `effecttsgo/missed-pipeable-opportunity` covers this for Pipeable receivers, by
 *  suggesting the `.pipe()` METHOD. A plain array is not Pipeable and has no `.pipe`, so that rule
 *  is structurally silent here and the only available form is standalone `pipe` from
 *  `effect/Function`. That gap is why this rule exists; `docs/features/effect-native.md` says so. */
export const nestedArrayPipelineRule = defineRule({
    meta: {
        type: "suggestion",
        docs: {
            description: "Suggest `pipe` where `effect/Array` calls are nested deeply enough to read inside-out.",
        },
        messages: {
            nestedArrayPipeline:
                "This nests {{length}} `Array` calls, so the data is innermost and the expression reads inside-out. " +
                "`pipe` from `effect/Function` reads in the order the steps run: `pipe(data, Array.f(…), Array.g(…))`.",
        },
    },
    createOnce(context) {
        // Inner links of a chain already reported at its outermost call. ESTree traversal reaches a
        // CallExpression before its arguments, so the outermost is always seen first, and one nest
        // produces one report rather than one per level.
        const covered = new WeakSet<ESTree.Node>();

        return {
            CallExpression(node: ESTree.CallExpression) {
                if (covered.has(node)) return;

                const length = chainLength(node, context.sourceCode);
                if (length < MIN_CHAIN) return;

                let inner: ESTree.Node | undefined = node.arguments[0];
                for (let step = 1; step < length && inner !== undefined; step += 1) {
                    covered.add(inner);
                    inner = inner.type === "CallExpression" ? inner.arguments[0] : undefined;
                }

                context.report({
                    node: node.callee.type === "MemberExpression" ? node.callee.property : node,
                    messageId: "nestedArrayPipeline",
                    data: { length: String(length) },
                });
            },
        };
    },
});
