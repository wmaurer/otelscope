# Collector

When the `OTEL_*` variables name a collector, `OtelscopeTracer.layer` sends every span to it as OTLP/HTTP
protobuf, beside the file or without one. The collector rules are Effect 4.1's `OtlpTracer.layerFromConfig`
rules: `OTEL_TRACES_EXPORTER` must list `otlp`, and the endpoint is `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` or
`OTEL_EXPORTER_OTLP_ENDPOINT` plus `/v1/traces`.

## Sub-features

- `collector-both` sends the collector the same spans the file gets.
- `collector-gzip` compresses the request with `OTEL_EXPORTER_OTLP_COMPRESSION=gzip`, and the file still gets
  every span.
- `collector-refused` prints one warning when the collector answers an error, retries, and leaves the file
  complete.

## How to get to it (user POV)

- Provide `OtelscopeTracer.layer({ serviceName, file })` with `NodeServices.layer` and `FetchHttpClient.layer`
  under it, and set `OTEL_TRACES_EXPORTER=otlp` and `OTEL_EXPORTER_OTLP_ENDPOINT`.

## Driving it with drive.sh

Preconditions:

- `$V/doctor.sh` prints `doctor: OK`.

- **File and collector.** Run `$V/drive.sh collector $V/programs/collector.ts`. `exit.txt` is `0`, `stderr.txt`
  is empty, and stdout is two lines: `collector: POST /v1/traces type=application/x-protobuf encoding=none
  bytes=<about 3000> spans=checkout,load-cart,charge answered=200`, then `program finished`. `out/spans.jsonl`
  holds three records, run `collector`.
- **Gzip.** Run `COLLECTOR_GZIP=1 $V/drive.sh collector-gzip $V/programs/collector.ts`. The one request line
  says `encoding=gzip` and about 500 bytes, still with all three span names, and the file has three records.
- **Refused.** Run `COLLECTOR_STATUS=503 $V/drive.sh collector-503 $V/programs/collector.ts`. stdout has three
  request lines, the first post and two retries, each `answered=503`, then `program finished`. `stderr.txt` is
  one line starting `otelscope: the collector at http://127.0.0.1:<port>/v1/traces failed: StatusCode:`.
  `exit.txt` is `0` and the file has three records.

## Gotchas

- The program adds its collector variables with `ConfigProvider.layerAdd`, under the real environment. An
  `OTEL_*` variable set in the shell wins over them.
- The refused run takes about 3 s: the exporter's final flush retries for up to `OTEL_BSP_EXPORT_TIMEOUT`,
  default 3 s, and then gives up.
- `spans=` only checks that each span name occurs in the decompressed body. `test/OtelscopeTracer.test.ts`
  decodes the protobuf.
