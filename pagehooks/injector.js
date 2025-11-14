(async () => {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
  if (window.__TXTENSION_INITIALISED__) return;
  window.__TXTENSION_INITIALISED__ = true;

  let configResponse;
  try {
    configResponse = await safeRuntimeSendMessage({ type: 'getTxConfig' });
  } catch (error) {
    console.error('[Xtension] Failed to request config', error);
    return;
  }

  if (!configResponse?.success || !configResponse.config) {
    console.error('[Xtension] Config unavailable', configResponse?.error);
    return;
  }

  const config = configResponse.config;
  const storageKey = configResponse.settingsKey || 'txSettings';
  const host = window.location.hostname;

  if (/discord\.com$/i.test(host)) {
    const discordController = new DiscordReplyController(config, storageKey);
    discordController.init().catch((error) => console.error('[Xtension] discord init failed', error));
    return;
  }

  if (!/(^|\.)twitter\.com$/i.test(host) && !/(^|\.)x\.com$/i.test(host) && !/(^|\.)pro\.x\.com$/i.test(host)) {
    return;
  }

  const controller = new TXTimelineController(config, storageKey);
  controller.init().catch((error) => console.error('[Xtension] init failed', error));
})();

// Safe wrapper for chrome.runtime.sendMessage with context validation
async function safeRuntimeSendMessage(message, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      if (!chrome.runtime?.id) {
        throw new Error('Extension context invalidated - chrome.runtime.id is undefined');
      }
      const response = await chrome.runtime.sendMessage(message);
      return response;
    } catch (error) {
      if (error.message?.includes('Extension context invalidated') || error.message?.includes('context invalidated')) {
        console.warn(`[Xtension] Extension context invalidated (attempt ${i + 1}/${retries})`, error);
        if (i === retries - 1) {
          throw new Error('Extension reloaded or updated. Please refresh the page to continue.');
        }
        // Wait a bit before retry
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        throw error;
      }
    }
  }
}

class TXTimelineController {
  constructor(config, storageKey) {
    this.config = config;
    this.storageKey = storageKey;
    this.settings = clone(config.defaultSettings);
    this.buttons = new WeakMap();
    this.overlays = new Map();
    this.observer = null;
    this.boundReposition = this.repositionOverlays.bind(this);
    this.listenersBound = false;
    this.rtlLanguages = new Set(config.rtlLanguages || []);
    this.buttonTimers = new WeakMap();
    this.selectors = {
      tweetArticle: 'article[data-testid="tweet"]',
      replyButton: '[data-testid="reply"], button[aria-label*="Reply"], button[data-testid="reply"]'
    };
  }

  async init() {
    await this.loadSettings();
    this.registerStorageListener();
    this.injectStyles();
    this.observeTimeline();
    this.scanExistingTweets();
  }

  async loadSettings() {
    try {
      const { [this.storageKey]: saved } = await chrome.storage.local.get([this.storageKey]);
      if (saved && typeof saved === 'object') {
        this.settings = deepMerge(clone(this.config.defaultSettings), saved);
      }
    } catch (error) {
      console.warn('[Xtension] Failed to load settings, using defaults', error);
      this.settings = clone(this.config.defaultSettings);
    }
  }

