# Parallel Documentation Sync — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Synchronize documentation structure, interactivity, and completeness across HakanMCP and claude-code-dotfiles.

**Architecture:** Two independent project repos get their markdown files restructured to a shared template standard. New files fill gaps. Existing files get TOC, badges, collapsible sections, mermaid diagrams, and cross-references.

**Tech Stack:** Markdown, Mermaid, GitHub-flavored Markdown extensions

---

## Execution Strategy

Tasks 1-2 are independent (parallel). Tasks 3-4 are independent (parallel). Tasks 5-6 are independent (parallel). Task 7 depends on all. Task 8 is cleanup.

```
Wave 1: [Task 1: HakanMCP SETUP.md] + [Task 2: Dotfiles CONTRIBUTING.md]
Wave 2: [Task 3: HakanMCP README.md] + [Task 4: Dotfiles README.md]
Wave 3: [Task 5: HakanMCP SECURITY.md] + [Task 6: Dotfiles SECURITY.md]
Wave 4: [Task 7: HakanMCP CONTRIBUTING.md refresh]
Wave 5: [Task 8: HakanMCP memory.db cleanup]
```

---

### Task 1: Create HakanMCP SETUP.md

**Files:**
- Create: `C:\dev\HakanMCP\SETUP.md`
- Reference: `C:\dev\HakanMCP\.env.example`, `C:\dev\HakanMCP\package.json`

**Content Structure:**
```markdown
# Setup Guide

> Complete guide to get HakanMCP running locally.
> For quick overview, see [README](README.md). For contributing, see [CONTRIBUTING](CONTRIBUTING.md).

## Table of Contents
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Verification](#verification)
- [IDE Integration](#ide-integration)
- [Troubleshooting](#troubleshooting)
```

**Step 1: Write SETUP.md with full content**

Include these sections with real data:

1. **Requirements table** — Node.js >= 20, npm >= 10, Git >= 2.x, TypeScript (auto), PostgreSQL (optional), MongoDB (optional), Python (optional). Add collapsible "Optional dependencies explained" with lazy-loading explanation and affected tools list.

2. **Installation** — Three collapsible OS sections (Windows PowerShell, macOS/Linux, Docker if applicable). Each with: clone, npm install, env setup. Include `> **Warning:**` admonition about never committing .env.

3. **Configuration** — Mermaid flowchart: `.env → config.yaml (auto-generated) → Zod validation → MCP Server Ready / Validation Error`. Collapsible .env variable reference table (pull ALL variables from .env.example with descriptions: GITHUB_TOKEN, AI keys, DB config, paths, dev options).

4. **Verification** — `npm run check:quick` command with expected output block. Manual checklist: `npm run check:quick` passes, `npm start` runs, `hakanmcp --version` correct, `hakanmcp tools` lists tools, MCP client connects.

5. **IDE Integration** — Collapsible sections for: Claude Code (recommended, show ~/.claude.json mcpServers config), VS Code + Continue, Cursor. Each with exact JSON config snippet.

6. **Troubleshooting table** — Minimum 8 entries:
   - better-sqlite3 build fails → C++ toolchain / skip optional
   - ECONNREFUSED on db → Start database service
   - Port in use → Change PORT in .env
   - MODULE_NOT_FOUND pg → npm install pg
   - Config validation error → Check .env vs .env.example
   - Permission denied Linux → Use nvm
   - TypeScript build errors → npm run build clean
   - MCP connection timeout → Check firewall/port

   Add collapsible "Still stuck?" with: check logs/, DEBUG=* mode, open issue with diagnostics.

**Step 2: Add cross-reference link in README.md**

In HakanMCP README.md, find the Contributing/Getting Started section and add link: `→ For detailed setup, see [SETUP.md](SETUP.md)`

**Step 3: Verify**

- Confirm all anchor links in TOC resolve
- Confirm mermaid diagram renders (valid syntax)
- Confirm .env.example variables match the table

---

### Task 2: Create Dotfiles CONTRIBUTING.md

