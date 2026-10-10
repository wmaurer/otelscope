import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Array as Arr, Cause, Console, Effect, Exit, Option, type PlatformError, Runtime } from "effect";

import * as Args from "./cli/Args.ts";
import * as Startup from "./cli/Startup.ts";
import { initialNav } from "./nav/Seed.ts";
import { withProductionReact } from "./productionReact.ts";

const report = (cause: Cause.Cause<Args.UsageError | Startup.StartupError | PlatformError.PlatformError>) =>
    Cause.hasInterruptsOnly(cause)
        ? Effect.void
        : Option.match(Cause.findErrorOption(cause), {
              onNone: () => Console.error(Cause.pretty(cause)),
              onSome: (error) =>
                  error._tag === "UsageError" ? Effect.void : Console.error(`otelscope: ${error.message}`),
          });

// Quit, SIGINT and SIGTERM all end the program normally, and Effect's default maps an interrupt to 130.
const teardown: Runtime.Teardown = (exit, onExit) =>
    Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause) ? onExit(0) : Runtime.defaultTeardown(exit, onExit);

const program = Effect.gen(function* () {
    const args = yield* Args.parse(Arr.drop(process.argv, 2));
    if (Option.isNone(args)) {
        return;
    }
    yield* Startup.check(args.value, { stdin: process.stdin.isTTY === true, stdout: process.stdout.isTTY === true });
    const nav = initialNav(args.value);
    const app = yield* withProductionReact(Effect.promise(() => import("./app.tsx")));
    yield* app.run(args.value, nav);
}).pipe(Effect.tapCause(report), Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program, { disableErrorReporting: true, teardown });
