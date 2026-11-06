import { Array as Arr, ConfigProvider, Effect, Layer, Predicate, Record, Ref } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

// A request as the collector receives it.
export interface Received {
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Uint8Array;
}

// An HttpClient standing in for a collector. It records every request and answers the n-th one (from 0) with
// `status(n)`.
export const recordingCollector = (status: (n: number) => number = () => 200) =>
    Effect.map(Ref.make<ReadonlyArray<Received>>([]), (received) => ({
        received: Ref.get(received),
        layer: Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
                Ref.modify(received, (all) => [
                    HttpClientResponse.fromWeb(request, new Response(null, { status: status(all.length) })),
                    Arr.append(all, {
                        url: request.url,
                        headers: { ...request.headers },
                        body: Predicate.isTagged(request.body, "Uint8Array") ? request.body.body : new Uint8Array(),
                    }),
                ]),
            ),
        ),
    }));

// The parts of a request that the environment decides. `user-agent` names the exporter, and `content-length`
// varies with the random span ids, so both are left out.
export const configured = (request: Received) => ({
    url: request.url,
    headers: Record.remove(Record.remove(request.headers, "user-agent"), "content-length"),
});

export const env = (variables: Readonly<Record<string, string>>) =>
    ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ...variables } }));
