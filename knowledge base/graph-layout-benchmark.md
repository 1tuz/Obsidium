# Graph layout benchmark

The ignored core test benchmarks complete graph layout and incremental coordinate seeding on deterministic sparse and clustered graphs. It runs 100, 1,000, 10,000, and 100,000 nodes by default and records elapsed microseconds and process RSS snapshots. The sparse case has a ring plus long-range links. The clustered case connects nodes within groups of 64 and joins adjacent groups with one bridge.

Run the benchmark from the repository root:

```sh
cargo test --release --manifest-path aquilum-app/core/Cargo.toml -p aquilum-core --lib benchmark_graph_layout -- --ignored --nocapture
```

Set `OBSIDIUM_GRAPH_BENCH_SIZES=100,1000` to select sizes. Results print as `BENCH-GRAPH` lines and append to `.artifacts/benchmarks/graph_layout.log` when the directory is writable.

Incremental seeding retains 99% of deterministic path-keyed coordinates (at least one new node) and times the existing `compute_incremental` implementation. This isolates seeding cost from cache construction. RSS is sampled with the platform `ps` command before layout and after each phase; it is a process-wide resident-memory snapshot, not peak allocation or graph-only memory. If `ps` is unavailable or returns an incompatible result, RSS is recorded as unavailable. Allocator retention can keep RSS elevated after temporary layout buffers are released.

The harness uses no extra dependency. Results describe the local release-mode Rust process and hardware; compare runs on the same machine and toolchain. The 100,000-node complete layout may take substantially longer than smaller sizes, so the environment variable allows staged runs without changing the default requested matrix.

## Recorded run

Release run on macOS, sparse and clustered cases:

| Nodes | Sparse full | Clustered full | Sparse incremental | Clustered incremental | Process RSS after case |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 2.904 ms | 3.063 ms | 17 µs | 9 µs | 8.7 / 8.9 MB |
| 1,000 | 47.366 ms | 56.531 ms | 40 µs | 37 µs | 9.6 / 9.7 MB |
| 10,000 | 910.242 ms | 1,045.909 ms | 265 µs | 267 µs | 18.6 / 21.4 MB |
| 100,000 | 6,209.974 ms | 8,777.006 ms | 2.847 ms | 2.833 ms | 91.6 / 114.3 MB |

Latest rerun: macOS release profile on 2026-10-10, one local run. RSS is shown as sparse/clustered process-wide snapshots after each case; this includes allocator-retained memory and excludes GPU memory. The harness measures Rust layout time and incremental coordinate seeding only. It does not measure WebGL frame rate, sustained CPU use, or full Tauri process memory.
