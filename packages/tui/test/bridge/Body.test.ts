import { describe, expect, it } from "@effect/vitest";
import { Array as Arr, Cause, Option } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import { bodyModelAtom } from "../../src/bridge/Body.ts";
import { BodyMissing, BodyReadFailed } from "../../src/data/Bodies.ts";
import * as Nav from "../../src/nav/Nav.ts";
import { bodyFor } from "../../src/nav/Screen.ts";
import { indexed } from "../support/store.ts";
import { span } from "../support/traces.ts";

import type { BodyKey } from "../../src/bridge/Atoms.ts";
import type { BodyText } from "../../src/data/Bodies.ts";
import type { BodyModel } from "../../src/model/bodyModel.ts";
import type { BodyView } from "../../src/nav/Screen.ts";

type Result = AsyncResult.AsyncResult<BodyText, BodyMissing | BodyReadFailed>;

const SHA = "a".repeat(64);
const request = '{"model":"m","messages":[{"role":"user","content":"hi"}]}';

const chat = span("chat", null, 0, {
    name: "llm.chat",
    attrs: {
        "llm.request.sha256": SHA,
        "llm.request.bytes": 57,
        "llm.request.preview": '{"model":"m",',
        "llm.response.sha256": "b".repeat(64),
        "llm.response.bytes": 9,
        "llm.response.preview": "ok",
    },
});
const snapshot = indexed([chat]);

const textOf = (text: string): BodyText => ({
    text,
    truncated: false,
    bytes: text.length,
    storedBytes: text.length,
    path: `/data/bodies/${SHA}.txt`,
});

const setup = (first: Result = AsyncResult.success(textOf(request)), prefix = "llm.request") => {
    const registry = AtomRegistry.make();
    const navAtom = Atom.make(Nav.push(Nav.initial, bodyFor("trace-1", "chat", prefix)));
    const snapshotAtom = Atom.make(snapshot);
    const result = Atom.make(first);
    const keys: Array<BodyKey> = [];
    const model = bodyModelAtom(snapshotAtom, navAtom, (key) => {
        keys[keys.length] = key;
        return result;
    });
    registry.mount(model);
    const setView = (over: Partial<BodyView>) =>
        registry.update(navAtom, (nav) => Nav.update(nav, "Body", (view) => ({ ...view, ...over })));
    const current = (): BodyModel => Option.getOrThrow(registry.get(model));
    return { registry, navAtom, snapshotAtom, result, keys, model, setView, current };
};

const docOfModel = (model: BodyModel) => (model.content._tag === "Loading" ? undefined : model.content.doc);

describe("bodyModelAtom", () => {
    it("reads the screen's body by its sha256 and declared bytes, with the span's bodies for the tab row", () => {
        const { keys, current } = setup();
        const model = current();
        expect(keys).toContainEqual({ sha256: SHA, bytes: 57 });
        expect(model.spanName).toBe("llm.chat");
        expect(Arr.map(model.refs, (ref) => ref.prefix)).toEqual(["llm.request", "llm.response"]);
        expect(model.content._tag).toBe("Stored");
        expect(docOfModel(model)?.text.split("\n")[1]).toBe('  "model": "m",');
    });

    it("is Loading until the body is read", () => {
        expect(setup(AsyncResult.initial(true)).current().content._tag).toBe("Loading");
    });

    it("keeps the doc and matches while only the scroll position moves, and on a snapshot that leaves the span", () => {
        const { current, setView, registry, snapshotAtom } = setup();
        const before = current();
        setView({ topLine: 3, leftCol: 8 });
        expect(current().content, "scrolling rebuilds nothing").toBe(before.content);
        registry.set(snapshotAtom, indexed([chat, span("other", null, 5)]));
        expect(current().content, "a live tail that leaves the span alone").toBe(before.content);
    });

    it("finds matches again on a new search over the same doc, and builds a new doc for raw", () => {
        const { current, setView } = setup();
        const before = current();
        setView({ search: "user" });
        const searched = current();
        expect(docOfModel(searched)).toBe(docOfModel(before));
        expect(searched.content._tag === "Stored" ? searched.content.matches.starts.length : -1).toBe(1);
        setView({ raw: true });
        expect(docOfModel(current())?.text).toBe(request);
    });

    it("shows the preview when the file is missing, and the error when it cannot be read", () => {
        const missing = setup(AsyncResult.failure(Cause.fail(new BodyMissing({ sha256: SHA, path: "/x" }))));
        expect(missing.current().content).toMatchObject({ _tag: "Preview", problem: Option.none() });
        expect(docOfModel(missing.current())).toMatchObject({ kind: "text", text: '{"model":"m",' });
        const failed = setup(
            AsyncResult.failure(Cause.fail(new BodyReadFailed({ sha256: SHA, path: "/x", message: "EACCES" }))),
        );
        expect(failed.current().content).toMatchObject({ _tag: "Preview", problem: Option.some("EACCES") });
    });

    it("is None for a prefix the span no longer carries, and off the Body screen", () => {
        const gone = setup(undefined, "llm.tool");
        expect(gone.registry.get(gone.model)).toEqual(Option.none());
        const { registry, model, navAtom } = setup();
        registry.set(navAtom, Nav.initial);
        expect(registry.get(model)).toEqual(Option.none());
    });
});
