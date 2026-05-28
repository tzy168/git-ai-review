# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

VS Code extension (`ai-git-branch-diff-review`) that diffs two Git branches and sends the diff to DeepSeek API to generate a structured Markdown code review report (or tech-spec document). Built with TypeScript + VS Code Extension API + `simple-git` + `openai` SDK.

**Before writing any code, read `CODE_WIKI.md`** — it is the authoritative reference for architecture, module responsibilities, data structures, and error handling patterns.

## Commands

```bash
npm run compile   # tsc -p ./ (required before F5 or package)
npm run watch     # tsc -watch for development
npm run lint      # eslint src --ext ts
npm run package   # vsce package → .vsix
```

Press **F5** in VS Code to launch the Extension Development Host for manual testing. There is no automated test suite.

## Architecture

Five source files in `src/`, compiled to `out/`:

| File | Role |
|------|------|
| `extension.ts` | Entry point: registers two commands (`start`, `openSettings`), orchestrates the 8-step review flow |
| `gitService.ts` | All Git operations via `simple-git` — branches, diffs, `merge-base` |
| `llmService.ts` | DeepSeek API client (via OpenAI SDK with `baseURL`), diff chunking strategy, multi-chunk merge |
| `prompts.ts` | Prompt templates for review and tech-spec generation (including merge prompts for chunked results) |
| `reportGenerator.ts` | Writes Markdown output and opens it in the editor |

Data flow: `extension.ts` → `GitService.getDiff()` → `LLMService.generate()` (which uses `prompts.ts`) → `ReportGenerator.generate()`

Two document types are supported via the `DocumentType` union: `"review"` (code review) and `"tech-spec"` (frontend tech spec reverse-engineered from the diff). The user picks which one at runtime.

### Diff chunking strategy

When total diff exceeds `maxCharsPerChunk` (default 50K), files are batched into chunks that fit within the limit. Oversized single files are truncated. Each chunk gets its own LLM call, then a merge prompt combines them into one report.

### Key types

- `DiffResult { baseBranch, headBranch, fileDiffs: FileDiff[], totalAdditions, totalDeletions }`
- `FileDiff { filePath, additions, deletions, diff }`
- `LLMConfig { apiKey, baseUrl, model, language, maxCharsPerChunk }`

## Commit style

Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`. Keep subjects short and imperative.

## Important constraints

- Never commit API keys (`git-ai-review.deepseekApiKey`)
- The `.vsix` file in the repo root is a build artifact — don't modify it directly
- VS Code extension — runs inside the Extension Host, not as a standalone Node process
- `simple-git` is the only interface to Git; don't shell out to git CLI
