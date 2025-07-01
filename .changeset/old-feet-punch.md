---
"kilo-code": minor
---

Include changes from Roo Code v3.22.4

- Fix: resolve E2BIG error by passing large prompts via stdin to Claude CLI (thanks @Fovty!)
- Add optional mode suggestions to follow-up questions
- Restore JSON backwards compatibility for .roomodes files (thanks @daniel-lxs!)
- Fix: eliminate XSS vulnerability in CodeBlock component (thanks @KJ7LNW!)
- Fix terminal keyboard shortcut error when adding content to context (thanks @MuriloFP!)
- Fix checkpoint popover not opening due to StandardTooltip wrapper conflict (thanks @daniel-lxs!)
- Fix(i18n): correct gemini cli error translation paths (thanks @daniel-lxs!)
- Code Index (Qdrant) recreate services when change configurations (thanks @catrielmuller!)
- Fix undefined mcp command (thanks @qdaxb!)
- Use upstream_inference_cost for OpenRouter BYOK cost calculation and show cached token count (thanks @chrarnoldus!)
- Update maxTokens value for qwen/qwen3-32b model on Groq (thanks @KanTakahiro!)
- Standardize tooltip delays to 300ms
- Add support for loading rules from a global .kilocode directory (thanks @samhvw8!)
- Modes selector improvements (thanks @brunobergher!)
- Use safeWriteJson for all JSON file writes to avoid task history corruption (thanks @KJ7LNW!)
- Improve YAML error handling when editing modes
- Add default task names for empty tasks (thanks @daniel-lxs!)
- Improve translation workflow to avoid unnecessary file reads (thanks @KJ7LNW!)
- Allow write_to_file to handle newline-only and empty content (thanks @Githubguy132010!)
- Address multiple memory leaks in CodeBlock component (thanks @kiwina!)
- Memory cleanup (thanks @xyOz-dev!)
- Fix port handling bug in code indexing for HTTPS URLs (thanks @benashby!)
- Improve Bedrock error handling for throttling and streaming contexts
- Handle long Claude code messages (thanks @daniel-lxs!)
- Fixes to Claude Code caching and image upload
- Disable reasoning budget UI controls for Claude Code provider
- Remove temperature parameter for Azure OpenAI reasoning models (thanks @ExactDoug!)
- Add VS Code setting to disable quick fix context actions (thanks @OlegOAndreev!)
