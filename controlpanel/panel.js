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

  try {
    // Load main interface directly
    console.log('[XTension] Loading main interface directly');
    await loadMainInterface();
    return;

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
// Function to load main interface
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
    bindActions();

    console.log('[XT] Main interface loaded successfully');
  } catch (error) {
    console.error('[XT] Error loading main interface:', error);
  }
}

function cacheTemplates() {
  state.toneTemplate = document.getElementById('toneTemplate');
  state.providerTemplate = document.getElementById('providerTemplate');
}

async function hydrateSettings() {
  try {
    const { [STORAGE_KEY]: saved } = await chrome.storage.local.get([STORAGE_KEY]);
    if (saved && typeof saved === 'object') {
      state.settings = deepMerge(clone(XtensionConfig.defaultSettings), saved);
    } else {
      state.settings = clone(XtensionConfig.defaultSettings);
    }
  } catch (error) {
    console.error('[Xtension] Failed to load settings', error);
    state.settings = clone(XtensionConfig.defaultSettings);
  }
  if (!state.settings.reply) {
    state.settings.reply = clone(XtensionConfig.defaultSettings.reply);
  } else {
    state.settings.reply = deepMerge(clone(XtensionConfig.defaultSettings.reply), state.settings.reply);
  }
  enforceWordBounds(state.settings.reply, XtensionConfig.defaultSettings.reply);
  if (!state.settings.popupStyle) {
    state.settings.popupStyle = clone(XtensionConfig.defaultSettings.popupStyle);
  } else {
    state.settings.popupStyle = deepMerge(clone(XtensionConfig.defaultSettings.popupStyle), state.settings.popupStyle);
  }
  if (!state.settings.discordReply) {
    state.settings.discordReply = clone(XtensionConfig.defaultSettings.discordReply);
  } else {
    state.settings.discordReply = deepMerge(clone(XtensionConfig.defaultSettings.discordReply), state.settings.discordReply);
  }
  enforceWordBounds(state.settings.discordReply, XtensionConfig.defaultSettings.discordReply);
  if (state.settings.discordReply && Object.prototype.hasOwnProperty.call(state.settings.discordReply, 'enabled')) {
    delete state.settings.discordReply.enabled;
  }
  updateHeaderSummary();
}

function renderOverview() {
  const linkNodes = document.querySelectorAll('[data-social-link]');
  linkNodes.forEach((node) => {
    const key = node.dataset.socialLink;
    node.href = XtensionConfig.branding.socials[key] || '#';
  });
}

function renderTranslationDefaults() {
  const languageSelect = document.getElementById('languageSelect');
  if (languageSelect) {
    languageSelect.innerHTML = '';
    XtensionConfig.languages.forEach((lang) => {
      const option = document.createElement('option');
      option.value = lang.code;
      option.textContent = lang.label;
      languageSelect.appendChild(option);
    });
    languageSelect.value = state.settings.targetLanguage;
  }

  const pinWindow = document.getElementById('pinWindow');
  if (pinWindow) {
    pinWindow.checked = !!state.settings.pinWindow;
  }

  const autoCopy = document.getElementById('autoCopy');
  if (autoCopy) {
    autoCopy.checked = !!state.settings.autoCopy;
  }
}

function renderWorkspace() {
  prepareAppearanceDefaults();
  renderAppearanceControls();
}

function prepareAppearanceDefaults() {
  const themes = XtensionConfig.popupThemes || [];
  state.settings.popupStyle = state.settings.popupStyle || {};
  const desiredTheme = state.settings.popupStyle.theme;
  const themeExists = themes.some((theme) => theme.id === desiredTheme);
  state.settings.popupStyle.theme = themeExists ? desiredTheme : themes[0]?.id || 'obsidian';
}

function renderAppearanceControls() {
  const select = document.getElementById('popupThemeSelect');
  if (!select) return;

  const themes = XtensionConfig.popupThemes || [];
  const current = state.settings.popupStyle?.theme;

  // Clear existing options
  select.innerHTML = '';

  // Add theme options with better names
  const themeNames = {
    'light': 'Light Theme',
    'dark': 'Dark Theme',
    'obsidian': 'Obsidian'
  };

  themes.forEach((theme) => {
    const option = document.createElement('option');
    option.value = theme.id;
    option.textContent = themeNames[theme.id] || theme.label;
    if (theme.id === current) {
      option.selected = true;
    }
    select.appendChild(option);
  });

  // Add change event listener
  select.addEventListener('change', () => {
    state.settings.popupStyle.theme = select.value;
    persistSettings();
  });
}

