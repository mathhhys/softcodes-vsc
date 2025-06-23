---
"kilo-code": minor
---

Include changes from Roo Code v3.21.1

- Fix tree-sitter issues that were preventing codebase indexing from working correctly
- Improve error handling for codebase search embeddings
- Resolve MCP server execution on Windows with node version managers
- Default 'Enable MCP Server Creation' to false
- Rate limit correctly when starting a subtask (thanks @olweraltuve!)
- Add Gemini 2.5 models (Pro, Flash and Flash Lite) (thanks @daniel-lxs!)
- Add max tokens checkbox option for OpenAI compatible provider (thanks @AlexandruSmirnov!)
- Update provider models and prices for Groq & Mistral (thanks @KanTakahiro!)
- Add proper error handling for API conversation history issues (thanks @KJ7LNW!)
- Fix ambiguous model id error (thanks @elianiva!)
- Fix save/discard/revert flow for Prompt Settings (thanks @hassoncs!)
- Fix codebase indexing alignment with list-files hidden directory filtering (thanks @daniel-lxs!)
- Fix subtask completion mismatch (thanks @feifei325!)
- Fix Windows path normalization in MCP variable injection (thanks @daniel-lxs!)
- Update marketplace branding to 'Roo Marketplace' (thanks @SannidhyaSah!)
- Refactor to more consistent history UI (thanks @elianiva!)
- Adjust context menu positioning to be near Copilot
- Update evals Docker setup to work on Windows (thanks @StevenTCramer!)
- Include current working directory in terminal details
- Encourage use of start_line in multi-file diff to match legacy diff
- Always focus the panel when clicked to ensure menu buttons are visible (thanks @hassoncs!)
