import { Array as Arr, Data, Duration, Effect, Option, Random, Ref, Schedule, Schema } from "effect";

// The four programs behind the fixture, one per run. Every choice that shapes a trace is fixed by index or drawn
// from a seeded `Random`, so the traces come out the same on every run. Only `Scale` differs between the sample
// and the large variant.

export interface Scale {
    // `POST /orders` traces in `shop-api`.
    readonly orders: number;
    // Children of the one parent in the wide `batch-jobs` trace.
    readonly wideChildren: number;
}

export const SAMPLE: Scale = { orders: 6, wideChildren: 400 };
export const LARGE: Scale = { orders: 3000, wideChildren: 10_000 };

// Typed errors with fields: their `exception` events have an empty message, and only the type names them.
class PaymentGatewayError extends Data.TaggedError("PaymentGatewayError")<{ readonly status: number }> {}
class PaymentDeclined extends Data.TaggedError("PaymentDeclined")<{ readonly reason: string }> {}
class RowInvalid extends Data.TaggedError("RowInvalid")<{ readonly row: number; readonly field: string }> {}

// Sleeps for `ms` give or take `spread`, to the microsecond.
const work = (ms: number, spread = 0.3) =>
    Effect.flatMap(Random.nextBetween(ms * (1 - spread), ms * (1 + spread)), (actual) =>
        Effect.sleep(Duration.micros(BigInt(Math.round(actual * 1000)))),
    );

// ---------------------------------------------------------------------------------------------------------------
// Bodies. Their text is built from fixed words, never from ids, times or paths, so a body's hash is stable.

const WORDS = [
    "order",
    "invoice",
    "shipment",
    "customer",
    "refund",
    "account",
    "warehouse",
    "carrier",
    "address",
    "parcel",
    "the",
    "a",
    "was",
    "has",
    "been",
    "is",
    "not",
    "delayed",
    "updated",
    "requested",
    "confirmed",
    "missing",
    "please",
    "check",
    "status",
    "tracking",
    "number",
    "after",
    "before",
    "today",
    "yesterday",
    "again",
];

// `words` words drawn from WORDS by a linear congruential generator, in sentences of 17 words, one per line.
const prose = (seed: number, words: number): string => {
    const states = Arr.scan(Arr.range(1, words), seed, (state) => (Math.imul(state, 1_103_515_245) + 12_345) >>> 0);
    const picked = Arr.map(Arr.drop(states, 1), (state, i) => {
        const word = WORDS[state % WORDS.length] ?? "";
        return i % 17 === 16 ? `${word}.\n` : `${word} `;
    });
    return Arr.join(picked, "").trimEnd();
};

// One line of HTML, as a mail API takes it. The same in every order, so it is stored once.
const EMAIL_BODY = Arr.join(
    [
        "<!doctype html><html><body><h1>Your order is confirmed</h1><p>Hello,</p>",
        "<p>Thank you for your order. We will let you know as soon as it ships.</p>",
        `<p>${prose(7, 400).replaceAll("\n", " ")}</p>`,
        "<p>The shop team</p></body></html>",
    ],
    "",
);

// ---------------------------------------------------------------------------------------------------------------
// shop-api: interleaved `POST /orders` traces. Order 2 retries its payment, order 4 is declined, and order 5's
// shipping quote times out.

const dbQuery = (statement: string, ms: number) =>
    work(ms).pipe(
        Effect.withSpan("db.query", { attributes: { "db.system": "postgresql", "db.statement": statement } }),
    );

const validateOrder = Effect.fn("order.validate")(function* (orderId: string) {
    yield* work(2);
    yield* Effect.logDebug(`validated ${orderId}`);
});

const paymentAttempt = (orderNo: number, attempt: number) =>
    Effect.gen(function* () {
        yield* work(80);
        if (orderNo % 6 === 2 && attempt < 3) {
            yield* Effect.logWarning("payment gateway unavailable");
            return yield* new PaymentGatewayError({ status: 503 });
        }
        if (orderNo % 6 === 4) return yield* new PaymentDeclined({ reason: "insufficient_funds" });
        yield* Effect.logInfo("payment captured");
    }).pipe(
        Effect.withSpan("payment.attempt", { attributes: { "payment.attempt": attempt } }),
        Effect.annotateLogs("payment.attempt", attempt),
    );

const chargePayment = Effect.fn("payment.charge", { attributes: { "payment.provider": "stripe" } })(function* (
    orderNo: number,
) {
    const attempts = yield* Ref.make(0);
    yield* Ref.updateAndGet(attempts, (n) => n + 1).pipe(
        Effect.flatMap((attempt) => paymentAttempt(orderNo, attempt)),
        Effect.retry({
            schedule: Schedule.exponential("40 millis"),
            times: 3,
            while: (error) => error._tag === "PaymentGatewayError",
        }),
    );
});