function renderReplySettings() {
  const replyPromptField = document.getElementById('replyPrompt');
  if (replyPromptField) {
    if (XtensionConfig.reply?.placeholder) {
      replyPromptField.placeholder = XtensionConfig.reply.placeholder;
    }
    replyPromptField.value = state.settings.reply?.prompt || '';
  }
  const replyContextField = document.getElementById('replyContext');
  if (replyContextField) {
    replyContextField.value = state.settings.reply?.context || '';
  }
  const replyAvoidField = document.getElementById('replyAvoid');
  if (replyAvoidField) {
    replyAvoidField.value = state.settings.reply?.avoid || '';
  }
  const replyMinField = document.getElementById('replyMinWords');
  if (replyMinField) {
    replyMinField.value = Number.isFinite(state.settings.reply?.minWords) ? state.settings.reply.minWords : '';
  }
  const replyMaxField = document.getElementById('replyMaxWords');
  if (replyMaxField) {
    replyMaxField.value = Number.isFinite(state.settings.reply?.maxWords) ? state.settings.reply.maxWords : '';
  }
  const replyAutoCopyToggle = document.getElementById('replyAutoCopy');
  if (replyAutoCopyToggle) {
    replyAutoCopyToggle.checked = !!state.settings.reply?.autoCopy;
  }
}

function renderDiscordSettings() {
  const contextField = document.getElementById('discordReplyContext');
  if (contextField) {
    const placeholder = XtensionConfig.discordReply?.contextPlaceholder;
    if (placeholder) contextField.placeholder = placeholder;
    contextField.value = state.settings.discordReply?.context || '';
  }

  const promptField = document.getElementById('discordReplyPrompt');
  if (promptField) {
    const placeholder = XtensionConfig.discordReply?.promptPlaceholder;
    if (placeholder) promptField.placeholder = placeholder;
    promptField.value = state.settings.discordReply?.prompt || '';
  }

  const avoidField = document.getElementById('discordReplyAvoid');
  if (avoidField) {
    avoidField.value = state.settings.discordReply?.avoid || '';
  }
  const minField = document.getElementById('discordReplyMinWords');
  if (minField) {
    minField.value = Number.isFinite(state.settings.discordReply?.minWords) ? state.settings.discordReply.minWords : '';
  }
  const maxField = document.getElementById('discordReplyMaxWords');
  if (maxField) {
    maxField.value = Number.isFinite(state.settings.discordReply?.maxWords) ? state.settings.discordReply.maxWords : '';
  }

  const autoCopyToggle = document.getElementById('discordReplyAutoCopy');
  if (autoCopyToggle) {
    autoCopyToggle.checked = !!state.settings.discordReply?.autoCopy;
  }
}

function renderTones() {
  const list = document.getElementById('toneList');
  list.innerHTML = '';
  state.tonePresets.forEach((preset) => {
    const node = state.toneTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.toneId = preset.id;
    node.querySelector('.tx-tone-name').textContent = preset.label;
    node.querySelector('.tx-tone-description').textContent = preset.description;
    if (state.settings.tonePreset === preset.id) {
      node.classList.add('active');
    }
    node.addEventListener('click', async () => {
      state.settings.tonePreset = preset.id;
      renderTones();
      await persistSettings();
    });
    list.appendChild(node);
  });

  // Render translation defaults in the Translation tab
  renderTranslationDefaults();
}

function renderProviders() {
  const select = document.getElementById('providerSelect');
  const container = document.getElementById('providerForms');
  select.innerHTML = '';
  container.innerHTML = '';
  state.providerForms.clear();

  Object.values(state.providerCatalog).forEach((provider) => {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = provider.label;
    select.appendChild(option);

    const form = buildProviderForm(provider);
    container.appendChild(form);
    state.providerForms.set(provider.id, form);
  });

  select.value = state.settings.provider;
  updateProviderVisibility(state.settings.provider);
  select.addEventListener('change', async (event) => {
    state.settings.provider = event.target.value;
    updateProviderVisibility(event.target.value);
    updateHeaderSummary();
    await persistSettings();
  });
}

