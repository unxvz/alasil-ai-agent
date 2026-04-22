#!/usr/bin/env node
// Quick verification that the concurrency limiter works as advertised.
import { createLimiter, withRetry } from '../src/utils/concurrency.js';

const limiter = createLimiter(3);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function task(id, delayMs) {
  const start = Date.now();
  return limiter(async () => {
    const waited = Date.now() - start;
    console.log(`task #${id} starting after ${waited}ms wait, stats=`, limiter.stats());
    await sleep(delayMs);
    return id;
  });
}

console.log('Firing 10 tasks (200ms each), limiter max=3');
console.log('Expect: 3 concurrent, 4 batches of 3+3+3+1.\n');
const t0 = Date.now();
await Promise.all(Array.from({ length: 10 }, (_, i) => task(i, 200)));
const total = Date.now() - t0;
console.log(`\nTotal time: ${total}ms (expected ~800ms with max=3, 200ms each)`);

console.log('\n─── retry test ───');
let attempts = 0;
const retryResult = await withRetry(
  () => {
    attempts++;
    if (attempts < 3) {
      const err = new Error('fake 429');
      err.status = 429;
      throw err;
    }
    return 'success after ' + attempts + ' attempts';
  },
  { retries: 3, baseDelayMs: 100, label: 'test' }
);
console.log('Retry result:', retryResult);
