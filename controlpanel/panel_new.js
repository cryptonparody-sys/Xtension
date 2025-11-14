import { XtensionConfig } from '../core/options.js';

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

const STORAGE_KEY = 'txSettings';
const clone = (value) => (typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)));

const state = {
  settings: clone(XtensionConfig.defaultSettings),
  tonePresets: XtensionConfig.tonePresets,
  providerCatalog: XtensionConfig.providerCatalog,
  toneTemplate: null,
  providerTemplate: null,
  providerForms: new Map(),
  storageChangeListener: null // Add storage listener reference for cleanup
};

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[XTension] Extension loading...');

  // Load main interface directly without license validation
  try {
    await loadMainInterface();
  } catch (error) {
    console.error('[XTension] Error loading main interface:', error);
    // Show error state but still try to load minimal interface
    try {
      await loadMainInterface();
    } catch (fallbackError) {
      console.error('[XTension] Critical error loading interface:', fallbackError);
    }
  }
});

// Function to load main interface after successful license activation
async function loadMainInterface() {
  try {
    // Load normal interface
    cacheTemplates();
    wireTabs();
    await hydrateSettings();
    renderOverview();
    renderWorkspace();
    renderReplySettings();
    renderDiscordSettings();
    renderTones();
    renderProviders();
    renderAccount();
    renderQuickSetup();
    wireGeneral();
    wireWorkspace();
    wireReplyButtons();
    wireReplySettings();
    wireDiscord();
    wireTones();
    wireProviders();
    wireAccount();
    bindStorageListener();

    // Show main content
    const loadingScreen = document.getElementById('loading-screen');
    const mainContent = document.getElementById('main-content');

    if (loadingScreen) {
      loadingScreen.style.display = 'none';
    }
    if (mainContent) {
      mainContent.style.display = 'block';
    }

    console.log('[XTension] Main interface loaded successfully');
  } catch (error) {
    console.error('[XTension] Error loading main interface:', error);

    // Still try to show the interface even if there's an error
    const loadingScreen = document.getElementById('loading-screen');
    const mainContent = document.getElementById('main-content');

    if (loadingScreen) {
      loadingScreen.style.display = 'none';
    }
    if (mainContent) {
      mainContent.style.display = 'block';
    }
  }
}

// Cache tab button templates
function cacheTemplates() {
  state.toneTemplate = document.getElementById('template-tone-tab');
  state.providerTemplate = document.getElementById('template-provider-tab');
}

// Tab navigation
function wireTabs() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const targetTab = button.dataset.tab;

      // Update button states
      tabButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');

      // Update panel visibility
      tabPanels.forEach(panel => {
        if (panel.id === `tab-${targetTab}`) {
          panel.classList.add('active');
        } else {
          panel.classList.remove('active');
        }
      });
    });
  });
}

// Load and hydrate settings
async function hydrateSettings() {
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
  if (stored) {
    Object.assign(state.settings, clone(stored));
  }
}

// Save settings
async function persistSettings() {
  await chrome.storage.local.set({ [STORAGE_KEY]: clone(state.settings) });
}

// Storage listener
function bindStorageListener() {
  const onStorageChange = (changes, namespace) => {
    if (namespace === 'local' && changes[STORAGE_KEY]) {
      Object.assign(state.settings, clone(changes[STORAGE_KEY].newValue));
    }
  };

  chrome.storage.onChanged.addListener(onStorageChange);
  state.storageChangeListener = onStorageChange; // Store reference for cleanup
}

// Overview panel
function renderOverview() {
  const container = document.getElementById('overview-details');
  const replies = state.settings.replyEngine.x.completion;
  const discord = state.settings.replyEngine.discord.completion;

  container.innerHTML = `
    <div class="overview-group">
      <h4>X (Twitter) Reply Engine</h4>
      <div class="overview-item">
        <label>Provider:</label>
        <span>${state.settings.replyEngine.x.provider}</span>
      </div>
      <div class="overview-item">
        <label>Model:</label>
        <span>${replies.model}</span>
      </div>
      <div class="overview-item">
        <label>Tone:</label>
        <span>${replies.tone}</span>
      </div>
      <div class="overview-item">
        <label>Max Tokens:</label>
        <span>${replies.max_tokens}</span>
      </div>
    </div>
    <div class="overview-group">
      <h4>Discord Reply Engine</h4>
      <div class="overview-item">
        <label>Provider:</label>
        <span>${state.settings.replyEngine.discord.provider}</span>
      </div>
      <div class="overview-item">
        <label>Model:</label>
        <span>${discord.model}</span>
      </div>
      <div class="overview-item">
        <label>Tone:</label>
        <span>${discord.tone}</span>
      </div>
      <div class="overview-item">
        <label>Max Tokens:</label>
        <span>${discord.max_tokens}</span>
      </div>
    </div>
  `;
}

