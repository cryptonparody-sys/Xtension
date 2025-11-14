import { XtensionConfig } from '../core/options.js';

const CONFIG_PROMISE = Promise.resolve(XtensionConfig);

const STORAGE_KEY = 'txSettings';
const DEFAULT_MAX_TOKENS = 400;
const clone = (value) => (typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)));

let keepAliveInterval = null;
let cachedConfig = null;

async function loadConfig() {
  if (!cachedConfig) {
    cachedConfig = await CONFIG_PROMISE;
  }
  return cachedConfig;
}

chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    const config = await loadConfig();
    const { rawSettings } = await readSettings();
    const merged = mergeSettings(config, rawSettings);
    await chrome.storage.local.set({ [STORAGE_KEY]: merged });

    if (details.reason === 'install') {
      startKeepAlive();
      await chrome.tabs.create({
        url: chrome.runtime.getURL('about/index.html'),
        active: true
      });
    }
  } catch (error) {
    console.error('[Xtension] onInstalled error', error);
  }
});

chrome.runtime.onStartup.addListener(() => startKeepAlive());
chrome.runtime.onSuspend.addListener(() => stopKeepAlive());

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  const action = request.action || request.type;

  switch (action) {
    case 'getTxConfig':
      loadConfig()
        .then((config) => sendResponse({ success: true, config, settingsKey: STORAGE_KEY }))
        .catch((error) => sendResponse({ success: false, error: error?.message || 'Config unavailable' }));
      return true;
    case 'translateTweet':
      translateTweet(request)
        .then((translation) => sendResponse({ success: true, translation }))
        .catch((error) => sendResponse({ success: false, error: error?.message || 'Translation failed' }));
      return true;
    case 'translateDiscordMessage':
      translateDiscordMessage(request)
        .then((translation) => sendResponse({ success: true, translation }))
        .catch((error) => sendResponse({ success: false, error: error?.message || 'Translation failed' }));
      return true;
    case 'generateReply':
      generateReply(request)
        .then((reply) => sendResponse({ success: true, reply }))
        .catch((error) => sendResponse({ success: false, error: error?.message || 'Reply failed' }));
      return true;
    case 'generateDiscordReply':
      generateDiscordReply(request)
        .then((reply) => sendResponse({ success: true, reply }))
        .catch((error) => sendResponse({ success: false, error: error?.message || 'Reply failed' }));
      return true;
    case 'translateReplyDraft':
      translateReplyDraft(request)
        .then((translation) => sendResponse({ success: true, translation }))
        .catch((error) => sendResponse({ success: false, error: error?.message || 'Translation failed' }));
      return true;
    default:
      return false;
  }
});

async function translateTweet({ tweetContent, targetLanguage, toneId }) {
  const config = await loadConfig();
  const { rawSettings } = await readSettings();
  const settings = mergeSettings(config, rawSettings);

  const providerId = settings.provider;
  const providerSettings = settings.providerSettings[providerId] || {};
  const apiKey = (providerSettings.apiKey || '').trim();
  if (!providerId || !apiKey) {
    throw new Error('No provider credentials configured.');
  }

  const selectedToneId = toneId || settings.tonePreset || 'simple';
  const tone = config.tonePresets.find((preset) => preset.id === selectedToneId) || config.tonePresets[0];
  const languageCode = targetLanguage || settings.targetLanguage;
  const languageLabel = resolveLanguageLabel(config, languageCode, 'the selected language');

  const prompt = [
    `You are Xtension, an expert translator specializing in nuanced tone-based translation.`,
    `${tone.prompt}`,
    `TASK: Translate the following tweet into ${languageLabel}. If the tweet is already in ${languageLabel}, rewrite it to match the requested tone style exactly.`,
    `CRITICAL REQUIREMENTS: Write entirely in ${languageLabel} using fluent, natural language. Never switch languages or include transliterations.`,
    `TRANSLATION STYLE: Translate using colloquial and non-formal language. The output should sound natural and conversational, like how people actually talk, not formal or academic writing.`,
    `Return ONLY the final translation text with no labels, headings, notes, commentary, or explanations.`,
    tweetContent?.author ? `Original tweet author: ${tweetContent.author}` : '',
    `Tweet content to translate:\n"""${tweetContent?.text || ''}"""`
  ]
    .filter(Boolean)
    .join('\n\n');

  await wait(Math.floor(120 + Math.random() * 220));

  const translation = await dispatchToProvider({
    providerId,
    providerSettings,
    prompt,
    config
  });

  return sanitizeOutput(translation);
}

