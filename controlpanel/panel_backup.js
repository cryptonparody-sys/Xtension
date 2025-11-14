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
    // Check if license was just activated
    const licenseActivated = localStorage.getItem('licenseActivated');
    if (licenseActivated === 'true') {
      console.log('[XT License] License was just activated, loading main interface');
      localStorage.removeItem('licenseActivated');
      clearTimeout(loadingTimeout);
      await loadMainInterface();
      return;
    }

    // Check if there's a license in storage
    const licenseKey = localStorage.getItem('xtensionLicense');
    if (!licenseKey) {
      console.log('[XT License] No license found, showing activation screen');
      clearTimeout(loadingTimeout);
      showLicenseActivationScreen();
      return;
    }

    console.log('[XT License] License found, checking validity...');

    // Check if license was validated recently (within last hour)
    const lastValidation = localStorage.getItem('xtensionLastValidation');
    if (lastValidation) {
      const timeDiff = Date.now() - parseInt(lastValidation);
      const hoursDiff = timeDiff / (1000 * 60 * 60);

      if (hoursDiff < 1) {
        console.log('[XT License] License validated recently, skipping server check');
        clearTimeout(loadingTimeout);
        await loadMainInterface();
        return;
      }
    }

    console.log('[XT License] Attempting server validation...');

    // Import validator
    const module = await import('../core/license-validator.js');
    const { XtensionLicenseValidator } = module;
    const validator = new XtensionLicenseValidator();

    // Quick connection test with timeout
    let connectionOk = false;
    try {
      const connectionPromise = validator.testInternetConnection();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout')), 5000)
      );

      await Promise.race([connectionPromise, timeoutPromise]);
      connectionOk = true;
      console.log('[XT License] Server connection OK');
    } catch (error) {
      console.log('[XT License] Server connection failed:', error.message);
    }

    if (!connectionOk) {
      console.log('[XT License] No server connection, checking recent validation...');

      if (lastValidation) {
        const timeDiff = Date.now() - parseInt(lastValidation);
        const hoursDiff = timeDiff / (1000 * 60 * 60);

        if (hoursDiff < 1) {
          console.log('[XT License] Using recent validation, loading main interface');
          clearTimeout(loadingTimeout);
          await loadMainInterface();
          return;
        }
      }

      console.log('[XT License] No recent validation, showing activation screen');
      clearTimeout(loadingTimeout);
      showLicenseActivationScreen();
      return;
    }

    // Try server validation with timeout
    try {
      await validator.initialize();

      const validationPromise = validator.validateLicense(licenseKey);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Validation timeout')), 8000)
      );

      const isValid = await Promise.race([validationPromise, timeoutPromise]);

      if (isValid) {
        console.log('[XT License] License validated successfully');
        localStorage.setItem('xtensionLastValidation', Date.now().toString());
        clearTimeout(loadingTimeout);
        await loadMainInterface();
        return;
      } else {
        console.log('[XT License] License validation failed');
        localStorage.removeItem('xtensionLicense');
        localStorage.removeItem('xtensionLastValidation');
      }
    } catch (error) {
      console.log('[XT License] Validation error:', error.message);
      localStorage.removeItem('xtensionLicense');
      localStorage.removeItem('xtensionLastValidation');
    }

  } catch (error) {
    console.log('[XT License] Critical error:', error);
    localStorage.removeItem('xtensionLicense');
    localStorage.removeItem('xtensionLastValidation');
  }

  console.log('[XT License] Showing activation screen');
  clearTimeout(loadingTimeout);
  showLicenseActivationScreen();
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
    bindActions();

    // Initialize license expiry timer
    initLicenseExpiryTimer();

    // Initialize bulk reply functionality
    setTimeout(enhancedInitBulkReply, 100);

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

// ============================================================================
// Xtension Bulk Reply - Safe Implementation
// ============================================================================

// Add bulk reply state without interfering with existing state
state.bulkReply = {
  activeLinks: [],
  isRunning: false
};

// Initialize bulk reply functionality
function initBulkReply() {
  console.log('[Xtension] Bulk Reply initialized');

  // Initialize log container
  clearBulkLog();

  // Bind bulk reply event listeners
  const extractLinksBtn = document.getElementById('extractLinksButton');
  const runReplyBtn = document.getElementById('runBulkReplyButton');
  const stopReplyBtn = document.getElementById('stopBulkReplyButton');
  const clearDataBtn = document.getElementById('clearBulkDataButton');
  const clearLogBtn = document.getElementById('clearBulkLogButton');
  const clearLinksBtn = document.getElementById('clearBulkLinksButton');
  const forceClearBtn = document.getElementById('forceClearBulkButton');
  const saveSettingsBtn = document.getElementById('saveBulkSettingsButton');

  if (extractLinksBtn) extractLinksBtn.addEventListener('click', extractTweetLinks);
  if (runReplyBtn) runReplyBtn.addEventListener('click', startBulkReply);
  if (stopReplyBtn) stopReplyBtn.addEventListener('click', stopBulkReply);
  if (clearDataBtn) clearDataBtn.addEventListener('click', clearBulkData);
  if (clearLogBtn) clearLogBtn.addEventListener('click', clearBulkLog);
  if (clearLinksBtn) clearLinksBtn.addEventListener('click', clearBulkLinks);
  if (forceClearBtn) forceClearBtn.addEventListener('click', forceClearBulkProcess);
  if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', saveBulkSettings);

  // Load saved data
  loadBulkData();

  // Listen for storage changes to update bulk links display
  chrome.storage.onChanged.addListener((changes, namespace) => {
    console.log('[Xtension] Storage changed detected:', { changes, namespace });

    if (namespace === 'local' && changes.bulkReplyActiveLinks) {
      console.log('[Xtension] Bulk links updated in storage, old value:', changes.bulkReplyActiveLinks.oldValue);
      console.log('[Xtension] Bulk links updated in storage, new value:', changes.bulkReplyActiveLinks.newValue);
      console.log('[Xtension] Refreshing display...');
      loadBulkData(); // Reload to update the display
    }

    // ADDITIONAL TRIGGER FOR ANY STORAGE CHANGE
    if (namespace === 'local' && changes.bulkReplyTriggerUpdate) {
      console.log('[Xtension] Bulk reply trigger update detected, refreshing display...');
      loadBulkData(); // Reload to update the display
    }
  });

  addBulkLog('🚀 Bulk Reply initialized successfully', 'success');
}

// Extract Twitter/X links from text
async function extractTweetLinks() {
  console.log('[Xtension] extractTweetLinks called!');
  console.log('[Xtension] state object:', state);
  console.log('[Xtension] state.bulkReply:', state.bulkReply);

  const textarea = document.getElementById('bulkTweetLinks');
  if (!textarea) {
    console.log('[Xtension] ERROR: textarea not found');
    return;
  }

  const text = textarea.value.trim();
  console.log('[Xtension] Text from textarea:', text);

  if (!text) {
    addBulkLog('❌ Please paste tweet links in the textarea', 'error');
    return;
  }

  // Extract Twitter/X URLs
  const linkRegex = /https?:\/\/(?:twitter\.com|x\.com)\/(?:\w+)\/status\/(\d+)/g;
  const matches = text.match(linkRegex);

  console.log('[Xtension] Link regex matches:', matches);

  if (!matches || matches.length === 0) {
    addBulkLog('❌ No Twitter/X links found in the text', 'warning');
    return;
  }

  // Remove duplicates and append to existing list (backup extension logic)
  const uniqueNewLinks = [...new Set(matches)].filter(link => !state.bulkReply.activeLinks.includes(link));
  console.log('[Xtension] Unique new links:', uniqueNewLinks);
  console.log('[Xtension] Current active links count:', state.bulkReply.activeLinks.length);

  if (uniqueNewLinks.length > 0) {
    // Check if adding new links would exceed 250 limit
    const currentCount = state.bulkReply.activeLinks.length;
    const availableSlots = 250 - currentCount;

    if (availableSlots <= 0) {
      addBulkLog(`❌ Maximum limit of 250 links reached. Please remove some links first.`, 'error');
      return;
    }

    // Only add as many links as we have room for
    const linksToAdd = uniqueNewLinks.slice(0, availableSlots);
    const rejectedCount = uniqueNewLinks.length - linksToAdd.length;
    console.log('[Xtension] Links to add:', linksToAdd);

    // Append new links to existing list
    state.bulkReply.activeLinks.push(...linksToAdd);
    console.log('[Xtension] After adding, active links count:', state.bulkReply.activeLinks.length);

    if (rejectedCount > 0) {
      addBulkLog(`⚠️ Added ${linksToAdd.length} links (${rejectedCount} skipped due to 250 link limit)`, 'warning');
    } else {
      addBulkLog(`✅ Added ${linksToAdd.length} new links to extracted list`, 'success');
    }
  } else {
    addBulkLog('ℹ️ No new links to add (all already in extracted list)', 'info');
  }

  // Display extracted links
  console.log('[Xtension] About to call renderExtractedLinks...');
  renderExtractedLinks();
  await chrome.storage.local.set({ bulkReplyActiveLinks: state.bulkReply.activeLinks });
  console.log('[Xtension] renderExtractedLinks completed and storage updated');

  addBulkLog(`📊 Total extracted links: ${state.bulkReply.activeLinks.length}`, 'success');

  // Add visual feedback for extract links button
  flashExtractButton(document.getElementById('extractLinksButton'));
}

