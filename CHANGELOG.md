# Changelog

## 2.1.0 — 2026-10-29

### Highlights

- **Reasoning controls:** Integrate the Thinking Effort picker with chat requests, support `max` effort, and hide redundant controls for models whose IDs already encode a reasoning tier.
- **Cleaner provider configuration:** Manage endpoints, API keys, and custom headers through provider profiles. Remove obsolete global settings and legacy `chatLanguageModels.json` entries while preserving migration of existing configuration.
- **Reliable model discovery:** Prevent stale requests from overwriting refreshed catalogs or metadata after profile changes. Treat cancellation separately from connection failures and preserve caches when configuration is unchanged.
- **Correct model routing:** Keep model ordering stable, disambiguate duplicate names across providers, preserve upstream model IDs, and save inline completion provider/model selections separately. Disabled providers no longer affect overall connection health or receive inline requests.
- **Simpler status and commands:** Render the status bar and tooltip from the same connection snapshot, consolidate connection testing, retain actionable connection errors, and use consistent token-number formatting.
- **Bun development workflow:** Run tests, coverage, builds, lint, type checking, and packaging with Bun. Update dependencies, CI, and the development container; remove redundant status machinery, test compilation, and packaging leftovers.

### Compatibility

- Requires **VS Code 1.144.0 or newer**.
- Configure provider endpoints and credentials through **9Router: Manage Providers**. Existing legacy configuration is migrated into provider profiles.
- The extension bundle still targets VS Code's Node-based extension host; development tooling runs with Bun.

### Validation

- 473 tests, coverage reporting, lint, type checking, development/production builds, and VSIX packaging verified.

### Thanks

Thanks to [@k1rana (ahann)](https://github.com/k1rana) for the reasoning-effort integration and picker refinements, and [@hotrungnhan](https://github.com/hotrungnhan) for the provider, reliability, and tooling improvements.

[Compare changes since `297e6e3`](https://github.com/hotrungnhan/9router-for-github-copilot/compare/297e6e38897c52ac3472ae24ef68900cb8394127...2.1.0).
