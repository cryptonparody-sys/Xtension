# 🛡️ TXtension Privacy Policy


## Our Commitment

TXtension keeps every request on your device. We do not collect analytics, store personal data on remote servers, or sell any information. All preferences and API keys remain in local browser storage under your control.

## What the Extension Uses

| Category | Purpose | Where it lives |
| --- | --- | --- |
| Tweet text & detected language | Required temporarily to request a translation | Processed in-memory only, never persisted |
| Workspace defaults | Default language, pin/copy options, tone preset | Stored locally via `chrome.storage.local` |
| Provider credentials | API keys, model overrides, custom endpoints | Stored locally and sent only to the provider you configure |

TXtension does not create accounts, transmit telemetry, or bundle third-party trackers.

## Network Calls

Outgoing requests target only the AI endpoints you configure (OpenAI, Anthropic, Google Gemini, DeepSeek, OpenRouter, or a custom compatible service). API keys are included solely in those calls. We do not proxy, inspect, or reroute traffic through any external servers.

## Your Controls

- Remove or rotate API keys any time from the **Integrations** tab.
- Clear all preferences by deleting the extension or removing `chrome.storage.local` data for TXtension.
- Review provider-specific privacy policies to understand how they handle submitted content.
