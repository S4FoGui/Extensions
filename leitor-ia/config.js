// ============================================================
// Configuração compartilhada (painel + service worker + content
// script — este arquivo também é injetado nas páginas).
// Modelos espelhados nas versões web (2026); `vision` indica
// suporte a imagem (multimodal) na API oficial.
// `web.*` centraliza os seletores DOM da automação web grátis.
// ============================================================

const PROVIDERS = [
  {
    id: "openai",
    name: "ChatGPT",
    consoleUrl: "https://platform.openai.com/api-keys",
    baseUrl: "https://api.openai.com/v1",
    keyPlaceholder: "sk-…",
    effortHint: "Controla o reasoning_effort (Extra/Máx equivalem a high na OpenAI).",
    webUrl: "https://chatgpt.com/",
    web: {
      composer: [
        'form[data-type="unified-composer"] #prompt-textarea[contenteditable="true"]',
        '#prompt-textarea.ProseMirror[contenteditable="true"]',
        '#prompt-textarea',
        '[data-testid="prompt-textarea"]',
        'div[contenteditable="true"][data-lexical-editor="true"]',
        'div[contenteditable="true"]'
      ],
      send: [
        'button[data-testid="send-button"]',
        'button[aria-label*="Send prompt"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="Enviar"]'
      ],
      answer: [
        'section[data-turn="assistant"] [data-message-author-role="assistant"]',
        '[data-message-author-role="assistant"]',
        '.markdown.prose',
        '.agent-turn',
        "main article"
      ],
      stop: [
        'button[data-testid="stop-button"]',
        'button[aria-label*="Stop"]',
        'button[aria-label*="Parar"]'
      ],
      generating: [
        '.result-streaming[aria-busy="true"]',
        '[data-testid*="thinking"]',
        '[data-testid*="reasoning"]'
      ],
      login: [
        'a[href*="login"]', 'a[href*="auth/login"]',
        'input[type="password"]',
        "#challenge-stage", ".cf-browser-verification", ".cloudflare-challenge"
      ]
    },
    models: [
      { id: "gpt-5.2", label: "GPT-5.2", effort: true, vision: true },
      { id: "gpt-5.2-pro", label: "GPT-5.2 Pro", effort: true, vision: true },
      { id: "gpt-5.1", label: "GPT-5.1", effort: true, vision: true },
      { id: "gpt-5-mini", label: "GPT-5 Mini", effort: true, vision: true },
      { id: "gpt-5.4-nano", label: "GPT-5.4 Nano", effort: true, vision: true },
      { id: "o3", label: "o3 (raciocínio)", effort: true, vision: true },
      { id: "gpt-4.1", label: "GPT-4.1 (rápido)", effort: false, vision: true }
    ]
  },
  {
    id: "anthropic",
    name: "Claude",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    baseUrl: "https://api.anthropic.com/v1",
    keyPlaceholder: "sk-ant-…",
    effortHint: "Mesmos níveis de esforço do Claude web (low…max) via output_config.effort.",
    webUrl: "https://claude.ai/new",
    web: {
      composer: [
        '[data-testid="chat-input"]',
        'div.ProseMirror[contenteditable="true"]',
        'div.ProseMirror',
        '[data-placeholder][contenteditable]',
        '[aria-label="Message Claude"][contenteditable]',
        'div[role="textbox"][contenteditable]',
        'div[contenteditable="true"]'
      ],
      send: [
        'button[aria-label="Send Message"]',
        'button[aria-label="Send message"]',
        'button[aria-label*="Send"]',
        'button[data-testid="send-button"]',
        'button[aria-label*="Enviar"]'
      ],
      answer: [
        '.font-claude-response',
        '[data-is-streaming]',
        '[data-testid="user-message"] ~ div',
        'div[class*="message"][class*="assistant"]',
        "main article"
      ],
      stop: [
        'button[aria-label*="Stop"]',
        'button[aria-label*="Stop generating"]',
        'button[aria-label*="Parar"]'
      ],
      generating: [
        '[data-is-streaming="true"]'
      ],
      login: [
        'a[href*="login"]', 'input[type="password"]',
        "#challenge-stage", ".cf-browser-verification"
      ]
    },
    models: [
      { id: "claude-sonnet-5", label: "Sonnet 5", effort: true, adaptive: true, vision: true },
      { id: "claude-opus-5", label: "Opus 5", effort: true, adaptive: true, vision: true },
      { id: "claude-fable-5-1", label: "Fable 5.1", effort: true, adaptive: true, vision: true },
      { id: "claude-haiku-4-5", label: "Haiku 4.5", effort: true, vision: true },
      { id: "claude-sonnet-4-5", label: "Sonnet 4.5 (legado)", effort: true, vision: true }
    ]
  },
  {
    id: "google",
    name: "Gemini",
    consoleUrl: "https://aistudio.google.com/apikey",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    keyPlaceholder: "AIza…",
    effortHint: "Gemini 3: thinkingLevel · Gemini 2.5: thinkingBudget (Extra/Máx = high).",
    oauth: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      scope: "https://www.googleapis.com/auth/generative-language"
    },
    webUrl: "https://gemini.google.com/app",
    web: {
      composer: [
        '.ql-editor',
        'rich-textarea [contenteditable="true"]',
        'rich-textarea div[contenteditable="true"]',
        '[aria-label*="message"][contenteditable]',
        'div[role="textbox"][contenteditable]',
        'div[contenteditable="true"]'
      ],
      send: [
        'button[aria-label="Send message"]',
        'button.send-button',
        'button[aria-label*="Send"]',
        'button[aria-label*="Enviar"]',
        'button[data-testid="send-button"]'
      ],
      answer: [
        'message-content',
        '.message-content',
        '.response-content',
        'model-response',
        '.model-response-text',
        '[data-message-author="assistant"]',
        '[data-response-index]'
      ],
      generating: [
        '.model-response-loading',
        'img[src*="sparkle"][class*="anim"]',
        '.pending-response'
      ],
      stop: [
        'button[aria-label*="Stop"]',
        '.stop-button',
        'button[aria-label*="Parar"]'
      ],
      login: [
        'input[type="email"]', 'a[href*="signin"]',
        "#challenge-stage", ".cf-browser-verification"
      ],
      modelSelectors: {
        trigger: '[data-test-id="bard-mode-menu-button"], bard-mode-switcher button, .model-picker-container button',
        items: {
          "gemini-3.1-pro": '[data-test-id="bard-mode-option-pro"], [data-model-id*="pro"]',
          "gemini-3.6-flash": '[data-test-id="bard-mode-option-fast"], [data-model-id*="flash"]',
          "gemini-3.5-flash-lite": '[data-test-id="bard-mode-option-flash-lite"], [data-model-id*="flash-lite"]',
          "gemini-2.5-flash": '[data-test-id="bard-mode-option-fast"]'
        }
      }
    },
    models: [
      { id: "gemini-3.1-pro", label: "3.1 Pro", effort: true, vision: true },
      { id: "gemini-3.6-flash", label: "3.6 Flash", effort: true, vision: true },
      { id: "gemini-3.5-flash-lite", label: "3.5 Flash Lite", effort: true, vision: true },
      { id: "gemini-2.5-flash", label: "2.5 Flash (legado)", effort: true, vision: true }
    ]
  },
  {
    id: "kimi",
    name: "Kimi",
    consoleUrl: "https://platform.moonshot.ai",
    baseUrl: "https://api.moonshot.ai/v1",
    keyPlaceholder: "sk-…",
    effortHint: "Como no Kimi web: o esforço liga (≥ Médio) ou desliga (Baixo) o raciocínio do K3.",
    webUrl: "https://kimi.ai/",
    web: {
      composer: ['div[contenteditable="true"][data-testid*="composer"]', 'div.ProseMirror', 'div[contenteditable="true"]', 'textarea[placeholder*="Mensagem"], textarea[placeholder*="Message"]'],
      send: ['button[aria-label*="Send"]', 'button[aria-label*="Enviar"]', 'button[data-testid="send-button"]', 'button[type="submit"]', '.send-button'],
      answer: [
        'div[data-testid*="message"][data-testid*="assistant"]',
        'div[class*="message"][class*="assistant"]',
        '[data-message-author="assistant"]',
        '[data-role="assistant"]',
        'div.assistant-message',
        '.message-content'
      ],
      stop: ['button[aria-label*="Stop"]', 'button[aria-label*="Parar"]'],
      login: ['a[href*="login"]', 'input[type="password"]', "#challenge-stage", ".cf-browser-verification"]
    },
    models: [
      { id: "kimi-k3", label: "K3", effort: true, vision: true },
      { id: "kimi-k2.6", label: "Kimi K2.6", effort: false, vision: true },
      { id: "moonshot-v1-32k", label: "Moonshot v1 32k", effort: false, vision: false }
    ]
  },
  {
    id: "zai",
    name: "Z.AI (GLM)",
    consoleUrl: "https://z.ai/manage-apikey/api-keys",
    baseUrl: "https://api.z.ai/api/paas/v4",
    keyPlaceholder: "chave Z.AI…",
    effortHint: "Como o Deep Think do Z.ai: Baixo desliga; Médio+ liga o modo thinking.",
    webUrl: "https://chat.z.ai/",
    web: {
      composer: ['textarea#chat-input', 'textarea[placeholder*="build"]', 'div[contenteditable="true"][data-testid*="composer"]', 'div[contenteditable="true"]', 'textarea'],
      send: ['button[aria-label*="Send"]', 'button[aria-label*="Enviar"]', 'button[data-testid="send-button"]', 'button[type="submit"]', '.send-button'],
      answer: [
        'div.assistant-message',
        '.message-content',
        'div[data-testid*="message"][data-testid*="assistant"]',
        'div[class*="message"][class*="assistant"]',
        '[data-message-author="assistant"]',
        '[data-role="assistant"]'
      ],
      stop: ['button[aria-label*="Stop"]', 'button[aria-label*="Parar"]'],
      login: ['a[href*="login"]', 'input[type="password"]', "#challenge-stage", ".cf-browser-verification"]
    },
    models: [
      { id: "glm-5.3", label: "GLM-5.3", effort: true, vision: true },
      { id: "glm-5.3-flash", label: "GLM-5.3-Flash", effort: true, vision: false },
      { id: "glm-5.2", label: "GLM-5.2", effort: true, vision: true }
    ]
  }
];

const EFFORTS = [
  { id: "low", label: "Baixo" },
  { id: "medium", label: "Médio" },
  { id: "high", label: "Alto" },
  { id: "xhigh", label: "Extra" },
  { id: "max", label: "Máx" }
];