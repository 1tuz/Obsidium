# Frontend Bundle Size

Measured with `npm run build` in `aquilum-app`; values are emitted asset sizes, followed by gzip sizes.

| Asset | Before Theme Engine follow-up | After Theme Engine follow-up | Change |
| --- | ---: | ---: | ---: |
| Main JavaScript | 1,015.83 kB (339.02 kB gzip) | 1,018.81 kB (340.10 kB gzip) | +2.98 kB (+1.08 kB gzip) |
| Main CSS | 150.17 kB (24.99 kB gzip) | 155.79 kB (26.09 kB gzip) | +5.62 kB (+1.10 kB gzip) |

Settings dialog and sections are emitted as separate lazy chunks, including `UiSection`, `FilesSection`, and `AnalysisSection`. The main JavaScript chunk still triggers Vite's 500 kB advisory; the build succeeds. No RAM benchmark runs in CI.
