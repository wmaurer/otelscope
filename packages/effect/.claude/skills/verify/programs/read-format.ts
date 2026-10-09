// A reader that imports only `@wmaurer/otelscope-effect/format`, as a trace viewer would. It reads the JSONL
// file named by argv or OTELSCOPE_FILE, and resolves every body reference against `bodies/`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { BODY_SUFFIX, type JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";

const file = process.env.OTELSCOPE_FILE ?? process.argv[2];
if (file === undefined) throw new Error("set OTELSCOPE_FILE to a spans.jsonl");

const records: Array<JsonlSpanRecord> = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));

for (const r of records) {
    const bodies = Object.keys(r.attrs)
        .filter((key) => key.endsWith(".sha256"))
        .map((key) => {
            const text = readFileSync(join(dirname(file), "bodies", `${String(r.attrs[key])}.txt`), "utf8");
            return `${key.slice(0, -".sha256".length)}${BODY_SUFFIX}=${text.length} chars`;
        });
    console.log(
        [r.run, r.trace, r.span, r.parent ?? "-", r.name, r.exit, `${r.events.length} events`, ...bodies].join("\t"),
    );
}
console.log(`${records.length} records, ${new Set(records.map((r) => r.run)).size} runs`);