const shippingQuote = (orderNo: number) =>
    work(orderNo % 6 === 5 ? 3_000 : 120).pipe(
        Effect.withSpan("shipping.quote", { attributes: { "shipping.carrier": "parcelco" } }),
        Effect.timeoutOption("1 second"),
        Effect.flatMap(
            Option.match({
                onNone: () => Effect.as(Effect.logWarning("shipping quote timed out, using the flat rate"), 9.9),
                onSome: () => Effect.succeed(6.5),
            }),
        ),
    );

const sendEmail = work(60).pipe(
    Effect.withSpan("email.send", { attributes: { "email.template": "order-confirmed", "email.body": EMAIL_BODY } }),
);

const handleOrder = Effect.fn("POST /orders", { kind: "server" })(
    function* (orderNo: number) {
        const orderId = `ord_${(1000 + orderNo).toString()}`;
        yield* Effect.annotateCurrentSpan({
            "http.request.method": "POST",
            "http.route": "/orders",
            "order.id": orderId,
        });
        yield* Effect.logInfo("order received");
        yield* validateOrder(orderId);
        yield* dbQuery("SELECT * FROM customers WHERE id = $1", 8);
        yield* chargePayment(orderNo).pipe(
            Effect.tapCause((cause) => Effect.logError("payment failed", cause)),
            Effect.tapError(() => Effect.annotateCurrentSpan("http.response.status_code", 402)),
        );
        const shipping = yield* shippingQuote(orderNo);
        yield* Effect.all(
            [
                work(25).pipe(Effect.withSpan("inventory.reserve", { attributes: { "inventory.items": 3 } })),
                sendEmail,
                dbQuery("INSERT INTO orders VALUES ($1, $2, $3)", 15),
            ],
            { concurrency: "unbounded" },
        );
        yield* Effect.annotateCurrentSpan({ "http.response.status_code": 201, "shipping.cost": shipping });
    },
    (effect, orderNo) => Effect.annotateLogs(effect, "order.id", `ord_${(1000 + orderNo).toString()}`),
);

export const shopApi = (scale: Scale) =>
    Effect.forEach(
        Array.from({ length: scale.orders }, (_, i) => i + 1),
        (orderNo) => handleOrder(orderNo).pipe(Effect.delay(Duration.millis(orderNo * 70)), Effect.ignore),
        { concurrency: "unbounded", discard: true },
    );

// ---------------------------------------------------------------------------------------------------------------
// support-agent: one session of three steps. Step 1 races two providers, step 2 runs tools concurrently and one
// of them times out, and the session ends by storing a transcript that is too large to keep whole.

// The request is compact, as an HTTP client sends it, so the body viewer has one long line to pretty-print. The
// response is already pretty. Message contents hold `\n` inside their strings.
const Message = Schema.Struct({ role: Schema.String, content: Schema.String });
type Message = typeof Message.Type;

const LlmRequest = Schema.fromJsonString(Schema.Struct({ model: Schema.String, messages: Schema.Array(Message) }));
const LlmResponse = Schema.fromJsonString(Schema.Struct({ ...Message.fields, stop_reason: Schema.String }), {
    space: 2,
});
// One line of JSON, about 1.2 MB, so the stored body is cut at the cap mid-string and no longer parses.
const Transcript = Schema.fromJsonString(Schema.Array(Message));

const message = (role: string, content: string): Message => ({ role, content });

const kbArticle = (n: number) => message("tool", prose(100 + n, 5_500));

const llmChat = (step: number, messages: ReadonlyArray<Message>) =>
    Effect.gen(function* () {
        const reply = prose(200 + step, 120);
        yield* Effect.annotateCurrentSpan({
            "llm.request.body": yield* Schema.encodeEffect(LlmRequest)({ model: "claude-sonnet-5-5", messages }),
            "llm.response.body": yield* Schema.encodeEffect(LlmResponse)({
                role: "assistant",
                content: reply,
                stop_reason: "end_turn",
            }),
        });
        yield* work(900);
        return message("assistant", reply);
    }).pipe(
        Effect.orDie,
        Effect.withSpan("llm.chat", { attributes: { "llm.model": "claude-sonnet-5-5", "llm.step": step } }),
    );

const provider = (name: string, ms: number) =>
    work(ms, 0.05).pipe(Effect.withSpan("llm.provider", { attributes: { "llm.provider": name } }));

const tool = (name: string, ms: number) =>
    Effect.gen(function* () {
        yield* Effect.logInfo(`calling ${name}`);
        yield* work(ms);
    }).pipe(Effect.withSpan(`tool.${name}`));