**Files:**
- Create: `C:\dev\claude-code-dotfiles\CONTRIBUTING.md`
- Reference: `C:\dev\claude-code-dotfiles\CLAUDE.md` (project-level), `C:\dev\claude-code-dotfiles\config\CLAUDE.md` (global)

**Content Structure:**
```markdown
# Contributing to claude-code-dotfiles

> Thank you for contributing! This guide covers everything you need.
> For setup, see [SETUP](SETUP.md). For security, see [SECURITY](SECURITY.md).

## Table of Contents
(10 sections as defined in design doc)
```

**Step 1: Write CONTRIBUTING.md with full content**

1. **Prerequisites table** — Node.js >= 18, Python >= 3.8, Git >= 2.x, Claude Code CLI (latest), jq (any). Each with `Check Command` column.

2. **Development Setup** — Fork & clone commands (using `gh repo fork`). Feature branch creation. Mermaid flowchart of install flow: `install.ps1/install.sh → Copy config/ → ~/.claude/ → Replace username → Install npm deps → Clone HakanMCP → Install plugins → Verify`. Admonition: "Changes in `config/` become `~/.claude/` on install."

3. **Project Structure Guide** — Collapsible "Where to put what" table:
   - Slash command → `config/commands/your-command.md`
   - GSD command → `config/commands/gsd/your-command.md`
   - Hook → `config/hooks/your-hook.js`
   - Agent → `config/agents/your-agent.md`
   - Global Claude rules → `config/CLAUDE.md`
   - Skill → `config/skills/your-skill/`
   - Reference docs → `config/docs/your-doc.md`
   - MCP server config → `home-config/.claude.json`

4. **Making Changes** — Subsections per file type:
   - Commands (Markdown): one file per command, include description/params/examples
   - Hooks (JavaScript): vanilla JS only, no transpilation, must handle errors gracefully, CommonJS for .cjs / ESM for .js
   - Agents (Markdown): role, tools, constraints, output format. Include collapsible agent template.
   - Skills: directory-based, include skill.md entry point

5. **Commit Convention** — Table with 6 prefixes: feat, fix, docs, chore, refactor, release. Note: release commits MUST include `vX.Y.Z`.

6. **Pull Request Flow** — Mermaid flowchart: Fork → Branch → Changes → Test → Commit → Push → PR → Review → Squash Merge. PR Checklist with 6 items.

7. **Code Style table** — Per file type: Hooks (vanilla JS), Commands (markdown), Agents (markdown), GSD runtime (CommonJS), Config (JSON, no trailing commas).

8. **Testing** — Note: no automated test suite (config distribution). Manual test flow: run installer to temp dir, verify hooks, test specific command, check path replacement (grep for "Hakan").

9. **Release Process** — Maintainers only. 6 steps: VERSION file → CHANGELOG.md → README.md badge → commit `release: vX.Y.Z` → push + tag → GitHub Actions auto-release.

**Step 2: Add cross-reference in README.md**

In Dotfiles README.md, add Contributing section with link to CONTRIBUTING.md.

**Step 3: Verify**

- All TOC anchors resolve
- Mermaid diagrams valid
- "Where to put what" paths match actual repo structure

---

### Task 3: Restructure HakanMCP README.md

**Files:**
- Modify: `C:\dev\HakanMCP\README.md`

**Step 1: Restructure to standard template**

Keep ALL existing content but reorganize to this order:

1. **Badges** — Standardize: version (from VERSION file), license (MIT), Node (>=20), platform (win|mac|linux), tools count (199). Use shields.io format.

2. **Project name + tagline** — `# HakanMCP` + one-line: "Comprehensive MCP server with 199 tools for AI-powered development workflows."

3. **Highlights** — Extract top 5 from existing features list. Short bullet points, no emoji.

4. **Quick Start** — Keep existing but wrap in cleaner code block. Add `→ For detailed setup, see [SETUP.md](SETUP.md)`.

