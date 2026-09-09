# 9Router for GitHub Copilot

Connect **9Router** and multiple OpenAI-compatible inference backends to GitHub Copilot Chat and inline code completions — with multi-provider profile management and resilience layers for self-hosted models.

## Quick Start

1. **Install** from the VS Code Marketplace.
2. Run **9Router: Manage Providers** (`Cmd+Shift+P` / `Ctrl+Shift+P`) or click the 9Router status bar item to add your first inference provider.
3. In Copilot Chat, open the model picker → **Manage Models** → enable the models you want to use.
4. Select a model and start chatting.

## Multi-Provider Support

Connect and use multiple inference backends simultaneously (e.g. local Ollama, a remote vLLM cluster, and cloud 9Router).

- **Profile Isolation**: Each provider profile maintains its own endpoint URL, API key, custom HTTP headers, and enabled/disabled state.
- **Secure Storage**: API keys and sensitive custom headers are stored in VS Code SecretStorage, not in plaintext workspace settings.
- **Smart Model Namespacing**:
  - **Single Active Provider**: Models expose raw IDs (e.g. `qwen2.5-coder-32b`) for seamless backward compatibility.
  - **Multiple Active Providers**: Models are automatically namespaced as `<profile-id>/<model-id>` (e.g. `ollama/qwen2.5-coder-32b`, `vllm/qwen2.5-coder-32b`) to prevent collisions, with provider details displayed directly in the model picker.
- **Unified Provider Registration**: Contributed directly to VS Code's language model chat provider registry with provider management accessible from VS Code's **Manage Language Models** UI.
- **Quick Toggle**: Enable or disable any profile to show or hide its models without deleting the configuration.
- **Automatic Migration**: Upgrades from single-provider versions migrate existing endpoints, keys, and headers into a `Default` profile automatically.

## Inline Code Completions (Ghost Text)

9Router can provide inline code completions directly from your inference backend using Fill-in-the-Middle (FIM):

1. Set `9router-for-github-copilot.enableInlineCompletion` to `true`.
2. Run **9Router: Select Inline Completion Model** to pick a FIM-capable base model (e.g. Qwen2.5-Coder base).
3. Optional: Route inline completions to a specific provider via `9router-for-github-copilot.inlineCompletionProvider` (leave blank to use the first active provider).

## Status Bar & Observability

The status bar item reflects real-time gateway health:

- **States**: Displays active connection state (`probing`, `idle`, `streaming [active request count]`, `responded [token stats]`, `noModels`, or `error`).
- **Interactive Tooltip**: Hovering over the status bar reveals a rich card showing:
  - All configured provider profiles, active states, model counts, and capability badges (`tools`, `vision`, `inline`).
  - Session token statistics (cumulative input, output, and reasoning tokens).
  - Last request metrics and duration.
  - Quick action links for **Refresh**, **Configure**, **Test Connection**, and **Output Log**.

## Why This Over Native BYOK?

VS Code's built-in BYOK works for standard models. 9Router adds a resilience layer for open-source and self-hosted models:

- **Tool calls fail with malformed JSON?** Repairs truncated arguments and injects missing required schema fields.
- **Reasoning models leak `<think>` tags?** Extracts thinking blocks and routes them into Copilot's collapsible thinking UI.
- **Context overflow errors?** Auto-detects real server limits, retries automatically, and budgets prompt tokens.
- **Model outputs tool calls as plain text?** Lowers agent temperature and stabilizes schema enforcement.

Inference stays on your server. No per-token platform surcharges. Does not consume Copilot premium quota.

## Supported Backends

9Router, vLLM, Ollama, llama.cpp / llama-server, LM Studio, LocalAI, LiteLLM, or any OpenAI-compatible `/v1` endpoint.

## Commands

