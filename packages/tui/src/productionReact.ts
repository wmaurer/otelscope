// @effect-diagnostics processEnvInEffect:off
import { Effect } from "effect";

/**
 * Runs `load` with `NODE_ENV` set to `production` when the user left it unset, and unsets it again after. React picks
 * its build from `NODE_ENV` when it is first loaded, and the development build records a performance measure, with a
 * diff of the props, for every component render, which Node keeps: following a busy file runs out of memory. Set only
 * while the app loads, it does not reach the editor, whose shells and package managers would read it.
 */
export const withProductionReact = <A, E, R>(load: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.suspend(() =>
        process.env.NODE_ENV === undefined
            ? Effect.acquireUseRelease(
                  Effect.sync(() => {
                      process.env.NODE_ENV = "production";
                  }),
                  () => load,
                  () => Effect.sync(() => Reflect.deleteProperty(process.env, "NODE_ENV")),
              )
            : load,
    );