5. **Features** — Convert existing feature list to collapsible grouped sections:
   - `<details><summary>AI & Language Models (X tools)</summary>` ... `</details>`
   - `<details><summary>Database Management (X tools)</summary>` ... `</details>`
   - `<details><summary>DevOps & System (X tools)</summary>` ... `</details>`
   - `<details><summary>File & Data Processing (X tools)</summary>` ... `</details>`
   - etc. (group by existing tool categories)

6. **Architecture** — Keep existing mermaid diagram. Add collapsible "Operating Modes" section (move Watch/Scheduled/Assistant/Reactive here).

7. **Project Structure** — Keep existing tree, wrap in collapsible section.

8. **Documentation** — Link table:
   | Document | Description |
   |----------|-------------|
   | [SETUP.md](SETUP.md) | Installation & configuration guide |
   | [CONTRIBUTING.md](CONTRIBUTING.md) | Development workflow & code style |
   | [SECURITY.md](SECURITY.md) | Vulnerability reporting & security policy |
   | [CHANGELOG.md](CHANGELOG.md) | Version history |
   | [docs/](docs/) | API reference, guides, architecture |

9. **Contributing** — Short paragraph + link to CONTRIBUTING.md

10. **License** — MIT, keep existing.

**Step 2: Add TOC after badges**

Anchor-linked table of contents with all H2 sections.

**Step 3: Verify**

- All links resolve
- No content lost from original
- Mermaid diagram intact
- Badge URLs valid

---

### Task 4: Restructure Dotfiles README.md

**Files:**
- Modify: `C:\dev\claude-code-dotfiles\README.md`

**Step 1: Restructure to standard template**

Keep ALL existing content but reorganize:

1. **Badges** — Standardize: version (1.9.3), license (MIT), platform (win|mac|linux), Claude Code (required).

2. **Project name + tagline** — `# claude-code-dotfiles` + one-line: "Production-ready Claude Code configuration with GSD workflow, multi-agent coordination, and 200+ MCP tools."

3. **Highlights** — Top 5: GSD workflow, multi-agent, 200+ MCP tools via HakanMCP, safety system (3 layers), auto-update.

4. **Quick Start** — Keep existing PowerShell/Bash one-liners. Add `→ For detailed setup, see [SETUP.md](SETUP.md)`.

5. **What's Included** — Keep existing but convert to collapsible grouped sections:
   - `<details><summary>Hooks & Safety (X items)</summary>` ... `</details>`
   - `<details><summary>GSD Commands (34 commands)</summary>` ... `</details>`
   - `<details><summary>Agents (12 specialized)</summary>` ... `</details>`
   - `<details><summary>Skills (DevOps, Security, UI/UX)</summary>` ... `</details>`

6. **Project Structure** — Keep existing tree, wrap in collapsible.

7. **Safety System** — Keep existing 3-layer explanation, add mermaid diagram of hook execution flow.

