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
| 100 | 3.710 ms | 3.387 ms | 5 µs | 3 µs | 8.8 / 9.0 MB |
| 1,000 | 51.883 ms | 51.143 ms | 33 µs | 32 µs | 9.8 / 9.9 MB |
| 10,000 | 845.069 ms | 980.718 ms | 343 µs | 261 µs | 16.9 / 19.7 MB |
| 100,000 | 5,871.047 ms | 8,231.686 ms | 2.802 ms | 2.973 ms | 93.3 / 117.1 MB |

Latest rerun: macOS release profile, one local run. RSS is shown as sparse/clustered process-wide snapshots after each case; this includes allocator-retained memory and excludes GPU memory. The harness measures Rust layout time and incremental coordinate seeding only. It does not measure WebGL frame rate, sustained CPU use, or full Tauri process memory.
