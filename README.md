# TXtension

TXtension turns Twitter and Discord into instant, conversational co-pilots. A `TX` button under every tweet delivers on-demand translations tuned to your preferred tone and language. A matching `RX` button drafts replies from your personal prompt, and an `RD` control inside Discord channels generates context-aware responses using the same popup experience.

## Quick start

1. **Download the project** — Clone or copy this repository so you have the full `txtension-extension` folder locally.
2. **Load it into Chrome** — Visit `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and choose the `txtension-extension` directory.
3. **Open the control panel** — Click the TX toolbar icon to launch the dashboard and configure providers, tones, and prompts.
4. **Connect your model** — In **Integrations**, paste the API key for the provider you own (Gemini `gemini-2.0-flash` is the default). Each card lists the default model and accepts custom endpoints.
5. **Tune the workspace** — In **Workspace**, pick your target language, decide whether popups stay pinned, enable auto-copy if desired, and select a theme for the inline popups.
6. **Save prompts** — Use **Reply** for the RX prompt and **Discord Reply** for RD guidance. Toggle auto-copy for each workflow as needed.
7. **Browse and use** — On Twitter / X, click `TX` or `RX`. On Discord, use the new `TD` (translate) and `RD` (reply) buttons beneath each message to open the same inline popups.

## Feature highlights

- **Inline TX translations** — Compact `TX` chips sit beside native tweet actions. Clicking shows a floating card with a smooth transition, honouring pin / fade behaviour and respecting right-to-left scripts automatically.
- **Personal RX replies** — Save a custom prompt, add an avoid list for banned words or behaviours, and generate a reply in the tweet’s language. If no prompt is stored, the extension reminds you before sending any request.
- **Discord TD translations** — Click `TD` beside any Discord message to open the familiar translation popup, complete with tone presets and language preferences.
- **Discord RD drafts** — Provide channel context plus a Discord-specific prompt. Every Discord message receives an `RD` button that opens the same themed popup with your generated reply. Optional auto-copy mirrors the Twitter behaviour.
- **Avoid lists everywhere** — Add separate avoid lists for Twitter and Discord replies so unwanted words, topics, or styles never appear in generated drafts.
- **Word count guardrails** — Defaults start at 3–20 words, and you can fine-tune each channel anywhere between 1 and 250 words while keeping replies complete.
- **Themeable popups** — Choose from curated themes (Noir, Pearl, Ember). A single refined font stack keeps output crisp; translations and replies inherit proper directionality for languages like Persian or Arabic.
- **Refined control panel** — A refreshed glassmorphism dashboard makes switching providers, tones, and prompts effortless while keeping everything on one workspace canvas.
- **Inline reply composer** — Every translation opens a “Your Reply” composer so you can draft in your own language, instantly translate it back to the tweet or message language, and copy it with one click.
- **Script-aware typing** — Input areas flip between left-to-right and right-to-left automatically, so Persian, Arabic, or Hebrew feel natural—even when you sprinkle in English terms.
- **Tone studio** — Four presets (Simple, Professional, Comprehensive, Point) steer how translations are written while staying casual and easy to digest—even for technical topics.
- **Provider flexibility** — OpenAI, Anthropic, Google Gemini, DeepSeek, OpenRouter, or any OpenAI-compatible REST endpoint are supported with per-provider settings kept locally.
- **Clipboard automation** — Optional auto-copy for TX, RX, and RD places generated text on your clipboard the moment it arrives.
- **Built by cryptonparody-sys** — Reach the maintainer on GitHub (cryptonparody-sys), Telegram (@itscryptools), or email (cryptonparody@gmail.com).

## Control panel guide

- **Workspace** — Default language, popup pin behaviour, auto-copy, and theme selection.
- **Reply** — Save the RX prompt, keep project context, maintain an avoid list, set min/max word counts, and control auto-copy. The RX button is disabled with a friendly reminder if no prompt is saved.
- **Discord Reply** — Add context, prompt, avoid list, and per-channel word limits for RD replies, then decide whether drafts should auto-copy.
- **Tone Studio** — Pick the translation tone; selections persist immediately.
- **Integrations** — Configure credentials, base URLs, models, and advanced headers for each provider. Settings sync to `chrome.storage.local`.
- **Overview** — Lightweight recap of capabilities for anyone new to the project.

## Using TX and RX on Twitter / X

1. Configure your provider and defaults in the control panel.
1. Hover any tweet to reveal `TX` and `RX` beside the native actions.
1. Click `TX` to translate the tweet into your selected language and tone. The popup stays open while hovered and fades after 10 seconds if pin mode is off.
1. Use the “Your Reply” composer beneath the translation to draft in your language; TXtension instantly converts it into the tweet’s language with a copy-ready output, respecting your saved word-count range.
1. Click `RX` to draft a reply that follows your saved prompt and the tweet’s detected language. Without a stored prompt, TXtension gently instructs you to add one first.
1. Copy results (manually or via auto-copy), or click the buttons again to close the popup.

## Using TD and RD on Discord

1. In the control panel, open **Discord Reply** and provide project context plus a reply prompt. Translation uses your global Workspace language and tone settings automatically.
1. Visit Discord in the browser. Each message thread gains a right-side column with `TD` (translate) and `RD` (reply) controls, keeping the buttons clear of the message text.
1. Click `TD` to translate the message into your configured language with the active tone preset. Use the attached “Your Reply” composer to draft and translate your response back into the message’s language, ready to copy and within your word-count bounds.
1. Click `RD` to open the reply popup that blends your prompt, avoid list, word limits, and the message text, responding in the message’s language automatically.
1. Keep the popup open while reviewing it. When pin mode is disabled, it fades smoothly after 10 seconds once your mouse leaves both the message and the popup. With pin mode enabled, it stays until you dismiss it or open another card.
1. Auto-copy mirrors your settings—translation uses the Workspace toggle, replies use the Discord Reply toggle. Otherwise, copy manually and post back to Discord.

## Tone presets

- **Simple** — Conversational, direct sentences that mirror the author’s meaning.
- **Professional** — Precise wording that remains relaxed and approachable, never stiff.
- **Comprehensive** — Expands implied ideas with friendly explanations while staying technical where needed.
- **Point** — Condenses intent into the target language only, under three short sentences, and keeps the explanation casual.

## Provider catalog

| Provider    | Default model                 | Notes                                                        |
|-------------|-------------------------------|--------------------------------------------------------------|
| OpenAI      | `gpt-4.1-mini`                | Works with modern ChatGPT-compatible keys.                   |
| Anthropic   | `claude-3-5-sonnet-20241022`  | Great tone control and long context handling.                |
| Gemini      | `gemini-2.0-flash`            | Default setup for fast translation and reply generation.     |
| DeepSeek    | `deepseek-chat`               | Efficient OpenAI-compatible endpoint.                        |
| OpenRouter  | `openrouter/deepseek-chat`    | Aggregator with access to premium community models.          |
| Custom REST | —                             | Bring any OpenAI-compatible REST API with custom headers.    |

## Troubleshooting

- **Buttons missing** — Ensure TXtension is enabled in `chrome://extensions` and reload the tab.
- **Prompt reminder** — If RX or RD reports “Please first specify the prompt in the settings,” open the control panel and save a prompt before retrying.
- **Clipboard blocked** — Chrome may deny clipboard writes without permissions; disable auto-copy or re-enable permissions in browser settings.
- **Slow responses** — API latency varies by provider. The popup remains in view with a toast notification until a response or error arrives.

## Privacy

- API keys, prompts, and settings stay in `chrome.storage.local`.
- Tweet and Discord message text is processed in-memory for the duration of the request.
- All calls go straight to the providers you configure—no external relay servers.

## Contact

- GitHub: https://github.com/cryptonparody-sys
- Telegram: https://t.me/itscryptools
- Email: cryptonparody@gmail.com

## License

MIT — see `LICENSE`.