// Workspace panel
function renderWorkspace() {
  const shortcut = document.getElementById('global-shortcut');
  if (shortcut) {
    shortcut.value = state.settings.globalHotkey || 'Ctrl+Shift+X';
  }
}

// Reply settings panel
function renderReplySettings() {
  // X settings
  const xProvider = document.getElementById('x-provider');
  const xModel = document.getElementById('x-model');
  const xTone = document.getElementById('x-tone');
  const xTokens = document.getElementById('x-max-tokens');

  if (xProvider) {
    xProvider.value = state.settings.replyEngine.x.provider;
  }
  if (xModel) {
    xModel.value = state.settings.replyEngine.x.completion.model;
  }
  if (xTone) {
    xTone.value = state.settings.replyEngine.x.completion.tone;
  }
  if (xTokens) {
    xTokens.value = state.settings.replyEngine.x.completion.max_tokens;
  }

  // Discord settings
  const dProvider = document.getElementById('discord-provider');
  const dModel = document.getElementById('discord-model');
  const dTone = document.getElementById('discord-tone');
  const dTokens = document.getElementById('discord-max-tokens');

  if (dProvider) {
    dProvider.value = state.settings.replyEngine.discord.provider;
  }
  if (dModel) {
    dModel.value = state.settings.replyEngine.discord.completion.model;
  }
  if (dTone) {
    dTone.value = state.settings.replyEngine.discord.completion.tone;
  }
  if (dTokens) {
    dTokens.value = state.settings.replyEngine.discord.completion.max_tokens;
  }
}

// Discord settings panel
function renderDiscordSettings() {
  const toggle = document.getElementById('discord-enabled');
  const status = document.getElementById('discord-status');

  if (toggle) {
    toggle.checked = state.settings.discord.enabled;
  }
  if (status) {
    status.textContent = state.settings.discord.enabled ? 'Enabled' : 'Disabled';
    status.className = `status-indicator ${state.settings.discord.enabled ? 'enabled' : 'disabled'}`;
  }
}

// Tones panel
function renderTones() {
  const container = document.getElementById('tones-list');
  container.innerHTML = '';

  state.tonePresets.forEach(tone => {
    const tab = state.toneTemplate.content.cloneNode(true);
    const button = tab.querySelector('.tone-tab-button');

    button.textContent = tone.name;
    button.dataset.tone = tone.name;
    container.appendChild(tab);
  });
}

// Providers panel
function renderProviders() {
  const container = document.getElementById('providers-list');
  container.innerHTML = '';

  state.providerCatalog.forEach(provider => {
    const tab = state.providerTemplate.content.cloneNode(true);
    const button = tab.querySelector('.provider-tab-button');
    const icon = tab.querySelector('.provider-icon');
    const name = tab.querySelector('.provider-name');

    if (icon) {
      icon.src = provider.icon || '';
      icon.alt = `${provider.name} icon`;
    }
    if (name) {
      name.textContent = provider.name;
    }

    button.dataset.provider = provider.id;
    container.appendChild(tab);

    // Store provider form reference
    const formId = `provider-form-${provider.id}`;
    state.providerForms.set(provider.id, formId);
  });
}

// Account panel
function renderAccount() {
  const version = document.getElementById('extension-version');
  if (version) {
    version.textContent = chrome.runtime.getManifest().version;
  }
}

// Quick setup panel
function renderQuickSetup() {
  const setup = document.getElementById('quick-setup-list');
  if (!setup) return;

  setup.innerHTML = `
    <div class="setup-step ${state.settings.replyEngine.x.provider ? 'completed' : ''}">
      <div class="step-number">1</div>
      <div class="step-content">
        <h4>Configure X Provider</h4>
        <p>Select your preferred AI provider for X replies</p>
      </div>
    </div>
    <div class="setup-step ${state.settings.replyEngine.discord.provider ? 'completed' : ''}">
      <div class="step-number">2</div>
      <div class="step-content">
        <h4>Setup Discord Integration</h4>
        <p>Enable Discord and configure reply settings</p>
      </div>
    </div>
    <div class="setup-step ${state.settings.replyEngine.x.completion.tone !== 'professional' ? 'completed' : ''}">
      <div class="step-number">3</div>
      <div class="step-content">
        <h4>Customize Reply Tones</h4>
        <p>Choose or create custom reply tones</p>
      </div>
    </div>
    <div class="setup-step ${Object.keys(state.settings.apiKeys).length > 0 ? 'completed' : ''}">
      <div class="step-number">4</div>
      <div class="step-content">
        <h4>Add API Keys</h4>
        <p>Configure API keys for your selected providers</p>
      </div>
    </div>
  `;
}

