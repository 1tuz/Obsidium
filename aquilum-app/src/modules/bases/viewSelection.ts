export function resolveBaseViewIndex(
  requestedIndex: number | null | undefined,
  savedIndex: number | null | undefined,
  viewCount: number,
): number {
  if (viewCount <= 0) return 0;
  const candidate = requestedIndex ?? savedIndex ?? 0;
  return Math.max(0, Math.min(Math.floor(candidate), viewCount - 1));
}