async function translateDiscordMessage({ messageContent, targetLanguage, toneId }) {
  const config = await loadConfig();
  const { rawSettings } = await readSettings();
  const settings = mergeSettings(config, rawSettings);

  const providerId = settings.provider;
  const providerSettings = settings.providerSettings[providerId] || {};
  const apiKey = (providerSettings.apiKey || '').trim();
  if (!providerId || !apiKey) {
    throw new Error('No provider credentials configured.');
  }

  const tone = config.tonePresets.find((preset) => preset.id === (toneId || settings.tonePreset)) || config.tonePresets[0];
  const languageCode = targetLanguage || settings.targetLanguage;
  const languageLabel = resolveLanguageLabel(config, languageCode, 'the selected language');

  const prompt = [
    `You are Xtension, an expert translator specializing in nuanced tone-based translation for Discord conversations.`,
    `${tone.prompt}`,
    `TASK: Translate the following Discord message into ${languageLabel}. Maintain conversational flow appropriate for Discord.`,
    `CRITICAL REQUIREMENTS: Write entirely in ${languageLabel} using fluent, natural language. Never switch languages or include transliterations.`,
    `TRANSLATION STYLE: Translate using colloquial and non-formal language. The output should sound natural and conversational, like how people actually talk, not formal or academic writing.`,
    `Use a smooth, conversational voice that feels natural in real chat threads. Keep terminology accurate but explain tricky ideas plainly.`,
    `Return ONLY the final translation text with no labels, headings, notes, emojis, markdown fences, or commentary.`,
    messageContent?.language ? `Original message language: ${messageContent.language}` : '',
    messageContent?.author ? `Original message author: ${messageContent.author}` : '',
    `Message content to translate:\n"""${messageContent?.text || ''}"""`
  ]
    .filter(Boolean)
    .join('\n\n');

  await wait(Math.floor(120 + Math.random() * 220));

  const translation = await dispatchToProvider({
    providerId,
    providerSettings,
    prompt,
    config
  });

  return sanitizeOutput(translation);
}

async function translateReplyDraft({ text, targetLanguage, sourceLanguage, context }) {
  const config = await loadConfig();
  const { rawSettings } = await readSettings();
  const settings = mergeSettings(config, rawSettings);

  const providerId = settings.provider;
  const providerSettings = settings.providerSettings[providerId] || {};
  const apiKey = (providerSettings.apiKey || '').trim();
  if (!providerId || !apiKey) {
    throw new Error('No provider credentials configured.');
  }

  const trimmed = (text || '').trim();
  if (!trimmed) {
    throw new Error('Write a reply first.');
  }

  const desiredLanguageCode = (targetLanguage || '').trim().toLowerCase() || settings.targetLanguage || 'en';
  const languageLabel = resolveLanguageLabel(config, desiredLanguageCode, 'the requested language');
  const sourceHint = (sourceLanguage || '').trim();

  const prompt = [
    `You are Xtension, a conversational translator preparing ${context === 'discord' ? 'Discord' : 'Twitter'} replies.`,
    `TASK: Translate the draft reply below into ${languageLabel} (${desiredLanguageCode}). Keep the exact same meaning and intent.`,
    sourceHint ? `Source language hint: The author likely wrote this in ${resolveLanguageLabel(config, sourceHint, sourceHint)}.` : '',
    'CRITICAL STYLE: Make the voice casual, fluid, and natural—completely avoid stiff, formal, academic, or bookish phrasing.',
    'Do not add ideas, emojis, hashtags, or commentary that don\'t exist in the original draft.',
    'Avoid using hyphens, underscores, or decorative separators between words.',
    'Return ONLY the translated reply text with no labels, explanations, or surrounding quotes.',
    `Original draft to translate:\n"""${trimmed}"""`
  ]
    .filter(Boolean)
    .join('\n\n');

  await wait(Math.floor(120 + Math.random() * 220));

  const translation = await dispatchToProvider({
    providerId,
    providerSettings,
    prompt,
    config
  });

  return sanitizeOutput(translation);
}

