#!/usr/bin/env bash
# Launches the release Obsidium binary with an isolated HOME and samples its RSS/CPU.
#
#   scripts/bench/measure-app.sh --home DIR --label cold-empty [--seconds 25]
#
# Output: a TSV of samples plus a summary line (peak RSS, time to RSS plateau, CPU seconds).
# macOS only (uses `ps`, `vm_stat` is not needed: RSS is enough at this granularity).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN="${OBSIDIUM_BIN:-$ROOT/../.artifacts/cargo-release/release/obsidium-app}"
HOME_DIR=""
LABEL="run"
SECONDS_TO_SAMPLE=25
INTERVAL=0.1

while [ $# -gt 0 ]; do
  case "$1" in
    --home) HOME_DIR="$2"; shift 2 ;;
    --label) LABEL="$2"; shift 2 ;;
    --seconds) SECONDS_TO_SAMPLE="$2"; shift 2 ;;
    --interval) INTERVAL="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "$HOME_DIR" ] || { echo "--home is required" >&2; exit 2; }
[ -x "$BIN" ] || { echo "binary not found: $BIN" >&2; exit 2; }

OUT="$ROOT/../.artifacts/benchmarks"
mkdir -p "$OUT"
TSV="$OUT/app-$LABEL.tsv"
: > "$TSV"

# Kill leftovers from an earlier run so the single-instance plugin does not short-circuit startup.
pkill -f "$(basename "$BIN")" 2>/dev/null || true
sleep 0.5

START_NS=$(python3 -c 'import time; print(time.time_ns())')
HOME="$HOME_DIR" "$BIN" >"$OUT/app-$LABEL.log" 2>&1 &
APP_PID=$!

peak=0
plateau_ms=""
last_rss=0
stable_since=""

while kill -0 "$APP_PID" 2>/dev/null; do
  now_ns=$(python3 -c 'import time; print(time.time_ns())')
  elapsed_ms=$(( (now_ns - START_NS) / 1000000 ))
  line=$(ps -o rss=,pcpu=,thcount= -p "$APP_PID" 2>/dev/null || true)
  [ -n "$line" ] || break
  rss_kb=$(echo "$line" | awk '{print $1}')
  cpu=$(echo "$line" | awk '{print $2}')
  threads=$(echo "$line" | awk '{print $3}')
  printf '%s\t%s\t%s\t%s\n' "$elapsed_ms" "$rss_kb" "$cpu" "$threads" >> "$TSV"
  if [ "$rss_kb" -gt "$peak" ]; then peak=$rss_kb; fi
  if [ "$rss_kb" -eq "$last_rss" ]; then
    if [ -z "$stable_since" ]; then stable_since=$elapsed_ms; fi
  else
    stable_since=""
  fi
  last_rss=$rss_kb
  if [ "$elapsed_ms" -ge $((SECONDS_TO_SAMPLE * 1000)) ]; then break; fi
  sleep "$INTERVAL"
done

cpu_time=$(ps -o time= -p "$APP_PID" 2>/dev/null | tr -d ' ' || true)
kill "$APP_PID" 2>/dev/null || true
wait "$APP_PID" 2>/dev/null || true

python3 - "$TSV" "$LABEL" "$peak" "$cpu_time" <<'PY'
import sys, statistics
path, label, peak, cpu_time = sys.argv[1:5]
rows = []
with open(path) as handle:
    for line in handle:
        parts = line.split()
        if len(parts) >= 3:
            threads = int(parts[3]) if len(parts) > 3 else 0
            rows.append((int(parts[0]), int(parts[1]), float(parts[2]), threads))
if not rows:
    print(f"app={label} samples=0")
    raise SystemExit
rss = [row[1] for row in rows]
final = rss[-1]
plateau = next(
    (row[0] for row in rows if row[1] >= final * 0.98),
    rows[-1][0],
)
idle_cpu = statistics.median(row[2] for row in rows[-30:])
startup_cpu = sum(row[2] for row in rows if row[0] <= plateau) / 100 * (rows[1][0] / 1000 if len(rows) > 1 else 0)
print(
    f"app={label} samples={len(rows)} peak_rss_mb={max(rss)/1024:.1f} "
    f"final_rss_mb={final/1024:.1f} rss_plateau_ms={plateau} "
    f"idle_cpu_pct={idle_cpu:.1f} threads_max={max(row[3] for row in rows)} "
    f"cpu_time={cpu_time} sampled_ms={rows[-1][0]}"
)
PY
