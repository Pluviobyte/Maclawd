import { quoteBucket, costOf, isPricingCandidate, priceFor, pricingMeta, updatePrices } from './pricing.js';

export const PRICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const PRICE_RETRY_MS = 60 * 60 * 1000;

/** Background scheduling is separate from pricing: queries never wait for the network.
 * Upstream review: ccusage/ccusage 62b3541 (cached public pricing and failure backoff).
 * Only the public catalog is fetched; missing model names stay in this process.
 */
export function createPricingRefresher({
  meta = pricingMeta, update = updatePrices, lookup = priceFor,
  now = Date.now, intervalMs = 60_000,
} = {}) {
  let running = false;
  let timer = null;
  let inFlight = null;
  let controller = null;
  let queued = false;
  let lastAttempt = -Infinity;
  const missing = new Set();

  function refresh() {
    if (inFlight) return inFlight;
    lastAttempt = now();
    controller = new AbortController();
    const signal = controller.signal;
    inFlight = Promise.resolve().then(() => update({ signal })).then((result) => {
      for (const model of missing) if (lookup(model)) missing.delete(model);
      return result;
    }).finally(() => { inFlight = null; controller = null; });
    return inFlight;
  }

  async function check() {
    if (!running) return;
    if (inFlight) return inFlight.catch(() => undefined);
    const time = now();
    // Clock corrections must not suppress refresh indefinitely.
    if (time >= lastAttempt && time - lastAttempt < PRICE_RETRY_MS) return;
    const info = meta();
    const fetched = Date.parse(info.fetchedAt);
    const stale = info.requiresRefresh === true || !info.models || !Number.isFinite(fetched)
      || fetched > time || time - fetched >= PRICE_MAX_AGE_MS;
    const unknown = [...missing].some((model) => !lookup(model));
    if (!stale && !unknown) return;
    // Background failures keep the old table and never reject into the server loop.
    return refresh().catch(() => undefined);
  }

  function observe(model) {
    if (!running || !isPricingCandidate(model)) return;
    if (missing.size < 100) missing.add(model);
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; void check(); });
  }

  const priceBucket = (model, bucket) => priceBucket.quote(model, bucket).cost;
  priceBucket.quote = (model, bucket) => {
    const quote = quoteBucket(model, bucket);
    if (quote.unpricedTokens > 0) observe(model);
    return quote;
  };
  return {
    refresh, check, priceBucket,
    observe,
    start() {
      if (running) return;
      running = true;
      void check();
      timer = setInterval(() => { void check(); }, intervalMs);
      timer.unref?.();
    },
    stop() {
      running = false;
      clearInterval(timer);
      timer = null;
      controller?.abort();
      missing.clear();
    },
  };
}