async function generateReply({ tweetContent }) {
  const config = await loadConfig();
  const { rawSettings } = await readSettings();
  const settings = mergeSettings(config, rawSettings);

  const providerId = settings.provider;
  const providerSettings = settings.providerSettings[providerId] || {};
  const apiKey = (providerSettings.apiKey || '').trim();
  if (!providerId || !apiKey) {
    throw new Error('No provider credentials configured.');
  }

  const customPrompt = (settings.reply?.prompt || '').trim();
  if (!customPrompt) {
    throw new Error('Please first specify the prompt in the settings.');
  }

  const replyContext = (settings.reply?.context || '').trim();
  const avoidList = (settings.reply?.avoid || '').trim();
  const minWords = Number.isFinite(settings.reply?.minWords) ? Math.max(0, settings.reply.minWords) : 0;
  const maxWords = Number.isFinite(settings.reply?.maxWords) ? Math.max(0, settings.reply.maxWords) : 0;

  const prompt = [
    'You are Xtension, a personalized reply assistant with expert language detection skills.',
    'CRITICAL LANGUAGE DETECTION: Analyze the tweet content carefully to determine the primary language. Write your reply ENTIRELY in that same language.',
    'If the tweet contains multiple languages, identify the dominant language and use it consistently for your entire reply.',
    'Language detection rules: Look at the main tweet text, not hashtags or mentions. Trust the actual content language over user profile language.',
    replyContext ? `Project or topic context to respect:
${replyContext}` : '',
    'Follow the custom instructions exactly:',
    customPrompt,
    avoidList ? `STRICTLY AVOID these words, phrases, or behaviors: ${avoidList}` : '',
    maxWords && minWords
      ? `Reply length: Write between ${minWords} and ${maxWords} words. Keep it complete, natural, and meaningful without exceeding ${maxWords} words.`
      : maxWords
        ? `Reply length: Keep under ${maxWords} words. Summarize and rephrase to stay complete and meaningful while respecting the limit.`
        : minWords
          ? `Reply length: Use at least ${minWords} words while keeping the reply natural and meaningful.`
          : '',
    tweetContent?.author ? `Tweet by: ${tweetContent.author}` : '',
    tweetContent?.authorDisplay ? `Display name: ${tweetContent.authorDisplay}` : '',
    `Tweet to analyze and reply to:\n"""${tweetContent?.text || ''}"""`,
    'IMPORTANT: Write your reply in the same language as the tweet. Return only the reply text, no explanations.'
  ]
    .filter(Boolean)
    .join('\n\n');

  await wait(Math.floor(120 + Math.random() * 220));

  const reply = await dispatchToProvider({
    providerId,
    providerSettings,
    prompt,
    config
  });

  return sanitizeOutput(reply);
}

