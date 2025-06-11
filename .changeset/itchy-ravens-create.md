---
"kilo-code": minor
---

Include changes from Roo Code v3.19.6:

- Replace explicit caching with implicit caching to reduce latency for Gemini models
- Clarify that the default concurrent file read limit is 15 files (thanks @olearycrew!)
- Fix copy button logic (thanks @samhvw8!)
- Fade buttons on history preview if no interaction in progress (thanks @sachasayan!)
- Allow MCP server refreshing, fix state changes in MCP server management UI view (thanks @taylorwilsdon!)
- Remove unnecessary npx usage in some npm scripts (thanks @user202729!)
- Bug fix for trailing slash error when using LiteLLM provider (thanks @kcwhite!)
- Fix Gemini 2.5 Pro Preview thinking budget bug
- Add Gemini Pro 06-05 model support (thanks @daniel-lxs and @shariqriazz!)
- Fix reading PDF, DOCX, and IPYNB files in read_file tool (thanks @samhvw8!)
- Fix Mermaid CSP errors with enhanced bundling strategy (thanks @KJ7LNW!)
- Improve model info detection for custom Bedrock ARNs (thanks @adamhill!)
- Add OpenAI Compatible embedder for codebase indexing (thanks @SannidhyaSah!)
- Fix multiple memory leaks in ChatView component (thanks @kiwina!)
- Fix WorkspaceTracker resource leaks by disposing FileSystemWatcher (thanks @kiwina!)
- Fix RooTips setTimeout cleanup to prevent state updates on unmounted components (thanks @kiwina!)
- Fix FileSystemWatcher leak in RooIgnoreController (thanks @kiwina!)
- Fix clipboard memory leak by clearing setTimeout in useCopyToClipboard (thanks @kiwina!)
- Fix ClineProvider instance cleanup (thanks @xyOz-dev!)
- Enforce codebase_search as primary tool for code understanding tasks (thanks @hannesrudolph!)
- Improve Docker setup for evals
- Move evals into pnpm workspace, switch from SQLite to Postgres
- Refactor MCP to use getDefaultEnvironment for stdio client transport (thanks @samhvw8!)
- Get rid of "partial" component in names referencing not necessarily partial messages (thanks @wkordalski!)
- Improve feature request template (thanks @elianiva!)
