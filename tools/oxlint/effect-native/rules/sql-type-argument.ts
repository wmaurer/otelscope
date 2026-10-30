import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

/** True when `source` is one of Effect's SQL modules: `effect/sql`, a path below it, or a driver
 *  package such as `@effect/sql-pg`. */
const isSqlModule = (source: string): boolean =>
    source === "effect/sql" || source.startsWith("effect/sql/") || source.startsWith("@effect/sql");

/** True when the file imports from one of Effect's SQL modules, as a value or as a type. */
const importsSql = (program: ESTree.Program): boolean =>
    program.body.some((statement) => statement.type === "ImportDeclaration" && isSqlModule(statement.source.value));

/** Report a row type passed to a tagged template as a type argument, in a file that imports from
 *  Effect's SQL modules: `` sql<{ readonly path: string }>`SELECT path FROM note` ``.
 *
 *  The type argument states the row type and checks nothing, so a renamed or retyped column still
 *  type-checks and turns up later as `undefined` in a row. `SqlSchema.findAll`, `findOne` and
 *  `findOneOption` decode each row with a `Result` schema and fail with a `SchemaError` instead. */
// Without types the rule cannot tell that the tag is a `SqlClient`: it is usually a local bound by
// `yield* SqlClient.SqlClient` or a parameter. The import is what keeps a file that uses another
// typed tag, such as a styled-components `styled.div<Props>`, out of it.
export const sqlTypeArgumentRule = defineRule({
    meta: {
        type: "problem",
        docs: {
            description: "Report a row type passed to `sql` as a type argument, and suggest `SqlSchema`.",
        },
        messages: {
            sqlTypeArgument:
                "The type argument on this query states the row type without checking it. Decode the rows " +
                "with `SqlSchema.findAll`, `SqlSchema.findOne` or `SqlSchema.findOneOption` and a `Result` schema.",
        },
    },
    createOnce(context) {
        return {
            TaggedTemplateExpression(node: ESTree.TaggedTemplateExpression) {
                if (node.typeArguments === undefined || node.typeArguments === null) return;
                if (!importsSql(context.sourceCode.ast)) return;
                context.report({ node: node.typeArguments, messageId: "sqlTypeArgument" });
            },
        };
    },
});