  registerStorageListener() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[this.storageKey]) return;
      const next = changes[this.storageKey].newValue || {};
      this.settings = deepMerge(clone(this.config.defaultSettings), next);
    });
  }

  injectStyles() {
    if (document.getElementById('txtension-styles')) return;
    const style = document.createElement('style');
    style.id = 'txtension-styles';
    style.textContent = `
      .tx-injection-surface {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-left: 4px;
      }
      .tx-message-host {
        position: relative !important;
        padding-right: 96px;
      }
      .rd-reply-container {
        position: absolute;
        top: 50%;
        right: 18px;
        transform: translateY(-50%);
        display: inline-flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        margin: 0;
        padding: 0;
        pointer-events: none;
      }
      .rd-reply-container .tx-trigger {
        width: auto;
        min-width: 46px;
        height: 34px;
        padding: 0 14px;
        pointer-events: auto;
      }
      @media (max-width: 900px) {
        .tx-message-host {
          padding-right: 72px;
        }
        .rd-reply-container {
          right: 12px;
        }
      }
      .tx-trigger {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 52px;
        height: 32px;
        padding: 0 18px;
        border: 1px solid var(--tx-outline);
        border-radius: 999px;
        background:
          linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(74, 144, 255, 0.15) 50%, rgba(16, 214, 255, 0.08) 100%),
          linear-gradient(145deg, rgba(20, 30, 50, 0.98) 0%, rgba(15, 25, 40, 0.92) 100%);
        color: var(--tx-text);
        font-family: ${this.config.theme.fontStack};
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        cursor: pointer;
        transition: all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        position: relative;
        box-shadow:
          0 16px 32px rgba(4, 8, 18, 0.4),
          0 4px 8px rgba(99, 102, 241, 0.15),
          inset 0 1px 0 rgba(255, 255, 255, 0.12),
          inset 0 -1px 0 rgba(0, 0, 0, 0.2);
        backdrop-filter: blur(4px);
      }
      .tx-trigger:hover {
        transform: translateY(-2px) scale(1.05);
        border-color: var(--tx-popup-accent-color, #4b5563);
        box-shadow:
          0 20px 40px rgba(5, 11, 24, 0.5),
          0 8px 16px rgba(99, 102, 241, 0.1),
          inset 0 1px 0 rgba(255, 255, 255, 0.15),
          inset 0 -1px 0 rgba(0, 0, 0, 0.2);
      }
      .tx-trigger:focus-visible {
        outline: 2px solid var(--tx-popup-accent-color, #4b5563);
        outline-offset: 2px;
      }
      .tx-trigger.tx-loading {
        background: rgba(255, 255, 255, 0.06);
        color: #9ca7bd;
        cursor: progress;
      }
      .tx-trigger-label {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
      }
      .tx-overlay {
        position: fixed;
        z-index: 2147483644;
        opacity: 0;
        transform: translate3d(0, 16px, 0) scale(0.96);
        pointer-events: none;
        transition: opacity 0.28s ease, transform 0.34s cubic-bezier(0.18, 0.89, 0.32, 1.28);
      }
      .tx-overlay.tx-visible {
        opacity: 1;
        transform: translate3d(0, 0, 0) scale(1);
        pointer-events: auto;
      }
      .tx-overlay.tx-overlay-fading {
        opacity: 0;
        transform: translate3d(0, 14px, 0) scale(0.97);
        pointer-events: none;
      }
      .tx-overlay-card {
        position: relative;
        width: min(380px, calc(100vw - 36px));
        min-width: min(320px, calc(100vw - 36px));
        background: var(--tx-popup-bg, rgba(9, 13, 22, 0.95));
        border: 1px solid var(--tx-popup-border, rgba(255, 255, 255, 0.08));
        border-radius: 18px;
        box-shadow: var(--tx-popup-shadow, 0 24px 58px rgba(0, 0, 0, 0.4));
        padding: 18px 20px 20px;
        font-family: var(--tx-popup-font, ${this.config.theme.fontStack});
        color: var(--tx-popup-text, #f2f6ff);
        backdrop-filter: blur(22px);
        box-sizing: border-box;
        transition: transform 0.32s ease, box-shadow 0.32s ease;
      }
      .tx-overlay-card::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: radial-gradient(140% 120% at 50% 0%, rgba(29, 211, 248, 0.16), rgba(29, 211, 248, 0));
        opacity: 0;
        transition: opacity 0.3s ease;
        pointer-events: none;
      }
      .tx-overlay-card:hover::before {
        opacity: 0.12;
      }
      .tx-overlay-card:hover {
        box-shadow: var(--tx-popup-shadow, 0 28px 64px rgba(0, 0, 0, 0.42)), 0 14px 34px rgba(0, 0, 0, 0.18);
      }
      .tx-overlay-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 14px;
      }
      .tx-overlay-title {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .tx-overlay-title strong {
        font-size: 15px;
        font-weight: 600;
        color: var(--tx-popup-text, #f2f6ff);
      }
      .tx-overlay-title span {
        font-size: 12px;
        color: var(--tx-popup-subtext, #8d98b1);
      }
      .tx-overlay-close {
        border: none;
        background: transparent;
        color: var(--tx-popup-subtext, #8f9ab4);
        font-size: 18px;
        cursor: pointer;
        line-height: 1;
        padding: 4px;
        border-radius: 8px;
      }
      .tx-overlay-close:hover {
        color: #dfe7ff;
        background: rgba(255, 255, 255, 0.08);
      }
      .tx-output {
        min-height: 110px;
        color: var(--tx-popup-text, #e3ebff);
        font-size: 14px;
        line-height: 1.65;
        white-space: pre-wrap;
        box-sizing: border-box;
        max-height: 220px;
        overflow-y: auto;
        overflow-wrap: break-word;
        word-break: break-word;
        transition: color 0.22s ease;
      }
      .tx-output.placeholder {
        color: var(--tx-popup-subtext, #7d889f);
        font-style: italic;
      }
      .tx-output[dir='rtl'] {
        direction: rtl;
        text-align: right;
      }
      .tx-output[dir='ltr'] {
        direction: ltr;
        text-align: left;
      }
      .tx-reply-composer {
        margin-top: 14px;
        padding: 12px 14px 14px;
        border-radius: 14px;
        border: 1px solid rgba(118, 182, 255, 0.16);
        background: rgba(12, 18, 34, 0.82);
        display: flex;
        flex-direction: column;
        gap: 10px;
        box-sizing: border-box;
      }
      .tx-reply-composer-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.04em;
        color: #f5f7ff;
      }
      .tx-reply-language {
        font-size: 11px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: rgba(200, 214, 245, 0.66);
      }
      .tx-reply-input {
        width: 100%;
        min-height: 60px;
        border-radius: 12px;
        border: 1px solid rgba(118, 182, 255, 0.18);
        background: rgba(8, 12, 22, 0.9);
        color: #f4f7ff;
        font-size: 13px;
        line-height: 1.5;
        padding: 10px 12px;
        resize: vertical;
        font-family: inherit;
        box-sizing: border-box;
        max-height: 160px;
        overflow-y: auto;
        overflow-wrap: break-word;
        word-break: break-word;
      }
      .tx-reply-input:focus {
        outline: none;
        border-color: rgba(96, 168, 255, 0.5);
        box-shadow: 0 0 0 1px rgba(96, 168, 255, 0.28);
      }
      .tx-reply-actions {
        display: flex;
        justify-content: flex-start;
        align-items: flex-start;
        flex-wrap: wrap;
        gap: 10px;
      }
      .tx-reply-language-select-wrapper {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 11px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: rgba(195, 210, 238, 0.64);
        width: 100%;
      }
      .tx-reply-language-select {
        width: 100%;
        border-radius: 10px;
        border: 1px solid rgba(118, 182, 255, 0.24);
        background: rgba(8, 12, 22, 0.88);
        color: #f2f6ff;
        font-size: 12px;
        padding: 8px 10px;
        font-family: ${this.config.theme.fontStack};
        box-sizing: border-box;
      }
      .tx-reply-language-select:focus {
        outline: none;
        border-color: rgba(96, 168, 255, 0.5);
        box-shadow: 0 0 0 1px rgba(96, 168, 255, 0.28);
      }
      .tx-reply-actions .tx-reply-hint {
        font-size: 11px;
        color: rgba(195, 210, 238, 0.68);
        letter-spacing: 0.04em;
        flex: 1 1 140px;
      }
      .tx-reply-translate-btn {
        background: linear-gradient(120deg, rgba(54, 128, 255, 0.96), rgba(16, 214, 255, 0.84));
        border: none;
        border-radius: 999px;
        padding: 7px 14px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.05em;
        color: #07111d;
        cursor: pointer;
        transition: transform 0.18s ease, box-shadow 0.2s ease;
      }
      .tx-reply-translate-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 12px 22px rgba(16, 122, 255, 0.32);
      }
      .tx-reply-translate-btn[disabled] {
        opacity: 0.6;
        cursor: progress;
        transform: none;
        box-shadow: none;
      }
      .tx-reply-output {
        border-radius: 12px;
        border: 1px solid rgba(118, 182, 255, 0.14);
        background: rgba(8, 12, 22, 0.78);
        padding: 12px;
        font-size: 13px;
        line-height: 1.55;
        color: #f0f4ff;
        min-height: 66px;
        white-space: pre-wrap;
        box-sizing: border-box;
        max-height: 160px;
        overflow-y: auto;
        overflow-wrap: break-word;
        word-break: break-word;
      }
      .tx-reply-output.placeholder {
        color: rgba(200, 214, 245, 0.58);
        font-style: italic;
      }
      .tx-reply-output[dir='rtl'] {
        direction: rtl;
        text-align: right;
      }
      .tx-reply-output[dir='ltr'] {
        direction: ltr;
        text-align: left;
      }
      .tx-reply-input[dir='rtl'] {
        text-align: right;
      }
      .tx-reply-input[dir='ltr'] {
        text-align: left;
      }
      .tx-reply-copy-btn {
        align-self: flex-end;
        padding: 6px 14px;
        border-radius: 999px;
        border: 1px solid rgba(118, 182, 255, 0.28);
        background: rgba(12, 18, 32, 0.84);
        color: #e8f1ff;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.05em;
        cursor: pointer;
        transition: transform 0.18s ease, box-shadow 0.2s ease, border 0.2s ease;
        margin-top: 4px;
      }
      .tx-reply-copy-btn:hover:not([disabled]) {
        transform: translateY(-1px);
        border-color: rgba(96, 168, 255, 0.5);
        box-shadow: 0 10px 20px rgba(8, 16, 32, 0.38);
      }
      .tx-reply-copy-btn[disabled] {
        opacity: 0.55;
        cursor: not-allowed;
        box-shadow: none;
        transform: none;
      }
      .tx-reply-composer {
        margin-top: 14px;
        padding: 12px 14px 14px;
        border-radius: 14px;
        border: 1px solid rgba(118, 182, 255, 0.16);
        background: rgba(12, 18, 34, 0.82);
        display: flex;
        flex-direction: column;
        gap: 10px;
        box-sizing: border-box;
      }
      .tx-reply-composer-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.04em;
        color: #f5f7ff;
      }
      .tx-reply-language {
        font-size: 11px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: rgba(200, 214, 245, 0.66);
      }
      .tx-reply-input {
        width: 100%;
        min-height: 60px;
        border-radius: 12px;
        border: 1px solid rgba(118, 182, 255, 0.18);
        background: rgba(8, 12, 22, 0.9);
        color: #f4f7ff;
        font-size: 13px;
        line-height: 1.5;
        padding: 10px 12px;
        resize: vertical;
        font-family: inherit;
        box-sizing: border-box;
        max-height: 160px;
        overflow-y: auto;
        overflow-wrap: break-word;
        word-break: break-word;
      }
      .tx-reply-input:focus {
        outline: none;
        border-color: rgba(96, 168, 255, 0.5);
        box-shadow: 0 0 0 1px rgba(96, 168, 255, 0.28);
      }
      .tx-reply-actions {
        display: flex;
        justify-content: flex-start;
        align-items: flex-start;
        flex-wrap: wrap;
        gap: 10px;
      }
      .tx-reply-language-select-wrapper {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 11px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: rgba(195, 210, 238, 0.64);
        width: 100%;
      }
      .tx-reply-language-select {
        width: 100%;
        border-radius: 10px;
        border: 1px solid rgba(118, 182, 255, 0.24);
        background: rgba(8, 12, 22, 0.88);
        color: #f2f6ff;
        font-size: 12px;
        padding: 8px 10px;
        font-family: ${this.config.theme.fontStack};
        box-sizing: border-box;
      }
      .tx-reply-language-select:focus {
        outline: none;
        border-color: rgba(96, 168, 255, 0.5);
        box-shadow: 0 0 0 1px rgba(96, 168, 255, 0.28);
      }
      .tx-reply-actions .tx-reply-hint {
        font-size: 11px;
        color: rgba(195, 210, 238, 0.68);
        letter-spacing: 0.04em;
        flex: 1 1 140px;
      }
      .tx-reply-translate-btn {
        background: linear-gradient(120deg, rgba(54, 128, 255, 0.96), rgba(16, 214, 255, 0.84));
        border: none;
        border-radius: 999px;
        padding: 7px 14px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.05em;
        color: #07111d;
        cursor: pointer;
        transition: transform 0.18s ease, box-shadow 0.2s ease;
      }
      .tx-reply-translate-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 12px 22px rgba(16, 122, 255, 0.32);
      }
      .tx-reply-translate-btn[disabled] {
        opacity: 0.6;
        cursor: progress;
        transform: none;
        box-shadow: none;
      }
      .tx-reply-output {
        border-radius: 12px;
        border: 1px solid rgba(118, 182, 255, 0.14);
        background: rgba(8, 12, 22, 0.78);
        padding: 12px;
        font-size: 13px;
        line-height: 1.55;
        color: #f0f4ff;
        min-height: 66px;
        white-space: pre-wrap;
        box-sizing: border-box;
        max-height: 160px;
        overflow-y: auto;
        overflow-wrap: break-word;
        word-break: break-word;
      }
      .tx-reply-output.placeholder {
        color: rgba(200, 214, 245, 0.58);
        font-style: italic;
      }
      .tx-reply-output[dir='rtl'] {
        direction: rtl;
        text-align: right;
      }
      .tx-reply-output[dir='ltr'] {
        direction: ltr;
        text-align: left;
      }
      .tx-reply-input[dir='rtl'] {
        text-align: right;
      }
      .tx-reply-input[dir='ltr'] {
        text-align: left;
      }
      .tx-reply-copy-btn {
        align-self: flex-end;
        padding: 6px 14px;
        border-radius: 999px;
        border: 1px solid rgba(118, 182, 255, 0.28);
        background: rgba(12, 18, 32, 0.84);
        color: #e8f1ff;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.05em;
        cursor: pointer;
        transition: transform 0.18s ease, box-shadow 0.2s ease, border 0.2s ease;
        margin-top: 4px;
      }
      .tx-reply-copy-btn:hover:not([disabled]) {
        transform: translateY(-1px);
        border-color: rgba(96, 168, 255, 0.5);
        box-shadow: 0 10px 20px rgba(8, 16, 32, 0.38);
      }
      .tx-reply-copy-btn[disabled] {
        opacity: 0.55;
        cursor: not-allowed;
        box-shadow: none;
        transform: none;
      }
      .tx-toast-stack {
        position: fixed;
        bottom: 24px;
        right: 24px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        z-index: 2147483646;
      }
      .tx-toast {
        min-width: 220px;
        max-width: 320px;
        padding: 12px 16px;
        border-radius: 14px;
        background: rgba(10, 14, 21, 0.94);
        color: #f5f7fa;
        font-size: 12px;
        line-height: 1.5;
        box-shadow: 0 16px 34px rgba(0, 0, 0, 0.32);
        transform: translateY(12px);
        opacity: 0;
        transition: transform 0.24s ease, opacity 0.24s ease;
      }
      .tx-toast strong {
        display: block;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        font-size: 11px;
        margin-bottom: 4px;
      }
      .tx-toast span {
        display: block;
      }
      .tx-toast.tx-visible {
        transform: translateY(0);
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  }

  observeTimeline() {
    if (this.observer) return;
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes?.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches?.(this.selectors.tweetArticle)) {
            this.attachButton(node);
          } else {
            node.querySelectorAll?.(this.selectors.tweetArticle).forEach((article) => this.attachButton(article));
          }
        });
        mutation.removedNodes?.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches?.(this.selectors.tweetArticle)) {
            this.cleanupArticle(node);
          } else {
            node.querySelectorAll?.(this.selectors.tweetArticle).forEach((article) => this.cleanupArticle(article));
          }
        });
      }
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  scanExistingTweets() {
    document.querySelectorAll(this.selectors.tweetArticle).forEach((article) => this.attachButton(article));
  }

  attachButton(article) {
    if (!article || this.buttons.has(article)) return;

    const replyButton = article.querySelector(this.selectors.replyButton);
    if (!replyButton) return;

    const container = replyButton.closest('[role="group"]') || replyButton.parentElement;
    if (!container) return;

    let surface = container.querySelector('[data-tx-surface="true"]');
    if (!surface) {
      surface = document.createElement('div');
      surface.className = 'tx-injection-surface';
      surface.dataset.txSurface = 'true';
      container.appendChild(surface);
    }

    const translateButton = this.createActionButton({
      idle: this.config.buttonStates?.idle || 'TX',
      loading: this.config.buttonStates?.loading || '…',
      success: this.config.buttonStates?.success || 'done',
      error: this.config.buttonStates?.error || 'retry',
      aria: 'Translate tweet',
      testId: 'tx-button'
    });

    translateButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.handleTriggerClick(article, translateButton, 'translate');
    });

    translateButton.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        translateButton.click();
      }
    });

    const replyTrigger = this.createActionButton({
      idle: 'RX',
      loading: this.config.buttonStates?.loading || '…',
      success: this.config.buttonStates?.success || 'done',
      error: this.config.buttonStates?.error || 'retry',
      aria: 'Generate reply with RX',
      testId: 'rx-button'
    });

    replyTrigger.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.handleTriggerClick(article, replyTrigger, 'reply');
    });

    replyTrigger.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        replyTrigger.click();
      }
    });

    surface.appendChild(translateButton);
    surface.appendChild(replyTrigger);
    this.setButtonState(translateButton, 'idle');
    this.setButtonState(replyTrigger, 'idle');
    this.buttons.set(article, { surface, txButton: translateButton, rxButton: replyTrigger });
  }

  cleanupArticle(article) {
    const buttonEntry = this.buttons.get(article);
    if (buttonEntry) {
      if (buttonEntry.txButton) {
        this.clearButtonReset(buttonEntry.txButton);
        buttonEntry.txButton.remove();
      }
      if (buttonEntry.rxButton) {
        this.clearButtonReset(buttonEntry.rxButton);
        buttonEntry.rxButton.remove();
      }
      if (buttonEntry.surface && buttonEntry.surface.childElementCount === 0) {
        buttonEntry.surface.remove();
      }
      this.buttons.delete(article);
    }

    this.dismissOverlay(article, { immediate: true });
  }

  async handleTriggerClick(article, button, mode) {
    const modeLabel = this.getModeLabel(mode);
    const activeOverlay = this.overlays.get(article);
    if (activeOverlay) {
      this.dismissOverlay(article);
      this.clearButtonReset(button);
      this.setButtonState(button, 'idle');
      return;
    }

    this.dismissAllOverlays(article);
    this.clearButtonReset(button);
    this.setButtonState(button, 'loading');
    this.toast(modeLabel, mode === 'reply' ? 'Drafting reply…' : 'Translating tweet…');

    try {
      const tweetContent = this.extractTweet(article);
      if (!tweetContent.language) {
        tweetContent.language = await detectLanguageGuess(tweetContent.text);
      }
      const isReply = mode === 'reply';
      const toneId = isReply ? null : this.settings.tonePreset;
      const languageCode = isReply
        ? tweetContent.language || this.settings.targetLanguage
        : this.settings.targetLanguage;

      let contentResponse;
      if (isReply) {
        contentResponse = await safeRuntimeSendMessage({
          type: 'generateReply',
          tweetContent
        });
        if (!contentResponse?.success) {
          throw new Error(contentResponse?.error || 'Reply unavailable.');
        }
      } else {
        contentResponse = await safeRuntimeSendMessage({
          type: 'translateTweet',
          tweetContent,
          targetLanguage: languageCode,
          toneId: toneId || this.settings.tonePreset
        });
        if (!contentResponse?.success) {
          throw new Error(contentResponse?.error || 'Translation unavailable.');
        }
      }

      const contentText = isReply ? contentResponse.reply : contentResponse.translation;
      const overlay = this.buildOverlay({
        mode,
        article,
        button,
        content: contentText,
        languageCode,
        toneId,
        tweetLanguage: tweetContent.language
      });
      document.body.appendChild(overlay.wrapper);
      requestAnimationFrame(() => overlay.wrapper.classList.add('tx-visible'));
      this.overlays.set(article, overlay);
      this.repositionOverlay(overlay, button);
      this.setupOverlayLifecycle(article, overlay);
      this.ensureGlobalOverlayListeners();

      this.setButtonState(button, 'success');
      this.scheduleButtonReset(button);

      const cleanedContent = (contentText || '').trim();
      const autoCopy = isReply ? !!this.settings.reply?.autoCopy : !!this.settings.autoCopy;
      if (autoCopy && cleanedContent) {
        try {
          await navigator.clipboard.writeText(cleanedContent);
          this.toast(modeLabel, 'Copied to clipboard.');
        } catch (copyError) {
          console.warn('[Xtension] Clipboard copy failed', copyError);
          this.toast(modeLabel, 'Clipboard unavailable — check permissions.');
        }
      }
    } catch (error) {
      console.error(`[Xtension] ${mode === 'reply' ? 'Reply' : 'Translation'} failed`, error);
      this.toast(modeLabel, error.message || (mode === 'reply' ? 'Unable to generate a reply right now.' : 'Unable to translate this tweet right now.'));
      this.setButtonState(button, 'error');
      this.scheduleButtonReset(button);
    }
  }

  buildOverlay({ mode, article, button, content, languageCode, toneId, tweetLanguage }) {
    // Check if this is a reply generation (compact popup) or translation (large overlay)
    const isReply = mode === 'reply';

    const wrapper = document.createElement('div');
    wrapper.className = isReply ? 'tx-compact-popup' : 'tx-overlay';
    wrapper.dataset.txtensionOverlay = 'true';

    const theme = this.resolvePopupTheme();
    const fontStack = this.resolvePopupFont();
    if (theme) {
      wrapper.style.setProperty('--tx-popup-bg', theme.background);
      wrapper.style.setProperty('--tx-popup-border', theme.border);
      wrapper.style.setProperty('--tx-popup-text', theme.text);
      wrapper.style.setProperty('--tx-popup-subtext', theme.subtext);
      wrapper.style.setProperty('--tx-popup-shadow', theme.shadow);
      wrapper.style.setProperty('--tx-popup-backdrop', theme.backdrop || 'blur(20px)');
      wrapper.style.setProperty('--tx-popup-glow', theme.glow || 'transparent');
      // Enhanced theme properties
      // Special case: use sky blue header for light theme
      if (theme.id === 'light') {
        wrapper.style.setProperty('--tx-popup-header-bg', 'linear-gradient(135deg, #87CEEB 0%, #B0E0E6 50%, #87CEFA 100%)');
      } else {
        wrapper.style.setProperty('--tx-popup-header-bg', theme.headerBg || theme.background);
      }
      wrapper.style.setProperty('--tx-popup-accent-color', theme.accentColor || '#3b82f6');
      wrapper.style.setProperty('--tx-popup-focus-glow', theme.focusGlow || '0 0 0 3px rgba(59, 130, 246, 0.2)');
      wrapper.style.setProperty('--tx-popup-button-bg', '#7c3aed');
      wrapper.style.setProperty('--tx-popup-button-hover', '#6d28d9');
    }
    if (fontStack) {
      wrapper.style.setProperty('--tx-popup-font', fontStack);
    }

    const card = document.createElement('div');
    card.className = isReply ? 'tx-compact-card' : 'tx-overlay-card';

    // Declare variables in broader scope to be accessible later
    let dragHandle, resizeHandle;

    let header;
    if (isReply) {
      // Compact header for reply generation
      header = document.createElement('div');
      header.className = 'tx-compact-header';

      // Add close button for compact popup
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'tx-compact-close';
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', () => this.dismissOverlay(article));
      header.appendChild(closeBtn);
    } else {
      // Large header for translation
      header = document.createElement('div');
      header.className = 'tx-overlay-header';

      // Add drag handle for large overlay
      dragHandle = document.createElement('div');
      dragHandle.className = 'tx-drag-handle';
      dragHandle.title = 'Drag to move';
      header.appendChild(dragHandle);

      // Add window controls for large overlay
      const windowControls = document.createElement('div');
      windowControls.className = 'tx-window-controls';

      const minimizeBtn = document.createElement('button');
      minimizeBtn.type = 'button';
      minimizeBtn.className = 'tx-window-control minimize';
      minimizeBtn.innerHTML = '−';
      minimizeBtn.title = 'Minimize';
      minimizeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMinimize(overlay);
      });

      const maximizeBtn = document.createElement('button');
      maximizeBtn.type = 'button';
      maximizeBtn.className = 'tx-window-control maximize';
      maximizeBtn.innerHTML = '□';
      maximizeBtn.title = 'Maximize';
      maximizeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMinimize(overlay);
      });

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'tx-window-control close';
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', () => this.dismissOverlay(article));

      windowControls.appendChild(minimizeBtn);
      windowControls.appendChild(maximizeBtn);
      windowControls.appendChild(closeBtn);
      header.appendChild(windowControls);
    }

    const title = document.createElement('div');
    title.className = isReply ? 'tx-compact-title' : 'tx-overlay-title';
    title.innerHTML = `<strong>${mode === 'reply' ? 'X Reply Draft' : 'Translation'}</strong><span>${this.getOverlaySubtitle(mode, {
      toneId,
      languageCode,
      tweetLanguage
    })}</span>`;

    header.appendChild(title);

    const output = document.createElement('div');
    output.className = isReply ? 'tx-compact-output' : 'tx-output';
    const text = typeof content === 'string' ? content.trim() : '';
    const languageAttr = mode === 'reply' ? tweetLanguage || languageCode : languageCode;
    this.setNodeDirection(output, languageAttr, text);
    output.textContent = text || this.getEmptyMessage(mode);

    card.appendChild(header);

    // Add content section
    if (isReply) {
      // Compact popup: content area
      const contentArea = document.createElement('div');
      contentArea.className = 'tx-compact-content';
      contentArea.appendChild(output);
      card.appendChild(contentArea);

      // Compact popup: actions section with copy button
      const actions = document.createElement('div');
      actions.className = 'tx-compact-actions';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'tx-compact-copy-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.disabled = !text;

      copyBtn.addEventListener('click', async () => {
        if (text) {
          try {
            await navigator.clipboard.writeText(text);
            this.toast('Reply', 'Copied to clipboard.');
          } catch (error) {
            console.warn('[Xtension] Clipboard copy failed', error);
            this.toast('Reply', 'Clipboard unavailable — check permissions.');
          }
        }
      });

      actions.appendChild(copyBtn);
      card.appendChild(actions);
    } else {
      // Large overlay: add output and resize handle
      card.appendChild(output);

      resizeHandle = document.createElement('div');
      resizeHandle.className = 'tx-resize-handle';
      resizeHandle.title = 'Drag to resize';
      card.appendChild(resizeHandle);
    }

    wrapper.appendChild(card);

    const overlay = {
      mode,
      wrapper,
      card,
      button,
      article,
      languageCode,
      toneId,
      output,
      originalLanguage: tweetLanguage,
      hoverCounter: 0,
      dismissTimer: null,
      leaveTimer: null,
      cleanupLifecycle: null,
      dragHandle: isReply ? null : dragHandle,
      resizeHandle: isReply ? null : resizeHandle
    };

    // Setup drag and resize functionality only for large overlay (translation)
    if (!isReply) {
      this.setupDrag(overlay, dragHandle);
      this.setupResize(overlay, resizeHandle);
    }

    // Add reply composer only for translation mode (large overlay)
    if (mode === 'translate') {
      overlay.replyComposer = this.attachReplyComposer({
        overlay,
        container: card,
        targetLanguage: (tweetLanguage || languageCode || this.settings.targetLanguage || 'en').toLowerCase(),
        sourceLanguage: this.settings.targetLanguage,
        originalLanguage: tweetLanguage,
        context: 'twitter'
      });
    }

    return overlay;
  }

  repositionOverlays() {
    this.overlays.forEach((overlay, article) => {
      const targetButton = overlay.button;
      if (!targetButton || !document.body.contains(targetButton)) {
        this.dismissOverlay(article, { immediate: true });
        return;
      }
      this.repositionOverlay(overlay, targetButton);
    });
  }

  repositionOverlay(overlay, button) {
    const rect = button.getBoundingClientRect();
    const cardRect = overlay.card.getBoundingClientRect();
    const width = cardRect.width || 360;
    const height = cardRect.height || 180;

    let left = rect.right + 14;
    if (left + width > window.innerWidth - 12) {
      left = Math.max(12, rect.left - width - 14);
    }

    let top = rect.top - height / 2 + rect.height / 2;
    if (top < 12) top = 12;
    if (top + height > window.innerHeight - 12) {
      top = window.innerHeight - height - 12;
    }

    overlay.wrapper.style.left = `${Math.round(left)}px`;
    overlay.wrapper.style.top = `${Math.round(top)}px`;
  }

  dismissOverlay(article, { immediate = false } = {}) {
    const overlay = this.overlays.get(article);
    if (!overlay) return;
    this.overlays.delete(article);

    if (overlay.cleanupLifecycle) {
      overlay.cleanupLifecycle();
    }
    if (overlay.replyComposer?.cleanup) {
      overlay.replyComposer.cleanup();
    }
    if (overlay.dragCleanup) {
      overlay.dragCleanup();
    }
    if (overlay.resizeCleanup) {
      overlay.resizeCleanup();
    }
    clearTimeout(overlay.dismissTimer);
    clearTimeout(overlay.leaveTimer);

    if (overlay.button) {
      this.clearButtonReset(overlay.button);
      this.setButtonState(overlay.button, 'idle');
    }

    const finalize = () => {
      overlay.wrapper.remove();
      if (!this.overlays.size && this.listenersBound) {
        window.removeEventListener('resize', this.boundReposition);
        window.removeEventListener('scroll', this.boundReposition);
        this.listenersBound = false;
      }
    };

    if (immediate) {
      finalize();
      return;
    }

    overlay.wrapper.classList.add('tx-overlay-fading');
    const handleTransitionEnd = (event) => {
      if (event.target === overlay.wrapper) {
        finalize();
      }
    };
    overlay.wrapper.addEventListener('transitionend', handleTransitionEnd, { once: true });
    setTimeout(finalize, 380);
  }

  toggleMinimize(overlay) {
    if (!overlay || !overlay.card) return;

    const isMinimized = overlay.card.classList.contains('tx-minimized');

    if (isMinimized) {
      // Maximize: Show full overlay
      overlay.card.classList.remove('tx-minimized');
      overlay.card.style.height = '490px';

      // Reposition overlay after maximizing to ensure it's properly positioned
      if (overlay.button && document.body.contains(overlay.button)) {
        setTimeout(() => {
          this.repositionOverlay(overlay, overlay.button);
        }, 50); // Small delay to allow CSS transition
      }
    } else {
      // Minimize: Show only output
      overlay.card.classList.add('tx-minimized');
      overlay.card.style.height = 'auto';
    }
  }

  dismissAllOverlays(exceptArticle = null) {
    Array.from(this.overlays.keys()).forEach((article) => {
      if (article === exceptArticle) return;
      this.dismissOverlay(article);
    });
  }

  ensureGlobalOverlayListeners() {
    if (this.listenersBound) return;
    window.addEventListener('resize', this.boundReposition, { passive: true });
    window.addEventListener('scroll', this.boundReposition, { passive: true });
    this.listenersBound = true;
  }

  setupOverlayLifecycle(article, overlay) {
    const pinEnabled = !!this.settings.pinWindow;
    const targets = [overlay.wrapper, article];

    const scheduleAutoDismiss = () => {
      if (pinEnabled) return;
      clearTimeout(overlay.dismissTimer);
      overlay.dismissTimer = setTimeout(() => {
        if (!this.overlays.has(article)) return;
        if (overlay.hoverCounter === 0) {
          this.dismissOverlay(article);
        }
      }, 10000);
    };

    const handleEnter = () => {
      overlay.hoverCounter += 1;
      clearTimeout(overlay.leaveTimer);
      clearTimeout(overlay.dismissTimer);
    };

    const handleLeave = () => {
      overlay.hoverCounter = Math.max(0, overlay.hoverCounter - 1);
      clearTimeout(overlay.leaveTimer);
      if (pinEnabled) return;
      overlay.leaveTimer = setTimeout(() => {
        if (!this.overlays.has(article)) return;
        if (overlay.hoverCounter === 0) {
          scheduleAutoDismiss();
        }
      }, 220);
    };

    targets.forEach((target) => {
      if (!target) return;
      target.addEventListener('pointerenter', handleEnter);
      target.addEventListener('pointerleave', handleLeave);
    });

    overlay.cleanupLifecycle = () => {
      targets.forEach((target) => {
        if (!target) return;
        target.removeEventListener('pointerenter', handleEnter);
        target.removeEventListener('pointerleave', handleLeave);
      });
      clearTimeout(overlay.leaveTimer);
      clearTimeout(overlay.dismissTimer);
    };

    if (!pinEnabled) {
      scheduleAutoDismiss();
    }
  }

  setupDrag(overlay, dragHandle) {
    const { wrapper } = overlay;
    let isDragging = false;
    let startX, startY, startLeft, startTop;

    const startDrag = (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      const rect = wrapper.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;

      document.body.style.userSelect = 'none';
      e.preventDefault();
    };

    const drag = (e) => {
      if (!isDragging) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      let newLeft = startLeft + deltaX;
      let newTop = startTop + deltaY;

      // Keep within viewport
      const popupWidth = wrapper.offsetWidth;
      const popupHeight = wrapper.offsetHeight;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      newLeft = Math.max(0, Math.min(newLeft, viewportWidth - popupWidth));
      newTop = Math.max(0, Math.min(newTop, viewportHeight - popupHeight));

      wrapper.style.left = `${newLeft}px`;
      wrapper.style.top = `${newTop}px`;
    };

    const endDrag = () => {
      isDragging = false;
      document.body.style.userSelect = '';
    };

    dragHandle.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', endDrag);

    // Cleanup function
    overlay.dragCleanup = () => {
      dragHandle.removeEventListener('mousedown', startDrag);
      document.removeEventListener('mousemove', drag);
      document.removeEventListener('mouseup', endDrag);
    };
  }

  setupResize(overlay, resizeHandle) {
    const { card } = overlay;
    let isResizing = false;
    let startX, startY, startWidth, startHeight;

    const startResize = (e) => {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;

      startWidth = card.offsetWidth;
      startHeight = card.offsetHeight;

      card.classList.add('tx-resizing');
      document.body.style.userSelect = 'none';
      e.preventDefault();
      e.stopPropagation();
    };

    const resize = (e) => {
      if (!isResizing) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      let newWidth = startWidth + deltaX;
      let newHeight = startHeight + deltaY;

      // Apply constraints
      const minWidth = 300;
      const minHeight = 200;
      const maxWidth = window.innerWidth - 40;
      const maxHeight = window.innerHeight - 40;

      newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
      newHeight = Math.max(minHeight, Math.min(newHeight, maxHeight));

      card.style.width = `${newWidth}px`;
      card.style.height = `${newHeight}px`;

      // Smart content management based on size
      this.manageContentVisibility(overlay, newWidth, newHeight);
    };

    const endResize = () => {
      if (!isResizing) return;
      isResizing = false;
      card.classList.remove('tx-resizing');
      document.body.style.userSelect = '';
    };

    resizeHandle.addEventListener('mousedown', startResize);
    document.addEventListener('mousemove', resize);
    document.addEventListener('mouseup', endResize);

    // Cleanup function
    overlay.resizeCleanup = () => {
      resizeHandle.removeEventListener('mousedown', startResize);
      document.removeEventListener('mousemove', resize);
      document.removeEventListener('mouseup', endResize);
    };
  }

  toggleMinimize(overlay) {
    const { card } = overlay;
    const isMinimized = card.classList.contains('tx-minimized');

    if (isMinimized) {
      // Restore to previous size
      card.classList.remove('tx-minimized');
      if (overlay.previousSize) {
        card.style.width = overlay.previousSize.width;
        card.style.height = overlay.previousSize.height;
      }
      this.showContent(overlay);
    } else {
      // Store current size and minimize
      overlay.previousSize = {
        width: card.style.width || '',
        height: card.style.height || ''
      };

      // Calculate optimal height based on content
      const optimalHeight = this.calculateOptimalHeight(overlay);

      // Set minimized size (just enough for translation section with proper height)
      card.style.width = '360px';
      card.style.height = `${optimalHeight}px`;
      card.classList.add('tx-minimized');
      this.hideContent(overlay);
    }
  }

  manageContentVisibility(overlay, width, height) {
    const { card } = overlay;
    const thresholdHeight = 300; // Minimum height to show reply composer

    if (height < thresholdHeight) {
      this.hideContent(overlay);
      card.classList.add('tx-smart-compact');
    } else {
      this.showContent(overlay);
      card.classList.remove('tx-smart-compact');
    }
  }

  hideContent(overlay) {
    if (overlay.replyComposer) {
      overlay.replyComposer.classList.add('tx-hidden');
    }
  }

  showContent(overlay) {
    if (overlay.replyComposer) {
      overlay.replyComposer.classList.remove('tx-hidden');
    }
  }

  calculateOptimalHeight(overlay) {
    const header = overlay.card.querySelector('.tx-overlay-header');
    const output = overlay.output;
    const resizeHandle = overlay.card.querySelector('.tx-resize-handle');

    let totalHeight = 0;

    // Header height
    if (header) {
      totalHeight += header.offsetHeight + 16; // Add margin
    }

    // Output content height
    if (output) {
      // Temporarily show full content to measure it
      const originalHeight = output.style.height;
      output.style.height = 'auto';
      const contentHeight = output.scrollHeight;
      output.style.height = originalHeight;

      totalHeight += Math.max(contentHeight + 32, 120); // Min 120px for output + padding
    }

    // Resize handle space
    if (resizeHandle) {
      totalHeight += 30;
    }

    // Add some padding
    totalHeight += 20;

    return Math.min(Math.max(totalHeight, 180), Math.min(window.innerHeight - 100, 400));
  }

  attachReplyComposer({ overlay, container, targetLanguage, sourceLanguage, context, originalLanguage }) {
    const normalizedOriginal = (originalLanguage || '').toLowerCase();
    const normalizedTarget = (targetLanguage || '').toLowerCase();
    const normalizedSource = (sourceLanguage || '').toLowerCase();
    const fallbackTarget = (this.settings.targetLanguage || 'en').toLowerCase();
    const defaultLanguage =
      normalizedOriginal ||
      normalizedTarget ||
      normalizedSource ||
      fallbackTarget;
    const fallbackInputLanguage = (this.settings.targetLanguage || '').toLowerCase();

    const composer = document.createElement('div');
    composer.className = 'tx-reply-composer';
    const toastLabel = 'Xtension';

    const header = document.createElement('div');
    header.className = 'tx-reply-composer-header';

    const title = document.createElement('span');
    title.textContent = 'Your Reply';

    const languageBadge = document.createElement('span');
    languageBadge.className = 'tx-reply-language';

    header.appendChild(title);
    header.appendChild(languageBadge);

    const input = document.createElement('textarea');
    input.className = 'tx-reply-input';
    input.rows = 4;
    input.placeholder = 'Write your reply in your language…';

    // Ensure consistent sizing across platforms
    input.style.minHeight = '72px';
    input.style.fontSize = '13px';
    input.style.lineHeight = '1.5';
    input.style.padding = '10px 12px';
    input.style.borderRadius = '12px';

    const languageSelectWrapper = document.createElement('label');
    languageSelectWrapper.className = 'tx-reply-language-select-wrapper';

    const selectLabel = document.createElement('span');
    selectLabel.textContent = 'Reply language';

    const languageSelect = document.createElement('select');
    languageSelect.className = 'tx-reply-language-select';

    const createOption = (code, label) => {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = label;
      return option;
    };

    languageSelect.appendChild(createOption('auto', 'Auto (match original)'));
    (this.config.languages || []).forEach((lang) => {
      languageSelect.appendChild(createOption(lang.code, lang.label));
    });
    if (defaultLanguage && !languageSelect.querySelector(`option[value="${defaultLanguage}"]`)) {
      languageSelect.appendChild(createOption(defaultLanguage, defaultLanguage.toUpperCase()));
    }
    languageSelect.value = 'auto';

    languageSelectWrapper.appendChild(selectLabel);
    languageSelectWrapper.appendChild(languageSelect);

    const actions = document.createElement('div');
    actions.className = 'tx-reply-actions';

    const translateButton = document.createElement('button');
    translateButton.type = 'button';
    translateButton.className = 'tx-reply-translate-btn';
    translateButton.textContent = 'Translate draft';

    const hint = document.createElement('span');
    hint.className = 'tx-reply-hint';

    actions.appendChild(translateButton);
    actions.appendChild(hint);

    const output = document.createElement('div');
    output.className = 'tx-reply-output placeholder';
    output.textContent = 'Translated reply appears here.';

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'tx-reply-copy-btn';
    copyButton.textContent = 'Copy translation';
    copyButton.disabled = true;

    composer.appendChild(header);
    composer.appendChild(input);
    composer.appendChild(languageSelectWrapper);
    composer.appendChild(actions);
    composer.appendChild(output);
    composer.appendChild(copyButton);

    container.appendChild(composer);

    const composerState = {
      container: composer,
      input,
      output,
      translateButton,
      copyButton,
      languageSelect,
      defaultLanguage,
      targetLanguage: defaultLanguage,
      inputLanguage: normalizedSource || fallbackInputLanguage || defaultLanguage,
      originalLanguage: normalizedOriginal,
      sourceLanguage: normalizedSource,
      context,
      translating: false,
      cleanup: null
    };

    const syncLanguageBadge = (code) => {
      const effective = (code || composerState.defaultLanguage || '').toLowerCase();
      const label = this.getLanguageLabel(effective);
      languageBadge.textContent = `Translates to ${label}`;
      hint.textContent = `Reply posts in ${label}`;
    };

    const applyLanguageSelection = (language) => {
      const effective = (language || composerState.defaultLanguage || '').toLowerCase();
      composerState.targetLanguage = effective;
      syncLanguageBadge(effective);
      this.setNodeDirection(composerState.input, composerState.inputLanguage || composerState.defaultLanguage, composerState.input.value);
      this.setNodeDirection(composerState.output, effective, composerState.output.textContent || '');
    };

    const handleInput = () => {
      output.textContent = 'Translated reply appears here.';
      output.classList.add('placeholder');
      this.setNodeDirection(output, composerState.targetLanguage, '');
      this.setNodeDirection(input, composerState.inputLanguage || composerState.defaultLanguage, input.value);
      copyButton.disabled = true;
      delete copyButton.dataset.clipboard;
    };

    const handleTranslate = (event) => {
      event.preventDefault();
      this.requestReplyDraftTranslation(overlay);
    };

    const handleKeydown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        this.requestReplyDraftTranslation(overlay);
      }
    };

    const handleCopy = async () => {
      const text = copyButton.dataset.clipboard || output.textContent?.trim();
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        this.toast(toastLabel, 'Copied to clipboard.');
      } catch (error) {
        console.warn('[Xtension] Clipboard copy failed', error);
        this.toast(toastLabel, 'Clipboard unavailable — check permissions.');
      }
    };

    const handleLanguageChange = () => {
      const selected = languageSelect.value === 'auto' ? composerState.defaultLanguage : languageSelect.value;
      applyLanguageSelection(selected);
      handleInput();
    };

    translateButton.addEventListener('click', handleTranslate);
    input.addEventListener('keydown', handleKeydown);
    input.addEventListener('input', handleInput);
    copyButton.addEventListener('click', handleCopy);
    languageSelect.addEventListener('change', handleLanguageChange);

    composerState.cleanup = () => {
      translateButton.removeEventListener('click', handleTranslate);
      input.removeEventListener('keydown', handleKeydown);
      input.removeEventListener('input', handleInput);
      copyButton.removeEventListener('click', handleCopy);
      languageSelect.removeEventListener('change', handleLanguageChange);
    };

    applyLanguageSelection(composerState.targetLanguage);

    return composerState;
  }

  async requestReplyDraftTranslation(overlay) {
    const composer = overlay.replyComposer;
    if (!composer || composer.translating) return;

    const draft = composer.input.value.trim();
    const toastLabel = composer.context === 'discord' ? 'Discord Translate' : 'Xtension';
    if (!draft) {
      this.toast(toastLabel, 'Write your reply before translating.');
      return;
    }

    composer.translating = true;
    const originalLabel = composer.translateButton.textContent;
    composer.translateButton.textContent = 'Translating…';
    composer.translateButton.disabled = true;
    composer.copyButton.disabled = true;
    delete composer.copyButton.dataset.clipboard;

    try {
      const effectiveLanguage = composer.targetLanguage || composer.defaultLanguage;

      const response = await safeRuntimeSendMessage({
        type: 'translateReplyDraft',
        text: draft,
        targetLanguage: effectiveLanguage,
        sourceLanguage: composer.sourceLanguage,
        context: composer.context
      });

      if (!response?.success) {
        throw new Error(response?.error || 'Translation unavailable.');
      }

      const translated = (response.translation || '').trim();
      if (!translated) {
        throw new Error('No translation returned.');
      }

      composer.targetLanguage = effectiveLanguage;
      this.setNodeDirection(composer.input, composer.inputLanguage || composer.defaultLanguage, composer.input.value);
      this.setNodeDirection(composer.output, effectiveLanguage, translated);
      composer.output.textContent = translated;
      composer.output.classList.remove('placeholder');
      composer.copyButton.dataset.clipboard = translated;
      composer.copyButton.disabled = false;
    } catch (error) {
      console.error('[Xtension] Reply draft translation failed', error);
      composer.output.textContent = error?.message || 'Unable to translate that reply right now.';
      composer.output.classList.remove('placeholder');
      this.setNodeDirection(composer.output, composer.targetLanguage || composer.defaultLanguage, composer.output.textContent);
      this.setNodeDirection(composer.input, composer.inputLanguage || composer.defaultLanguage, composer.input.value);
      composer.copyButton.disabled = true;
      delete composer.copyButton.dataset.clipboard;
      this.toast(toastLabel, error?.message || 'Unable to translate that reply right now.');
    } finally {
      composer.translateButton.textContent = originalLabel;
      composer.translateButton.disabled = false;
      composer.translating = false;
    }
  }

  createActionButton({ idle, loading, success, error, aria, testId }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tx-trigger';
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');
    if (aria) button.setAttribute('aria-label', aria);
    if (testId) button.dataset.testid = testId;
    button.dataset.labelIdle = idle;
    button.dataset.labelLoading = loading;
    button.dataset.labelSuccess = success;
    button.dataset.labelError = error;

    const labelNode = document.createElement('span');
    labelNode.className = 'tx-trigger-label';
    labelNode.textContent = idle;
    button.appendChild(labelNode);
    return button;
  }

  getModeLabel(mode) {
    return mode === 'reply' ? 'Xtension' : 'Xtension';
  }

  getOverlaySubtitle(mode, { toneId, languageCode, tweetLanguage }) {
    const languageLabel = this.getLanguageLabel(mode === 'reply' ? tweetLanguage || languageCode : languageCode);
    if (mode === 'reply') {
      return `Reply · ${languageLabel}`;
    }
    const toneLabel = this.getToneLabel(toneId);
    return `${toneLabel} · ${languageLabel}`;
  }

  getToneLabel(toneId) {
    const tone = this.config.tonePresets.find((preset) => preset.id === toneId) ||
      this.config.tonePresets.find((preset) => preset.id === this.settings.tonePreset);
    return tone?.label || 'Simple';
  }

  getLanguageLabel(languageCode) {
    if (!languageCode) return 'Original language';
    const entry = this.config.languages.find((lang) => lang.code === languageCode);
    return entry?.label || languageCode.toUpperCase();
  }

  getEmptyMessage(mode) {
    return mode === 'reply' ? 'No reply generated yet.' : 'No translation returned.';
  }

  resolvePopupTheme() {
    const themes = this.config.popupThemes || [];
    if (!themes.length) {
      return {
        background: 'rgba(9, 13, 22, 0.95)',
        border: 'rgba(255, 255, 255, 0.08)',
        text: '#f2f6ff',
        subtext: '#8d98b1',
        shadow: '0 28px 64px rgba(0, 0, 0, 0.42)'
      };
    }
    const themeId = this.settings.popupStyle?.theme;
    return themes.find((theme) => theme.id === themeId) || themes[0];
  }

  resolvePopupFont() {
    return this.config.theme?.fontStack || `'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif`;
  }

  setNodeDirection(node, languageCode, sampleText = '') {
    if (!node) return;
    const normalized = (languageCode || '').toLowerCase();
    if (normalized) {
      node.setAttribute('lang', normalized);
    } else {
      node.removeAttribute('lang');
    }
    const rtl = this.isRTLLanguage(normalized, sampleText);
    node.setAttribute('dir', rtl ? 'rtl' : 'ltr');
  }

  setButtonState(button, state) {
    if (!button) return;
    const label = button.querySelector('.tx-trigger-label');
    const datasetKey = `label${capitalize(state)}`;
    const fallbackIdle = button.dataset.labelIdle || this.config.buttonStates?.idle || 'TX';
    const next = button.dataset[datasetKey] || this.config.buttonStates?.[state] || fallbackIdle;
    if (label) {
      label.textContent = next;
    }
    button.classList.remove('tx-state-idle', 'tx-state-loading', 'tx-state-success', 'tx-state-error');
    const nextState = ['idle', 'loading', 'success', 'error'].includes(state) ? state : 'idle';
    button.classList.add(`tx-state-${nextState}`);
  }

  clearButtonReset(button) {
    const timer = this.buttonTimers.get(button);
    if (timer) {
      clearTimeout(timer);
      this.buttonTimers.delete(button);
    }
  }

  scheduleButtonReset(button) {
    this.clearButtonReset(button);
    const timer = setTimeout(() => {
      this.setButtonState(button, 'idle');
      this.buttonTimers.delete(button);
    }, 2200);
    this.buttonTimers.set(button, timer);
  }

  isRTLLanguage(languageCode, sampleText = '') {
    if (languageCode && this.rtlLanguages.has(languageCode.toLowerCase())) {
      return true;
    }
    const rtlPattern = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
    return rtlPattern.test(sampleText);
  }

  extractTweet(article) {
    const segments = [];
    article.querySelectorAll('[data-testid="tweetText"]').forEach((node) => {
      const text = node.innerText?.trim();
      if (text) segments.push(text);
    });
    const author = article.querySelector('div[data-testid="User-Name"] a[href*="/"]')?.getAttribute('href') || '';
    const language = article.querySelector('[lang]')?.getAttribute('lang') || '';
    let authorDisplay = '';
    const nameSpans = article.querySelectorAll('div[data-testid="User-Name"] span');
    for (const span of nameSpans) {
      const value = span?.textContent?.trim();
      if (value && !value.includes('@')) {
        authorDisplay = value;
        break;
      }
    }
    return {
      text: segments.join('\n').trim(),
      author: author.replace('/', '@'),
      authorDisplay,
      language
    };
  }

  toast(title, message) {
    if (!this.toastStack) {
      this.toastStack = document.createElement('div');
      this.toastStack.className = 'tx-toast-stack';
      document.body.appendChild(this.toastStack);
    }

    const toast = document.createElement('div');
    toast.className = 'tx-toast';
    const titleNode = document.createElement('strong');
    titleNode.textContent = title;
    const messageNode = document.createElement('span');
    messageNode.textContent = message;
    toast.appendChild(titleNode);
    toast.appendChild(messageNode);
    this.toastStack.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('tx-visible'));
    setTimeout(() => {
      toast.classList.remove('tx-visible');
      setTimeout(() => toast.remove(), 240);
    }, 2200);
  }
}

