import { Context, Effect, Layer, Path } from "effect";

export interface InputFileOptions {
    readonly file: string;
    readonly follow: boolean;
    readonly pollMillis?: number | undefined;
}

export class InputFile extends Context.Service<
    InputFile,
    {
        readonly file: string;
        readonly bodiesDir: string;
        readonly follow: boolean;
        readonly pollMillis: number;
    }
>()("@wmaurer/otelscope/data/InputFile") {
    static readonly layer = (options: InputFileOptions) =>
        Layer.effect(
            InputFile,
            Effect.gen(function* () {
                const path = yield* Path.Path;
                const file = path.resolve(options.file);
                return InputFile.of({
                    file,
                    bodiesDir: path.join(path.dirname(file), "bodies"),
                    follow: options.follow,
                    pollMillis: options.pollMillis ?? 1000,
                });
            }),
        );
}
