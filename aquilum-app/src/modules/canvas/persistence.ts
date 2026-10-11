type CanvasFlush = () => Promise<boolean>;

const flushers = new Set<CanvasFlush>();

export function registerCanvasFlush(flush: CanvasFlush): () => void {
  flushers.add(flush);
  return () => { flushers.delete(flush); };
}

export async function flushCanvasDocuments(): Promise<boolean> {
  const results = await Promise.all([...flushers].map((flush) => flush()));
  return results.every(Boolean);
}