function renderExtractedLinks() {
  const container = document.getElementById('extractedLinksList');
  const countEl = document.getElementById('extractedCount');
  const containerEl = document.getElementById('extractedLinksCard');

  console.log('[Xtension] renderExtractedLinks() called');
  console.log('[Xtension] state.bulkReply.activeLinks:', state.bulkReply.activeLinks);
  console.log('[Xtension] Number of links:', state.bulkReply.activeLinks.length);

  if (!container || !countEl) {
    console.log('[Xtension] Container or count element not found, skipping render');
    return;
  }

  container.innerHTML = '';
  state.bulkReply.activeLinks.forEach((link, index) => {
    console.log('[Xtension] Rendering link', index, ':', link);
    const item = document.createElement('div');
    item.className = 'rx-link-item';  // Backup extension class

    // Create link span - EXACT backup structure
    const linkSpan = document.createElement('div');
    linkSpan.className = 'rx-link-text';  // Backup extension class
    linkSpan.title = link;
    linkSpan.textContent = link;

    // Create remove button - EXACT backup structure
    const removeBtn = document.createElement('button');
    removeBtn.className = 'rx-link-remove';  // Backup extension class
    removeBtn.textContent = '❌';
    removeBtn.title = 'Remove this link';

    // Add event listener properly (not using inline onclick)
    removeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeBulkLink(index);
    });

    // Assemble the item
    item.appendChild(linkSpan);
    item.appendChild(removeBtn);
    container.appendChild(item);
  });

  countEl.textContent = state.bulkReply.activeLinks.length;
  console.log('[Xtension] Set count to:', state.bulkReply.activeLinks.length);

  if (containerEl) {
    const displayStyle = state.bulkReply.activeLinks.length > 0 ? 'block' : 'none';
    containerEl.style.display = displayStyle;
    console.log('[Xtension] Set container display to:', displayStyle);
  }

  // CRITICAL DEBUG: Force scrolling with maximum specificity
  if (container) {
    console.log('[Xtension] DEBUG - Container element:', container);
    console.log('[Xtension] DEBUG - Container computed style max-height:', window.getComputedStyle(container).maxHeight);
    console.log('[Xtension] DEBUG - Container computed style overflow-y:', window.getComputedStyle(container).overflowY);
    console.log('[Xtension] DEBUG - Container actual height:', container.scrollHeight);

    // BRUTE FORCE: Apply styles with maximum specificity
    container.style.cssText = `
      max-height: 200px !important;
      overflow-y: auto !important;
      padding: 8px !important;
      height: 200px !important;
    `;

    console.log('[Xtension] DEBUG - Applied forced styles');
    console.log('[Xtension] DEBUG - Container height after forcing:', container.scrollHeight);
  }
}

function removeBulkLink(index) {
  console.log('[Xtension] removeBulkLink called with index:', index);
  console.log('[Xtension] Links before removal:', state.bulkReply.activeLinks.length);

  if (index >= 0 && index < state.bulkReply.activeLinks.length) {
    const removedLink = state.bulkReply.activeLinks[index];
    state.bulkReply.activeLinks.splice(index, 1);

    console.log('[Xtension] Removed link:', removedLink);
    console.log('[Xtension] Links after removal:', state.bulkReply.activeLinks.length);

    // Re-render the list
    renderExtractedLinks();

    // Update storage
    chrome.storage.local.set({ bulkReplyActiveLinks: state.bulkReply.activeLinks });

    addBulkLog(`🗑️ Removed link: ${removedLink.substring(0, 50)}...`, 'info');
  } else {
    console.error('[Xtension] Invalid index for removal:', index);
    addBulkLog('❌ Error: Invalid link index for removal', 'error');
  }
}

function clearBulkLinks() {
  const textarea = document.getElementById('bulkTweetLinks');
  if (textarea) textarea.value = '';

  state.bulkReply.activeLinks = [];
  renderExtractedLinks();
  chrome.storage.local.set({ bulkReplyActiveLinks: [] });
  addBulkLog('🗑️ Cleared all links', 'info');

  // Add visual feedback for clear all button
  flashClearButton(document.getElementById('clearBulkLinksButton'), 'All Links Cleared!');
}

// Start bulk reply process
async function startBulkReply() {
  if (state.bulkReply.activeLinks.length === 0) {
    addBulkLog('❌ No links to process', 'error');
    return;
  }

  try {
    // Validate we're on Twitter/X
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!currentTab.url.includes('twitter.com') && !currentTab.url.includes('x.com')) {
      addBulkLog('❌ Please navigate to Twitter/X before starting', 'error');
      return;
    }

    // Get settings
    const settings = {
      minWait: parseInt(document.getElementById('bulkMinWait')?.value || 20),
      maxWait: parseInt(document.getElementById('bulkMaxWait')?.value || 35),
      likePosts: document.getElementById('bulkLikePosts')?.checked || false,
      shuffle: document.getElementById('bulkShuffle')?.checked || false
    };

    // Prepare links array (apply shuffle if enabled)
    let linksToProcess = [...state.bulkReply.activeLinks];

    if (settings.shuffle) {
      // Fisher-Yates shuffle algorithm for true random order
      addBulkLog('🔀 Shuffle enabled - randomizing link order...', 'info');
      console.log('[Xtension] Original link order:', linksToProcess);

      for (let i = linksToProcess.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [linksToProcess[i], linksToProcess[j]] = [linksToProcess[j], linksToProcess[i]];
      }

      console.log('[Xtension] Shuffled link order:', linksToProcess);
      addBulkLog('🔀 Links randomized - processing in random order', 'success');
    }

    addBulkLog(`🚀 Starting bulk reply process with ${linksToProcess.length} links...`, 'info');
    addBulkLog(`📋 Settings: minWait=${settings.minWait}s, maxWait=${settings.maxWait}s, likePosts=${settings.likePosts}, shuffle=${settings.shuffle}`, 'info');
    updateBulkUI(true);

    // Call service worker to start bulk process
    const message = {
      action: 'startBulkReply',
      links: linksToProcess, // Send shuffled (or original) links
      settings: settings,
      currentTabId: (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id
    };

    console.log('[Xtension] Sending message to service worker:', message);
    addBulkLog('📡 Sending request to service worker...', 'info');

    // Add timeout to prevent hanging
    const response = await Promise.race([
      safeRuntimeSendMessage(message),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Service worker response timeout (10s)')), 10000)
      )
    ]);

    console.log('[Xtension] Service worker response:', response);
    addBulkLog(`📨 Service worker response: ${JSON.stringify(response)}`, 'info');

    if (response && response.success) {
      addBulkLog('✅ Bulk reply process started successfully', 'success');
      showStatusNotification('🚀 Bulk reply process started!', 'success');
      // Start monitoring progress
      startBulkProgressMonitoring();
    } else {
      throw new Error(response?.error || 'Failed to start bulk reply process');
    }

  } catch (error) {
    console.error('[Xtension] Bulk reply error:', error);
    addBulkLog(`❌ Failed to start bulk reply: ${error.message}`, 'error');
    updateBulkUI(false);
  }
}

// Stop bulk reply process
async function stopBulkReply() {
  try {
    state.bulkReply.isRunning = false;

    const response = await safeRuntimeSendMessage({
      action: 'stopBulkReply'
    });

    if (response && response.success) {
      addBulkLog('⏹️ Bulk reply process stopped', 'warning');
      showStatusNotification('⏹️ Bulk process stopped', 'warning');
      updateBulkUI(false);
      stopBulkProgressMonitoring();
    } else {
      throw new Error(response?.error || 'Failed to stop bulk reply');
    }

  } catch (error) {
    console.error('[Xtension] Stop bulk reply error:', error);
    addBulkLog(`❌ Failed to stop bulk reply: ${error.message}`, 'error');
  }
}

// Clear bulk data
async function clearBulkData() {
  state.bulkReply.activeLinks = [];
  state.bulkReply.isRunning = false;
  await chrome.storage.local.remove(['bulkReplyActiveLinks', 'bulkProcessActive']);
  renderExtractedLinks();
  updateBulkUI(false);
  addBulkLog('🗑️ Bulk data cleared', 'info');

  // Add visual feedback for clear button
  flashClearButton(document.getElementById('clearBulkDataButton'), 'Data Cleared!');
}

// Clear bulk log
function clearBulkLog() {
  const container = document.getElementById('bulkLogContainer');
  if (container) {
    container.innerHTML = `
      <div class="rxLogEntry">
        <span class="rxLogTime">Ready</span>
        <span class="rxLogMessage">Bulk Reply ready to process tweets.</span>
      </div>
    `;
  }
}

// Add entry to bulk log
function addBulkLog(message, type = 'info') {
  const container = document.getElementById('bulkLogContainer');
  if (!container) return;

  const timestamp = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `rxLogEntry ${type}`;
  entry.innerHTML = `
    <span class="rxLogTime">${timestamp}</span>
    <span class="rxLogMessage">${message}</span>
  `;

  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;
}