async function generateDiscordReply({ messageContent }) {
  const config = await loadConfig();
  const { rawSettings } = await readSettings();
  const settings = mergeSettings(config, rawSettings);

  const discordSettings = settings.discordReply || {};
  const customPrompt = (discordSettings.prompt || '').trim();
  if (!customPrompt) {
    throw new Error('Please first specify the prompt in the settings.');
  }

  const avoidList = (discordSettings.avoid || '').trim();
  const minWordsDiscord = Number.isFinite(discordSettings.minWords) ? Math.max(0, discordSettings.minWords) : 0;
  const maxWordsDiscord = Number.isFinite(discordSettings.maxWords) ? Math.max(0, discordSettings.maxWords) : 0;
  const providerId = settings.provider;
  const providerSettings = settings.providerSettings[providerId] || {};
  const apiKey = (providerSettings.apiKey || '').trim();
  if (!providerId || !apiKey) {
    throw new Error('No provider credentials configured.');
  }

  const context = typeof discordSettings.context === 'string' ? discordSettings.context.trim() : '';

  const prompt = [
    'You are RD, a collaborative Discord co-pilot with expert language detection skills.',
    'CRITICAL LANGUAGE DETECTION: Analyze the Discord message content carefully to determine the primary language. Write your reply ENTIRELY in that same language.',
    'If the message mixes languages, identify the dominant language and use it consistently. Never switch languages unless explicitly asked.',
    'Language detection rules: Focus on the main message text, not hashtags or code snippets. Trust the actual content language.',
    'Keep phrasing conversational and fluent—avoid stiff, academic, or overly formal language.',
    'Respond directly to the author with helpful guidance, don\'t just restate the original message.',
    context ? `Background context to respect:\n${context}` : '',
    'Custom reply guidance (follow these instructions exactly):',
    customPrompt,
    avoidList ? `STRICTLY AVOID these words, phrases, or behaviors: ${avoidList}` : '',
    maxWordsDiscord && minWordsDiscord
      ? `Reply length: Write between ${minWordsDiscord} and ${maxWordsDiscord} words. Keep it complete, natural, and meaningful.`
      : maxWordsDiscord
        ? `Reply length: Keep under ${maxWordsDiscord} words. Stay complete and meaningful while respecting the limit.`
        : minWordsDiscord
          ? `Reply length: Use at least ${minWordsDiscord} words while keeping the reply natural and meaningful.`
          : '',
    messageContent?.author ? `Message from: ${messageContent.author}` : '',
    `Discord message to analyze and reply to:\n"""${messageContent?.text || ''}"""`,
    'IMPORTANT: Write your reply in the same language as the message. Return only the reply text.'
  ]
    .filter(Boolean)
    .join('\n\n');

  await wait(Math.floor(120 + Math.random() * 220));

  const reply = await dispatchToProvider({
    providerId,
    providerSettings,
    prompt,
    config
  });

  return sanitizeOutput(reply);
}

async function dispatchToProvider({ providerId, providerSettings, prompt, config }) {
  const catalog = config.providerCatalog;
  switch (providerId) {
    case 'openai':
      return callOpenAI({ providerSettings, prompt, catalog });
    case 'anthropic':
      return callAnthropic({ providerSettings, prompt, catalog });
    case 'gemini':
      return callGemini({ providerSettings, prompt, catalog });
    case 'deepseek':
      return callDeepSeek({ providerSettings, prompt, catalog });
    case 'openrouter':
      return callOpenRouter({ providerSettings, prompt, catalog });
    case 'groq':
      return callGroq({ providerSettings, prompt, catalog });
    case 'zai':
      return callZai({ providerSettings, prompt, catalog });
    default:
      throw new Error('Unsupported provider configured.');
  }
}

