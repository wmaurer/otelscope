// The attributes the tracer hook sets on a span, which `toRecord` lifts into the record's `site`, `def` and
// `fiber`.
export const SITE = ["code.file.path", "code.line.number", "code.column.number"] as const;
export const DEF = ["otelscope.def.file.path", "otelscope.def.line.number", "otelscope.def.column.number"] as const;
export const FIBER = "otelscope.fiber.id";

export type LocationKeys = typeof SITE | typeof DEF;