// Update bulk UI state (simplified - only run/stop)
function updateBulkUI(isRunning) {
  const runBtn = document.getElementById('runBulkReplyButton');
  const stopBtn = document.getElementById('stopBulkReplyButton');
  const progressContainer = document.getElementById('bulkProgressContainer');

  if (isRunning) {
    // Process is running - show stop button, hide run button
    if (runBtn) runBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'inline-flex';
    if (progressContainer) progressContainer.style.display = 'block';
  } else {
    // Process is stopped - show run button, hide stop button
    if (runBtn) runBtn.style.display = 'inline-flex';
    if (stopBtn) stopBtn.style.display = 'none';
    if (progressContainer) progressContainer.style.display = 'none';
  }
}

// Load saved bulk data
async function loadBulkData() {
  try {
    console.log('[Xtension] Loading bulk data from storage...');
    const { bulkReplyActiveLinks } = await chrome.storage.local.get(['bulkReplyActiveLinks']);
    console.log('[Xtension] Retrieved bulkReplyActiveLinks from storage:', bulkReplyActiveLinks);

    if (bulkReplyActiveLinks && Array.isArray(bulkReplyActiveLinks)) {
      console.log('[Xtension] Updating state.bulkReply.activeLinks to:', bulkReplyActiveLinks);
      console.log('[Xtension] Previous state.bulkReply.activeLinks was:', state.bulkReply.activeLinks);

      state.bulkReply.activeLinks = bulkReplyActiveLinks;
      console.log('[Xtension] After update, state.bulkReply.activeLinks is:', state.bulkReply.activeLinks);

      renderExtractedLinks();
      console.log('[Xtension] Called renderExtractedLinks()');
    } else {
      console.log('[Xtension] No bulkReplyActiveLinks found or not an array');
    }
  } catch (error) {
    console.error('[Xtension] Failed to load bulk data:', error);
  }
}

// Progress monitoring
let bulkProgressInterval = null;

function startBulkProgressMonitoring() {
  // Clear any existing interval
  if (bulkProgressInterval) {
    clearInterval(bulkProgressInterval);
  }

  bulkProgressInterval = setInterval(async () => {
    try {
      const { bulkProcessData } = await chrome.storage.local.get(['bulkProcessData']);
      if (bulkProcessData) {
        updateBulkProgressDisplay(bulkProcessData);

        // Check if process completed
        if (bulkProcessData.isCompleted) {
          addBulkLog('🎉 Bulk reply process completed!', 'success');
          addBulkLog(`✅ Final stats: ${bulkProcessData.stats.success} success, ${bulkProcessData.stats.failed} failed`, 'info');
          updateBulkUI(false);
          stopBulkProgressMonitoring();

          // Show completion popup (original functionality)
          showBulkCompletionPopup(bulkProcessData.stats);
          clearAllBulkPopups(); // Clean up progress popups
        }
      }

      // Check if process stopped
      const { bulkProcessActive } = await chrome.storage.local.get(['bulkProcessActive']);
      if (!bulkProcessActive && bulkProgressInterval) {
        updateBulkUI(false);
        stopBulkProgressMonitoring();
      }

    } catch (error) {
      console.error('[Xtension] Progress monitoring error:', error);
    }
  }, 1000); // Update every second
}

function stopBulkProgressMonitoring() {
  if (bulkProgressInterval) {
    clearInterval(bulkProgressInterval);
    bulkProgressInterval = null;
  }
}

function updateBulkProgressDisplay(data) {
  // Update progress bar
  const progressFill = document.getElementById('bulkProgressFill');
  const progressText = document.getElementById('bulkProgressText');

  if (progressFill && progressText && data.links && data.links.length > 0) {
    const progress = Math.round((data.processedCount / data.links.length) * 100);
    progressFill.style.width = `${progress}%`;
    progressText.textContent = `${data.processedCount} / ${data.links.length}`;
  }

  // Update stats
  const successCount = document.getElementById('bulkSuccessCount');
  const failedCount = document.getElementById('bulkFailedCount');
  const skippedCount = document.getElementById('bulkSkippedCount');

  if (data.stats) {
    if (successCount) successCount.textContent = data.stats.success || 0;
    if (failedCount) failedCount.textContent = data.stats.failed || 0;
    if (skippedCount) skippedCount.textContent = data.stats.skipped || 0;
  }

  // Pause/resume functionality removed - simplified to run/stop only

  // Show progress popups for key events (original functionality)
  if (data.currentTweet && data.lastEvent) {
    showBulkProgressPopup(data.lastEvent, data.currentTweet, data.stats);
  }
}

// Progress tracking popups exactly like original
let activeBulkPopups = new Set();

