import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks — replace OpenAI-driven runAgent and Telegram I/O so the test
// is fast and deterministic. We keep the real session store (in-memory fallback
// since REDIS_URL is the default 'redis://localhost:6379' which the context
// module treats as "no Redis configured").
vi.mock('../../src/modules/agent.js', () => ({
  runAgent: vi.fn(),
  openaiLimiter: { stats: () => ({ active: 0, queued: 0, max: 5 }) },
}));

vi.mock('../../src/channels/telegram.js', () => ({
  sendMessage: vi.fn().mockResolvedValue({}),
  sendChatAction: vi.fn().mockResolvedValue({}),
  getMe: vi.fn().mockResolvedValue({ id: 0, username: 'test_bot' }),
  setWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  hasTelegram: () => false,
  buildWebhookUrl: () => '',
}));

import { runAgent } from '../../src/modules/agent.js';
import { sendMessage } from '../../src/channels/telegram.js';
import { getSession, saveSession, resetSession } from '../../src/modules/context.js';
import { handleAgent } from '../../src/routes/telegram.js';

// Test factories
let _testCounter = 0;
function uniqueSessionId() {
  return `tg:test:${Date.now()}:${++_testCounter}`;
}

function makeMsg(chatId = 999) {
  return { chat: { id: chatId }, message_thread_id: undefined };
}