async function callOpenAI({ providerSettings, prompt, catalog }) {
  const entry = catalog.openai;
  const model = providerSettings.model || entry.defaultModel;
  const modelInfo = entry.models[model] || {};

  // Dynamic base URL based on model's endpoint or default provider endpoint
  const baseUrl = (providerSettings.baseUrl || modelInfo.endpoint || entry.endpoint).replace(/\/$/, '');
  const response = await executeJson(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${providerSettings.apiKey}`
    },
    body: JSON.stringify({
      model: providerSettings.model || entry.defaultModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: sanitizeNumber(providerSettings.temperature, 0.2),
      max_tokens: providerSettings.maxTokens || DEFAULT_MAX_TOKENS
    })
  });
  const content = response?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned an empty response.');
  return content;
}

async function callAnthropic({ providerSettings, prompt, catalog }) {
  const entry = catalog.anthropic;
  const model = providerSettings.model || entry.defaultModel;
  const modelInfo = entry.models[model] || {};

  // Dynamic base URL based on model's endpoint or default provider endpoint
  const baseUrl = (providerSettings.baseUrl || modelInfo.endpoint || entry.endpoint).replace(/\/$/, '');
  const response = await executeJson(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': providerSettings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: providerSettings.model || entry.defaultModel,
      max_tokens: providerSettings.maxTokens || DEFAULT_MAX_TOKENS,
      temperature: sanitizeNumber(providerSettings.temperature, 0.2),
      system: 'You are Xtension, a precise translation assistant.',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const content = response?.content?.[0]?.text;
  if (!content) throw new Error('Claude returned an empty response.');
  return content;
}

async function callGemini({ providerSettings, prompt, catalog }) {
  const entry = catalog.gemini;
  const model = providerSettings.model || entry.defaultModel;
  const modelInfo = entry.models[model] || {};

  // Gemini uses complete endpoint URL from model configuration
  const baseUrl = (providerSettings.baseUrl || modelInfo.endpoint || entry.endpoint).replace(/\/$/, '');
  const endpoint = modelInfo.endpoint ? baseUrl : `${baseUrl}/models/${model}:generateContent`;

  try {
    const response = await executeJson(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': providerSettings.apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: sanitizeNumber(providerSettings.temperature, 0.2),
          maxOutputTokens: providerSettings.maxOutputTokens || providerSettings.maxTokens || DEFAULT_MAX_TOKENS,
          candidateCount: 1
        },
        safetySettings: [
          {
            "category": "HARM_CATEGORY_HARASSMENT",
            "threshold": "BLOCK_NONE"
          },
          {
            "category": "HARM_CATEGORY_HATE_SPEECH",
            "threshold": "BLOCK_NONE"
          },
          {
            "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            "threshold": "BLOCK_NONE"
          },
          {
            "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
            "threshold": "BLOCK_NONE"
          }
        ]
      })
    });

    const content = response?.candidates?.[0]?.content?.parts?.map((part) => part.text).join('');
    if (!content) {
      // If response is blocked, try with a simpler prompt
      const fallbackResponse = await executeJson(`${baseUrl}/models/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': providerSettings.apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Translate this text: ${prompt}` }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 100,
            candidateCount: 1
          }
        })
      });

      const fallbackContent = fallbackResponse?.candidates?.[0]?.content?.parts?.map((part) => part.text).join('');
      if (!fallbackContent) {
        throw new Error('Gemini content was blocked or returned empty response.');
      }
      return fallbackContent;
    }
    return content;
  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('404')) {
      // Try alternative API version if model not found
      const altVersion = apiVersion === 'v1beta' ? 'v1' : 'v1beta';
      const altBaseUrl = `https://generativelanguage.googleapis.com/${altVersion}`;

      try {
        const altResponse = await executeJson(`${altBaseUrl}/models/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': providerSettings.apiKey
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: sanitizeNumber(providerSettings.temperature, 0.2),
              maxOutputTokens: providerSettings.maxOutputTokens || providerSettings.maxTokens || DEFAULT_MAX_TOKENS
            }
          })
        });

        const altContent = altResponse?.candidates?.[0]?.content?.parts?.map((part) => part.text).join('');
        if (altContent) {
          return altContent;
        }
      } catch (altError) {
        // Alternative API version also failed
      }

      throw new Error(`Gemini model "${model}" not found in ${apiVersion} or ${altVersion}. Please check the model name and API version.`);
    }
    throw error;
  }
}

async function callDeepSeek({ providerSettings, prompt, catalog }) {
  const entry = catalog.deepseek;
  const model = providerSettings.model || entry.defaultModel;
  const modelInfo = entry.models[model] || {};

  // Dynamic base URL based on model's endpoint or default provider endpoint
  const baseUrl = (providerSettings.baseUrl || modelInfo.endpoint || entry.endpoint).replace(/\/$/, '');
  const response = await executeJson(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${providerSettings.apiKey}`
    },
    body: JSON.stringify({
      model: providerSettings.model || entry.defaultModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: sanitizeNumber(providerSettings.temperature, 0.2),
      max_tokens: providerSettings.maxTokens || DEFAULT_MAX_TOKENS
    })
  });
  const content = response?.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek returned an empty response.');
  return content;
}

