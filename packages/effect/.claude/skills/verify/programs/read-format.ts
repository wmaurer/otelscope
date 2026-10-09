// A reader that imports only `@wmaurer/otelscope-effect/format`, as a trace viewer would. It decodes every line
// of the JSONL file named by argv or OTELSCOPE_FILE with the `JsonlSpanRecord` Schema, and resolves every body
// reference against `bodies/`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { BODY_SUFFIX, JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";
import { Exit, Schema } from "effect";

const file = process.env.OTELSCOPE_FILE ?? process.argv[2];
if (file === undefined) throw new Error("set OTELSCOPE_FILE to a spans.jsonl");

const records = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line, index) => {
        const exit = Schema.decodeUnknownExit(JsonlSpanRecord)(JSON.parse(line));
        if (Exit.isFailure(exit)) throw new Error(`line ${index + 1} is not a JsonlSpanRecord`);
        return exit.value;
    });

for (const r of records) {
    const bodies = Object.keys(r.attrs)
        .filter((key) => key.endsWith(".sha256"))
        .map((key) => {
            const text = readFileSync(join(dirname(file), "bodies", `${String(r.attrs[key])}.txt`), "utf8");
            return `${key.slice(0, -".sha256".length)}${BODY_SUFFIX}=${text.length} chars`;
        });
    const site = r.site === null ? "-" : `${r.site.line}:${r.site.col}`;
    console.log(
        [
            r.run,
            r.service,
            r.trace,
            r.span,
            r.parent ?? "-",
            r.name,
            r.exit,
            `site ${site}`,
            `fiber ${r.fiber ?? "-"}`,
            `${r.events.length} events`,
            ...bodies,
        ].join("\t"),
    );
}
console.log(`${records.length} records, ${new Set(records.map((r) => r.run)).size} runs`);