8. **Documentation** — Link table:
   | Document | Description |
   |----------|-------------|
   | [SETUP.md](SETUP.md) | Installation & configuration |
   | [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |
   | [SECURITY.md](SECURITY.md) | Security policy |
   | [CHANGELOG.md](CHANGELOG.md) | Version history |

9. **Troubleshooting** — Keep existing table, ensure collapsible for long entries.

10. **Contributing** — Short paragraph + link to CONTRIBUTING.md.

11. **License** — MIT.

**Step 2: Add TOC after badges**

**Step 3: Verify** — Same as Task 3.

---

### Task 5: Enrich HakanMCP SECURITY.md

**Files:**
- Modify: `C:\dev\HakanMCP\SECURITY.md`

**Step 1: Expand to standard template**

Keep existing content, add:

1. **TOC** at top

2. **Supported Versions** — Keep existing table, ensure it's current (1.0.x ✅, <1.0 ❌)

3. **Reporting a Vulnerability** — Keep existing email + what to include. Make response timeline a proper table:
   | Stage | Timeline | Description |
   |-------|----------|-------------|
   | Acknowledgment | 48 hours | Confirm receipt |
   | Assessment | 5 business days | Evaluate severity |
   | Fix (Critical) | 7 days | Patch + release |
   | Fix (Non-critical) | Next release | Included in regular cycle |
   | Disclosure | After fix | Coordinated disclosure |

4. **Security Architecture** — NEW section. Collapsible. Describe:
   - Zod validation on all inputs
   - Path traversal prevention
   - Command injection protection
   - No hardcoded secrets (env vars only)
   - ESM module isolation
   - Lazy-loaded optional dependencies (reduced attack surface)

5. **Best Practices** — Keep existing 5 items, format as checklist:
   - [ ] Keep dependencies updated
   - [ ] Use environment variables for secrets
   - [ ] Enable input validation
   - [ ] Review logs regularly
   - [ ] Follow principle of least privilege

6. **Dependency Security** — NEW collapsible section. Note about optional deps, `npm audit`, update cadence.

**Step 2: Verify** — TOC anchors, table formatting.

---

### Task 6: Standardize Dotfiles SECURITY.md

**Files:**
- Modify: `C:\dev\claude-code-dotfiles\SECURITY.md`

**Step 1: Minimal restructure**

This file is already detailed (98 lines). Changes:

1. **Add TOC** at top
2. **Ensure section order** matches standard: Supported Versions → Reporting → Response Timeline → Best Practices
3. **Add response timeline table** if not present (format same as Task 5)
4. **Wrap long sections** (hooks security matrix, install script analysis) in collapsible `<details>`

**Step 2: Verify** — TOC anchors, collapsible sections render.

---

### Task 7: Refresh HakanMCP CONTRIBUTING.md

**Files:**
- Modify: `C:\dev\HakanMCP\CONTRIBUTING.md`

**Step 1: Enrich to standard template**

Existing file is 117 lines. Add:

1. **TOC** at top
2. **Prerequisites table** (tool, version, check command) — currently missing
3. **Development Setup mermaid** — flowchart of clone → install → build → test → develop cycle
4. **Collapsible "Where to put what" table** — map intent to directory (tools → src/tools/, services → src/services/, etc.)
5. **Wrap Code Style section** in collapsible with more detail (TypeScript patterns, Zod examples)
6. **Add Testing section** — `npm test`, `npm run check:quick`, smoke test explanation
7. **Add Release Process** (maintainers only) — VERSION + CHANGELOG + package.json + tag

Keep existing content (commit convention, PR process, code of conduct) — just restructure into standard order.

**Step 2: Verify** — TOC, mermaid, all links.

---

### Task 8: HakanMCP memory.db Cleanup

**Files:**
- Remove from tracking: `v2/docs/reasoningbank/models/domain-expert/memory.db`
- Modify: `C:\dev\HakanMCP\.gitignore`

**Step 1: Verify .gitignore already has *.db pattern**

Check if `*.db` is already in .gitignore (it likely is based on audit).

**Step 2: Remove from tracking**

```bash
cd /c/dev/HakanMCP
git rm --cached v2/docs/reasoningbank/models/domain-expert/memory.db
```

**Step 3: Verify**

```bash
git status  # should show deleted from index
git ls-files | grep memory.db  # should return nothing
```

> **Note:** This task only removes from tracking. Commit is user-initiated per Git Rule.

---

## Summary

| Wave | Tasks | Projects | Type |
|------|-------|----------|------|
| 1 | Task 1 + Task 2 | HakanMCP + Dotfiles | Create new files |
| 2 | Task 3 + Task 4 | HakanMCP + Dotfiles | Restructure README |
| 3 | Task 5 + Task 6 | HakanMCP + Dotfiles | Enrich SECURITY |
| 4 | Task 7 | HakanMCP | Refresh CONTRIBUTING |
| 5 | Task 8 | HakanMCP | Cleanup |

**Total files created:** 2 (SETUP.md, CONTRIBUTING.md)
**Total files modified:** 5 (2x README, 2x SECURITY, 1x CONTRIBUTING)
**Total files cleaned:** 1 (memory.db untracked)
