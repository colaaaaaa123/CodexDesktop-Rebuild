# Codex Desktop Rebuild (Fork)

Maintained fork of Codex Desktop with pinned Codex CLI binaries and Electron packaging.

## Basics

- Latest release: `v1.0.7`
- App version in this repo: `1.0.7`
- Pinned CLI package: `@openai/codex 0.101.0`
- CLI update note: Bundled CLI is updated and pinned to `@openai/codex 0.101.0`.
- Spark note: Spark can be used when your ChatGPT account/backend exposes it in the model picker.

## Quick Start

1. Download from [Releases](https://github.com/chrisbuchanpham/CodexDesktop-Rebuild/releases/latest).
2. Install and launch Codex.

## Build From Source

```bash
npm install
npm run stage:host
npm run dev
```

## Validation

| Check | Status |
| --- | --- |
| `npm ls @openai/codex` (`0.101.0`) | ✅ Pass |
| `npm run stage:host` | ✅ Pass |
| `node --check forge.config.js` | ✅ Pass |
| `node --check scripts/patch-console-epipe.js` | ✅ Pass |

## Supported Platforms

| Platform | Status |
| --- | --- |
| Windows x64 | ✅ Supported |
| macOS x64 | ✅ Supported |
| macOS arm64 | ✅ Supported |
| Linux x64 | ✅ Supported |
| Linux arm64 | ✅ Supported |

## Program Structure

```text
├── src/
│   ├── .vite/build/     # Main process (Electron)
│   └── webview/         # Renderer (Frontend)
├── resources/
│   ├── electron.icns    # App icon
│   └── notification.wav # Sound
├── scripts/
│   └── patch-copyright.js
├── forge.config.js      # Electron Forge config
└── package.json
```

## Credits

- Original rebuild architecture: [Haleclipse/CodexDesktop-Rebuild](https://github.com/Haleclipse/CodexDesktop-Rebuild)
- Upstream Codex CLI: [OpenAI Codex](https://github.com/openai/codex)