| Command | Purpose |
| --- | --- |
| **9Router: Manage Providers** | Interactive dashboard to list, add, edit, test, toggle, or delete provider profiles |
| **9Router: Add Provider** | Wizard to register a new OpenAI-compatible inference endpoint |
| **9Router: Test Server Connection** | Test connectivity and model listing (select a specific provider or test all) |
| **9Router: Refresh Models** | Invalidate model cache and re-probe endpoints (single provider or all) |
| **9Router: Edit Custom Headers** | Add or modify secure custom HTTP headers for a selected provider profile |
| **9Router: Select Inline Completion Model** | Quick-pick menu to configure the model used for ghost-text completions |
| **9Router: Show Output Log** | Open the 9Router diagnostic output channel |

## Key Settings

Provider endpoints, API keys, and custom headers are managed per profile via **9Router: Manage Providers**. Workspace and user settings govern global runtime behavior:

| Setting | Default | Description |
| --- | --- | --- |
| `9router-for-github-copilot.defaultMaxTokens` | `262144` | Fallback context window when server does not report one |
| `9router-for-github-copilot.defaultMaxOutputTokens` | `4096` | Fallback maximum output tokens |
| `9router-for-github-copilot.enableToolCalling` | `true` | Enable agent tools (file edits, terminal execution, etc.) |
| `9router-for-github-copilot.parallelToolCalling` | `true` | Allow models to issue multiple tool calls in a single turn |
| `9router-for-github-copilot.agentTemperature` | `0` | Fallback temperature when tools are active (0 = strict formatting) |
| `9router-for-github-copilot.modelContextWindows` | `{}` | Per-model context overrides, e.g. `{"qwen*": 32768}` |
| `9router-for-github-copilot.perModelOptions` | `{}` | Per-model sampler parameters, e.g. `{"deepseek*": {"temperature": 0.6}}` |
| `9router-for-github-copilot.extraModelOptions` | `{}` | Extra request body parameters sent on all chat completions |
| `9router-for-github-copilot.requestTimeout` | `60000` | HTTP request timeout in milliseconds |
| `9router-for-github-copilot.verboseLogging` | `false` | Log full request and response bodies to output channel |
| `9router-for-github-copilot.enableInlineCompletion` | `false` | Enable experimental ghost-text code completions |
| `9router-for-github-copilot.inlineCompletionProvider` | `""` | Target provider profile ID for inline completions (empty = first active) |
| `9router-for-github-copilot.inlineCompletionModel` | `""` | Model ID for inline completions (empty = first available) |
| `9router-for-github-copilot.inlineCompletionDebounce` | `300` | Debounce delay in milliseconds before requesting completion |
| `9router-for-github-copilot.inlineCompletionMaxTokens` | `256` | Maximum generated tokens for inline suggestions |

## Troubleshooting

**Models not appearing in Copilot?**

- Verify your endpoint responds to `curl <server-url>/models` or `<server-url>/v1/models` (trailing `/v1` is handled automatically).
- Run **9Router: Test Server Connection** to check profile health.
- Ensure the profile is enabled in **9Router: Manage Providers**.

**Tool calls output as text instead of executing?**

- Ensure `agentTemperature` is set to `0`.
- Disable `parallelToolCalling` if the model does not reliably handle parallel calls.
- If using vLLM, ensure `--enable-auto-tool-choice` and a compatible chat template are enabled.

**Context overflow errors?**

- Set explicit limits in `modelContextWindows` for your model or family wildcard (e.g. `{"qwen*": 32768}`).
- The extension automatically learns corrected context limits on HTTP 400 context errors and retries once.

**Models not in the Agents window?**

- The Agents window runs in a separate process. Add this setting and reload VS Code:

```jsonc
"extensions.supportAgentsWindow": {
  "hotrungnhan.9router-for-github-copilot": true
}
```

## Utility Tasks (Titles, Commit Messages)

Route Copilot utility tasks (chat titles, commit messages) to your local or self-hosted models:

- Open VS Code Settings → set `chat.utilityModel` and `chat.utilitySmallModel` to a 9Router model.

## Privacy

Inference prompts and code context are transmitted directly to your configured provider endpoints only. API keys and headers are stored in VS Code SecretStorage.

## Credits

This project is a fork of [arbs-io/github-copilot-llm-gateway](https://github.com/arbs-io/github-copilot-llm-gateway). Thanks to the original authors for the base extension.

## License

MIT — see [LICENSE](LICENSE).