// Event wiring functions
function wireGeneral() {
  const shortcut = document.getElementById('global-shortcut');
  if (shortcut) {
    shortcut.addEventListener('change', async (e) => {
      state.settings.globalHotkey = e.target.value;
      await persistSettings();
    });
  }
}

function wireWorkspace() {
  // Workspace-specific event handlers
}

function wireReplyButtons() {
  // Reply button event handlers
}

function wireReplySettings() {
  // Provider dropdowns
  const xProvider = document.getElementById('x-provider');
  const dProvider = document.getElementById('discord-provider');

  if (xProvider) {
    xProvider.addEventListener('change', async (e) => {
      state.settings.replyEngine.x.provider = e.target.value;
      await persistSettings();
      renderOverview();
    });
  }

  if (dProvider) {
    dProvider.addEventListener('change', async (e) => {
      state.settings.replyEngine.discord.provider = e.target.value;
      await persistSettings();
      renderOverview();
    });
  }

  // Model and tone settings
  const xModel = document.getElementById('x-model');
  const xTone = document.getElementById('x-tone');
  const xTokens = document.getElementById('x-max-tokens');
  const dModel = document.getElementById('discord-model');
  const dTone = document.getElementById('discord-tone');
  const dTokens = document.getElementById('discord-max-tokens');

  [xModel, xTone, xTokens, dModel, dTone, dTokens].forEach(input => {
    if (input) {
      input.addEventListener('change', async (e) => {
        const path = input.id.split('-');
        if (path[0] === 'x') {
          if (path[1] === 'model') {
            state.settings.replyEngine.x.completion.model = e.target.value;
          } else if (path[1] === 'tone') {
            state.settings.replyEngine.x.completion.tone = e.target.value;
          } else if (path[1] === 'max') {
            state.settings.replyEngine.x.completion.max_tokens = parseInt(e.target.value);
          }
        } else if (path[0] === 'discord') {
          if (path[1] === 'model') {
            state.settings.replyEngine.discord.completion.model = e.target.value;
          } else if (path[1] === 'tone') {
            state.settings.replyEngine.discord.completion.tone = e.target.value;
          } else if (path[1] === 'max') {
            state.settings.replyEngine.discord.completion.max_tokens = parseInt(e.target.value);
          }
        }
        await persistSettings();
        renderOverview();
      });
    }
  });
}

function wireDiscord() {
  const toggle = document.getElementById('discord-enabled');
  const status = document.getElementById('discord-status');

  if (toggle && status) {
    toggle.addEventListener('change', async (e) => {
      state.settings.discord.enabled = e.target.checked;
      status.textContent = e.target.checked ? 'Enabled' : 'Disabled';
      status.className = `status-indicator ${e.target.checked ? 'enabled' : 'disabled'}`;
      await persistSettings();
      renderOverview();
    });
  }
}

function wireTones() {
  const container = document.getElementById('tones-list');
  if (!container) return;

  container.addEventListener('click', async (e) => {
    const button = e.target.closest('.tone-tab-button');
    if (!button) return;

    const toneName = button.dataset.tone;
    const tone = state.tonePresets.find(t => t.name === toneName);
    if (!tone) return;

    // Update current tone for X replies
    state.settings.replyEngine.x.completion.tone = tone.name;
    await persistSettings();

    // Update UI
    const xTone = document.getElementById('x-tone');
    if (xTone) {
      xTone.value = tone.name;
    }
    renderOverview();
    renderQuickSetup();
  });
}

function wireProviders() {
  const container = document.getElementById('providers-list');
  if (!container) return;

  container.addEventListener('click', async (e) => {
    const button = e.target.closest('.provider-tab-button');
    if (!button) return;

    const providerId = button.dataset.provider;
    const provider = state.providerCatalog.find(p => p.id === providerId);
    if (!provider) return;

    // Show provider configuration modal or panel
    console.log('Provider selected:', provider);
  });
}

function wireAccount() {
  // Account-related event handlers
}

// Theme switching
function applyTheme(theme = 'light') {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
}

// Error handling
window.addEventListener('error', (e) => {
  console.error('[XTension] Unhandled error:', e.error);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[XTension] Unhandled promise rejection:', e.reason);
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (state.storageChangeListener) {
    chrome.storage.onChanged.removeListener(state.storageChangeListener);
  }
});

// Export for debugging
window.XtensionPanel = {
  state,
  persistSettings,
  applyTheme
};