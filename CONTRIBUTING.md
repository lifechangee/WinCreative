# Contributing to WinCreative

Thanks for helping! By contributing you agree that your work is licensed under AGPL-3.0-or-later, like the rest of the project.

## Setup

Node.js 20+ on Windows.

```
npm install
npm run dev
```

## Before opening a pull request

```
npx tsc --noEmit     # type-check
npm test             # vitest unit tests
npm run i18n:check   # must report TOTAL 0
npm run build
```

* Keep changes focused and match the existing style (TypeScript, vanilla DOM, no UI framework).
* All user-visible strings go through the i18n layer (`tk()` / `t()`), with both English and Russian entries in `src/renderer/src/i18n/locales/`. See [docs/I18N.md](docs/I18N.md).
* Architecture rules (pure `core/`, GL-only `gl/`, feature modules) are in [ARCHITECTURE.md](ARCHITECTURE.md).
* Do not add assets or code copied from Procreate or other proprietary software. Only contribute material you have the right to license under the AGPL.
* UI test drivers live in `scripts/qa/` (Playwright + Electron; always run them with an isolated profile).

## Reporting bugs

Use the bug report template. For tablet problems please include the tablet model, driver and version, and whether Windows Ink is enabled.