async function showBulkProgressPopup(eventType, tweetUrl, stats) {
  try {
    // Get current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || (!tab.url.includes('twitter.com') && !tab.url.includes('x.com'))) {
      console.log('[Xtension] Not on Twitter/X, skipping popup');
      return;
    }

    // Get event details
    const eventConfig = getBulkEventConfig(eventType, tweetUrl, stats);

    // Inject popup into the webpage
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (popupData) => {
        // Remove existing popup with same ID if exists
        const existingId = `tx-bulk-popup-${popupData.eventType}`;
        const existing = document.getElementById(existingId);
        if (existing) existing.remove();

        // Create popup element
        const popup = document.createElement('div');
        popup.id = existingId;
        popup.className = 'tx-bulk-popup';
        popup.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: linear-gradient(135deg, rgba(10, 14, 24, 0.95), rgba(15, 20, 30, 0.92));
          border: 1px solid rgba(107, 114, 128, 0.3);
          border-radius: 12px;
          padding: 16px;
          min-width: 300px;
          max-width: 400px;
          z-index: 2147483647;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(107, 114, 128, 0.2);
          backdrop-filter: blur(8px);
          animation: slideInRight 0.3s ease-out;
          font-family: 'Inter', 'Segoe UI', sans-serif;
          color: #f8f8f8;
          font-size: 12px;
          line-height: 1.4;
        `;

        popup.innerHTML = `
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
            <span style="font-size: 16px;">${popupData.icon}</span>
            <span style="font-weight: 600; color: ${popupData.color};">${popupData.title}</span>
            <button onclick="this.parentElement.parentElement.remove()" style="
              margin-left: auto;
              background: none;
              border: none;
              color: #9ca3af;
              cursor: pointer;
              font-size: 14px;
              padding: 2px;
            ">×</button>
          </div>
          <div style="color: #d1d5db; font-size: 11px; word-break: break-all;">
            ${popupData.message}
          </div>
          ${popupData.stats ? `
            <div style="margin-top: 8px; display: flex; gap: 12px; font-size: 10px; color: #9ca3af;">
              <span>✅ ${popupData.stats.success}</span>
              <span>❌ ${popupData.stats.failed}</span>
              <span>⏭️ ${popupData.stats.skipped}</span>
            </div>
          ` : ''}
        `;

        // Add animations if not already present
        if (!document.querySelector('#tx-bulk-popup-styles')) {
          const style = document.createElement('style');
          style.id = 'tx-bulk-popup-styles';
          style.textContent = `
            @keyframes slideInRight {
              from { transform: translateX(100%); opacity: 0; }
              to { transform: translateX(0); opacity: 1; }
            }
            @keyframes slideOutRight {
              from { transform: translateX(0); opacity: 1; }
              to { transform: translateX(100%); opacity: 0; }
            }
          `;
          document.head.appendChild(style);
        }

        // Add to page
        document.body.appendChild(popup);

        // Auto-remove after delay
        setTimeout(() => {
          if (popup.parentElement) {
            popup.style.animation = 'slideOutRight 0.3s ease-in';
            setTimeout(() => {
              if (popup.parentElement) {
                popup.remove();
              }
            }, 300);
          }
        }, popupData.duration);

        return { success: true };
      },
      args: [{
        eventType: eventType,
        icon: eventConfig.icon,
        title: eventConfig.title,
        color: eventConfig.color,
        message: eventConfig.message,
        stats: eventConfig.stats,
        duration: eventConfig.duration
      }]
    });

  } catch (error) {
    console.error('[Xtension] Error showing popup:', error);
  }
}

function getBulkEventConfig(eventType, tweetUrl, stats) {
  const configs = {
    'tweet_processing': {
      icon: '⏳',
      title: 'Processing Tweet',
      message: `Working on: ${shortenUrl(tweetUrl)}`,
      color: '#60a5fa',
      duration: 4000
    },
    'reply_generated': {
      icon: '✨',
      title: 'Reply Generated',
      message: `AI reply created for: ${shortenUrl(tweetUrl)}`,
      color: '#34d399',
      duration: 5000
    },
    'reply_posted': {
      icon: '✅',
      title: 'Reply Posted Successfully',
      message: `Reply sent to: ${shortenUrl(tweetUrl)}`,
      color: '#34d399',
      duration: 6000
    },
    'tweet_liked': {
      icon: '❤️',
      title: 'Tweet Liked',
      message: `Liked: ${shortenUrl(tweetUrl)}`,
      color: '#f87171',
      duration: 4000
    },
    'tweet_skipped': {
      icon: '⏭️',
      title: 'Tweet Skipped',
      message: `Skipped: ${shortenUrl(tweetUrl)} (already replied)`,
      color: '#fbbf24',
      duration: 4000
    },
    'error_occurred': {
      icon: '❌',
      title: 'Error Processing Tweet',
      message: `Failed to process: ${shortenUrl(tweetUrl)}`,
      color: '#f87171',
      duration: 6000
    },
    'waiting_delay': {
      icon: '⏰',
      title: 'Waiting Between Replies',
      message: `Human-like delay before next tweet...`,
      color: '#a78bfa',
      duration: 3000
    },
    'process_completed': {
      icon: '🎉',
      title: 'Bulk Reply Completed!',
      message: `All ${stats?.total || 0} tweets processed successfully!`,
      color: '#34d399',
      duration: 10000,
      stats: stats
    },
    'process_paused': {
      icon: '⏸️',
      title: 'Bulk Reply Paused',
      message: `Process paused. Resume when ready.`,
      color: '#fbbf24',
      duration: 8000
    },
    'process_resumed': {
      icon: '▶️',
      title: 'Bulk Reply Resumed',
      message: `Continuing from tweet ${stats?.processed || 0}...`,
      color: '#60a5fa',
      duration: 4000
    }
  };

  return configs[eventType] || configs['tweet_processing'];
}

function shortenUrl(url) {
  if (!url) return 'Unknown tweet';
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    const statusIndex = pathParts.indexOf('status');
    if (statusIndex !== -1 && pathParts[statusIndex + 1]) {
      const tweetId = pathParts[statusIndex + 1];
      return `@${pathParts[1]}/status/${tweetId.substring(0, 8)}...`;
    }
    return urlObj.hostname;
  } catch (error) {
    return url.length > 30 ? url.substring(0, 30) + '...' : url;
  }
}

// Enhanced completion popup (show on webpage)
async function showBulkCompletionPopup(stats) {
  try {
    // Get current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || (!tab.url.includes('twitter.com') && !tab.url.includes('x.com'))) {
      console.log('[Xtension] Not on Twitter/X, skipping completion popup');
      return;
    }

    // Inject completion popup into the webpage
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (completionStats) => {
        const successRate = completionStats.total > 0 ? Math.round((completionStats.success / completionStats.total) * 100) : 0;
        const isSuccess = successRate >= 80;

        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'tx-completion-overlay';
        overlay.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.6);
          z-index: 2147483647;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: fadeIn 0.3s ease-out;
        `;

        const popup = document.createElement('div');
        popup.style.cssText = `
          background: linear-gradient(135deg, #1e293b, #0f172a);
          border: 2px solid rgba(34, 197, 94, 0.3);
          border-radius: 20px;
          padding: 32px;
          min-width: 400px;
          max-width: 500px;
          z-index: 2147483648;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 8px 24px rgba(34, 197, 94, 0.2);
          backdrop-filter: blur(12px);
          animation: completionPopup 0.5s ease-out;
          text-align: center;
          font-family: 'Inter', 'Segoe UI', sans-serif;
        `;

        popup.innerHTML = `
          <div style="font-size: 48px; margin-bottom: 16px;">
            ${isSuccess ? '🎉' : '⚠️'}
          </div>
          <h2 style="margin: 0 0 16px 0; color: ${isSuccess ? '#22c55e' : '#fbbf24'}; font-size: 24px; font-weight: 700;">
            ${isSuccess ? 'Bulk Reply Completed!' : 'Bulk Reply Finished'}
          </h2>
          <div style="color: #f8f8f8; margin-bottom: 24px; font-size: 14px; line-height: 1.5;">
            ${isSuccess
              ? `Successfully processed ${completionStats.total} tweets with ${completionStats.success} successful replies!`
              : `Processed ${completionStats.total} tweets. ${completionStats.success} successful, ${completionStats.failed} failed.`
            }
          </div>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px;">
            <div style="background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.2); border-radius: 12px; padding: 16px;">
              <div style="font-size: 24px; font-weight: 700; color: #22c55e;">${completionStats.success}</div>
              <div style="color: #9ca3af; font-size: 11px; margin-top: 4px;">Success</div>
            </div>
            <div style="background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.2); border-radius: 12px; padding: 16px;">
              <div style="font-size: 24px; font-weight: 700; color: #fbbf24;">${completionStats.skipped}</div>
              <div style="color: #9ca3af; font-size: 11px; margin-top: 4px;">Skipped</div>
            </div>
            <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 12px; padding: 16px;">
              <div style="font-size: 24px; font-weight: 700; color: #ef4444;">${completionStats.failed}</div>
              <div style="color: #9ca3af; font-size: 11px; margin-top: 4px;">Failed</div>
            </div>
          </div>
          <div style="display: flex; gap: 12px; justify-content: center;">
            <button onclick="this.closest('.tx-completion-overlay').remove()" style="
              background: linear-gradient(135deg, #22c55e, #16a34a);
              border: none;
              border-radius: 10px;
              padding: 12px 24px;
              color: white;
              font-weight: 600;
              cursor: pointer;
              font-size: 14px;
            ">Great!</button>
            <button onclick="this.closest('.tx-completion-overlay').remove()" style="
              background: rgba(107, 114, 128, 0.2);
              border: 1px solid rgba(107, 114, 128, 0.3);
              border-radius: 10px;
              padding: 12px 24px;
              color: #f8f8f8;
              font-weight: 500;
              cursor: pointer;
              font-size: 14px;
            ">Close</button>
          </div>
        `;

        // Add completion animations if not already present
        if (!document.querySelector('#tx-completion-styles')) {
          const style = document.createElement('style');
          style.id = 'tx-completion-styles';
          style.textContent = `
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes fadeOut {
              from { opacity: 1; }
              to { opacity: 0; }
            }
            @keyframes completionPopup {
              0% { transform: translate(-50%, -50%) scale(0.8); opacity: 0; }
              60% { transform: translate(-50%, -50%) scale(1.05); opacity: 1; }
              80% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
              100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
            }
          `;
          document.head.appendChild(style);
        }

        overlay.appendChild(popup);
        document.body.appendChild(overlay);

        // Auto-remove after 15 seconds
        setTimeout(() => {
          if (overlay.parentElement) {
            overlay.style.animation = 'fadeOut 0.3s ease-in';
            setTimeout(() => {
              if (overlay.parentElement) {
                overlay.remove();
              }
            }, 300);
          }
        }, 15000);

        return { success: true };
      },
      args: [stats]
    });

  } catch (error) {
    console.error('[Xtension] Error showing completion popup:', error);
  }
}

// Clear all bulk popups
function clearAllBulkPopups() {
  activeBulkPopups.forEach(popup => {
    if (popup.parentElement) {
      popup.remove();
    }
  });
  activeBulkPopups.clear();

  // Remove completion overlay if present
  const overlay = document.querySelector('.tx-completion-overlay');
  if (overlay) {
    overlay.remove();
  }
}

// Show status notification popup on main screen (improved version)
function showStatusNotification(message, type = 'info') {
  console.log('[Xtension] Showing status notification:', message, type);

  // Inject popup into the active tab (not inside extension)
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && (tabs[0].url.includes('twitter.com') || tabs[0].url.includes('x.com'))) {
      console.log('[Xtension] Found valid tab, injecting popup...');
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: (notificationMessage, notificationType) => {
          console.log('[Xtension] Inside page, creating popup:', notificationMessage);

          try {
            // Remove any existing notification
            const existing = document.getElementById('tx-status-notification');
            if (existing) {
              existing.remove();
            }

            // Create notification element with exact newextension positioning
            const notification = document.createElement('div');
            notification.id = 'tx-status-notification';
            notification.style.cssText = `
              position: fixed;
              top: 20px;
              right: 20px;
              background: ${notificationType === 'success' ? '#4CAF50' : notificationType === 'error' ? '#f44336' : notificationType === 'warning' ? '#ff9800' : '#1DA1F2'};
              color: white;
              padding: 12px 20px;
              border-radius: 8px;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              font-size: 14px;
              font-weight: 500;
              box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
              z-index: 10000;
              animation: slideIn 0.3s ease-out;
            `;

            notification.textContent = notificationMessage;
            document.body.appendChild(notification);

            // Add CSS animation
            if (!document.getElementById('tx-notification-styles')) {
              const style = document.createElement('style');
              style.id = 'tx-notification-styles';
              style.textContent = `
                @keyframes slideIn {
                  from {
                    transform: translateX(100%);
                    opacity: 0;
                  }
                  to {
                    transform: translateX(0);
                    opacity: 1;
                  }
                }
              `;
              document.head.appendChild(style);
            }

            console.log('[Xtension] Popup created successfully!');

            // Auto-remove after 3 seconds
            setTimeout(() => {
              if (document.getElementById('tx-status-notification')) {
                notification.remove();
                console.log('[Xtension] Popup removed after timeout');
              }
            }, 3000);

          } catch (error) {
            console.error('[Xtension] Error creating popup:', error);
          }
        },
        args: [message, type]
      }).then(() => {
        console.log('[Xtension] Popup injection completed');
      }).catch((error) => {
        console.error('[Xtension] Error injecting popup:', error);
      });
    } else {
      console.warn('[Xtension] No valid Twitter/X tab found for popup');
    }
  });
}