function buildProviderForm(provider) {
  const form = state.providerTemplate.content.firstElementChild.cloneNode(true);
  form.dataset.provider = provider.id;
  form.querySelector('.tx-provider-title').textContent = provider.label;
  form.querySelector('.tx-provider-description').textContent = provider.endpoint
    ? `Endpoint: ${provider.endpoint}`
    : 'Bring your own OpenAI-compatible endpoint.';

  const settings = state.settings.providerSettings[provider.id] || {};
  form.querySelector('[data-field="apiKey"]').value = settings.apiKey || '';
  form.querySelector('[data-field="baseUrl"]').value = settings.baseUrl || provider.endpoint || '';
  form.querySelector('[data-field="temperature"]').value = settings.temperature ?? 0.2;
  form.querySelector('[data-field="maxTokens"]').value = settings.maxTokens ?? settings.maxOutputTokens ?? 400;

  // Populate model dropdown
  const modelSelect = form.querySelector('[data-field="model"]');
  if (provider.models && Object.keys(provider.models).length > 0) {
    modelSelect.innerHTML = '';
    Object.entries(provider.models).forEach(([modelId, modelInfo]) => {
      const option = document.createElement('option');
      option.value = modelId;
      option.textContent = `${modelInfo.name} • ${modelInfo.context}k context • ${modelInfo.tier}`;
      option.dataset.tier = modelInfo.tier;
      modelSelect.appendChild(option);
    });
    modelSelect.value = settings.model || provider.defaultModel || '';
  }

  const extra = form.querySelector('.tx-extra');
  extra.innerHTML = '';

  return form;
}


function buildInputField(label, field, value, type = 'text', hint = '') {
  const wrapper = document.createElement('label');
  wrapper.className = 'tx-field';
  const span = document.createElement('span');
  span.className = 'tx-label';
  span.textContent = label;
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  input.dataset.field = field;
  wrapper.appendChild(span);
  wrapper.appendChild(input);
  if (hint) {
    const help = document.createElement('span');
    help.className = 'tx-help';
    help.textContent = hint;
    wrapper.appendChild(help);
  }
  return wrapper;
}

function bindActions() {
  // Handle Translation defaults form (new location in Translation tab)
  const translationDefaultsForm = document.getElementById('translationDefaultsForm');
  if (translationDefaultsForm) {
    translationDefaultsForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const languageSelect = document.getElementById('languageSelect');
      const pinWindow = document.getElementById('pinWindow');
      const autoCopy = document.getElementById('autoCopy');

      if (languageSelect) state.settings.targetLanguage = languageSelect.value;
      if (pinWindow) state.settings.pinWindow = pinWindow.checked;
      if (autoCopy) state.settings.autoCopy = autoCopy.checked;

      await persistSettings();
      flashButton(event.submitter);
    });
  }

  // Handle workspace form (now only popup theme)
  document.getElementById('workspaceForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    // Theme settings are already handled by renderAppearanceControls
    await persistSettings();
    flashButton(event.submitter);
  });

  const replyForm = document.getElementById('replyForm');
  if (replyForm) {
    replyForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      state.settings.reply = state.settings.reply || {};
      state.settings.reply.prompt = document.getElementById('replyPrompt').value.trim();
      state.settings.reply.context = document.getElementById('replyContext').value.trim();
      state.settings.reply.avoid = document.getElementById('replyAvoid').value.trim();
      state.settings.reply.minWords = normalizeWordCount(document.getElementById('replyMinWords').value);
      state.settings.reply.maxWords = normalizeWordCount(document.getElementById('replyMaxWords').value);
      enforceWordBounds(state.settings.reply, XtensionConfig.defaultSettings.reply);
      state.settings.reply.autoCopy = document.getElementById('replyAutoCopy').checked;
      await persistSettings();
      renderReplySettings();
      flashButton(event.submitter);
    });
  }

  const discordForm = document.getElementById('discordForm');
  if (discordForm) {
    discordForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      state.settings.discordReply = state.settings.discordReply || {};
      state.settings.discordReply.context = document.getElementById('discordReplyContext').value.trim();
      state.settings.discordReply.prompt = document.getElementById('discordReplyPrompt').value.trim();
      state.settings.discordReply.avoid = document.getElementById('discordReplyAvoid').value.trim();
      state.settings.discordReply.minWords = normalizeWordCount(document.getElementById('discordReplyMinWords').value);
      state.settings.discordReply.maxWords = normalizeWordCount(document.getElementById('discordReplyMaxWords').value);
      enforceWordBounds(state.settings.discordReply, XtensionConfig.defaultSettings.discordReply);
      state.settings.discordReply.autoCopy = document.getElementById('discordReplyAutoCopy').checked;
      await persistSettings();
      renderDiscordSettings();
      flashButton(event.submitter);
    });
  }

  document.getElementById('saveProviders').addEventListener('click', async () => {
    state.providerForms.forEach((form, providerId) => {
      const inputs = form.querySelectorAll('[data-field]');
      const snapshot = { ...(state.settings.providerSettings[providerId] || {}) };
      inputs.forEach((input) => {
        let value = input.value;
        if (input.type === 'number') {
          value = Number(value);
        }
        snapshot[input.dataset.field] = value;
      });
      state.settings.providerSettings[providerId] = snapshot;
    });

    await persistSettings();
    updateHeaderSummary();
    flashButton(document.getElementById('saveProviders'));
  });

  // Simple theme toggle
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    const savedTheme = state.settings.theme || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    themeToggle.checked = savedTheme === 'light';
    updateThemeIcon(savedTheme);

    themeToggle.addEventListener('change', async (event) => {
      const theme = event.target.checked ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', theme);
      state.settings.theme = theme;
      await persistSettings();
      updateThemeIcon(theme);
    });
  }
}

