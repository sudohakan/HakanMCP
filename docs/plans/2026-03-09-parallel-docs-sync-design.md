# Parallel Documentation Sync — Design Document

**Date:** 2026-03-09
**Status:** Approved
**Scope:** HakanMCP + claude-code-dotfiles

## Goal

Establish visual/structural consistency across both projects' markdown documentation and complete missing files, so both repos share the same professional "DNA" while keeping content project-specific.

## Approach

**Option B — Common Template + Gap Completion** (selected over minimal sync and monorepo-level standard)

## Interactivity Standard

Both projects will use these markdown features consistently:

| Feature | Usage |
|---------|-------|
| Table of Contents | Anchor-linked TOC at top of every MD |
| Collapsible sections | `<details><summary>` for long/optional content |
| Mermaid diagrams | Architecture, install flow, PR flow visuals |
| OS-specific code blocks | Collapsible per-OS install instructions |
| Cross-reference links | `→ See [FILE.md](FILE.md)` between docs |
| Checklists | `- [ ]` for verification steps |
| Admonitions | `> **Note:**`, `> **Warning:**` blocks |
| Tables | Requirements, troubleshooting, feature lists |

## File Map

| File | HakanMCP | Dotfiles | Action |
|------|----------|----------|--------|
| README.md | Exists (305 lines) | Exists (260 lines) | Standardize structure, add TOC/badges/mermaid |
| CHANGELOG.md | Exists (259 lines) | Exists (16K) | No change — already Keep a Changelog |
| CONTRIBUTING.md | Exists (116 lines) | **Missing** | Create for Dotfiles |
| SECURITY.md | Exists (50 lines) | Exists (3.8K) | Enrich HakanMCP version |
| SETUP.md | **Missing** | Exists (8.1K) | Create for HakanMCP |
| CLAUDE.md | Exists | Exists | No change — internal config |

## Section Order Standard

### README.md
1. Badges (version, license, platform, node version)
2. Logo / Project name + one-line tagline
3. Highlights (3-5 key points)
4. Quick Start (code block)
5. Features (table or collapsible grouped list)
6. Project Structure (tree, collapsible)
7. Documentation (link table → other MDs)
8. Contributing link → CONTRIBUTING.md
9. License

### CONTRIBUTING.md
1. TOC
2. Prerequisites (table: tool, version, check command)
3. Development Setup (with mermaid flow)
4. Project Structure guide (where to put what)
5. Making Changes (per file type)
6. Commit Convention (Conventional Commits table)
7. Pull Request Flow (mermaid + checklist)
8. Code Style (table per file type)
9. Testing
10. Release Process (maintainers only)

### SECURITY.md
1. Supported Versions (table)
2. Reporting a Vulnerability
3. Response Timeline (table: acknowledge → assess → fix)
4. Security Best Practices (collapsible)

### SETUP.md
1. TOC
2. Requirements (table: tool, version, required/optional, purpose)
3. Installation (OS-specific collapsible sections)
4. Configuration (mermaid flow + collapsible reference)
5. Verification (checklist + expected output)
6. IDE Integration (collapsible per-IDE)
7. Troubleshooting (table: symptom → cause → solution)

## Additional: HakanMCP Cleanup

- Remove `v2/docs/reasoningbank/models/domain-expert/memory.db` from tracking
- Add `*.db` pattern to `.gitignore`

## Non-Goals

- CHANGELOG.md changes (already consistent)
- CLAUDE.md changes (internal project config)
- docs/ subdirectory restructuring (project-specific)
- CI/CD automation for doc linting