async function callOpenRouter({ providerSettings, prompt, catalog }) {
  const entry = catalog.openrouter;
  const model = providerSettings.model || entry.defaultModel;
  const modelInfo = entry.models[model] || {};

  // Dynamic base URL based on model's endpoint or default provider endpoint
  const baseUrl = (providerSettings.baseUrl || modelInfo.endpoint || entry.endpoint).replace(/\/$/, '');
  const response = await executeJson(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${providerSettings.apiKey}`
    },
    body: JSON.stringify({
      model: providerSettings.model || entry.defaultModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: sanitizeNumber(providerSettings.temperature, 0.2),
      max_tokens: providerSettings.maxTokens || DEFAULT_MAX_TOKENS
    })
  });
  const content = response?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter returned an empty response.');
  return content;
}


async function callZai({ providerSettings, prompt, catalog }) {
  const entry = catalog.zai;
  const model = providerSettings.model || entry.defaultModel;
  const modelInfo = entry.models[model] || {};

  // Dynamic base URL based on model-specific endpoint
  const baseUrl = (providerSettings.baseUrl || modelInfo.endpoint || entry.endpoint).replace(/\/$/, '');
  const authHeader = entry.authHeader || 'x-api-key';
  const headers = {
    'Content-Type': 'application/json',
    [authHeader]: providerSettings.apiKey,
    'anthropic-version': '2023-06-01'
  };

  const response = await executeJson(`${baseUrl}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: model,
      max_tokens: providerSettings.maxTokens || 220,
      temperature: sanitizeNumber(providerSettings.temperature, 0.7),
      system: 'You are Xtension, a precise translation assistant.',
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const content = response?.content?.[0]?.text;
  if (!content) throw new Error('Z.ai returned an empty response.');
  return content;
}

async function callGroq({ providerSettings, prompt, catalog }) {
  const entry = catalog.groq;
  const model = providerSettings.model || entry.defaultModel;
  const modelInfo = entry.models[model] || {};

  // Dynamic base URL based on model's endpoint or default provider endpoint
  const baseUrl = (providerSettings.baseUrl || modelInfo.endpoint || entry.endpoint).replace(/\/$/, '');
  const response = await executeJson(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${providerSettings.apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      temperature: sanitizeNumber(providerSettings.temperature, 0.2),
      max_tokens: providerSettings.maxTokens || DEFAULT_MAX_TOKENS
    })
  });
  const content = response?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Groq returned an empty response.');
  return content;
}



async function executeJson(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 32000);
  const response = await fetch(url, { ...options, signal: controller.signal });
  clearTimeout(timeout);

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.clone().json();
      message = body?.error?.message || body?.message || message;
    } catch {
      message = await response.text();
    }
    throw new Error(message);
  }

  return response.json();
}

function sanitizeOutput(raw) {
  let content = Array.isArray(raw) ? raw.join('\n') : raw;
  if (typeof content !== 'string') {
    content = JSON.stringify(content);
  }
  return content.replace(/^[\s"']+|[\s"']+$/g, '').trim();
}

function resolveLanguageLabel(config, languageCode, fallbackLabel) {
  if (!languageCode) return fallbackLabel;
  return config.languages.find((lang) => lang.code === languageCode)?.label || languageCode.toUpperCase();
}

async function readSettings() {
  try {
    const { [STORAGE_KEY]: settings } = await chrome.storage.local.get([STORAGE_KEY]);
    return { rawSettings: settings || {} };
  } catch (error) {
    console.warn('[Xtension] Failed to read settings, using defaults', error);
    return { rawSettings: {} };
  }
}

function mergeSettings(config, raw = {}) {
  const merged = deepMerge(clone(config.defaultSettings), raw || {});
  if (!merged.providerSettings) {
    merged.providerSettings = clone(config.defaultSettings.providerSettings);
  }
  merged.reply = deepMerge(clone(config.defaultSettings.reply), merged.reply || {});
  merged.popupStyle = deepMerge(clone(config.defaultSettings.popupStyle), merged.popupStyle || {});
  merged.discordReply = deepMerge(clone(config.defaultSettings.discordReply), merged.discordReply || {});
  if (merged.discordReply && Object.prototype.hasOwnProperty.call(merged.discordReply, 'enabled')) {
    delete merged.discordReply.enabled;
  }
  return merged;
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

function sanitizeNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.min(Math.max(num, 0), 1) : fallback;
}

function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => undefined);
  }, 20000);
}

function stopKeepAlive() {
  if (!keepAliveInterval) return;
  clearInterval(keepAliveInterval);
  keepAliveInterval = null;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