function updateThemeIcon(theme) {
  const themeIcon = document.querySelector('.tx-theme-icon');
  if (themeIcon) {
    themeIcon.textContent = theme === 'light' ? '☀️' : '🌙';
  }
}

function updateProviderVisibility(activeId) {
  state.providerForms.forEach((form, id) => {
    form.style.display = id === activeId ? 'flex' : 'none';
  });
}

async function persistSettings() {
  await chrome.storage.local.set({ [STORAGE_KEY]: state.settings });
}

function wireTabs() {
  const tabs = document.querySelectorAll('.tx-tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((other) => {
        other.classList.toggle('active', other === tab);
        other.setAttribute('aria-selected', other === tab);
      });
      document.querySelectorAll('.tx-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.id === tab.dataset.tab);
      });
    });
  });
}

function updateHeaderSummary() {
  const provider = state.providerCatalog[state.settings.provider];
  const providerSettings = state.settings.providerSettings[state.settings.provider] || {};
  document.getElementById('providerLabel').textContent = `Provider: ${provider?.label || '—'}`;
  document.getElementById('modelLabel').textContent = `Model: ${providerSettings.model || provider?.defaultModel || '—'}`;
}

function flashButton(button, customMessage = 'Settings Saved!') {
  if (!button) return;

  const original = button.textContent;
  const originalClasses = button.className;
  const originalStyles = button.getAttribute('style') || '';

  // Add success animation class
  button.classList.add('save-success');

  // FORCE green color with inline styles - maximum override
  button.style.cssText = `
    background: linear-gradient(135deg, #22c55e, #16a34a) !important;
    border: 2px solid #16a34a !important;
    color: #ffffff !important;
    transform: scale(1.05) !important;
    box-shadow: 0 0 25px rgba(34, 197, 94, 0.6) !important;
    ${originalStyles}
  `;

  // Change to success state with icon
  button.innerHTML = `<span class="save-icon">✓</span>${customMessage}`;
  button.disabled = true;

  // Create ripple effect
  createSaveRipple(button);

  // Show toast notification
  showSaveToast(customMessage);

  // Reset after animation
  setTimeout(() => {
    button.innerHTML = original;
    button.disabled = false;
    button.classList.remove('save-success');
    button.style.cssText = originalStyles; // Restore original styles
  }, 2000);
}

