import { Array as Arr, Clock, Duration, Effect, Order, Scheduler } from "effect";

// A clock and a scheduler that run a program in virtual time, so that every span time it records is the same
// on every run. Real time would make each duration differ by a few microseconds, and the fixture would never
// be byte-stable.
//
// - A sleep never waits. It is queued, and when no fiber has anything left to run, the clock jumps to the
//   earliest queued sleep and wakes it. Timeouts, races and retries resolve in the same order every time.
// - Each read of the clock advances it by a few microseconds, chosen by a seeded generator. That stands in for
//   the CPU time between two reads, so sibling spans with no sleep in them still start apart.
//
// Only the program runs on this clock. The exporter keeps the live one. Its shutdown flush, though, is timed by
// the fiber that closes the scope, which is on this clock: a flush waiting on file I/O leaves every fiber idle,
// and its timeout would be the next sleep to fire. `hold` keeps the clock still while an effect does I/O.

interface Sleeper {
    readonly at: bigint;
    readonly seq: number;
    readonly wake: () => void;
}

type Bucket = readonly [priority: number, tasks: ReadonlyArray<() => void>];

export interface VirtualTime {
    readonly clock: Clock.Clock;
    readonly scheduler: Scheduler.Scheduler;
    readonly hold: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

// mulberry32: small, fast and seeded; the fixture needs repeatability, not quality.
const seeded = (seed: number): (() => number) => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
};

const MIN_TICK_NANOS = 2_000;
const MAX_TICK_NANOS = 30_000;

// Earliest first; two sleeps due at the same time wake in the order they were queued.
const byWakeTime: Order.Order<Sleeper> = Order.combine(
    Order.mapInput(Order.BigInt, (sleeper: Sleeper) => sleeper.at),
    Order.mapInput(Order.Number, (sleeper: Sleeper) => sleeper.seq),
);

export const make = (startMillis: number, seed: number): VirtualTime => {
    const random = seeded(seed);
    let now = BigInt(startMillis) * 1_000_000n;
    let sequence = 0;
    let holds = 0;
    let sleepers: ReadonlyArray<Sleeper> = [];
    let buckets: ReadonlyArray<Bucket> = [];
    let pending = false;

    const read = (): bigint => {
        now += BigInt(MIN_TICK_NANOS + Math.floor(random() * (MAX_TICK_NANOS - MIN_TICK_NANOS)));
        return now;
    };

    // Called when the scheduler has no task left. Returns whether a sleeper was woken.
    const advance = (): boolean => {
        const [next, ...rest] = sleepers;
        if (holds > 0 || next === undefined) return false;
        sleepers = rest;
        if (next.at > now) now = next.at;
        next.wake();
        return true;
    };

    const runTasks = (): void => {
        const drained = buckets;
        buckets = [];
        for (const [, tasks] of drained) {
            for (const task of tasks) task();
        }
    };

    const afterScheduled = (): void => {
        pending = false;
        runTasks();
        // A woken fiber resumes synchronously, inside `advance`. If it ends or blocks without scheduling a task,
        // nothing else would come back here, so keep advancing while the runtime stays idle.
        while (!pending && buckets.length === 0 && advance()) {
            // advance() did the work
        }
    };

    const kick = (): void => {
        if (!pending) {
            pending = true;
            setImmediate(afterScheduled);
        }
    };

    const sleep = (duration: Duration.Duration): Effect.Effect<void> =>
        Effect.callback<void>((resume) => {
            const sleeper: Sleeper = {
                at: now + Duration.toNanosUnsafe(duration),
                seq: sequence++,
                wake: () => resume(Effect.void),
            };
            const [earlier, later] = Arr.span(sleepers, (other) => byWakeTime(other, sleeper) < 0);
            sleepers = [...earlier, sleeper, ...later];
            // A program whose first act is a sleep has scheduled no task yet that would lead to an idle check.
            kick();
            return Effect.sync(() => {
                sleepers = Arr.filter(sleepers, (other) => other !== sleeper);
            });
        });

    const clock: Clock.Clock = {
        currentTimeMillisUnsafe: () => Number(read() / 1_000_000n),
        currentTimeMillis: Effect.sync(() => Number(read() / 1_000_000n)),
        currentTimeNanosUnsafe: read,
        currentTimeNanos: Effect.sync(read),
        monotonicTimeNanosUnsafe: read,
        monotonicTimeNanos: Effect.sync(read),
        sleep,
    };

    // One dispatcher shared by every fiber, unlike Effect's default of one per fiber, because only a shared
    // queue knows when all of them are idle. It drains the queue once per `setImmediate`, as the default does,
    // so file I/O still gets its turn.
    const dispatcher: Scheduler.SchedulerDispatcher = {
        scheduleTask(task, priority) {
            const [lower, rest] = Arr.span(buckets, ([p]) => p < priority);
            const [same, higher] = Arr.span(rest, ([p]) => p === priority);
            buckets = [...lower, [priority, [...Arr.flatMap(same, ([, tasks]) => tasks), task]], ...higher];
            kick();
        },
        flush() {
            while (buckets.length > 0) runTasks();
        },
    };

    const scheduler: Scheduler.Scheduler = {
        executionMode: "async",
        shouldYield: (fiber) => fiber.currentOpCount >= fiber.cache.maxOpsBeforeYield,
        makeDispatcher: () => dispatcher,
    };

    const hold = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        Effect.acquireUseRelease(
            Effect.sync(() => {
                holds++;
            }),
            () => effect,
            () =>
                Effect.sync(() => {
                    holds--;
                    kick();
                }),
        );

    return { clock, scheduler, hold };
};