// Add CSS animation (exact newextension method)
const txNotificationStyle = document.createElement('style');
txNotificationStyle.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
`;
if (document.head) {
  document.head.appendChild(txNotificationStyle);
}

// Show Task Done popup (exact newextension method)
function showTaskDonePopup() {
  console.log('[Xtension] ✅ Task Done - Showing popup');

  // Inject Task Done popup into the active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && (tabs[0].url.includes('twitter.com') || tabs[0].url.includes('x.com'))) {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => {
          // Create or update Task Done popup
          let taskDonePopup = document.getElementById('tx-task-done-popup');
          if (!taskDonePopup) {
            taskDonePopup = document.createElement('div');
            taskDonePopup.id = 'tx-task-done-popup';
            document.body.appendChild(taskDonePopup);
          }

          taskDonePopup.textContent = '✅ TASK DONE';
          taskDonePopup.style.cssText = `
            position: fixed;
            top: 140px;
            right: 20px;
            background: linear-gradient(135deg, #00b894, #00a085);
            color: white;
            padding: 20px 30px;
            border-radius: 12px;
            z-index: 999999;
            font-family: 'Inter', sans-serif;
            font-size: 18px;
            font-weight: 700;
            box-shadow: 0 8px 25px rgba(0,184,148,0.4);
            animation: taskDonePulse 2s ease-out;
            max-width: 300px;
            text-align: center;
            border: 2px solid rgba(255,255,255,0.3);
          `;

          // Add animation styles if not already added
          if (!document.getElementById('tx-task-done-styles')) {
            const style = document.createElement('style');
            style.id = 'tx-task-done-styles';
            style.textContent = `
              @keyframes taskDonePulse {
                0% { transform: scale(0.8) translateX(100%); opacity: 0; }
                50% { transform: scale(1.1) translateX(0); opacity: 1; }
                100% { transform: scale(1) translateX(0); opacity: 1; }
              }
              @keyframes fadeOut {
                from { opacity: 1; transform: scale(1); }
                to { opacity: 0; transform: scale(0.9); }
              }
            `;
            document.head.appendChild(style);
          }

          // Auto-hide after 5 seconds
          setTimeout(() => {
            if (taskDonePopup && taskDonePopup.parentNode) {
              taskDonePopup.style.animation = 'fadeOut 0.5s ease-in forwards';
              setTimeout(() => {
                if (taskDonePopup.parentNode) {
                  taskDonePopup.parentNode.removeChild(taskDonePopup);
                }
              }, 500);
            }
          }, 5000);
        }
      });
    }
  });
}

// Force clear stuck bulk process (newextension style)
async function forceClearBulkProcess() {
  if (!confirm('⚠️ Force clear stuck process?\n\nThis will IMMEDIATELY terminate any running bulk process and reset all bulk-related data. Use this only if the process is completely stuck.\n\nContinue?')) {
    return;
  }

  try {
    addBulkLog('🔄 FORCE CLEARING stuck bulk process...', 'warning');
    console.log('🚨 [Xtension] Force clearing stuck bulk process...');

    // 🚨 IMMEDIATE CLEAR ALL BULK-RELATED STORAGE
    await chrome.storage.local.remove([
      'bulkProcessActive',
      'bulkProcessData',
      'bulkReplyActiveLinks',
      'bulkRepliedLinks',
      'bulkProcessState',
      'bulkReplyProcessing',
      'bulkProcessEmergencyStop',
      'bulkProcessCompleted'
    ]);

    // Force update UI immediately
    updateBulkUI(false);
    state.bulkReply.activeLinks = [];
    state.bulkReply.isRunning = false;
    state.bulkReply.isPaused = false;

    // Stop monitoring
    if (bulkProgressInterval) {
      clearInterval(bulkProgressInterval);
      bulkProgressInterval = null;
    }

    // Clear extracted links display
    renderExtractedLinks();

    // Send emergency stop to service worker
    try {
      safeRuntimeSendMessage({
        type: 'emergencyBulkStop',
        action: 'forceClear'
      });
    } catch (err) {
      console.log('Force clear: Service worker communication failed:', err);
    }

    addBulkLog('✅ Force clear completed - all bulk data reset', 'success');
    // Dashboard notifications should stay in dashboard, not show as popups

    // Add visual feedback for force clear button
    flashForceButton(document.getElementById('forceClearBulkButton'));

  } catch (error) {
    console.error('🚨 Force clear error:', error);
    addBulkLog(`❌ Force clear failed: ${error.message}`, 'error');
  }
}

// Save bulk settings (newextension style)
async function saveBulkSettings() {
  try {
    console.log('💾 Saving bulk settings...');

    // Get current settings from UI
    const settings = {
      minWait: parseInt(document.getElementById('bulkMinWait')?.value || 20),
      maxWait: parseInt(document.getElementById('bulkMaxWait')?.value || 35),
      likePosts: document.getElementById('bulkLikePosts')?.checked || false,
      shuffle: document.getElementById('bulkShuffle')?.checked || false
    };

    // Save to storage
    await chrome.storage.local.set({ bulkSettings: settings });

    addBulkLog('💾 Settings saved successfully', 'success');
    // Dashboard notifications should stay in dashboard, not show as popups

    console.log('✅ Bulk settings saved:', settings);

    // Add visual feedback for save button
    flashButton(document.getElementById('saveBulkSettingsButton'));

  } catch (error) {
    console.error('💾 Save settings error:', error);
    addBulkLog(`❌ Failed to save settings: ${error.message}`, 'error');
    // Dashboard notifications should stay in dashboard, not show as popups

    // Add error visual feedback for save button
    const saveBtn = document.getElementById('saveBulkSettingsButton');
    if (saveBtn) {
      const original = saveBtn.innerHTML;
      saveBtn.innerHTML = '<span class="save-icon">❌</span>Save Failed!';
      saveBtn.style.background = 'linear-gradient(135deg, #ef4444, #dc2626) !important';
      saveBtn.disabled = true;

      setTimeout(() => {
        saveBtn.innerHTML = original;
        saveBtn.style.background = '';
        saveBtn.disabled = false;
      }, 2000);
    }
  }
}

// Load saved bulk settings on initialization
async function loadBulkSettings() {
  try {
    const { bulkSettings } = await chrome.storage.local.get(['bulkSettings']);

    if (bulkSettings) {
      console.log('💾 Loading saved bulk settings:', bulkSettings);

      // Apply settings to UI
      const minWaitInput = document.getElementById('bulkMinWait');
      const maxWaitInput = document.getElementById('bulkMaxWait');
      const likePostsCheckbox = document.getElementById('bulkLikePosts');
      const shuffleCheckbox = document.getElementById('bulkShuffle');

      if (minWaitInput) minWaitInput.value = bulkSettings.minWait || 20;
      if (maxWaitInput) maxWaitInput.value = bulkSettings.maxWait || 35;
      if (likePostsCheckbox) likePostsCheckbox.checked = bulkSettings.likePosts !== false;
      if (shuffleCheckbox) shuffleCheckbox.checked = bulkSettings.shuffle || false;

      addBulkLog('💾 Settings loaded from storage', 'info');
    }
  } catch (error) {
    console.error('💾 Load settings error:', error);
    addBulkLog('⚠️ Failed to load settings from storage', 'warning');
  }
}

// Setup toggle event listeners for real-time updates
function setupBulkToggleListeners() {
  // Like posts toggle
  const likePostsToggle = document.getElementById('bulkLikePosts');
  if (likePostsToggle) {
    likePostsToggle.addEventListener('change', async (event) => {
      const isChecked = event.target.checked;
      console.log('🔧 Like posts toggle changed:', isChecked);

      // Update settings immediately
      const { bulkSettings = {} } = await chrome.storage.local.get(['bulkSettings']);
      bulkSettings.likePosts = isChecked;
      await chrome.storage.local.set({ bulkSettings });

      addBulkLog(`💾 Like posts ${isChecked ? 'enabled' : 'disabled'}`, 'info');
    });
  }

  
  // Shuffle toggle
  const shuffleToggle = document.getElementById('bulkShuffle');
  if (shuffleToggle) {
    shuffleToggle.addEventListener('change', async (event) => {
      const isChecked = event.target.checked;
      console.log('🔧 Shuffle toggle changed:', isChecked);

      // Update settings immediately
      const { bulkSettings = {} } = await chrome.storage.local.get(['bulkSettings']);
      bulkSettings.shuffle = isChecked;
      await chrome.storage.local.set({ bulkSettings });

      addBulkLog(`💾 Shuffle order ${isChecked ? 'enabled' : 'disabled'}`, 'info');
    });
  }
}

// Enhanced initialization with settings loading
async function enhancedInitBulkReply() {
  // Call original init
  initBulkReply();

  // Load saved settings
  await loadBulkSettings();

  // Setup toggle listeners
  setupBulkToggleListeners();

  // Setup storage change monitoring for persistence
  setupStorageChangeMonitoring();

  // Check for existing process on startup (persistence)
  await checkExistingProcess();
}

// Setup storage change monitoring (newextension style) - SAFE IMPLEMENTATION
function setupStorageChangeMonitoring() {
  try {
    // Remove any existing listener to prevent duplicates
    if (state.storageChangeListener) {
      chrome.storage.onChanged.removeListener(state.storageChangeListener);
    }

    // Create new listener
    state.storageChangeListener = (changes, areaName) => {
      if (areaName !== 'local') return;

      console.log('🔍 Storage changes detected:', changes);

      // Handle bulk process state changes
      if (changes.bulkProcessActive || changes.bulkProcessData) {
        console.log('🔄 Bulk process state changed, updating UI...');

        // Get current state safely
        const isActive = changes.bulkProcessActive?.newValue || false;
        const processData = changes.bulkProcessData?.newValue;

        // Update UI safely with try-catch
        try {
          if (isActive && processData) {
            // Process is active - show stop button
            updateBulkUI(true);
            console.log('✅ UI updated: Process running, showing stop button');

            // Start monitoring if not already running
            if (!bulkProgressInterval) {
              startBulkProgressMonitoring();
            }
          } else {
            // Process is stopped - show run button
            updateBulkUI(false);
            console.log('✅ UI updated: Process stopped, showing run button');

            // Stop monitoring
            if (bulkProgressInterval) {
              stopBulkProgressMonitoring();
            }
          }
        } catch (uiError) {
          console.error('UI update error:', uiError);
        }
      }

      // Handle bulk settings changes (non-critical)
      if (changes.bulkSettings) {
        console.log('💾 Bulk settings changed, updating UI...');
        try {
          loadBulkSettings(); // Reload settings to sync UI
        } catch (settingsError) {
          console.error('Settings load error:', settingsError);
        }
      }
    };

    // Add the listener
    chrome.storage.onChanged.addListener(state.storageChangeListener);
    console.log('✅ Storage change monitoring setup completed');

  } catch (error) {
    console.error('❌ Failed to setup storage change monitoring:', error);
  }
}

// Check for existing process on startup (newextension style)
async function checkExistingProcess() {
  try {
    const { bulkProcessActive, bulkProcessData } = await chrome.storage.local.get(['bulkProcessActive', 'bulkProcessData']);

    if (bulkProcessActive && bulkProcessData) {
      console.log('🔄 Found existing bulk process on startup');
      addBulkLog('🔄 Resuming bulk process detection...', 'warning');

      // Update UI to show process is running
      updateBulkUI(true);

      // Start monitoring
      startBulkProgressMonitoring();

      // Process resumption should show in dashboard, not as popup
      addBulkLog('🔄 Bulk process resumed from previous session', 'info');
    }
  } catch (error) {
    console.error('Check existing process error:', error);
  }
}

// ============================================================================
// LICENSE VALIDATION FUNCTIONS
// ============================================================================

async function shouldShowLicenseActivation() {
  try {
    // Check if user has manually chosen to see license screen
    const showLicenseScreen = localStorage.getItem('showLicenseScreen');
    if (showLicenseScreen === 'true') {
      localStorage.removeItem('showLicenseScreen'); // Clear the flag
      return true;
    }

    // Check if there's a valid license (this doesn't block anything, just checks)
    const licenseKey = localStorage.getItem('xtensionLicense');
    if (!licenseKey) {
      // No license found, but don't force license screen - let user use extension
      return false;
    }

    // Basic license format check
    const parts = licenseKey.split('-');
    if (parts.length < 4 || !parts[0].startsWith('XT')) {
      return false;
    }

    return false; // License exists, no need to show activation screen

  } catch (error) {
    console.error('[XT License] Error checking license screen:', error);
    return false; // On error, don't show license screen
  }
}

async function checkLicenseWithRealValidation() {
  try {
    // Check if there's a stored license first
    const storedLicense = localStorage.getItem('xtensionLicense');

    if (!storedLicense) {
      console.log('[XT License] No license found');
      return false;
    }

    console.log('[XT License] Found stored license, validating with RSA...');

    // Dynamically load the server-enabled license validator
    const module = await import('../core/license-validator.js');
    const { XtensionLicenseValidator } = module;

    // Use server-enabled license validation
    const validator = new XtensionLicenseValidator();

    // Initialize the validator (generates device ID)
    await validator.initialize();

    // Validate the stored license
    const isValid = await validator.validateLicense(storedLicense);
    console.log('[XT License] Stored license validation result:', isValid);

    return isValid !== false; // Return true if valid, false if invalid

  } catch (error) {
    console.error('[XT License] Real validation failed:', error);
    // If real validation fails, fall back to format check
    return checkLicenseFormat();
  }
}

async function checkLicenseFormat() {
  try {
    const storedLicense = localStorage.getItem('xtensionLicense');
    if (!storedLicense) return false;

    // Basic format check - at least verify it looks like a license
    return storedLicense.startsWith('XT-') && storedLicense.split('-').length >= 4;
  } catch (error) {
    console.error('[XT License] Format check failed:', error);
    return false;
  }
}

// ============================================================================
// LICENSE EXPIRY TIMER
// ============================================================================

let expiryTimerInterval = null;

function initLicenseExpiryTimer() {
  // Show simple expiry display
  const expirySimple = document.getElementById('expirySimple');
  if (expirySimple) {
    expirySimple.style.display = 'block';
  }

  // Start the timer
  updateLicenseExpiry();
  expiryTimerInterval = setInterval(updateLicenseExpiry, 60000); // Update every minute
}

function updateLicenseExpiry() {
  try {
    const licenseKey = localStorage.getItem('xtensionLicense');
    if (!licenseKey) {
      hideLicenseStatus();
      return;
    }

    // Parse license to get expiry info
    const licenseData = parseLicenseExpiry(licenseKey);
    if (!licenseData || !licenseData.expiryDate) {
      hideLicenseStatus();
      return;
    }

    updateExpiryDisplay(licenseData);

  } catch (error) {
    console.error('[XT License] Error updating expiry:', error);
    hideLicenseStatus();
  }
}

function parseLicenseExpiry(licenseKey) {
  try {
    if (!licenseKey) {
      console.log('[XT License] No license key provided for expiry parsing');
      return null;
    }
    console.log('[XT License] Parsing expiry from license key:', licenseKey.substring(0, 50) + '...');

    // Parse the license key to get embedded data
    const cleanLicenseKey = licenseKey.replace(/[\s\n\r]/g, '');
    const parts = cleanLicenseKey.split('-');

    console.log('[XT License] License parts:', parts.length);

    if (parts.length < 4) {
      console.warn('[XT License] Invalid license format - too few parts');
      return null;
    }

    let prefix, duration, licenseId, encodedData, signature;
    let isTrial = false;

    // Parse based on length (same logic as validator)
    if (parts.length === 6) {
      // Trial format: XT-TRIAL-1H-A1B2C3D4-[ENCODED_DATA]-[SIGNATURE]
      [prefix, trialMarker, duration, licenseId, encodedData, signature] = parts;
      if (trialMarker !== 'TRIAL') {
        throw new Error('Invalid trial license format - expected TRIAL marker');
      }
      isTrial = true;
    } else if (parts.length === 5) {
      // Regular format: XT-1M-A1B2C3D4-[ENCODED_DATA]-[SIGNATURE]
      [prefix, duration, licenseId, encodedData, signature] = parts;
    } else if (parts.length === 4) {
      // Old format: XT-1M-A1B2C3D4-SIGNATURE (no embedded data)
      [prefix, duration, licenseId, signature] = parts;
      encodedData = null;
    } else {
      console.warn('[XT License] Invalid license format - expected 4, 5, or 6 parts, got', parts.length);
      return null;
    }

    console.log('[XT License] Parsed license ID:', licenseId);

    // Try to decode embedded data first
    if (encodedData) {
      try {
        const cleanEncodedData = encodedData.replace(/[\s\n\r]/g, '');
        console.log('[XT License] Decoding embedded data...');
        const jsonString = atob(cleanEncodedData);
        const licenseData = JSON.parse(jsonString);

        console.log('[XT License] Successfully decoded license data:', licenseData);

        if (licenseData.expires) {
          const expiryDate = new Date(licenseData.expires);
          console.log('[XT License] Expiry date from embedded data:', expiryDate.toISOString());

          const type = isTrial ? 'TRIAL' : 'PREMIUM';

          return {
            expiryDate: expiryDate,
            type: type,
            isTrial: isTrial
          };
        }
      } catch (decodeError) {
        console.warn('[XT License] Failed to decode embedded data:', decodeError.message);
      }
    }

    // Fallback to stored data
    const storedData = localStorage.getItem(`license_${licenseId}`);
    if (storedData) {
      console.log('[XT License] Using stored license data as fallback');
      const data = JSON.parse(storedData);

      if (data.expires) {
        const expiryDate = new Date(data.expires);
        console.log('[XT License] Expiry date from stored data:', expiryDate.toISOString());

        const type = data.type === 'trial' ? 'TRIAL' : 'PREMIUM';

        return {
          expiryDate: expiryDate,
          type: type,
          isTrial: data.type === 'trial'
        };
      }
    }

    console.warn('[XT License] No expiry date found in license');
    return null;

  } catch (error) {
    console.error('[XT License] Error parsing licence expiry:', error);
    return null;
  }
}

function createDemoExpiry() {
  // Create a demo expiry (3 days from now for visual testing)
  const now = new Date();
  const demoExpiry = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  return {
    expiryDate: demoExpiry,
    type: 'PREMIUM',
    isTrial: false,
    isDemo: true
  };
}

function updateExpiryDisplay(licenseData) {
  const expiryTimeSimpleEl = document.getElementById('expiryTimeSimple');
  const expirySimpleEl = document.getElementById('expirySimple');

  if (!expiryTimeSimpleEl || !expirySimpleEl) return;

  const now = new Date();
  const expiry = licenseData.expiryDate;
  const timeDiff = expiry.getTime() - now.getTime();

  // Check if expired
  if (timeDiff <= 0) {
    hideLicenseStatus();
    // License expired - remove it and show activation screen
    localStorage.removeItem('xtensionLicense');
    location.reload();
    return;
  }

  // Calculate time components
  const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));

  // Format display
  let timeString = '';
  if (days > 0) {
    timeString = `${days}D ${hours}H ${minutes}M`;
  } else if (hours > 0) {
    timeString = `${hours}H ${minutes}M`;
  } else {
    timeString = `${minutes}M`;
  }

  expiryTimeSimpleEl.textContent = timeString;
}

function hideLicenseStatus() {
  const expirySimple = document.getElementById('expirySimple');
  if (expirySimple) {
    expirySimple.style.display = 'none';
  }

  if (expiryTimerInterval) {
    clearInterval(expiryTimerInterval);
    expiryTimerInterval = null;
  }
}


async function checkLicenseForPopup() {
  return await checkLicenseWithRealValidation();
}

function showLicenseActivationScreen() {
  // Show license activation screen
  document.body.innerHTML = getLicenseActivationHTML();
  bindLicenseActivationEvents();
}

function getLicenseActivationHTML() {
  return `
    <div class="tx-shell">
      <header class="tx-header">
        <div class="tx-brand">
          <div class="tx-avatar">XT</div>
          <div>
            <h1>Xtension</h1>
            <p>Your Best X/Discord Companion</p>
          </div>
        </div>
        <div class="tx-provider-summary">
          <span id="providerLabel">License Required</span>
          <span id="modelLabel">🔑 Activate to Unlock</span>
        </div>
      </header>

      <main class="tx-panels">
        <section class="tx-panel active" style="padding: 24px;">
          <div class="tx-card">
            <div class="tx-card-header">
              <h2>🔑 License Activation Required</h2>
              <p>Enter your license key to unlock all Xtension features and start using AI-powered translations and replies.</p>
            </div>

            <div class="tx-form">
              <label class="tx-field">
                <span class="tx-label">License Key</span>
                <input type="text"
                       id="licenseInput"
                       placeholder="XT-1M-A1B2C3D4-E5F6G7H8 or XT-TRIAL-1H-A1B2C3D4-E5F6G7H8"
                       autocomplete="off"
                       spellcheck="false">
              </label>

              <button id="activateBtn" class="tx-primary-btn">
                🔑 Activate License
              </button>

              <div id="licenseMessage" class="tx-message" style="display: none;"></div>
            </div>
          </div>

          <div class="tx-card">
            <div class="tx-card-header">
              <h3>Don't have a license?</h3>
              <p>Get your premium license and unlock all features:</p>
            </div>

            <div class="tx-contact-options">
              <div class="tx-contact-item">
                <span class="tx-icon">💬</span>
                <div>
                  <strong>Support and Subscription</strong>
                  <a href="https://t.me/itscryptools" target="_blank">t.me/itscryptools</a>
                </div>
              </div>

              <div class="tx-contact-item">
                <span class="tx-icon">🤖</span>
                <div>
                  <strong>Subscription Bot</strong>
                  <a href="https://t.me/Xtension_Subscription_bot" target="_blank">t.me/Xtension_Subscription_bot</a>
                  <small style="color: #888; font-size: 11px;">(If bot is not available, contact <a href="https://t.me/itscryptools" target="_blank" style="color: #1DD3F8;">support</a>)</small>
                </div>
              </div>

              <div class="tx-contact-item">
                <span class="tx-icon">📧</span>
                <div>
                  <strong>Email</strong>
                  <a href="mailto:cryptonparody@gmail.com" target="_blank">cryptonparody@gmail.com</a>
                </div>
              </div>
            </div>

            <div class="tx-plans">
              <h4>Available Plans: Click To Purchase</h4>
              <a href="https://t.me/itscryptools" target="_blank" class="tx-plan-link">
                <div class="tx-plan">
                  <span class="tx-plan-name">1 Month</span>
                  <span class="tx-plan-price">$50</span>
                </div>
              </a>
              <a href="https://t.me/itscryptools" target="_blank" class="tx-plan-link">
                <div class="tx-plan">
                  <span class="tx-plan-name">3 Months</span>
                  <span class="tx-plan-price">$120</span>
                </div>
              </a>
            </div>

            <div class="tx-info-box">
              <strong>🧪 Want to try first?</strong>
              <p>Contact support for a 1-hour trial license to test all features before purchasing!</p>
              <p><a href="https://t.me/itscryptools" target="_blank" style="color: #1DD3F8;">t.me/itscryptools</a></p>
            </div>
          </div>
        </section>
      </main>
    </div>

    <style>
      ${getLicensePopupCSS()}
    </style>
  `;
}

function getLicensePopupCSS() {
  return `
    .tx-message {
      margin-top: var(--tx-space-4);
      padding: var(--tx-space-3) var(--tx-space-4);
      border-radius: var(--tx-radius-md);
      text-align: center;
      font-size: var(--tx-font-sm);
      font-weight: 500;
      display: none;
      animation: slideIn 0.3s ease;
    }

    .tx-message.error {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #f87171;
    }

    .tx-message.success {
      background: rgba(34, 197, 94, 0.1);
      border: 1px solid rgba(34, 197, 94, 0.3);
      color: #22c55e;
    }

    .tx-contact-options {
      margin: var(--tx-space-5) 0;
    }

    .tx-contact-item {
      display: flex;
      align-items: center;
      gap: var(--tx-space-3);
      padding: var(--tx-space-4);
      background: rgba(255, 255, 255, 0.03);
      border-radius: var(--tx-radius-md);
      margin-bottom: var(--tx-space-3);
      transition: all 0.2s ease;
      border: 1px solid transparent;
    }

    .tx-contact-item:hover {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(255, 255, 255, 0.1);
    }

    .tx-icon {
      font-size: 20px;
      flex-shrink: 0;
    }

    .tx-contact-item strong {
      display: block;
      color: var(--tx-text-primary);
      font-size: var(--tx-font-sm);
      font-weight: 600;
      line-height: 1.2;
    }

    .tx-contact-item span {
      color: #1DD3F8;
      font-size: var(--tx-font-xs);
      font-weight: 500;
    }

    .tx-plans {
      margin-top: var(--tx-space-6);
      padding-top: var(--tx-space-6);
      border-top: 1px solid var(--tx-panel-border);
    }

    .tx-plans h4 {
      margin-bottom: var(--tx-space-4);
      color: var(--tx-text-primary);
      font-size: var(--tx-font-md);
      font-weight: 600;
    }

    .tx-plan {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--tx-space-3) var(--tx-space-4);
      background: rgba(255, 255, 255, 0.02);
      border-radius: var(--tx-radius-md);
      margin-bottom: var(--tx-space-2);
      position: relative;
      border: 1px solid transparent;
      transition: all 0.2s ease;
    }

    .tx-plan:hover {
      background: rgba(255, 255, 255, 0.04);
      border-color: rgba(255, 255, 255, 0.1);
    }

    .tx-plan-link {
      text-decoration: none;
      color: inherit;
      display: block;
    }

    .tx-plan-link:hover .tx-plan {
      background: rgba(255, 255, 255, 0.04);
      border-color: rgba(255, 255, 255, 0.1);
      transform: translateY(-1px);
    }

    .tx-plan.featured {
      border: 1px solid #1DD3F8;
      background: rgba(29, 211, 248, 0.08);
    }

    .tx-plan.featured:hover {
      background: rgba(29, 211, 248, 0.12);
    }

    .tx-plan-name {
      color: var(--tx-text-primary);
      font-weight: 500;
      font-size: var(--tx-font-sm);
    }

    .tx-plan-price {
      color: #1DD3F8;
      font-weight: 600;
      font-size: var(--tx-font-sm);
    }

    .tx-popular-badge {
      position: absolute;
      top: -8px;
      right: var(--tx-space-2);
      background: #1DD3F8;
      color: #000;
      padding: 2px var(--tx-space-2);
      border-radius: var(--tx-radius-lg);
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .tx-info-box {
      margin-top: var(--tx-space-6);
      padding: var(--tx-space-4);
      background: rgba(29, 211, 248, 0.05);
      border: 1px solid rgba(29, 211, 248, 0.2);
      border-radius: var(--tx-radius-md);
    }

    .tx-info-box strong {
      color: #1DD3F8;
      font-size: var(--tx-font-sm);
      font-weight: 600;
    }

    .tx-info-box p {
      margin: var(--tx-space-1) 0 0 0;
      color: var(--tx-text-muted);
      font-size: var(--tx-font-xs);
      line-height: 1.4;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .xtension-license-popup {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%);
      color: #ffffff;
      height: 600px;
      width: 400px;
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      overflow: hidden;
    }

    .license-popup-header {
      text-align: center;
      padding: 30px 20px 20px;
    }

    .xt-logo {
      width: 50px;
      height: 50px;
      background: linear-gradient(135deg, #1DD3F8, #0099CC);
      border-radius: 15px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      font-weight: bold;
      margin: 0 auto 15px;
    }

    .license-popup-header h1 {
      margin: 0 0 5px 0;
      font-size: 20px;
      font-weight: 700;
    }

    .license-popup-header p {
      margin: 0;
      color: #999;
      font-size: 14px;
    }

    .license-popup-card {
      flex: 1;
      padding: 0 25px 25px;
      overflow-y: auto;
    }

    .license-status {
      text-align: center;
      margin-bottom: 25px;
    }

    .status-icon {
      font-size: 36px;
      margin-bottom: 10px;
    }

    .license-status h2 {
      margin: 0 0 8px 0;
      font-size: 16px;
      font-weight: 600;
    }

    .license-status p {
      margin: 0;
      font-size: 13px;
      color: #ccc;
    }

    .license-form input {
      width: 100%;
      padding: 12px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.05);
      color: #ffffff;
      font-size: 14px;
      font-family: 'Courier New', monospace;
      margin-bottom: 15px;
      box-sizing: border-box;
    }

    .license-form input:focus {
      outline: none;
      border-color: #1DD3F8;
      background: rgba(255, 255, 255, 0.08);
    }

    .license-form input::placeholder {
      color: #666;
    }

    .license-form button {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #1DD3F8, #0099CC);
      border: none;
      border-radius: 8px;
      color: #ffffff;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
    }

    .license-form button:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 5px 15px rgba(29, 211, 248, 0.3);
    }

    .license-form button:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }

    .license-message {
      margin-top: 10px;
      padding: 8px;
      border-radius: 6px;
      text-align: center;
      font-size: 12px;
      display: none;
    }

    .license-message.error {
      background: rgba(255, 107, 107, 0.1);
      border: 1px solid rgba(255, 107, 107, 0.3);
      color: #ff6b6b;
    }

    .license-message.success {
      background: rgba(76, 175, 80, 0.1);
      border: 1px solid rgba(76, 175, 80, 0.3);
      color: #4caf50;
    }

    .license-help {
      text-align: center;
      font-size: 12px;
      color: #ccc;
    }

    .license-help h3 {
      margin-top: 0;
      margin-bottom: 15px;
      color: #fff;
      font-size: 14px;
    }

    .contact-info {
      margin: 15px 0;
    }

    .contact-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 6px;
      margin-bottom: 8px;
    }

    .contact-item .icon {
      font-size: 16px;
    }

    .contact-item strong {
      display: block;
      color: #fff;
      font-size: 12px;
    }

    .contact-item span {
      color: #1DD3F8;
      font-size: 11px;
    }

    .license-plans {
      margin-top: 20px;
    }

    .license-plans h4 {
      margin-bottom: 10px;
      color: #fff;
      font-size: 13px;
    }

    .plan {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 10px;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 6px;
      margin-bottom: 6px;
      position: relative;
    }

    .plan.featured {
      border: 1px solid #1DD3F8;
      background: rgba(29, 211, 248, 0.05);
    }

    .plan-name {
      color: #fff;
      font-weight: 500;
      font-size: 12px;
    }

    .plan-price {
      color: #1DD3F8;
      font-weight: 600;
      font-size: 12px;
    }

    .popular-badge {
      position: absolute;
      top: -6px;
      right: 8px;
      background: #1DD3F8;
      color: #000;
      padding: 1px 6px;
      border-radius: 8px;
      font-size: 9px;
      font-weight: bold;
    }
  `;
}

function bindLicenseActivationEvents() {
  const input = document.getElementById('licenseInput');
  const activateBtn = document.getElementById('activateBtn');

  if (input && activateBtn) {
    // Enter key support
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        activateLicenseInPopup();
      }
    });

    // Button click
    activateBtn.addEventListener('click', activateLicenseInPopup);
  }
}

async function activateLicenseInPopup() {
  const input = document.getElementById('licenseInput');
  const activateBtn = document.getElementById('activateBtn');

  // Check if elements exist
  if (!input || !activateBtn) {
    console.error('[XT License] License input or button not found in DOM');
    showLicenseMessage('License activation interface not loaded. Please refresh the extension.', 'error');
    return;
  }

  if (!input.value || !input.value.trim()) {
    showLicenseMessage('Please enter a license key', 'error');
    return;
  }

  // Show loading state
  const originalText = activateBtn.textContent;
  activateBtn.textContent = '🔄 Validating...';
  activateBtn.disabled = true;

  try {
    const licenseKey = input.value.trim();
    console.log('[XT License] Attempting to activate license:', licenseKey.substring(0, 50) + '...');

    // Use dynamic loading for server-enabled license validation
    let validator;

    try {
      console.log('[XT License] Importing XtensionLicenseValidator...');
      const module = await import('../core/license-validator.js');
      const { XtensionLicenseValidator } = module;
      console.log('[XT License] Successfully imported XtensionLicenseValidator');

      console.log('[XT License] Creating validator instance...');
      validator = new XtensionLicenseValidator();
      console.log('[XT License] Validator instance created successfully');
    } catch (constructorError) {
      console.error('[XT License] Constructor failed:', constructorError);
      throw new Error('Failed to create license validator: ' + constructorError.message);
    }

    console.log('[XT License] Calling activateLicense...');
    const isValid = await validator.activateLicense(licenseKey);
    console.log('[XT License] activateLicense result:', isValid);

    if (isValid) {
      console.log('[XT License] License activation successful!');
      showLicenseMessage('License activated successfully!', 'success');
      activateBtn.textContent = '✅ Activated!';

      // Store validation timestamp for offline access
      localStorage.setItem('xtensionLastValidation', Date.now().toString());
      console.log('[XT License] Validation timestamp stored');

      // Load main interface after 2 seconds
      setTimeout(() => {
        console.log('[XT License] Loading main interface...');
        // Store that license was activated and reload the page
        localStorage.setItem('licenseActivated', 'true');
        location.reload();
      }, 2000);

    } else {
      console.log('[XT License] activateLicense returned false');
      throw new Error('Invalid or expired license key - validator returned false');
    }

  } catch (error) {
    console.error('[XT License] Activation error:', error);
    console.error('[XT License] Full error stack:', error.stack);

    let errorMessage = error.message;

    // Provide user-friendly error messages for internet-required validation
    if (error.message.includes('Internet connection required')) {
      errorMessage = '🌐 Internet connection required for license activation. Please connect to the internet and try again.';
    } else if (error.message.includes('License already used on maximum devices')) {
      errorMessage = '🚫 This license is already activated on another device. Each license can only be used on 1 device.';
    } else if (error.message.includes('License not found')) {
      errorMessage = '❌ Invalid license key. Please check your license and try again.';
    } else if (error.message.includes('License expired')) {
      errorMessage = '⏰ This license has expired. Please contact support for renewal.';
    } else if (error.message.includes('timeout') || error.message.includes('Timeout')) {
      errorMessage = '⏱️ Connection timeout. Please check your internet connection and try again.';
    } else if (error.message.includes('Failed to fetch') || error.message.includes('No internet connection')) {
      errorMessage = '📶 No internet connection. License activation requires internet access.';
    } else if (error.message.includes('Failed to load license validator')) {
      errorMessage = 'License validator could not be loaded. Please restart the extension.';
    } else if (error.message.includes('Invalid license format')) {
      errorMessage = 'Invalid license format. Please check your license key.';
    } else if (error.message.includes('Invalid license signature')) {
      errorMessage = '❌ Invalid license signature. This may be a fake license.';
    } else if (error.message.includes('server')) {
      errorMessage = '🔴 Server connection failed. Please try again in a few minutes.';
    }

    showLicenseMessage(errorMessage, 'error');
    activateBtn.textContent = '❌ Try Again';

    setTimeout(() => {
      activateBtn.textContent = originalText;
      activateBtn.disabled = false;
    }, 3000);
  }
}

function showLicenseMessage(message, type = 'info') {
  const messageEl = document.getElementById('licenseMessage');
  if (messageEl) {
    messageEl.textContent = message;
    messageEl.className = `tx-message ${type}`;
    messageEl.style.display = 'block';

    setTimeout(() => {
      messageEl.style.display = 'none';
    }, 4000);
  }
}

