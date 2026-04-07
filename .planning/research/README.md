# SysInt Stack Research & Design

Research phase for 245 cross-platform CLI tools replacing NirSoft utilities.

## Documents

| File | Purpose | Audience |
|------|---------|----------|
| **STACK.md** | Complete technical stack research with examples, confidence levels, and 10-phase implementation plan | Architects, tech leads |
| **QUICK_REF.md** | 1-page developer reference: code templates, patterns, checklists, debugging | Implementation team |
| **SUMMARY.txt** | Executive overview: recommendations, timeline, next steps | Project managers, stakeholders |

## Key Findings

**Recommended Stack**: Node.js 20+, TypeScript 5.9, systeminformation 5.31.5, better-sqlite3 11.0

**Architecture**: 10 implementation phases by category; lazy-loading MCP dispatcher; platform adapters for Windows/Linux/WSL

**Timeline**: ~20-30 working days; 180-200 fully implemented tools + 40-50 stubs

**High-Confidence Categories** (90%+): System, Network, Browser, Registry
**Low-Confidence Categories** (30-50%): Outlook, Audio, Password tools

## Status

✓ Research phase: Complete  
△ Next phase: Implementation planning (Phase 1: System metrics)  
→ Use `/gsd:plan-phase` to create detailed Phase 1 roadmap

## Context

- HakanMCP already has 245 NirSoft tools as Windows binary wrappers
- SysInt replaces binary wrappers with native TypeScript implementations
- Enables cross-platform system access (Windows, WSL, Linux) without binaries
- Integrates via existing MCP dispatcher pattern (catalog + lazy-loading)

## Quick Start

1. Read **STACK.md** sections: Recommended Stack, Key Libraries, Platform Adapters
2. Check QUICK_REF.md for code template
3. Implement Phase 1 (System: cpuload, memory, processes) as proof-of-concept
4. Wire into MCP dispatcher
5. Plan Phase 2 (Network) using `/gsd:plan-phase`

---

*Research completed: 2026-04-07*