function makeProduct(overrides = {}) {
  return {
    id: 'gid://shopify/Product/123',
    sku: 'MYMJ3AE/A',
    title: 'iPhone 17 Pro Max 256GB Deep Blue Middle East',
    price_aed: 5139,
    in_stock: true,
    category: 'iPhone',
    family: 'iPhone 17',
    model_key: 'iPhone 17 Pro Max',
    storage_gb: 256,
    color: 'Deep Blue',
    region: 'Middle East',
    url: 'https://alasil.ae/products/iphone-17-pro-max-256gb-deep-blue',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SC#2 confirmation-flow integration', () => {
  it('Turn 1 SETs pending_action when runAgent returns 1 product without URL', async () => {
    const sessionId = uniqueSessionId();
    await resetSession(sessionId);

    runAgent.mockResolvedValueOnce({
      text: 'Is this the one — iPhone 17 Pro Max 256GB Deep Blue?',
      products: [makeProduct()],
      toolCalls: [{ name: 'findProduct', count: 1 }],
      iterations: 2,
      latency_ms: 1200,
    });

    const session = await getSession(sessionId);
    await handleAgent(makeMsg(), session, sessionId, 'iphone 17 pro max 256');

    const after = await getSession(sessionId);
    expect(after.pending_action).toBe('awaiting_confirmation');
    expect(after.pending_product_id).toBe('gid://shopify/Product/123');
    expect(after.pending_action_category).toBe('iPhone');
    expect(typeof after.pending_action_ts).toBe('number');
    expect(after.last_products).toHaveLength(1);
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('Turn 2 with "yes" fires SC and DOES NOT call runAgent', async () => {
    const sessionId = uniqueSessionId();
    await resetSession(sessionId);

    // Turn 1: SET pending_action
    runAgent.mockResolvedValueOnce({
      text: 'Is this the one?',
      products: [makeProduct()],
      toolCalls: [],
      iterations: 1,
      latency_ms: 800,
    });
    let session = await getSession(sessionId);
    await handleAgent(makeMsg(), session, sessionId, 'iphone 17 pro max');
    expect(runAgent).toHaveBeenCalledTimes(1);

    // Turn 2: user says "yes" — SC must fire, runAgent must NOT be invoked
    session = await getSession(sessionId);
    await handleAgent(makeMsg(), session, sessionId, 'yes');

    expect(runAgent).toHaveBeenCalledTimes(1); // still 1, not 2
    expect(sendMessage).toHaveBeenCalledTimes(2); // both turns sent

    // Turn 2's reply should be the SC reply containing the URL
    const lastSend = sendMessage.mock.calls[sendMessage.mock.calls.length - 1];
    const lastSendText = lastSend[1];
    expect(lastSendText).toContain('Confirmed');
    expect(lastSendText).toContain('https://alasil.ae/products/iphone-17-pro-max-256gb-deep-blue');
    expect(lastSendText).toContain('Anything else?');

    // Pending state should be cleared after SC fired
    const after = await getSession(sessionId);
    expect(after.pending_action).toBe(null);
    expect(after.pending_product_id).toBe(null);
  });

  it('Turn 2 with "yes" but >60s elapsed → SC does NOT fire, runAgent IS called', async () => {
    const sessionId = uniqueSessionId();
    await resetSession(sessionId);

    runAgent.mockResolvedValueOnce({
      text: 'Is this the one?',
      products: [makeProduct()],
      toolCalls: [],
      iterations: 1,
      latency_ms: 800,
    });
    let session = await getSession(sessionId);
    await handleAgent(makeMsg(), session, sessionId, 'iphone 17 pro max');

    // Backdate the pending_action_ts by 61 seconds so the staleness check fires.
    session = await getSession(sessionId);
    session.pending_action_ts = Date.now() - 61_000;
    await saveSession(sessionId, session);

    runAgent.mockResolvedValueOnce({
      text: 'Sorry, what would you like?',
      products: [],
      toolCalls: [],
      iterations: 1,
      latency_ms: 700,
    });

    session = await getSession(sessionId);
    await handleAgent(makeMsg(), session, sessionId, 'yes');

    // SC should NOT have fired — runAgent invoked normally for turn 2.
    expect(runAgent).toHaveBeenCalledTimes(2);

    const after = await getSession(sessionId);
    expect(after.pending_action).toBe(null); // staleness check cleared it
  });

  it('Turn 2 with "yes" but pending_product_id missing → fail-open to runAgent', async () => {
    const sessionId = uniqueSessionId();
    await resetSession(sessionId);

    runAgent.mockResolvedValueOnce({
      text: 'Is this the one?',
      products: [makeProduct()],
      toolCalls: [],
      iterations: 1,
      latency_ms: 800,
    });
    let session = await getSession(sessionId);
    await handleAgent(makeMsg(), session, sessionId, 'iphone 17 pro max');

    // Simulate /reset between turns: clear last_products but leave pending_action set.
    // (Edge case the spec calls out — pathological, but must not wedge.)
    session = await getSession(sessionId);
    session.last_products = [];
    await saveSession(sessionId, session);

    runAgent.mockResolvedValueOnce({
      text: 'Sure — what would you like?',
      products: [],
      toolCalls: [],
      iterations: 1,
      latency_ms: 700,
    });

    session = await getSession(sessionId);
    await handleAgent(makeMsg(), session, sessionId, 'yes');

    // Fail-open: SC bailed, runAgent invoked normally.
    expect(runAgent).toHaveBeenCalledTimes(2);

    const after = await getSession(sessionId);
    expect(after.pending_action).toBe(null); // cleared during fail-open
  });

  it('Category change between turns clears pending_action', async () => {
    const sessionId = uniqueSessionId();
    await resetSession(sessionId);

    // Turn 1: SET awaiting_confirmation for iPhone
    runAgent.mockResolvedValueOnce({
      text: 'Is this the one?',
      products: [makeProduct()],
      toolCalls: [],
      iterations: 1,
      latency_ms: 800,
    });
    let session = await getSession(sessionId);
    await handleAgent(makeMsg(), session, sessionId, 'iphone 17 pro max');

    session = await getSession(sessionId);
    expect(session.pending_action).toBe('awaiting_confirmation');
    expect(session.pending_action_category).toBe('iPhone');

    // Turn 2: customer pivots to Mac. runAgent returns Mac results
    // → focus.category becomes "Mac" → pending state cleared.
    runAgent.mockResolvedValueOnce({
      text: 'Here are some MacBook options...',
      products: [
        makeProduct({
          id: 'gid://shopify/Product/999',
          title: 'MacBook Air M5 13"',
          category: 'Mac',
          family: 'MacBook Air',
          model_key: 'MacBook Air 13" (M5)',
          url: 'https://alasil.ae/products/macbook-air-m5',
        }),
        makeProduct({
          id: 'gid://shopify/Product/1000',
          title: 'MacBook Pro M5 14"',
          category: 'Mac',
          family: 'MacBook Pro',
          url: 'https://alasil.ae/products/macbook-pro-m5',
        }),
      ],
      toolCalls: [{ name: 'findProduct', count: 2 }],
      iterations: 2,
      latency_ms: 1500,
    });

    session = await getSession(sessionId);
    await handleAgent(makeMsg(), session, sessionId, 'actually macbook air');

    const after = await getSession(sessionId);
    expect(after.pending_action).toBe(null); // cleared by category-change
    expect(after.pending_product_id).toBe(null);
    expect(after.focus?.category).toBe('Mac');
  });

  it('Turn 2 with non-affirmative ("not really") does NOT fire SC, runAgent called', async () => {
    const sessionId = uniqueSessionId();
    await resetSession(sessionId);

    // Turn 1: SET
    runAgent.mockResolvedValueOnce({
      text: 'Is this the one?',
      products: [makeProduct()],
      toolCalls: [],
      iterations: 1,
      latency_ms: 800,
    });
    let session = await getSession(sessionId);
    await handleAgent(makeMsg(), session, sessionId, 'iphone 17 pro max');

    // Turn 2: user says "not really" → not affirmative → runAgent invoked
    runAgent.mockResolvedValueOnce({
      text: 'No problem — what would you prefer?',
      products: [],
      toolCalls: [],
      iterations: 1,
      latency_ms: 600,
    });
    session = await getSession(sessionId);
    await handleAgent(makeMsg(), session, sessionId, 'not really');

    expect(runAgent).toHaveBeenCalledTimes(2);
  });

  it('Turn 1 returning a URL in the reply does NOT SET pending_action', async () => {
    const sessionId = uniqueSessionId();
    await resetSession(sessionId);

    runAgent.mockResolvedValueOnce({
      text: 'Confirmed — iPhone 17 Pro Max for AED 5,139. https://alasil.ae/products/iphone-17-pro-max-256gb-deep-blue',
      products: [makeProduct()],
      toolCalls: [],
      iterations: 1,
      latency_ms: 800,
    });

    const session = await getSession(sessionId);
    await handleAgent(makeMsg(), session, sessionId, 'iphone 17 pro max');

    const after = await getSession(sessionId);
    expect(after.pending_action).toBe(null); // URL emitted, nothing pending
  });

  it('Persian/Arabic affirmatives also fire SC', async () => {
    // Single test exercising both languages — fast verification that the
    // multi-language isAffirmative integrates correctly with handleAgent.
    for (const yesWord of ['آره', 'baleh', 'نعم', 'are']) {
      const sessionId = uniqueSessionId();
      await resetSession(sessionId);

      runAgent.mockResolvedValueOnce({
        text: 'Is this the one?',
        products: [makeProduct()],
        toolCalls: [],
        iterations: 1,
        latency_ms: 800,
      });
      let session = await getSession(sessionId);
      await handleAgent(makeMsg(), session, sessionId, 'iphone 17 pro max');

      const callsBefore = runAgent.mock.calls.length;
      session = await getSession(sessionId);
      await handleAgent(makeMsg(), session, sessionId, yesWord);

      // SC must have fired — runAgent count unchanged
      expect(runAgent.mock.calls.length).toBe(callsBefore);

      const after = await getSession(sessionId);
      expect(after.pending_action).toBe(null);
    }
  });
});