class DiscordReplyController {
  constructor(config, storageKey) {
    this.config = config;
    this.storageKey = storageKey;
    this.settings = clone(config.defaultSettings);
    this.buttons = new WeakMap();
    this.overlays = new Map();
    this.buttonTimers = new WeakMap();
    this.observer = null;
    this.toastStack = null;
    this.listenersBound = false;
    this.boundReposition = this.repositionOverlays.bind(this);
    this.rtlLanguages = new Set(config.rtlLanguages || []);
    this.selectors = {
      messageContent: '[id^="message-content"]'
    };
  }

  async init() {
    await this.loadSettings();
    this.registerStorageListener();
    this.injectStyles();
    this.observeMessages();
    this.scanExistingMessages();
  }

  async loadSettings() {
    try {
      const { [this.storageKey]: saved } = await chrome.storage.local.get([this.storageKey]);
      if (saved && typeof saved === 'object') {
        this.settings = deepMerge(clone(this.config.defaultSettings), saved);
      }
    } catch (error) {
      console.warn('[Xtension] Failed to load settings, using defaults', error);
      this.settings = clone(this.config.defaultSettings);
    }
  }

  registerStorageListener() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[this.storageKey]) return;
      const next = changes[this.storageKey].newValue || {};
      this.settings = deepMerge(clone(this.config.defaultSettings), next);
    });
  }

  injectStyles() {
    if (document.getElementById('txtension-styles')) return;
    const style = document.createElement('style');
    style.id = 'txtension-styles';
    style.textContent = `
      .tx-injection-surface {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-left: 4px;
      }
      .tx-message-host {
        position: relative !important;
        padding-right: 96px;
      }
      .rd-reply-container {
        position: absolute;
        top: 50%;
        right: 18px;
        transform: translateY(-50%);
        display: inline-flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        margin: 0;
        padding: 0;
        pointer-events: none;
      }
      .rd-reply-container .tx-trigger {
        width: auto;
        min-width: 46px;
        height: 34px;
        padding: 0 14px;
        pointer-events: auto;
      }
      @media (max-width: 900px) {
        .tx-message-host {
          padding-right: 72px;
        }
        .rd-reply-container {
          right: 12px;
        }
      }
      .tx-trigger {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 48px;
        height: 30px;
        padding: 0 16px;
        border: 1px solid rgba(110, 180, 255, 0.35);
        border-radius: 999px;
        background: linear-gradient(135deg, rgba(54, 128, 255, 0.32) 0%, rgba(16, 214, 255, 0.12) 58%) rgba(10, 16, 28, 0.94);
        color: #f5f7ff;
        font-family: ${this.config.theme.fontStack};
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        cursor: pointer;
        transition: transform 0.2s cubic-bezier(0.19, 1, 0.22, 1), box-shadow 0.24s ease, border-color 0.24s ease, background 0.24s ease;
        position: relative;
        box-shadow: 0 14px 28px rgba(4, 8, 18, 0.36);
      }
      .tx-trigger::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        box-shadow: 0 0 0 1px rgba(96, 168, 255, 0.28), inset 0 0 0 1px rgba(255, 255, 255, 0.08);
        opacity: 0;
        transition: opacity 0.24s ease;
      }
      .tx-trigger:hover {
        transform: translateY(-1px) scale(1.02);
        box-shadow: 0 18px 34px rgba(5, 11, 24, 0.42);
      }
      .tx-trigger:hover::after,
      .tx-trigger:focus-visible::after {
        opacity: 1;
      }
      .tx-trigger:focus-visible {
        outline: none;
        border-color: rgba(96, 168, 255, 0.5);
      }
      .tx-trigger:active {
        transform: translateY(0) scale(0.98);
      }
      .tx-trigger-label {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
      }
      .tx-overlay {
        position: fixed;
        z-index: 2147483644;
        opacity: 0;
        transform: translate3d(0, 16px, 0) scale(0.96);
        pointer-events: none;
        transition: opacity 0.28s ease, transform 0.34s cubic-bezier(0.18, 0.89, 0.32, 1.28);
      }
      .tx-overlay.tx-visible {
        opacity: 1;
        transform: translate3d(0, 0, 0) scale(1);
        pointer-events: auto;
      }
      .tx-overlay.tx-overlay-fading {
        opacity: 0;
        transform: translate3d(0, 14px, 0) scale(0.97);
        pointer-events: none;
      }
      .tx-overlay-card {
        position: relative;
        width: min(380px, calc(100vw - 36px));
        min-width: min(320px, calc(100vw - 36px));
        background: var(--tx-popup-bg, rgba(9, 13, 22, 0.95));
        border: 1px solid var(--tx-popup-border, rgba(255, 255, 255, 0.08));
        border-radius: 18px;
        box-shadow: var(--tx-popup-shadow, 0 24px 58px rgba(0, 0, 0, 0.4));
        padding: 18px 20px 20px;
        font-family: var(--tx-popup-font, ${this.config.theme.fontStack});
        color: var(--tx-popup-text, #f2f6ff);
        backdrop-filter: blur(22px);
        box-sizing: border-box;
        transition: transform 0.32s ease, box-shadow 0.32s ease;
      }
      .tx-overlay-card::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: radial-gradient(140% 120% at 50% 0%, rgba(29, 211, 248, 0.16), rgba(29, 211, 248, 0));
        opacity: 0;
        transition: opacity 0.3s ease;
        pointer-events: none;
      }
      .tx-overlay-card:hover::before {
        opacity: 0.12;
      }
      .tx-overlay-card:hover {
        box-shadow: var(--tx-popup-shadow, 0 28px 64px rgba(0, 0, 0, 0.42)), 0 14px 34px rgba(0, 0, 0, 0.18);
      }
      .tx-overlay-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 14px;
      }
      .tx-overlay-title {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .tx-overlay-title strong {
        font-size: 15px;
        font-weight: 600;
        color: var(--tx-popup-text, #f2f6ff);
      }
      .tx-overlay-title span {
        font-size: 12px;
        color: var(--tx-popup-subtext, #8d98b1);
      }
      .tx-overlay-close {
        border: none;
        background: transparent;
        color: var(--tx-popup-subtext, #8f9ab4);
        font-size: 18px;
        cursor: pointer;
        line-height: 1;
        padding: 4px;
        border-radius: 8px;
      }
      .tx-overlay-close:hover {
        color: #dfe7ff;
        background: rgba(255, 255, 255, 0.08);
      }
      .tx-output {
        min-height: 110px;
        color: var(--tx-popup-text, #e3ebff);
        font-size: 14px;
        line-height: 1.65;
        white-space: pre-wrap;
        box-sizing: border-box;
        max-height: 220px;
        overflow-y: auto;
        overflow-wrap: break-word;
        word-break: break-word;
        transition: color 0.22s ease;
      }
      .tx-output.placeholder {
        color: var(--tx-popup-subtext, #7d889f);
        font-style: italic;
      }
      .tx-output[dir='rtl'] {
        direction: rtl;
        text-align: right;
      }
      .tx-output[dir='ltr'] {
        direction: ltr;
        text-align: left;
      }
      .tx-toast-stack {
        position: fixed;
        bottom: 24px;
        right: 24px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        z-index: 2147483646;
      }
      .tx-toast {
        min-width: 220px;
        max-width: 320px;
        padding: 12px 16px;
        border-radius: 14px;
        background: rgba(10, 14, 21, 0.94);
        color: #f5f7fa;
        font-size: 12px;
        line-height: 1.5;
        box-shadow: 0 16px 34px rgba(0, 0, 0, 0.32);
        transform: translateY(12px);
        opacity: 0;
        transition: transform 0.24s ease, opacity 0.24s ease;
      }
      .tx-toast strong {
        display: block;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        font-size: 11px;
        margin-bottom: 4px;
      }
      .tx-toast span {
        display: block;
      }
      .tx-toast.tx-visible {
        transform: translateY(0);
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  }

  observeMessages() {
    if (this.observer) return;
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes?.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches?.(this.selectors.messageContent)) {
            this.attachButton(node);
          } else {
            node.querySelectorAll?.(this.selectors.messageContent).forEach((content) => this.attachButton(content));
          }
        });
        mutation.removedNodes?.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches?.(this.selectors.messageContent)) {
            const root = this.getMessageRoot(node);
            if (root) this.cleanupMessage(root);
          } else {
            node.querySelectorAll?.(this.selectors.messageContent).forEach((content) => {
              const root = this.getMessageRoot(content);
              if (root) this.cleanupMessage(root);
            });
          }
        });
      }
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  scanExistingMessages() {
    document.querySelectorAll(this.selectors.messageContent).forEach((content) => this.attachButton(content));
  }

  attachButton(messageContent) {
    if (!messageContent) return;

    const messageRoot = this.getMessageRoot(messageContent);
    if (!messageRoot) return;

    const existing = this.buttons.get(messageRoot);
    const replyAttached = existing?.replyButton && document.body.contains(existing.replyButton);
    const translateAttached = existing?.translateButton && document.body.contains(existing.translateButton);
    if (replyAttached && translateAttached) {
      return;
    }

    messageRoot.classList.add('tx-message-host');

    const containers = Array.from(messageRoot.querySelectorAll('[data-rd-container="true"]'));
    let bar = containers.shift();
    containers.forEach((node) => node.remove());
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'rd-reply-container';
      bar.dataset.rdContainer = 'true';
      messageRoot.appendChild(bar);
    } else if (bar.parentElement !== messageRoot) {
      messageRoot.appendChild(bar);
    }

    const entry = existing || {};
    entry.bar = bar;
    entry.content = messageContent;

    if (!entry.translateButton || !document.body.contains(entry.translateButton)) {
      const translateButton = this.createActionButton({
        idle: 'TD',
        loading: this.config.buttonStates?.loading || '…',
        success: this.config.buttonStates?.success || 'done',
        error: this.config.buttonStates?.error || 'retry',
        aria: 'Translate Discord message',
        testId: 'td-button'
      });

      translateButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.handleTranslateClick(messageRoot, translateButton);
      });

      translateButton.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          translateButton.click();
        }
      });

      bar.appendChild(translateButton);
      this.setButtonState(translateButton, 'idle');
      entry.translateButton = translateButton;
    }

    if (!entry.replyButton || !document.body.contains(entry.replyButton)) {
      const replyButton = this.createActionButton({
        idle: 'RD',
        loading: this.config.buttonStates?.loading || '…',
        success: this.config.buttonStates?.success || 'done',
        error: this.config.buttonStates?.error || 'retry',
        aria: 'Generate Discord reply',
        testId: 'rd-button'
      });

      replyButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.handleReplyClick(messageRoot, replyButton);
      });

      replyButton.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          replyButton.click();
        }
      });

      bar.appendChild(replyButton);
      this.setButtonState(replyButton, 'idle');
      entry.replyButton = replyButton;
    }

    this.buttons.set(messageRoot, entry);
  }

  cleanupMessage(messageRoot) {
    const entry = this.buttons.get(messageRoot);
    if (entry) {
      if (entry.replyButton) {
        this.clearButtonReset(entry.replyButton);
        entry.replyButton.remove();
      }
      if (entry.translateButton) {
        this.clearButtonReset(entry.translateButton);
        entry.translateButton.remove();
      }
      if (entry.bar && entry.bar.childElementCount === 0) {
        entry.bar.remove();
      }
      this.buttons.delete(messageRoot);
    }
    messageRoot.classList.remove('tx-message-host');
    this.dismissOverlay(messageRoot, { immediate: true });
  }

  async handleReplyClick(message, button) {
    const discordSettings = this.settings.discordReply || {};
    if (!discordSettings.prompt?.trim()) {
      this.toast('Reply', 'Please first specify the prompt in the settings.');
      return;
    }

    const activeOverlay = this.overlays.get(message);
    if (activeOverlay) {
      this.dismissOverlay(message);
      this.clearButtonReset(button);
      this.setButtonState(button, 'idle');
      return;
    }

    const messageContent = this.extractMessage(message);
    if (!messageContent.text) {
      this.toast('Reply', 'No message content detected.');
      return;
    }
    if (!messageContent.language) {
      messageContent.language = await detectLanguageGuess(messageContent.text);
    }

    this.dismissAllOverlays(message);
    this.clearButtonReset(button);
    this.setButtonState(button, 'loading');
    this.toast('Reply', 'Drafting reply…');

    try {
      const response = await safeRuntimeSendMessage({
        type: 'generateDiscordReply',
        messageContent
      });

      if (!response?.success) {
        throw new Error(response?.error || 'Reply unavailable.');
      }

      const overlay = this.buildOverlay({
        mode: 'reply',
        message,
        button,
        content: response.reply,
        languageCode: messageContent.language
      });
      document.body.appendChild(overlay.wrapper);
      requestAnimationFrame(() => overlay.wrapper.classList.add('tx-visible'));
      this.overlays.set(message, overlay);
      this.repositionOverlay(overlay, button);
      this.ensureGlobalOverlayListeners();
      this.setupOverlayLifecycle(message, overlay);

      this.setButtonState(button, 'success');
      this.scheduleButtonReset(button);

      const cleanedContent = (response.reply || '').trim();
      if (discordSettings.autoCopy && cleanedContent) {
        try {
          await navigator.clipboard.writeText(cleanedContent);
          this.toast('Reply', 'Copied to clipboard.');
        } catch (copyError) {
          console.warn('[Xtension] Clipboard copy failed', copyError);
          this.toast('Reply', 'Clipboard unavailable — check permissions.');
        }
      }
    } catch (error) {
      console.error('[Xtension] Discord reply failed', error);
      this.toast('Reply', error?.message || 'Unable to generate a reply right now.');
      this.setButtonState(button, 'error');
      this.scheduleButtonReset(button);
    }
  }

  async handleTranslateClick(message, button) {
    const messageContent = this.extractMessage(message);
    if (!messageContent.text) {
      this.toast('Translation', 'No message content detected.');
      return;
    }
    if (!messageContent.language) {
      messageContent.language = await detectLanguageGuess(messageContent.text);
    }

    const targetLanguage = this.settings.targetLanguage;
    const toneId = this.settings.tonePreset;

    const activeOverlay = this.overlays.get(message);
    if (activeOverlay) {
      this.dismissOverlay(message);
      this.clearButtonReset(button);
      this.setButtonState(button, 'idle');
      return;
    }

    this.dismissAllOverlays(message);
    this.clearButtonReset(button);
    this.setButtonState(button, 'loading');
    this.toast('Translation', 'Translating message…');

    try {
      const response = await safeRuntimeSendMessage({
        type: 'translateDiscordMessage',
        messageContent,
        targetLanguage,
        toneId
      });

      if (!response?.success) {
        throw new Error(response?.error || 'Translation unavailable.');
      }

      const overlay = this.buildOverlay({
        mode: 'translate',
        message,
        button,
        content: response.translation,
        languageCode: targetLanguage,
        toneId,
        messageLanguage: messageContent.language
      });
      document.body.appendChild(overlay.wrapper);
      requestAnimationFrame(() => overlay.wrapper.classList.add('tx-visible'));
      this.overlays.set(message, overlay);
      this.repositionOverlay(overlay, button);
      this.ensureGlobalOverlayListeners();
      this.setupOverlayLifecycle(message, overlay);

      this.setButtonState(button, 'success');
      this.scheduleButtonReset(button);

      const cleanedContent = (response.translation || '').trim();
      if (this.settings.autoCopy && cleanedContent) {
        try {
          await navigator.clipboard.writeText(cleanedContent);
          this.toast('Translation', 'Copied to clipboard.');
        } catch (copyError) {
          console.warn('[Xtension] Clipboard copy failed', copyError);
          this.toast('Translation', 'Clipboard unavailable — check permissions.');
        }
      }
    } catch (error) {
      console.error('[Xtension] Discord translate failed', error);
      this.toast('Translation', error?.message || 'Unable to translate right now.');
      this.setButtonState(button, 'error');
      this.scheduleButtonReset(button);
    }
  }

  buildOverlay({ mode = 'reply', message, button, content, languageCode, toneId, messageLanguage }) {
    // Check if this is a reply generation (compact popup) or translation (large overlay)
    const isReply = mode === 'reply';

    const wrapper = document.createElement('div');
    wrapper.className = isReply ? 'tx-compact-popup' : 'tx-overlay';
    wrapper.dataset.txtensionOverlay = 'true';

    const theme = this.resolvePopupTheme();
    const fontStack = this.resolvePopupFont();
    if (theme) {
      wrapper.style.setProperty('--tx-popup-bg', theme.background);
      wrapper.style.setProperty('--tx-popup-border', theme.border);
      wrapper.style.setProperty('--tx-popup-text', theme.text);
      wrapper.style.setProperty('--tx-popup-subtext', theme.subtext);
      wrapper.style.setProperty('--tx-popup-shadow', theme.shadow);
      wrapper.style.setProperty('--tx-popup-backdrop', theme.backdrop || 'blur(20px)');
      wrapper.style.setProperty('--tx-popup-glow', theme.glow || 'transparent');
      // Enhanced theme properties
      // Special case: use sky blue header for light theme
      if (theme.id === 'light') {
        wrapper.style.setProperty('--tx-popup-header-bg', 'linear-gradient(135deg, #87CEEB 0%, #B0E0E6 50%, #87CEFA 100%)');
      } else {
        wrapper.style.setProperty('--tx-popup-header-bg', theme.headerBg || theme.background);
      }
      wrapper.style.setProperty('--tx-popup-accent-color', theme.accentColor || '#3b82f6');
      wrapper.style.setProperty('--tx-popup-focus-glow', theme.focusGlow || '0 0 0 3px rgba(59, 130, 246, 0.2)');
      wrapper.style.setProperty('--tx-popup-button-bg', '#7c3aed');
      wrapper.style.setProperty('--tx-popup-button-hover', '#6d28d9');
    }
    if (fontStack) {
      wrapper.style.setProperty('--tx-popup-font', fontStack);
    }

    const card = document.createElement('div');
    card.className = isReply ? 'tx-compact-card' : 'tx-overlay-card';

    // Declare variables in broader scope to be accessible later
    let dragHandle, resizeHandle;

    let header;
    if (isReply) {
      // Compact header for reply generation
      header = document.createElement('div');
      header.className = 'tx-compact-header';

      // Add close button for compact popup
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'tx-compact-close';
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', () => this.dismissOverlay(message));
      header.appendChild(closeBtn);
    } else {
      // Large header for translation
      header = document.createElement('div');
      header.className = 'tx-overlay-header';

      // Add drag handle for large overlay
      dragHandle = document.createElement('div');
      dragHandle.className = 'tx-drag-handle';
      dragHandle.title = 'Drag to move';
      header.appendChild(dragHandle);

      // Add window controls for large overlay
      const windowControls = document.createElement('div');
      windowControls.className = 'tx-window-controls';

      const minimizeBtn = document.createElement('button');
      minimizeBtn.type = 'button';
      minimizeBtn.className = 'tx-window-control minimize';
      minimizeBtn.innerHTML = '−';
      minimizeBtn.title = 'Minimize';
      minimizeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMinimize(overlay);
      });

      const maximizeBtn = document.createElement('button');
      maximizeBtn.type = 'button';
      maximizeBtn.className = 'tx-window-control maximize';
      maximizeBtn.innerHTML = '□';
      maximizeBtn.title = 'Maximize';
      maximizeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMinimize(overlay);
      });

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'tx-window-control close';
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', () => this.dismissOverlay(message));

      windowControls.appendChild(minimizeBtn);
      windowControls.appendChild(maximizeBtn);
      windowControls.appendChild(closeBtn);
      header.appendChild(windowControls);
    }

    const title = document.createElement('div');
    title.className = isReply ? 'tx-compact-title' : 'tx-overlay-title';
    const heading = mode === 'reply' ? 'X Reply Draft' : 'Translation';
    const subtitle = mode === 'reply' ? this.getSubtitle(languageCode) : `${this.getToneLabel(toneId)} · ${this.getLanguageLabel(languageCode)}`;
    title.innerHTML = `<strong>${heading}</strong><span>${subtitle}</span>`;

    header.appendChild(title);

    const output = document.createElement('div');
    output.className = isReply ? 'tx-compact-output' : 'tx-output';
    const text = typeof content === 'string' ? content.trim() : '';
    const languageAttr = mode === 'reply' ? messageLanguage || languageCode : languageCode;
    this.setNodeDirection(output, languageAttr, text);
    output.textContent = text || this.getEmptyMessage(mode);

    card.appendChild(header);

    // Add content section
    if (isReply) {
      // Compact popup: content area
      const contentArea = document.createElement('div');
      contentArea.className = 'tx-compact-content';
      contentArea.appendChild(output);
      card.appendChild(contentArea);

      // Compact popup: actions section with copy button
      const actions = document.createElement('div');
      actions.className = 'tx-compact-actions';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'tx-compact-copy-btn';
      copyBtn.textContent = 'Copy';
      copyBtn.disabled = !text;

      copyBtn.addEventListener('click', async () => {
        if (text) {
          try {
            await navigator.clipboard.writeText(text);
            this.toast('Reply', 'Copied to clipboard.');
          } catch (error) {
            console.warn('[Xtension] Clipboard copy failed', error);
            this.toast('Reply', 'Clipboard unavailable — check permissions.');
          }
        }
      });

      actions.appendChild(copyBtn);
      card.appendChild(actions);
    } else {
      // Large overlay: add output and resize handle
      card.appendChild(output);

      resizeHandle = document.createElement('div');
      resizeHandle.className = 'tx-resize-handle';
      resizeHandle.title = 'Drag to resize';
      card.appendChild(resizeHandle);
    }

    wrapper.appendChild(card);

    const overlay = {
      mode,
      wrapper,
      card,
      button,
      message,
      output,
      originalLanguage: messageLanguage || languageCode,
      hoverCounter: 0,
      dismissTimer: null,
      leaveTimer: null,
      cleanupLifecycle: null,
      dragHandle: isReply ? null : dragHandle,
      resizeHandle: isReply ? null : resizeHandle
    };

    // Setup drag and resize functionality only for large overlay (translation)
    if (!isReply) {
      this.setupDrag(overlay, dragHandle);
      this.setupResize(overlay, resizeHandle);
    }

    if (mode === 'translate') {
      overlay.replyComposer = this.attachReplyComposer({
        overlay,
        container: card,
        targetLanguage: (messageLanguage || languageCode || this.settings.targetLanguage || 'en').toLowerCase(),
        sourceLanguage: this.settings.targetLanguage,
        originalLanguage: messageLanguage,
        context: 'discord'
      });
    }

    return overlay;
  }

  getSubtitle(languageCode) {
    const languageLabel = this.getLanguageLabel(languageCode);
    return `Reply · ${languageLabel}`;
  }

  getToneLabel(toneId) {
    const tone = this.config.tonePresets.find((preset) => preset.id === toneId) ||
      this.config.tonePresets.find((preset) => preset.id === this.settings.tonePreset);
    return tone?.label || 'Simple';
  }

  repositionOverlays() {
    this.overlays.forEach((overlay, messageRoot) => {
      const targetButton = overlay.button;
      if (!targetButton || !document.body.contains(targetButton)) {
        this.dismissOverlay(messageRoot, { immediate: true });
        return;
      }
      this.repositionOverlay(overlay, targetButton);
    });
  }

  repositionOverlay(overlay, button) {
    const rect = button.getBoundingClientRect();
    const cardRect = overlay.card.getBoundingClientRect();
    const width = cardRect.width || 360;
    const height = cardRect.height || 180;

    let left = rect.right + 14;
    if (left + width > window.innerWidth - 12) {
      left = Math.max(12, rect.left - width - 14);
    }

    let top = rect.top - height / 2 + rect.height / 2;
    if (top < 12) top = 12;
    if (top + height > window.innerHeight - 12) {
      top = window.innerHeight - height - 12;
    }

    overlay.wrapper.style.left = `${Math.round(left)}px`;
    overlay.wrapper.style.top = `${Math.round(top)}px`;
  }

  attachReplyComposer({ overlay, container, targetLanguage, sourceLanguage, context, originalLanguage }) {
    const normalizedOriginal = (originalLanguage || '').toLowerCase();
    const normalizedTarget = (targetLanguage || '').toLowerCase();
    const normalizedSource = (sourceLanguage || '').toLowerCase();
    const fallbackTarget = (this.settings.targetLanguage || 'en').toLowerCase();
    const defaultLanguage =
      normalizedOriginal ||
      normalizedTarget ||
      normalizedSource ||
      fallbackTarget;
    const fallbackInputLanguage = (this.settings.targetLanguage || '').toLowerCase();

    const composer = document.createElement('div');
    composer.className = 'tx-reply-composer';
    const toastLabel = 'Xtension';

    const header = document.createElement('div');
    header.className = 'tx-reply-composer-header';

    const title = document.createElement('span');
    title.textContent = 'Your Reply';

    const languageBadge = document.createElement('span');
    languageBadge.className = 'tx-reply-language';

    header.appendChild(title);
    header.appendChild(languageBadge);

    const input = document.createElement('textarea');
    input.className = 'tx-reply-input';
    input.rows = 4;
    input.placeholder = 'Write your reply in your language…';

    // Ensure consistent sizing across platforms
    input.style.minHeight = '72px';
    input.style.fontSize = '13px';
    input.style.lineHeight = '1.5';
    input.style.padding = '10px 12px';
    input.style.borderRadius = '12px';

    const languageSelectWrapper = document.createElement('label');
    languageSelectWrapper.className = 'tx-reply-language-select-wrapper';

    const selectLabel = document.createElement('span');
    selectLabel.textContent = 'Reply language';

    const languageSelect = document.createElement('select');
    languageSelect.className = 'tx-reply-language-select';

    const createOption = (code, label) => {
      const option = document.createElement('option');
      option.value = code;
      option.textContent = label;
      return option;
    };

    languageSelect.appendChild(createOption('auto', 'Auto (match original)'));
    (this.config.languages || []).forEach((lang) => {
      languageSelect.appendChild(createOption(lang.code, lang.label));
    });
    if (defaultLanguage && !languageSelect.querySelector(`option[value="${defaultLanguage}"]`)) {
      languageSelect.appendChild(createOption(defaultLanguage, defaultLanguage.toUpperCase()));
    }
    languageSelect.value = 'auto';

    languageSelectWrapper.appendChild(selectLabel);
    languageSelectWrapper.appendChild(languageSelect);

    const actions = document.createElement('div');
    actions.className = 'tx-reply-actions';

    const translateButton = document.createElement('button');
    translateButton.type = 'button';
    translateButton.className = 'tx-reply-translate-btn';
    translateButton.textContent = 'Translate draft';

    const hint = document.createElement('span');
    hint.className = 'tx-reply-hint';

    actions.appendChild(translateButton);
    actions.appendChild(hint);

    const output = document.createElement('div');
    output.className = 'tx-reply-output placeholder';
    output.textContent = 'Translated reply appears here.';

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'tx-reply-copy-btn';
    copyButton.textContent = 'Copy translation';
    copyButton.disabled = true;

    composer.appendChild(header);
    composer.appendChild(input);
    composer.appendChild(languageSelectWrapper);
    composer.appendChild(actions);
    composer.appendChild(output);
    composer.appendChild(copyButton);

    container.appendChild(composer);

    const composerState = {
      container: composer,
      input,
      output,
      translateButton,
      copyButton,
      languageSelect,
      defaultLanguage,
      targetLanguage: defaultLanguage,
      inputLanguage: normalizedSource || fallbackInputLanguage || defaultLanguage,
      originalLanguage: normalizedOriginal,
      sourceLanguage: normalizedSource,
      context,
      translating: false,
      cleanup: null
    };

    const syncLanguageBadge = (code) => {
      const effective = (code || composerState.defaultLanguage || '').toLowerCase();
      const label = this.getLanguageLabel(effective);
      languageBadge.textContent = `Translates to ${label}`;
      hint.textContent = `Reply posts in ${label}`;
    };

    const applyLanguageSelection = (language) => {
      const effective = (language || composerState.defaultLanguage || '').toLowerCase();
      composerState.targetLanguage = effective;
      syncLanguageBadge(effective);
      this.setNodeDirection(composerState.input, composerState.inputLanguage || composerState.defaultLanguage, composerState.input.value);
      this.setNodeDirection(composerState.output, effective, composerState.output.textContent || '');
    };

    const handleInput = () => {
      output.textContent = 'Translated reply appears here.';
      output.classList.add('placeholder');
      this.setNodeDirection(output, composerState.targetLanguage, '');
      this.setNodeDirection(input, composerState.inputLanguage || composerState.defaultLanguage, input.value);
      copyButton.disabled = true;
      delete copyButton.dataset.clipboard;
    };

    const handleTranslate = (event) => {
      event.preventDefault();
      this.requestReplyDraftTranslation(overlay);
    };

    const handleKeydown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        this.requestReplyDraftTranslation(overlay);
      }
    };

    const handleCopy = async () => {
      const text = copyButton.dataset.clipboard || output.textContent?.trim();
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        this.toast(toastLabel, 'Copied to clipboard.');
      } catch (error) {
        console.warn('[Xtension] Clipboard copy failed', error);
        this.toast(toastLabel, 'Clipboard unavailable — check permissions.');
      }
    };

    const handleLanguageChange = () => {
      const selected = languageSelect.value === 'auto' ? composerState.defaultLanguage : languageSelect.value;
      applyLanguageSelection(selected);
      handleInput();
    };

    translateButton.addEventListener('click', handleTranslate);
    input.addEventListener('keydown', handleKeydown);
    input.addEventListener('input', handleInput);
    copyButton.addEventListener('click', handleCopy);
    languageSelect.addEventListener('change', handleLanguageChange);

    composerState.cleanup = () => {
      translateButton.removeEventListener('click', handleTranslate);
      input.removeEventListener('keydown', handleKeydown);
      input.removeEventListener('input', handleInput);
      copyButton.removeEventListener('click', handleCopy);
      languageSelect.removeEventListener('change', handleLanguageChange);
    };

    applyLanguageSelection(composerState.targetLanguage);

    return composerState;
  }

  async requestReplyDraftTranslation(overlay) {
    const composer = overlay.replyComposer;
    if (!composer || composer.translating) return;

    const draft = composer.input.value.trim();
    if (!draft) {
      this.toast('Translation', 'Write your reply before translating.');
      return;
    }

    composer.translating = true;
    const originalLabel = composer.translateButton.textContent;
    composer.translateButton.textContent = 'Translating…';
    composer.translateButton.disabled = true;
    composer.copyButton.disabled = true;
    delete composer.copyButton.dataset.clipboard;

    try {
      const effectiveLanguage = composer.targetLanguage || composer.defaultLanguage;
      composer.targetLanguage = effectiveLanguage;
      this.setNodeDirection(composer.input, composer.inputLanguage || composer.defaultLanguage, composer.input.value);
      const response = await safeRuntimeSendMessage({
        type: 'translateReplyDraft',
        text: draft,
        targetLanguage: effectiveLanguage,
        sourceLanguage: composer.sourceLanguage,
        context: composer.context
      });

      if (!response?.success) {
        throw new Error(response?.error || 'Translation unavailable.');
      }

      const translated = (response.translation || '').trim();
      if (!translated) {
        throw new Error('No translation returned.');
      }

      this.setNodeDirection(composer.output, effectiveLanguage, translated);
      composer.output.textContent = translated;
      composer.output.classList.remove('placeholder');
      composer.copyButton.dataset.clipboard = translated;
      composer.copyButton.disabled = false;
    } catch (error) {
      console.error('[Xtension] Discord draft translation failed', error);
      composer.output.textContent = error?.message || 'Unable to translate that reply right now.';
      composer.output.classList.remove('placeholder');
      this.setNodeDirection(composer.output, composer.targetLanguage || composer.defaultLanguage, composer.output.textContent);
      this.setNodeDirection(composer.input, composer.inputLanguage || composer.defaultLanguage, composer.input.value);
      composer.copyButton.disabled = true;
      delete composer.copyButton.dataset.clipboard;
      this.toast('Translation', error?.message || 'Unable to translate that reply right now.');
    } finally {
      composer.translateButton.textContent = originalLabel;
      composer.translateButton.disabled = false;
      composer.translating = false;
    }
  }

  dismissOverlay(message, { immediate = false } = {}) {
    const overlay = this.overlays.get(message);
    if (!overlay) return;
    this.overlays.delete(message);

    if (overlay.cleanupLifecycle) {
      overlay.cleanupLifecycle();
    }
    if (overlay.replyComposer?.cleanup) {
      overlay.replyComposer.cleanup();
    }
    if (overlay.dragCleanup) {
      overlay.dragCleanup();
    }
    if (overlay.resizeCleanup) {
      overlay.resizeCleanup();
    }
    clearTimeout(overlay.dismissTimer);
    clearTimeout(overlay.leaveTimer);

    if (overlay.button) {
      this.clearButtonReset(overlay.button);
      this.setButtonState(overlay.button, 'idle');
    }

    const finalize = () => {
      overlay.wrapper.remove();
      if (!this.overlays.size && this.listenersBound) {
        window.removeEventListener('resize', this.boundReposition);
        window.removeEventListener('scroll', this.boundReposition);
        this.listenersBound = false;
      }
    };

    if (immediate) {
      finalize();
      return;
    }

    overlay.wrapper.classList.add('tx-overlay-fading');
    const handleTransitionEnd = (event) => {
      if (event.target === overlay.wrapper) {
        finalize();
      }
    };
    overlay.wrapper.addEventListener('transitionend', handleTransitionEnd, { once: true });
    setTimeout(finalize, 380);
  }

  toggleMinimize(overlay) {
    if (!overlay || !overlay.card) return;

    const isMinimized = overlay.card.classList.contains('tx-minimized');

    if (isMinimized) {
      // Maximize: Show full overlay
      overlay.card.classList.remove('tx-minimized');
      overlay.card.style.height = '490px';

      // Reposition overlay after maximizing to ensure it's properly positioned
      if (overlay.button && document.body.contains(overlay.button)) {
        setTimeout(() => {
          this.repositionOverlay(overlay, overlay.button);
        }, 50); // Small delay to allow CSS transition
      }
    } else {
      // Minimize: Show only output
      overlay.card.classList.add('tx-minimized');
      overlay.card.style.height = 'auto';
    }
  }

  dismissAllOverlays(exceptMessage = null) {
    Array.from(this.overlays.keys()).forEach((message) => {
      if (message === exceptMessage) return;
      this.dismissOverlay(message);
    });
  }

  ensureGlobalOverlayListeners() {
    if (this.listenersBound) return;
    window.addEventListener('resize', this.boundReposition, { passive: true });
    window.addEventListener('scroll', this.boundReposition, { passive: true });
    this.listenersBound = true;
  }

  setupOverlayLifecycle(message, overlay) {
    const pinEnabled = !!this.settings.pinWindow;
    const targets = [overlay.wrapper, message];

    const scheduleAutoDismiss = () => {
      if (pinEnabled) return;
      clearTimeout(overlay.dismissTimer);
      overlay.dismissTimer = setTimeout(() => {
        if (!this.overlays.has(message)) return;
        if (overlay.hoverCounter === 0) {
          this.dismissOverlay(message);
        }
      }, 10000);
    };

    const handleEnter = () => {
      overlay.hoverCounter += 1;
      clearTimeout(overlay.leaveTimer);
      clearTimeout(overlay.dismissTimer);
    };

    const handleLeave = () => {
      overlay.hoverCounter = Math.max(0, overlay.hoverCounter - 1);
      clearTimeout(overlay.leaveTimer);
      if (pinEnabled) return;
      overlay.leaveTimer = setTimeout(() => {
        if (!this.overlays.has(message)) return;
        if (overlay.hoverCounter === 0) {
          scheduleAutoDismiss();
        }
      }, 220);
    };

    targets.forEach((target) => {
      if (!target) return;
      target.addEventListener('pointerenter', handleEnter);
      target.addEventListener('pointerleave', handleLeave);
    });

    overlay.cleanupLifecycle = () => {
      targets.forEach((target) => {
        if (!target) return;
        target.removeEventListener('pointerenter', handleEnter);
        target.removeEventListener('pointerleave', handleLeave);
      });
      clearTimeout(overlay.leaveTimer);
      clearTimeout(overlay.dismissTimer);
    };

    if (!pinEnabled) {
      scheduleAutoDismiss();
    }
  }

  createActionButton({ idle, loading, success, error, aria, testId }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tx-trigger';
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');
    if (aria) button.setAttribute('aria-label', aria);
    if (testId) button.dataset.testid = testId;
    button.dataset.labelIdle = idle;
    button.dataset.labelLoading = loading;
    button.dataset.labelSuccess = success;
    button.dataset.labelError = error;

    const labelNode = document.createElement('span');
    labelNode.className = 'tx-trigger-label';
    labelNode.textContent = idle;
    button.appendChild(labelNode);
    return button;
  }

  setButtonState(button, state) {
    if (!button) return;
    const label = button.querySelector('.tx-trigger-label');
    const datasetKey = `label${capitalize(state)}`;
    const fallbackIdle = button.dataset.labelIdle || 'RD';
    const next = button.dataset[datasetKey] || this.config.buttonStates?.[state] || fallbackIdle;
    if (label) {
      label.textContent = next;
    }
    button.classList.remove('tx-state-idle', 'tx-state-loading', 'tx-state-success', 'tx-state-error');
    const nextState = ['idle', 'loading', 'success', 'error'].includes(state) ? state : 'idle';
    button.classList.add(`tx-state-${nextState}`);
  }

  clearButtonReset(button) {
    const timer = this.buttonTimers.get(button);
    if (timer) {
      clearTimeout(timer);
      this.buttonTimers.delete(button);
    }
  }

  scheduleButtonReset(button) {
    this.clearButtonReset(button);
    const timer = setTimeout(() => {
      this.setButtonState(button, 'idle');
      this.buttonTimers.delete(button);
    }, 2200);
    this.buttonTimers.set(button, timer);
  }

  getEmptyMessage(mode) {
    return mode === 'reply' ? 'No reply generated yet.' : 'No translation returned.';
  }

  extractMessage(message) {
    const segments = [];
    message.querySelectorAll('[id^="message-content"]').forEach((node) => {
      const text = node.innerText?.trim();
      if (text) segments.push(text);
    });
    if (!segments.length) {
      const fallback = message.querySelector('[data-slate-object]');
      const text = fallback?.innerText?.trim();
      if (text) segments.push(text);
    }

    let author = '';
    const authorNode = message.querySelector('h3') || message.querySelector('[data-role="username"]');
    if (authorNode) {
      author = authorNode.textContent?.trim() || '';
    }

    const languageAttr = message.querySelector('[lang]')?.getAttribute('lang') || '';

    return {
      text: segments.join('\n').trim(),
      author,
      language: languageAttr
    };
  }

  getMessageRoot(contentNode) {
    if (!contentNode) return null;
    const root =
      contentNode.closest('li[data-list-item-id^="chat-messages"]') ||
      contentNode.closest('li[id^="chat-messages"]') ||
      contentNode.closest('li[class*="messageListItem"]') ||
      contentNode.closest('[class*="message-"][role="article"]');
    return root || contentNode.closest('[class*="message-"]');
  }

  resolvePopupTheme() {
    const themes = this.config.popupThemes || [];
    if (!themes.length) {
      return {
        background: 'rgba(9, 13, 22, 0.95)',
        border: 'rgba(255, 255, 255, 0.08)',
        text: '#f2f6ff',
        subtext: '#8d98b1',
        shadow: '0 28px 64px rgba(0, 0, 0, 0.42)'
      };
    }
    const themeId = this.settings.popupStyle?.theme;
    return themes.find((theme) => theme.id === themeId) || themes[0];
  }

  resolvePopupFont() {
    return this.config.theme?.fontStack || `'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif`;
  }

  setNodeDirection(node, languageCode, sampleText = '') {
    if (!node) return;
    const normalized = (languageCode || '').toLowerCase();
    if (normalized) {
      node.setAttribute('lang', normalized);
    } else {
      node.removeAttribute('lang');
    }
    const rtl = this.isRTLLanguage(normalized, sampleText);
    node.setAttribute('dir', rtl ? 'rtl' : 'ltr');
  }

  getLanguageLabel(languageCode) {
    if (!languageCode) return 'Original language';
    const entry = this.config.languages.find((lang) => lang.code === languageCode);
    return entry?.label || languageCode.toUpperCase();
  }

  isRTLLanguage(languageCode, sampleText = '') {
    if (languageCode && this.rtlLanguages.has(languageCode.toLowerCase())) {
      return true;
    }
    const rtlPattern = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
    return rtlPattern.test(sampleText);
  }

  ensureGlobalOverlayListeners() {
    if (this.listenersBound) return;
    window.addEventListener('resize', this.boundReposition, { passive: true });
    window.addEventListener('scroll', this.boundReposition, { passive: true });
    this.listenersBound = true;
  }

  setupDrag(overlay, dragHandle) {
    console.log('[Xtension Discord] Setting up drag functionality', dragHandle);
    const { wrapper } = overlay;
    let isDragging = false;
    let startX, startY, startLeft, startTop;

    const startDrag = (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      const rect = wrapper.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;

      document.body.style.userSelect = 'none';
      e.preventDefault();
    };

    const drag = (e) => {
      if (!isDragging) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      let newLeft = startLeft + deltaX;
      let newTop = startTop + deltaY;

      // Keep within viewport
      const popupWidth = wrapper.offsetWidth;
      const popupHeight = wrapper.offsetHeight;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      newLeft = Math.max(0, Math.min(newLeft, viewportWidth - popupWidth));
      newTop = Math.max(0, Math.min(newTop, viewportHeight - popupHeight));

      wrapper.style.left = `${newLeft}px`;
      wrapper.style.top = `${newTop}px`;
    };

    const endDrag = () => {
      isDragging = false;
      document.body.style.userSelect = '';
    };

    dragHandle.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', endDrag);

    // Cleanup function
    overlay.dragCleanup = () => {
      dragHandle.removeEventListener('mousedown', startDrag);
      document.removeEventListener('mousemove', drag);
      document.removeEventListener('mouseup', endDrag);
    };
  }

  setupResize(overlay, resizeHandle) {
    const { card } = overlay;
    let isResizing = false;
    let startX, startY, startWidth, startHeight;

    const startResize = (e) => {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;

      startWidth = card.offsetWidth;
      startHeight = card.offsetHeight;

      card.classList.add('tx-resizing');
      document.body.style.userSelect = 'none';
      e.preventDefault();
      e.stopPropagation();
    };

    const resize = (e) => {
      if (!isResizing) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      let newWidth = startWidth + deltaX;
      let newHeight = startHeight + deltaY;

      // Apply constraints
      const minWidth = 300;
      const minHeight = 200;
      const maxWidth = window.innerWidth - 40;
      const maxHeight = window.innerHeight - 40;

      newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
      newHeight = Math.max(minHeight, Math.min(newHeight, maxHeight));

      card.style.width = `${newWidth}px`;
      card.style.height = `${newHeight}px`;

      // Smart content management based on size
      this.manageContentVisibility(overlay, newWidth, newHeight);
    };

    const endResize = () => {
      if (!isResizing) return;
      isResizing = false;
      card.classList.remove('tx-resizing');
      document.body.style.userSelect = '';
    };

    resizeHandle.addEventListener('mousedown', startResize);
    document.addEventListener('mousemove', resize);
    document.addEventListener('mouseup', endResize);

    // Cleanup function
    overlay.resizeCleanup = () => {
      resizeHandle.removeEventListener('mousedown', startResize);
      document.removeEventListener('mousemove', resize);
      document.removeEventListener('mouseup', endResize);
    };
  }

  toggleMinimize(overlay) {
    const { card } = overlay;
    const isMinimized = card.classList.contains('tx-minimized');

    if (isMinimized) {
      // Restore to previous size
      card.classList.remove('tx-minimized');
      if (overlay.previousSize) {
        card.style.width = overlay.previousSize.width;
        card.style.height = overlay.previousSize.height;
      }
      this.showContent(overlay);
    } else {
      // Store current size and minimize
      overlay.previousSize = {
        width: card.style.width || '',
        height: card.style.height || ''
      };

      // Calculate optimal height based on content
      const optimalHeight = this.calculateOptimalHeight(overlay);

      // Set minimized size (just enough for translation section with proper height)
      card.style.width = '360px';
      card.style.height = `${optimalHeight}px`;
      card.classList.add('tx-minimized');
      this.hideContent(overlay);
    }
  }

  manageContentVisibility(overlay, width, height) {
    const { card } = overlay;
    const thresholdHeight = 300; // Minimum height to show reply composer

    if (height < thresholdHeight) {
      this.hideContent(overlay);
      card.classList.add('tx-smart-compact');
    } else {
      this.showContent(overlay);
      card.classList.remove('tx-smart-compact');
    }
  }

  hideContent(overlay) {
    if (overlay.replyComposer) {
      overlay.replyComposer.classList.add('tx-hidden');
    }
  }

  showContent(overlay) {
    if (overlay.replyComposer) {
      overlay.replyComposer.classList.remove('tx-hidden');
    }
  }

  calculateOptimalHeight(overlay) {
    const header = overlay.card.querySelector('.tx-overlay-header');
    const output = overlay.output;
    const resizeHandle = overlay.card.querySelector('.tx-resize-handle');

    let totalHeight = 0;

    // Header height
    if (header) {
      totalHeight += header.offsetHeight + 16; // Add margin
    }

    // Output content height
    if (output) {
      // Temporarily show full content to measure it
      const originalHeight = output.style.height;
      output.style.height = 'auto';
      const contentHeight = output.scrollHeight;
      output.style.height = originalHeight;

      totalHeight += Math.max(contentHeight + 32, 120); // Min 120px for output + padding
    }

    // Resize handle space
    if (resizeHandle) {
      totalHeight += 30;
    }

    // Add some padding
    totalHeight += 20;

    return Math.min(Math.max(totalHeight, 180), Math.min(window.innerHeight - 100, 400));
  }

  toast(title, message) {
    if (!message) return;
    if (!this.toastStack) {
      this.toastStack = document.createElement('div');
      this.toastStack.className = 'tx-toast-stack';
      document.body.appendChild(this.toastStack);
    }

    const toast = document.createElement('div');
    toast.className = 'tx-toast';
    const titleNode = document.createElement('strong');
    titleNode.textContent = title;
    const messageNode = document.createElement('span');
    messageNode.textContent = message;
    toast.appendChild(titleNode);
    toast.appendChild(messageNode);
    this.toastStack.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('tx-visible'));
    setTimeout(() => {
      toast.classList.remove('tx-visible');
      setTimeout(() => toast.remove(), 240);
    }, 2200);
  }
}

async function detectLanguageGuess(text) {
  const snippet = (text || '').trim();
  if (!snippet || !chrome?.i18n?.detectLanguage) return '';
  return new Promise((resolve) => {
    try {
      chrome.i18n.detectLanguage(snippet.slice(0, 1200), (result) => {
        if (chrome.runtime?.lastError) {
          resolve('');
          return;
        }
        const languages = result?.languages || [];
        const reliable =
          languages.find((entry) => entry.isReliable) ||
          languages.find((entry) => (entry.percentage || 0) >= 50);
        resolve((reliable?.language || languages[0]?.language || '').toLowerCase());
      });
    } catch (error) {
      resolve('');
    }
  });
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function deepMerge(target, source) {
  if (!source) return target;
  const output = Array.isArray(target) ? [...target] : { ...target };
  Object.keys(source).forEach((key) => {
    if (Array.isArray(source[key])) {
      output[key] = source[key].slice();
    } else if (source[key] && typeof source[key] === 'object') {
      output[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      output[key] = source[key];
    }
  });
  return output;
}

function capitalize(value) {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + String(value).slice(1);
}