const agentStep = (step: number, history: Ref.Ref<ReadonlyArray<Message>>) =>
    Effect.gen(function* () {
        yield* Effect.logInfo(`step ${step.toString()} started`);
        if (step === 1) {
            yield* Effect.race(provider("primary", 1_800), provider("fallback", 1_200));
        }
        if (step === 2) {
            yield* Effect.all(
                [
                    tool("search_kb", 300),
                    tool("lookup_order", 150),
                    tool("fetch_invoice", 5_000).pipe(
                        Effect.timeoutOption("2 seconds"),
                        Effect.tap(
                            Option.match({
                                onNone: () => Effect.logWarning("fetch_invoice timed out"),
                                onSome: () => Effect.void,
                            }),
                        ),
                    ),
                ],
                { concurrency: "unbounded" },
            );
            yield* Ref.update(history, (h) => [...h, kbArticle(1), kbArticle(2), kbArticle(3)]);
        }
        const reply = yield* llmChat(step, yield* Ref.get(history));
        yield* Ref.update(history, (h) => [...h, reply, message("user", prose(300 + step, 40))]);
    }).pipe(
        Effect.withSpan("agent.step", { attributes: { "agent.step": step } }),
        Effect.annotateLogs("agent.step", step),
    );

const agentSession = Effect.fn("agent.session")(
    function* () {
        const history = yield* Ref.make<ReadonlyArray<Message>>([
            message("system", prose(1, 300)),
            message("user", prose(2, 60)),
        ]);
        for (const step of [1, 2, 3]) yield* agentStep(step, history);
        const transcript = yield* Schema.encodeEffect(Transcript)(
            Arr.makeBy(172, (i) => message(i % 2 === 0 ? "user" : "assistant", prose(400 + i, 1_000))),
        ).pipe(Effect.orDie);
        yield* work(40).pipe(
            Effect.withSpan("agent.transcript.save", { attributes: { "agent.transcript.body": transcript } }),
        );
        yield* Effect.logInfo("session closed");
    },
    Effect.annotateLogs("agent.session", "sess_7f3a"),
);

export const supportAgent = (_scale: Scale) => agentSession();

// ---------------------------------------------------------------------------------------------------------------
// batch-jobs: a deep trace, 41 levels of nested spans, and a wide one, whose parent has `wideChildren` children
// of which 6 fail.

const nested = (depth: number, max: number): Effect.Effect<void> =>
    (depth === max ? work(3) : Effect.andThen(work(0.2), nested(depth + 1, max))).pipe(
        Effect.withSpan("schema.resolve", { attributes: { "schema.depth": depth } }),
    );

const failingRows = (count: number): ReadonlyArray<number> =>
    Array.from({ length: 6 }, (_, i) => Math.floor(((i + 0.5) * count) / 6) + 3);

const processRow = (row: number, failing: ReadonlyArray<number>) =>
    Effect.gen(function* () {
        yield* work(1.5);
        if (Arr.contains(failing, row)) return yield* new RowInvalid({ row, field: "email" });
    }).pipe(
        Effect.tapCause((cause) => Effect.logError("row rejected", cause)),
        Effect.withSpan("row.process", { attributes: { "row.index": row } }),
        Effect.annotateLogs("row.index", row),
        Effect.ignore,
    );

export const batchJobs = (scale: Scale) =>
    Effect.gen(function* () {
        yield* nested(1, 40).pipe(Effect.withSpan("import.schema", { root: true }));
        yield* work(500);
        const failing = failingRows(scale.wideChildren);
        yield* Effect.forEach(
            Array.from({ length: scale.wideChildren }, (_, i) => i + 1),
            (row) => processRow(row, failing),
            { concurrency: 8, discard: true },
        ).pipe(Effect.withSpan("rows.process", { root: true, attributes: { "rows.total": scale.wideChildren } }));
    });

// ---------------------------------------------------------------------------------------------------------------
// worker: logs at all six levels, a defect that fails three levels of spans, and a heartbeat forked into a scope
// that is interrupted when the scope closes.

const heartbeat = Effect.forever(Effect.andThen(Effect.sleep("1 second"), Effect.logTrace("heartbeat"))).pipe(
    Effect.withSpan("worker.heartbeat"),
);

const loadConfig = Effect.fn("config.load")(function* () {
    yield* work(5);
    return yield* Effect.die(new TypeError("Cannot read properties of undefined (reading 'maxRetries')"));
});

const runJob = Effect.fn("job.run")(function* (job: string) {
    yield* Effect.logInfo(`running ${job}`);
    return yield* loadConfig();
});

const workerTick = Effect.fn("worker.tick")(
    function* () {
        yield* Effect.forkScoped(heartbeat);
        yield* Effect.logTrace("polling the queue");
        yield* work(1_200);
        yield* Effect.logDebug("fetched 3 jobs");
        yield* Effect.logInfo("processing jobs");
        yield* Effect.logWarning("job queue is backing up");
        return yield* runJob("reindex").pipe(
            Effect.tapCause((cause) =>
                Effect.andThen(Effect.logError("job crashed", cause), Effect.logFatal("worker stopped")),
            ),
        );
    },
    Effect.scoped,
    Effect.annotateLogs("worker.id", "w-1"),
);

// The defect ends the run, as it would end the worker; the fixture only needs its spans.
export const worker = (_scale: Scale) => workerTick().pipe(Effect.ignoreCause);
