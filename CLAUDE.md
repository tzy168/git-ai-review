# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

VS Code extension (`ai-git-branch-diff-review`) that diffs two Git branches and sends the diff to DeepSeek API to generate a structured Markdown code review report or tech-spec document. Built with TypeScript + VS Code Extension API + `simple-git` + LangChain (`@langchain/core` + `@langchain/deepseek`).

**Before writing any code, read `CODE_WIKI.md`** — it is the authoritative reference for architecture, module responsibilities, data structures, error handling, and extension points.

## Commands

```bash
npm run compile   # tsc -p ./ (required before F5 or package)
npm run watch     # tsc -watch for development
npm run lint      # eslint src --ext ts
npm run package   # vsce package → .vsix
```

Press **F5** in VS Code to launch the Extension Development Host for manual testing. There is no automated test suite.

## Architecture

Five top-level source files in `src/`, plus a four-file LLM sub-layer in `src/llm/`:

| File | Role |
|------|------|
| `extension.ts` | Entry point: registers two commands (`start`, `openSettings`), orchestrates the 8-step review flow |
| `gitService.ts` | All Git operations via `simple-git` — branches, diffs, `merge-base` |
| `llmService.ts` | Reads VS Code config, holds `BaseChatModel`, and is a **facade** that delegates to `runReviewPipeline()` then maps errors to user-friendly messages |
| `prompts.ts` | `ChatPromptTemplate` definitions for 4 prompt types (review / tech-spec × single / merge) |
| `reportGenerator.ts` | Writes Markdown output and opens it in the editor |
| `llm/modelFactory.ts` | **Multi-provider extension point**: the only place that instantiates a concrete model (`ChatDeepSeek`); everything else depends on `BaseChatModel` |
| `llm/chunker.ts` | Batches `FileDiff[]` into chunks ≤ `maxCharsPerChunk`; truncates oversized single files |
| `llm/chains.ts` | Builds 4 LCEL chains: variable mapper → `ChatPromptTemplate` → model → `StringOutputParser` |
| `llm/reviewPipeline.ts` | **Orchestration core**: small diff → single chain invoke; large diff → `chunkFiles()` → concurrent pool (max 3 workers) → merge chain |

### Data flow

`extension.ts` → `GitService.getDiff()` → `LLMService.generate()` → `runReviewPipeline()` (which uses `chunker.ts` + `chains.ts` + `prompts.ts`) → `ReportGenerator.generate()`

### Key types

- `DiffResult { baseBranch, headBranch, fileDiffs: FileDiff[], totalAdditions, totalDeletions }`
- `FileDiff { filePath, additions, deletions, diff }`
- `LLMConfig { apiKey, baseUrl, model, language, maxCharsPerChunk }`
- `DocumentType = "review" | "tech-spec"`

### Diff chunking strategy

When total diff exceeds `maxCharsPerChunk` (default 50K), files are batched into chunks that fit within the limit. Oversized single files are truncated with a marker. Each chunk gets its own LLM call via a concurrency-limited pool (DEFAULT_CONCURRENCY = 3), then a merge prompt combines them into one report.

### Error handling

`LLMService.generate()` maps errors: 401 → API key invalid, 429 → rate limit, ECONNREFUSED/ENOTFOUND → connection failure, "LLM 返回空内容" → passed through, everything else → wrapped with the original message.

## Commit style

Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`. Keep subjects short and imperative.

## Important constraints

- Never commit API keys (`git-ai-review.deepseekApiKey`)
- The `.vsix` file in the repo root is a build artifact — don't modify it directly
- VS Code extension — runs inside the Extension Host, not as a standalone Node process
- `simple-git` is the only interface to Git; don't shell out to git CLI
- To switch LLM providers, only modify `src/llm/modelFactory.ts` — the rest of the codebase depends solely on `BaseChatModel`
- `package-lock.json` and `pnpm-lock.yaml` coexist; the team should standardize on one to avoid dependency drift