// Specialized flash functions for different actions
function flashExtractButton(button) {
  if (!button) return;
  const original = button.textContent;
  const originalStyles = button.getAttribute('style') || '';
  button.classList.add('save-success');

  // FORCE green color with inline styles
  button.style.cssText = `
    background: linear-gradient(135deg, #22c55e, #16a34a) !important;
    border: 2px solid #16a34a !important;
    color: #ffffff !important;
    transform: scale(1.05) !important;
    box-shadow: 0 0 25px rgba(34, 197, 94, 0.6) !important;
    ${originalStyles}
  `;

  button.innerHTML = '<span class="save-icon">🔗</span>Links Extracted!';
  button.disabled = true;
  createSaveRipple(button);
  showSaveToast('Links extracted successfully!');
  setTimeout(() => {
    button.innerHTML = original;
    button.disabled = false;
    button.classList.remove('save-success');
    button.style.cssText = originalStyles;
  }, 2000);
}

function flashClearButton(button, message = 'Cleared!') {
  if (!button) return;
  const original = button.textContent;
  const originalStyles = button.getAttribute('style') || '';
  button.classList.add('save-success');

  // FORCE green color with inline styles
  button.style.cssText = `
    background: linear-gradient(135deg, #22c55e, #16a34a) !important;
    border: 2px solid #16a34a !important;
    color: #ffffff !important;
    transform: scale(1.05) !important;
    box-shadow: 0 0 25px rgba(34, 197, 94, 0.6) !important;
    ${originalStyles}
  `;

  button.innerHTML = `<span class="save-icon">🗑️</span>${message}`;
  button.disabled = true;
  createSaveRipple(button);
  showSaveToast(message);
  setTimeout(() => {
    button.innerHTML = original;
    button.disabled = false;
    button.classList.remove('save-success');
    button.style.cssText = originalStyles;
  }, 2000);
}

function flashForceButton(button) {
  if (!button) return;
  const original = button.textContent;
  const originalStyles = button.getAttribute('style') || '';
  button.classList.add('save-success');

  // FORCE green color with inline styles
  button.style.cssText = `
    background: linear-gradient(135deg, #22c55e, #16a34a) !important;
    border: 2px solid #16a34a !important;
    color: #ffffff !important;
    transform: scale(1.05) !important;
    box-shadow: 0 0 25px rgba(34, 197, 94, 0.6) !important;
    ${originalStyles}
  `;

  button.innerHTML = '<span class="save-icon">🔄</span>Force Cleared!';
  button.disabled = true;
  createSaveRipple(button);
  showSaveToast('Force clear completed!');
  setTimeout(() => {
    button.innerHTML = original;
    button.disabled = false;
    button.classList.remove('save-success');
    button.style.cssText = originalStyles;
  }, 2000);
}

function createSaveRipple(button) {
  const ripple = document.createElement('span');
  ripple.className = 'save-ripple';
  button.appendChild(ripple);

  setTimeout(() => {
    if (ripple.parentNode) {
      ripple.parentNode.removeChild(ripple);
    }
  }, 1000);
}

function showSaveToast(message = 'Settings saved successfully!') {
  // Remove existing toast if any
  const existingToast = document.querySelector('.save-toast');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.className = 'save-toast';
  toast.innerHTML = `
    <div class="toast-icon">✓</div>
    <div class="toast-message">${message}</div>
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-show');
  }, 100);

  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 2500);
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

function normalizeWordCount(value) {
  if (value === '' || value === null || value === undefined) return 0;
  const num = Math.floor(Number(value));
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(250, num);
}

function enforceWordBounds(config, defaults = {}) {
  if (!config) return;
  const clamp = (input) => {
    if (!Number.isFinite(input) || input <= 0) return 0;
    return Math.min(250, Math.max(1, Math.floor(input)));
  };
  config.minWords = clamp(config.minWords);
  config.maxWords = clamp(config.maxWords);
  if (!config.minWords && !config.maxWords) {
    const fallbackMin = clamp(defaults?.minWords);
    const fallbackMax = clamp(defaults?.maxWords);
    config.minWords = fallbackMin;
    config.maxWords = fallbackMax;
  }
  if (config.minWords && config.maxWords && config.minWords > config.maxWords) {
    const swap = config.minWords;
    config.minWords = config.maxWords;
    config.maxWords = swap;
  }
}


