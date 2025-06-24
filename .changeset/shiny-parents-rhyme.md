---
"kilo-code": minor
---

Include changes from Roo Code v3.21.5

- Fix Qdrant URL prefix handling for QdrantClient initialization (thanks @CW-B-W!)
- Improve LM Studio model detection to show all downloaded models (thanks @daniel-lxs!)
- Resolve Claude Code provider JSON parsing and reasoning block display
- Fix start line not working in multiple apply diff (thanks @samhvw8!)
- Resolve diff editor issues with markdown preview associations (thanks @daniel-lxs!)
- Resolve URL port handling bug for HTTPS URLs in Qdrant (thanks @benashby!)
- Mark unused Ollama schema properties as optional (thanks @daniel-lxs!)
- Close the local browser when used as fallback for remote (thanks @markijbema!)
- Add Claude Code provider for local CLI integration (thanks @BarreiroT!)
- Add profile-specific context condensing thresholds (thanks @SannidhyaSah!)
- Fix context length for lmstudio and ollama (thanks @thecolorblue!)
- Resolve MCP tool eye icon state and hide in chat context (thanks @daniel-lxs!)
- Add LaTeX math equation rendering in chat window
- Add toggle for excluding MCP server tools from the prompt (thanks @Rexarrior!)
- Add symlink support to list_files tool
- Fix marketplace blanking after populating
- Fix recursive directory scanning in @ mention "Add Folder" functionality (thanks @village-way!)
- Resolve phantom subtask display on cancel during API retry
- Correct Gemini 2.5 Flash pricing (thanks @daniel-lxs!)
- Resolve marketplace timeout issues and display installed MCPs (thanks @daniel-lxs!)
- Onboarding tweaks to emphasize modes (thanks @brunobergher!)
- Rename 'Boomerang Tasks' to 'Task Orchestration' for clarity
- Remove command execution from attempt_completion
- Fix markdown for links followed by punctuation (thanks @xyOz-dev!)
