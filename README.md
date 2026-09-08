# 9Router for GitHub Copilot

Use **9Router** and any OpenAI-compatible model inside GitHub Copilot Chat — with automatic fixes for the rough edges that self-hosted models produce.

## Quick Start

1. **Install** from the VS Code Marketplace.
2. Use the **Manage Providers** command (`Cmd+Shift+P` → "9Router: Manage Providers") or click the status bar to configure your endpoint and API key.
3. In Copilot Chat, open the model picker → **Manage Models** → enable models under **9Router**.
4. Select a model and start chatting.

## Why This Over Native BYOK?

VS Code's built-in BYOK works great for well-behaved models. 9Router adds a resilience layer for when things break:

- **Tool calls fail with bad JSON?** Repairs truncated arguments and fills missing required fields.
- **Reasoning models leak `<think>` blocks?** Routes them into Copilot's thinking UI, not your chat.
- **Context-length errors?** Auto-detects the real limit and budgets tokens safely.
- **Model outputs tool names as text?** Lowers temperature and stabilises formatting.

Inference stays on your server. No per-token fees. Doesn't consume Copilot premium quota.

## Servers Supported

9Router, vLLM, Ollama, llama.cpp, LM Studio, LocalAI, LiteLLM — any OpenAI-compatible endpoint.

## Key Settings

Provider endpoints, API keys, and custom headers are configured per profile using the **9Router: Manage Providers** command or via VS Code's native Copilot Chat provider settings.

Global settings:

| Setting                                          | Default                     | What it does                                            |
| ------------------------------------------------ | --------------------------- | ------------------------------------------------------- |
| `9router-for-github-copilot.defaultMaxTokens`    | `262144`                    | Fallback context window                                 |
| `9router-for-github-copilot.enableToolCalling`   | `true`                      | Allow agent tools (file ops, terminal, etc.)            |
| `9router-for-github-copilot.agentTemperature`    | `0`                         | Tool-call stability (lower = stricter)                  |
| `9router-for-github-copilot.modelContextWindows` | `{}`                        | Per-model context overrides, e.g. `{"qwen3-8b": 32768}` |
| `9router-for-github-copilot.perModelOptions`     | `{}`                        | Per-model sampler params (temperature, top_p, etc.)     |

## Commands

| Command                                        | Purpose                                      |
| ---------------------------------------------- | -------------------------------------------- |
| **9Router: Manage Providers**                  | Manage provider profiles, URLs, and API keys |
| **9Router: Add Provider**                      | Add a new provider endpoint profile          |
| **9Router: Test Server Connection**            | Verify connectivity and list models          |
| **9Router: Refresh Models**                    | Re-probe the server for model changes        |
| **9Router: Edit Custom Headers**               | Manage custom HTTP headers (stored securely) |
| **9Router: Select Inline Completion Model**    | Choose the model used for inline completions |
| **9Router: Show Output Log**                   | View debug output                            |

## Troubleshooting

**Models not showing?** Run `curl <server-url>/v1/models` to verify the server is up (trailing `/v1` is handled automatically). Run the **Test Server Connection** command for a diagnostic.

**Tool calls output as text instead of executing?** Set **Agent Temperature** to `0`, disable **Parallel Tool Calling**, and confirm your server has `--enable-auto-tool-choice` (vLLM).

**Context overflow errors?** Add the model to `modelContextWindows` with the correct limit. The extension learns the real limit from the error and retries once automatically.

**Models not in the Agents window?** Agents window runs in a separate process. Add this to settings and reload:

```jsonc
"extensions.supportAgentsWindow": {
  "hotrungnhan.9router-for-github-copilot": true
}
```

## Utility Tasks (Titles, Commit Messages)

By default, Copilot sends chat titles and commit messages to GitHub. Route them to your own model instead:

- Open Settings → set `chat.utilityModel` and `chat.utilitySmallModel` to a 9Router model.

## Privacy

Prompts and code go to **your server only**. Copilot Chat (the VS Code host) may send its own auth, telemetry, and title requests to GitHub — route utility tasks to your server to minimise this.

## Credits

This project is a fork of [arbs-io/github-copilot-llm-gateway](https://github.com/arbs-io/github-copilot-llm-gateway). Thanks to the original authors for the base extension.

## License

MIT — see [LICENSE](LICENSE).
