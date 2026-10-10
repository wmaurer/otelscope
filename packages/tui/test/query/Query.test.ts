import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";

import { Needle, needle, parse, Term, termKey } from "../../src/query/Query.ts";

const text = (value: string, caseSensitive = false) =>
    Term.Text({ needle: caseSensitive ? Needle.Exact({ text: value }) : Needle.Folded({ lower: value }) });

describe("parse", () => {
    it("splits plain terms on whitespace and keeps a quoted term's spaces", () => {
        expect(parse("  payment   declined ")).toEqual([text("payment"), text("declined")]);
        expect(parse('"card declined" retry')).toEqual([text("card declined"), text("retry")]);
    });

    it("reads key=value and key= as attribute terms, with a quoted value keeping its spaces", () => {
        expect(parse("http.route=/orders")).toEqual([
            Term.Attr({ key: "http.route", value: Option.some(Needle.Folded({ lower: "/orders" })) }),
        ]);
        expect(parse("db.system=")).toEqual([Term.Attr({ key: "db.system", value: Option.none() })]);
        expect(parse('db.statement="select *"')).toEqual([
            Term.Attr({ key: "db.statement", value: Option.some(Needle.Folded({ lower: "select *" })) }),
        ]);
        expect(parse("=x"), "no key: plain text").toEqual([text("=x")]);
    });

    it("reads is: as an exit or a log level, and an unknown value as matching nothing", () => {
        expect(parse("is:failed is:interrupted is:ok")).toEqual([
            Term.Exit({ exit: "Failure" }),
            Term.Exit({ exit: "Interrupted" }),
            Term.Exit({ exit: "Success" }),
        ]);
        expect(parse("is:warn is:fatal")).toEqual([Term.Level({ level: "warn" }), Term.Level({ level: "fatal" })]);
        expect(parse("is:bogus")).toEqual([Term.Never({ raw: "is:bogus" })]);
        expect(parse('"is:failed"'), "quoted, it is plain text").toEqual([text("is:failed")]);
    });

    it("applies smart case to plain terms and to values, never to keys", () => {
        expect(parse("Payment")).toEqual([text("Payment", true)]);
        expect(parse("User.Id=Ab")).toEqual([
            Term.Attr({ key: "User.Id", value: Option.some(Needle.Exact({ text: "Ab" })) }),
        ]);
        expect(parse("User.Id=ab")).toEqual([
            Term.Attr({ key: "User.Id", value: Option.some(Needle.Folded({ lower: "ab" })) }),
        ]);
    });

    it("falls back to plain terms with the quotes kept when a quote is not closed", () => {
        expect(parse('"card declined is:failed')).toEqual([text('"card'), text("declined"), text("is:failed")]);
    });

    it("has no terms for an empty or blank query, and drops an empty quoted term", () => {
        expect(parse("")).toEqual([]);
        expect(parse("   ")).toEqual([]);
        expect(parse('"" x')).toEqual([text("x")]);
    });
});

describe("termKey", () => {
    it("tells case-sensitive and case-insensitive needles apart", () => {
        expect(termKey(Term.Text({ needle: needle("ab") }))).not.toBe(
            termKey(Term.Text({ needle: Needle.Exact({ text: "ab" }) })),
        );
        expect(termKey(Term.Attr({ key: "k", value: Option.none() }))).not.toBe(
            termKey(Term.Attr({ key: "k", value: Option.some(needle("")) })),
        );
    });
});
