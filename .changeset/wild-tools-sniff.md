---
"kilo-code": minor
---

Include changes from Roo Code v3.22.6

- Add timer-based auto approve for follow up questions (thanks @liwilliam2021!)
- Add import/export modes functionality
- Add persistent version indicator on chat screen
- Add automatic configuration import on extension startup (thanks @takakoutso!)
- Add user-configurable search score threshold slider for semantic search (thanks @hannesrudolph!)
- Add default headers and testing for litellm fetcher (thanks @andrewshu2000!)
- Fix consistent cancellation error messages for thinking vs streaming phases
- Fix AWS Bedrock cross-region inference profile mapping (thanks @KevinZhao!)
- Fix URL loading timeout issues in @ mentions (thanks @MuriloFP!)
- Fix API retry exponential backoff capped at 10 minutes (thanks @MuriloFP!)
- Fix Qdrant URL field auto-filling with default value (thanks @SannidhyaSah!)
- Fix profile context condensation threshold (thanks @PaperBoardOfficial!)
- Fix apply_diff tool documentation for multi-file capabilities
- Fix cache files excluded from rules compilation (thanks @MuriloFP!)
- Add streamlined extension installation and documentation (thanks @devxpain!)
- Prevent Architect mode from providing time estimates
- Remove context size from environment details
- Change default mode to architect for new installations
- Suppress Mermaid error rendering
- Improve Mermaid buttons with light background in light mode (thanks @chrarnoldus!)
- Add .vscode/ to write-protected files/directories
- Update AWS Bedrock cross-region inference profile mapping (thanks @KevinZhao!)
