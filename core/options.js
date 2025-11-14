const XtensionConfig = {
  version: '1.0.0',
  branding: {
    productName: 'Xtension',
    shortName: 'TX',
    tagline: 'Translate every tweet instantly.',
    socials: {}
  },
  theme: {
    fontStack: `'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif`,
    accent: '#1DD3F8'
  },
  buttonStates: {
    idle: 'TX',
    loading: '…',
    success: 'done',
    error: 'retry'
  },
  tonePresets: [
    {
      id: 'simple',
      label: 'Simple',
      description: 'Everyday language, easy to understand.',
      prompt: `CRITICAL INSTRUCTIONS: Translate the tweet completely but using simple, everyday language. Use basic words and short sentences that everyone can understand. Explain complex ideas in simple terms. The output must be conversational, fluent, natural, and completely non-bookish. Avoid technical jargon unless absolutely necessary, and if used, explain it simply. IMPORTANT: Translate using informal, conversational, and understandable language.`
    },
    {
      id: 'professional',
      label: 'Professional',
      description: 'Clear and reliable, workplace friendly.',
      prompt: `CRITICAL INSTRUCTIONS: Translate the tweet with professional clarity suitable for business context. Present the information step-by-step in a logical flow. Use proper terminology but keep it accessible. The output must be well-structured, fluent, natural, and completely non-bookish. Focus on clarity and reliability while maintaining professional tone. IMPORTANT: Translate using informal, conversational, and understandable language.`
    },
    {
      id: 'comprehensive',
      label: 'Detailed',
      description: 'Extra helpful information included.',
      prompt: `CRITICAL INSTRUCTIONS: Translate the tweet with extra helpful details and explanations. Add brief context for cultural references, idioms, or unclear concepts. Provide background information that makes the content completely understandable. The output must be thorough, fluent, natural, and completely non-bookish. Include helpful footnotes in parentheses when needed. IMPORTANT: Translate using informal, conversational, and understandable language.`
    },
    {
      id: 'point',
      label: 'Brief',
      description: 'Only the main idea, very short.',
      prompt: `CRITICAL INSTRUCTIONS: Translate by extracting ONLY the main point or key message. Create a very short, fluent summary that captures the essential meaning. Remove all secondary details and examples. Get straight to the point. The output must be concise (under 15 words), fluent, natural, and completely non-bookish. Focus on the core purpose only. IMPORTANT: Translate using informal, conversational, and understandable language.`
    }
  ],
  reply: {
    title: 'X Reply',
    description: 'Save personal instructions, project context, and constraints RX must follow whenever it drafts a reply.',
    placeholder:
      'Explain the tone, structure, and context RX should apply. The tweet text is appended after your instructions.'
  },
  discordReply: {
    title: 'Discord Reply',
    description: 'Provide context, desired prompt, and banned phrases for generating responses inside Discord.',
    promptPlaceholder: 'Describe how RD should respond to Discord messages.',
    contextPlaceholder: 'Share background context or project notes that should guide replies.'
  },
  popupThemes: [
    {
      id: 'light',
      label: 'Light Theme',
      background: '#ffffff',
      border: '#e5e7eb',
      text: '#000000',
      subtext: '#6b7280',
      headerBg: '#ffffff',
      accentColor: '#4b5563',
      shadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
      focusGlow: '0 0 0 2px rgba(75, 85, 99, 0.2)',
      buttonBg: '#000000',
      buttonHover: '#1f2937',
      backdrop: 'blur(4px)',
      glow: 'rgba(75, 85, 99, 0.05)'
    },
    {
      id: 'dark',
      label: 'Dark Theme',
      background: '#000000',
      border: '#1a1a1a',
      text: '#ffffff',
      subtext: '#999999',
      headerBg: 'linear-gradient(135deg, #0a0a0a 0%, #111111 50%, #1a1a1a 100%)',
      accentColor: '#6b7280',
      shadow: '0 40px 80px rgba(0, 0, 0, 0.8), 0 20px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)',
      focusGlow: '0 0 0 4px rgba(107, 114, 128, 0.25)',
      buttonBg: 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
      buttonHover: 'linear-gradient(135deg, #4b5563 0%, #374151 100%)',
      backdrop: 'blur(20px) saturate(120%)',
      glow: 'rgba(107, 114, 128, 0.15)'
    },
    {
      id: 'obsidian',
      label: 'Obsidian',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 40%, #334155 100%)',
      border: 'rgba(156, 163, 175, 0.6)',
      text: '#f1f5f9',
      subtext: '#94a3b8',
      headerBg: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.9) 50%, rgba(51, 65, 85, 0.85) 100%)',
      accentColor: '#6b7280',
      shadow: '0 50px 100px rgba(15, 23, 42, 0.9), 0 25px 50px rgba(107, 114, 128, 0.3), 0 0 0 1px rgba(156, 163, 175, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
      focusGlow: '0 0 0 4px rgba(107, 114, 128, 0.3), 0 0 20px rgba(107, 114, 128, 0.2)',
      buttonBg: 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
      buttonHover: 'linear-gradient(135deg, #4b5563 0%, #374151 100%)',
      backdrop: 'blur(25px) saturate(180%)',
      glow: 'rgba(107, 114, 128, 0.4)'
    }
  ],
  rtlLanguages: ['ar', 'fa', 'he', 'ur', 'ps'],
  languages: [
    { code: 'en', label: 'English' },
    { code: 'fa', label: 'Persian' },
    { code: 'tr', label: 'Turkish' },
    { code: 'ru', label: 'Russian' },
    { code: 'zh', label: 'Chinese' },
    { code: 'es', label: 'Spanish' },
    { code: 'fr', label: 'French' },
    { code: 'de', label: 'German' },
    { code: 'ja', label: 'Japanese' },
    { code: 'pt', label: 'Portuguese' }
  ],
  providerCatalog: {
    openai: {
      id: 'openai',
      label: 'OpenAI',
      defaultModel: 'gpt-4o-mini',
      endpoint: 'https://api.openai.com/v1',
      models: {
        'gpt-4o-mini': { name: 'GPT-4o Mini', tier: 'pro', context: 128000, speed: 'fast', endpoint: 'https://api.openai.com/v1' },
        'gpt-4o': { name: 'GPT-4o', tier: 'pro', context: 128000, speed: 'medium', endpoint: 'https://api.openai.com/v1' },
        'gpt-3.5-turbo': { name: 'GPT-3.5 Turbo', tier: 'pro', context: 16385, speed: 'fast', endpoint: 'https://api.openai.com/v1' },
        'o1-mini': { name: 'o1 Mini', tier: 'pro', context: 128000, speed: 'slow', endpoint: 'https://api.openai.com/v1' }
      }
    },
    openrouter: {
      id: 'openrouter',
      label: 'OpenRouter',
      defaultModel: 'openai/gpt-4o-mini',
      endpoint: 'https://openrouter.ai/api/v1',
      models: {
        'deepseek/deepseek-r1:free': { name: 'DeepSeek R1', tier: 'free', context: 64000, speed: 'medium', endpoint: 'https://openrouter.ai/api/v1' },
        'openai/gpt-4o-mini': { name: 'GPT-4o Mini', tier: 'free', context: 128000, speed: 'fast', endpoint: 'https://openrouter.ai/api/v1' },
        'meta-llama/llama-4-maverick:free': { name: 'Llama 4 Maverick', tier: 'free', context: 128000, speed: 'very-fast', endpoint: 'https://openrouter.ai/api/v1' },
        'mistralai/mistral-small-3.1-24b-instruct:free': { name: 'Mistral Small 3.1', tier: 'free', context: 32000, speed: 'very-fast', endpoint: 'https://openrouter.ai/api/v1' },
        'minimax/minimax-m2:free': { name: 'MiniMax M2', tier: 'free', context: 128000, speed: 'fast', endpoint: 'https://openrouter.ai/api/v1' },
        'openai/gpt-4o': { name: 'GPT-4o', tier: 'pro', context: 128000, speed: 'medium', endpoint: 'https://openrouter.ai/api/v1' },
        'meta-llama/llama-3.1-70b-instruct': { name: 'Llama 3.1 70B', tier: 'pro', context: 128000, speed: 'fast', endpoint: 'https://openrouter.ai/api/v1' },
        'anthropic/claude-3.5-sonnet': { name: 'Claude 3.5 Sonnet', tier: 'pro', context: 200000, speed: 'medium', endpoint: 'https://openrouter.ai/api/v1' },
        'anthropic/claude-3.5-haiku': { name: 'Claude 3.5 Haiku', tier: 'pro', context: 200000, speed: 'fast', endpoint: 'https://openrouter.ai/api/v1' }
      }
    },
    groq: {
      id: 'groq',
      label: 'Groq',
      defaultModel: 'llama-3.3-70b-versatile',
      endpoint: 'https://api.groq.com/openai/v1',
      models: {
        'llama-3.1-8b-instant': { name: 'Llama 3.1 8B Instant', tier: 'free', context: 131072, speed: 'very-fast', endpoint: 'https://api.groq.com/openai/v1' },
        'llama-3.3-70b-versatile': { name: 'Llama 3.3 70B Versatile', tier: 'free', context: 131072, speed: 'very-fast', endpoint: 'https://api.groq.com/openai/v1' }
      }
    },
    anthropic: {
      id: 'anthropic',
      label: 'Anthropic Claude',
      defaultModel: 'claude-3-haiku-20240307',
      endpoint: 'https://api.anthropic.com/v1',
      models: {
        'claude-3-5-sonnet-20241022': { name: 'Claude 3.5 Sonnet', tier: 'pro', context: 200000, speed: 'medium', endpoint: 'https://api.anthropic.com/v1' },
        'claude-3-5-haiku-20241022': { name: 'Claude 3.5 Haiku', tier: 'pro', context: 200000, speed: 'fast', endpoint: 'https://api.anthropic.com/v1' },
        'claude-3-haiku-20240307': { name: 'Claude 3 Haiku', tier: 'pro', context: 200000, speed: 'very-fast', endpoint: 'https://api.anthropic.com/v1' },
        'claude-3-sonnet-20240229': { name: 'Claude 3 Sonnet', tier: 'pro', context: 200000, speed: 'medium', endpoint: 'https://api.anthropic.com/v1' }
      }
    },
    gemini: {
      id: 'gemini',
      label: 'Google Gemini',
      defaultModel: 'gemini-2.0-flash',
      endpoint: 'https://generativelanguage.googleapis.com/v1beta',
      models: {
        'gemini-2.0-flash': { name: 'Gemini 2.0 Flash', tier: 'free', context: 1048576, speed: 'very-fast', endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent' },
        'gemini-2.5-flash-lite': { name: 'Gemini 2.5 Flash Lite', tier: 'free', context: 1000000, speed: 'very-fast', endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent' },
        'gemini-2.5-flash': { name: 'Gemini 2.5 Flash', tier: 'pro', context: 1000000, speed: 'very-fast', endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent' },
        'gemini-2.5-pro': { name: 'Gemini 2.5 Pro', tier: 'pro', context: 1000000, speed: 'very-fast', endpoint: 'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-pro:generateContent' },
        'gemini-pro-vision': { name: 'Gemini Pro Vision', tier: 'pro', context: 16384, speed: 'medium', endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent' }
      }
    },
    deepseek: {
      id: 'deepseek',
      label: 'DeepSeek',
      defaultModel: 'deepseek-chat',
      endpoint: 'https://api.deepseek.com/v1/chat/completions',
      models: {
        'deepseek-chat': { name: 'DeepSeek Chat', tier: 'pro', context: 128000, speed: 'fast', endpoint: 'https://api.deepseek.com/v1/chat/completions' },
        'deepseek-coder': { name: 'DeepSeek Coder', tier: 'pro', context: 128000, speed: 'fast', endpoint: 'https://api.deepseek.com/v1/chat/completions' },
        'deepseek-reasoner': { name: 'DeepSeek Reasoner', tier: 'pro', context: 64000, speed: 'medium', endpoint: 'https://api.deepseek.com/v1/chat/completions' }
      }
    },
                zai: {
      id: 'zai',
      label: 'Z.ai',
      defaultModel: 'glm-4.6',
      endpoint: 'https://api.z.ai/api/anthropic/v1',
      models: {
        'glm-4.6': { name: 'GLM-4.6 (Most Capable)', tier: 'pro', context: 128000, speed: 'medium', endpoint: 'https://api.z.ai/api/anthropic/v1' },
        'glm-4.5v': { name: 'GLM-4.5V (Vision)', tier: 'pro', context: 128000, speed: 'medium', endpoint: 'https://api.z.ai/api/anthropic/v1' },
        'glm-4.5': { name: 'GLM-4.5 (Balanced)', tier: 'pro', context: 128000, speed: 'medium', endpoint: 'https://api.z.ai/api/anthropic/v1' },
        'glm-4.5-air': { name: 'GLM-4.5-Air (Fast)', tier: 'pro', context: 128000, speed: 'fast', endpoint: 'https://api.z.ai/api/anthropic/v1' }
      },
      authHeader: 'x-api-key'
    }
  },
  defaultSettings: {
    tonePreset: 'simple',
    targetLanguage: 'en',
    pinWindow: true,
    autoCopy: false,
    popupStyle: {
      theme: 'dark'
    },
    reply: {
      prompt: '',
      context: '',
      avoid: '',
      minWords: 3,
      maxWords: 20,
      autoCopy: false
    },
    discordReply: {
      prompt: '',
      context: '',
      avoid: '',
      minWords: 3,
      maxWords: 20,
      autoCopy: false
    },
    provider: 'openrouter',
    providerSettings: {
      openai: {
        apiKey: '',
        model: 'gpt-4o-mini',
        baseUrl: 'https://api.openai.com/v1',
        temperature: 0.2,
        maxTokens: 400
      },
      anthropic: {
        apiKey: '',
        model: 'claude-3-haiku-20240307',
        baseUrl: 'https://api.anthropic.com/v1',
        temperature: 0.2,
        maxTokens: 400
      },
      gemini: {
        apiKey: '',
        model: 'gemini-2.0-flash',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
        temperature: 0.2,
        maxOutputTokens: 400
      },
      deepseek: {
        apiKey: '',
        model: 'deepseek-chat-v3.1:free',
        baseUrl: 'https://api.deepseek.com/v1',
        temperature: 0.2,
        maxTokens: 400
      },
      openrouter: {
        apiKey: '',
        model: 'openai/gpt-4o-mini',
        baseUrl: 'https://openrouter.ai/api/v1',
        temperature: 0.2,
        maxTokens: 400
      },
      groq: {
        apiKey: '',
        model: 'llama-3.3-70b-versatile',
        baseUrl: 'https://api.groq.com/openai/v1',
        temperature: 0.2,
        maxTokens: 400
      },
                          zai: {
        apiKey: '',
        model: 'glm-4.6',
        baseUrl: 'https://api.z.ai/api/anthropic/v1',
        temperature: 0.7,
        maxTokens: 400
      }
    }
  }
};

export { XtensionConfig };
