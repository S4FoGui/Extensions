// tests/setup.js - global test setup for vitest
import { vi } from 'vitest';

// Mock chrome.* APIs
global.chrome = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    getURL: vi.fn((path) => `chrome-extension://test/${path}`),
    lastError: null
  },
  tabs: {
    create: vi.fn(),
    update: vi.fn(),
    query: vi.fn(),
    sendMessage: vi.fn(),
    captureVisibleTab: vi.fn()
  },
  scripting: {
    executeScript: vi.fn()
  },
  storage: {
    local: { get: vi.fn(), set: vi.fn() },
    session: { get: vi.fn(), set: vi.fn() },
    sync: { get: vi.fn(), set: vi.fn() }
  },
  action: {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
    onClicked: { addListener: vi.fn() }
  },
  sidePanel: {
    open: vi.fn()
  },
  windows: {
    getLastFocused: vi.fn(),
    create: vi.fn()
  }
};

// Mock PROVIDERS from config.js (loaded before tests)
global.PROVIDERS = [
  {
    id: 'openai',
    name: 'ChatGPT',
    webUrl: 'https://chatgpt.com/',
    web: {
      composer: ['#prompt-textarea'],
      send: ['button[data-testid="send-button"]'],
      answer: ['[data-message-author-role="assistant"]'],
      stop: ['button[data-testid="stop-button"]'],
      login: ['a[href*="login"]']
    }
  },
  {
    id: 'anthropic',
    name: 'Claude',
    webUrl: 'https://claude.ai/new',
    web: {
      composer: ['div[data-testid="composer"]'],
      send: ['button[aria-label*="Send"]'],
      answer: ['[data-testid="conversation-turn"]'],
      stop: ['button[aria-label*="Stop"]'],
      login: ['a[href*="login"]']
    }
  }
];

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});