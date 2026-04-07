# SysInt: Cross-Platform System Intelligence Tools

## What This Is

HakanMCP icindeki 245 NirSoft aracinin hafif, hizli, cross-platform (Windows + Linux) CLI versiyonlari. Her tool JSON output uretir, GUI bagimliligi yoktur ve AI agent'lar tarafindan MCP uzerinden kullanilabilir. NirSoft binary'lerine bagimli olmayan, tamamen native TypeScript implementasyonlari.

## Core Value

AI agent'larin herhangi bir platformda (Windows, WSL, Linux) sistem bilgisine programatik olarak erisebilmesi — GUI veya platform kisitlamasi olmadan.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] 245 NirSoft aracinin cross-platform CLI karsiliklari
- [ ] Her tool JSON output destekli
- [ ] Windows ve Linux'ta calisma
- [ ] NirSoft dokumantasyonuyla uyumlu islevsellik
- [ ] HakanMCP MCP server'a entegrasyon
- [ ] Iyilestirme noktalarinin tespiti ve uygulanmasi

### Out of Scope

- GUI arayuzu — sadece CLI/JSON, AI agent'lar icin
- NirSoft binary'lerinin wrapping'i — tamamen native implementasyon
- Mobile platform destegi — Windows + Linux yeterli
- Real-time monitoring dashboard — tool'lar tek seferlik calisir

## Context

- HakanMCP zaten 245 NirSoft aracini binary wrapper olarak entegre etmis durumda (catalog.json, lazy-loading)
- 226 tool CLI destekliyor, 19 password araci free versiyonda CLI export kapali
- Bazi tool'lar sessizce basarisiz oluyor (browsinghistoryview, lastactivityview, loadeddllsview)
- NirSoft araclari Windows-only, GUI-only — Linux'ta hicbiri calismiyor
- Mevcut entegrasyon: `src/tools/nirsoft.ts`, `src/services/nirsoft/`, `data/nirsoft/catalog.json`
- TypeScript + Node.js stack, Zod validation, lazy-loading pattern

## Constraints

- **Platform**: Windows + WSL + Linux. macOS nice-to-have ama zorunlu degil
- **Runtime**: Node.js (HakanMCP stack)
- **Integration**: HakanMCP MCP tool olarak register olmali
- **Output**: JSON default, CSV/raw opsiyonel
- **Dependencies**: Zero external binary dependency
- **Compatibility**: Mevcut NirSoft catalog yapisiyla uyumlu tool ID'ler

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Native TypeScript vs binary wrapper | Binary'ler Windows-only, CLI export kisitli, AI agent'lar icin uygunsuz | — Pending |
| Kategori bazli faz yapisi | 10 kategori, her biri bagimsiz gelistirilebilir | — Pending |
| NirSoft API uyumlulugu | Mevcut catalog.json tool ID'leri korunacak | — Pending |

---
*Last updated: 2026-04-07 after initialization*
