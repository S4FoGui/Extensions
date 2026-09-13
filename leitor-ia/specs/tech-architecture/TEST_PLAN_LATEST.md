# Test Design: Leitor IA Chrome Extension

## 1. Risk Matrix & Scenarios

| Scenario ID | Behavior Description | Risk | Test Level | Target File/Module |
|-------------|----------------------|------|------------|--------------------|
| SC-P0-01 | Web free mode: hidden tab creation, content script injection, question send, response capture | P0 | E2E | background.js:webAsk, content.js:fillAndSend/watchAnswer |
| SC-P0-02 | Web free mode: existing tab reuse (injects scripts if missing) | P0 | E2E | background.js:webAsk/webBridge |
| SC-P0-03 | Web free mode: Brave/Chromium tab freezing defeated by kickTab | P0 | E2E | background.js:kickTab |
| SC-P0-04 | Response streaming: MutationObserver captures deltas, finishes on copy button / silence | P0 | E2E | content.js:watchAnswer |
| SC-P0-05 | Login barrier detection: returns needLogin with reason | P0 | Integration | content.js:loginBarrier/findComposer |
| SC-P0-06 | Provider selectors: composer/send/answer/stop work for all 5 providers | P0 | Integration | config.js:PROVIDERS[*].web |
| SC-P1-01 | API key mode: direct API call with correct payload/effort | P1 | Integration | background.js:apiAsk |
| SC-P1-02 | OAuth (Gemini): token exchange, refresh, expiry | P1 | Integration | background.js:oauth handlers |
| SC-P1-03 | Page context capture: extractLocalPage returns title/text/selection | P1 | Unit | content.js:extractLocalPage |
| SC-P1-04 | Panel UI: model selector, effort selector, page toggle persist | P1 | E2E | panel.js:persist/syncModelUI |
| SC-P1-05 | Markdown rendering: paragraphs, lists, code, blockquotes, links | P1 | Unit | panel.js:renderMarkdown |
| SC-P1-06 | Plain text response formatting: numbered lists → bullets, double newlines → paragraphs | P1 | Unit | panel.js:renderMarkdown |
| SC-P2-01 | Custom model endpoint: custom baseUrl + model ID | P2 | Integration | background.js:custom model handling |
| SC-P2-02 | Multimodal: screenshot captured + sent with question | P2 | Integration | background.js:captureActiveTabScreenshot |
| SC-P2-03 | Panel modes: inpage drawer, sidepanel, docked left/right | P2 | E2E | background.js:toggleInPage/openDocked |
| SC-P3-01 | Settings persistence: prefs sync across reloads | P3 | Unit | panel.js:persist/load |

## 2. Fixture Architecture & Isolation

### Test Helpers (to be created in `tests/`)

```javascript
// tests/fixtures/providers.js
export const mockProviders = [
  { id: 'openai', name: 'ChatGPT', webUrl: 'https://chatgpt.com/', web: {...} },
  { id: 'anthropic', name: 'Claude', webUrl: 'https://claude.ai/new', web: {...} },
  { id: 'google', name: 'Gemini', webUrl: 'https://gemini.google.com/app', web: {...} },
  { id: 'kimi', name: 'Kimi', webUrl: 'https://kimi.ai/', web: {...} },
  { id: 'zai', name: 'Z.AI (GLM)', webUrl: 'https://chat.z.ai/', web: {...} }
];

// tests/fixtures/mockTab.js
export function createMockTab(overrides = {}) {
  return {
    id: 123,
    url: 'https://chatgpt.com/',
    active: true,
    ...overrides
  };
}

// tests/fixtures/mockResponse.js
export function createStreamingResponse(chunks, delayMs = 50) {
  let i = 0;
  return {
    async *[Symbol.asyncIterator]() {
      while (i < chunks.length) {
        await new Promise(r => setTimeout(r, delayMs));
        yield chunks[i++];
      }
    }
  };
}
```

### Network Intercepts (MSW-style for background.js)
```javascript
// tests/mocks/apiHandlers.js
export const apiHandlers = [
  http.post('https://api.openai.com/v1/chat/completions', ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({
      choices: [{ message: { content: 'Mock response' } }]
    });
  }),
  http.post('https://api.anthropic.com/v1/messages', () => HttpResponse.json({
    content: [{ type: 'text', text: 'Mock response' }]
  }))
];
```

### Content Script Test DOM
```javascript
// tests/fixtures/providerDOMs.js
export const providerDOMs = {
  openai: {
    composer: '<div id="prompt-textarea" contenteditable="true"></div>',
    send: '<button data-testid="send-button"></button>',
    answer: '<div data-message-author-role="assistant"><div class="markdown">Resposta</div></div>',
    stop: '<button data-testid="stop-button"></button>'
  },
  anthropic: {
    composer: '<div data-testid="composer" contenteditable="true" class="ProseMirror"></div>',
    send: '<button aria-label="Send"></button>',
    answer: '<div data-testid="conversation-turn"><div data-message-author-role="assistant">Resposta</div></div>',
    stop: '<button aria-label="Stop generating"></button>'
  }
  // ... google, kimi, zai
};
```

## 3. NFR Verification

| NFR Type | Requirement | Verification Command |
|----------|-------------|----------------------|
| Perf | Background startup < 100ms | `npm run test:perf:startup` |
| Perf | Content script injection < 200ms | `npm run test:perf:injection` |
| Perf | First delta within 3s of send | `npm run test:perf:first-delta` |
| Reliability | 100 consecutive webAsk calls no leak | `npm run test:reliability:webask` |
| Compat | Works in Chrome 118+, Brave, Edge | Manual matrix |
| A11y | Panel keyboard navigable | `npm run test:a11y` |

## 4. Test Commands (package.json scripts)

```json
{
  "test:unit": "vitest run tests/unit",
  "test:integration": "vitest run tests/integration",
  "test:e2e": "playwright test tests/e2e",
  "test:perf:startup": "node tests/perf/startup.js",
  "test:perf:first-delta": "node tests/perf/first-delta.js",
  "test:reliability:webask": "node tests/reliability/webask.js",
  "test:a11y": "axe-core tests/a11y/panel.html"
}
```

## 5. Out of Scope

- Testing actual provider websites (flaky, external dependency)
- OAuth flow with real Google accounts (requires credentials)
- Cross-browser extension packaging (tested manually per release)
- Load testing background service worker (single-user extension)

## 6. CI Pipeline (GitHub Actions)

```yaml
# .github/workflows/test.yml
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run test:unit
      - run: npm run test:integration
      - run: npm run test:e2e
        env:
          DISPLAY: ':99'
      - run: npm run test:a11y
```

---

### Next Steps for Implementation

1. **Unit tests** (`tests/unit/`): renderMarkdown, extractLocalPage, loginBarrier, findComposer
2. **Integration tests** (`tests/integration/`): webAsk with mocked chrome.* APIs, apiAsk with MSW
3. **E2E tests** (`tests/e2e/`): Playwright + extension loading, real provider pages (optional, tagged @manual)
4. **Perf/Realiability**: Custom Node scripts measuring timing

Run `npm test` after implementing test infrastructure.