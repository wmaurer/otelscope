import { JsonlSpanRecord } from "@wmaurer/otelscope-effect/format";
import { Cause, Data, Exit, Option, Predicate, Schema } from "effect";

export type Classified = Data.TaggedEnum<{
    Span: { readonly record: JsonlSpanRecord };
    Legacy: {};
    Malformed: { readonly issue: string };
}>;

export const Classified = Data.taggedEnum<Classified>();

const legacy = Classified.Legacy();

const decodeRecord = Schema.decodeUnknownExit(JsonlSpanRecord);

const isLegacy = Schema.is(Schema.Struct({ run: Schema.String, trace: Schema.String, span: Schema.String }));

type Parsed = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly issue: string };

// Schema's JSON transformation reports only "a valid JSON string"; the parse error's position is what makes a
// malformed line findable.
const parseJson = (text: string): Parsed => {
    try {
        return { ok: true, value: JSON.parse(text) };
    } catch (error) {
        return { ok: false, issue: error instanceof Error ? error.message : String(error) };
    }
};

const oneLine = (message: string): string => message.replace(/\s*\n\s*/gu, " ");

export const classify = (text: string): Classified => {
    const parsed = parseJson(text);
    if (!parsed.ok) {
        return Classified.Malformed({ issue: parsed.issue });
    }
    const decoded = decodeRecord(parsed.value);
    if (Exit.isSuccess(decoded)) {
        return Classified.Span({ record: decoded.value });
    }
    if (isLegacy(parsed.value) && !Predicate.hasProperty(parsed.value, "startMs")) {
        return legacy;
    }
    const issue = Option.match(Cause.findErrorOption(decoded.cause), {
        onNone: () => Cause.pretty(decoded.cause),
        onSome: (error) => error.message,
    });
    return Classified.Malformed({ issue: oneLine(issue) });
};
