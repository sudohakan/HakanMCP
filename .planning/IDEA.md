# SysInt: Cross-Platform System Intelligence Tools

## What

HakanMCP icindeki 245 NirSoft aracinin hafif, hizli, cross-platform (Windows + Linux) CLI versiyonlarini yazacagiz. Her bir tool icin:

1. NirSoft sitesinden (nirsoft.net) orijinal aracin dokumantasyonunu inceleyecegiz
2. Ayni islevi CLI-only, JSON-output, zero-GUI-dependency olarak yeniden yazacagiz
3. Iyilestirilebilir noktalar tespit edilecek ve uygulanacak
4. Her tool stdin/stdout tabanli, AI agent'lar tarafindan kullanilabilir olacak

## Why

- NirSoft araclari GUI-only, Windows-only
- Password araclari CLI export'u free versiyonda kapali
- AI agent'lar GUI kullanamaz — CLI/JSON arayuzu gerek
- Linux sunucularda hicbir NirSoft araci calismiyor
- Mevcut NirSoft entegrasyonu 245 aracindan sadece 226'si CLI destekliyor, onlarin da bir kismi sessizce basarisiz oluyor

## Scope

245 arac, 10 kategori:

| Category | Count | Examples |
|----------|-------|---------|
| network | 63 | Port scanner, DNS, Wi-Fi, ping, traceroute, HTTP sniffer |
| system | 74 | Event log, drivers, BSOD, USB, startup, task scheduler |
| browser | 24 | History, cache, cookies, extensions, downloads, autofill |
| password | 21 | Browser passwords, Wi-Fi keys, mail passwords, credentials |
| disk | 17 | SMART, file search, drive letters, NTFS, ADS |
| programmer | 15 | DLL export, resources, hash, debug |
| process | 11 | Process list, threads, loaded DLLs, handles |
| registry | 10 | Registry search, change monitor, offline registry |
| outlook | 6 | Attachments, stats, address book |
| audio | 4 | Volume control, app audio config |

## Technical Approach

- TypeScript/Node.js native modules (HakanMCP icinde)
- Platform-specific adapters: Windows API (child_process + PowerShell), Linux (/proc, /sys, native commands)
- Ortak arayuz: her tool ayni input/output contract'i kullanir
- JSON output default, CSV/raw opsiyonel
- NirSoft binary'lerine bagimliliksiz — tamamen native implementasyon

## Target Users

- AI agent'lar (birincil hedef — MCP uzerinden)
- CLI kullanicilar (ikincil — dogrudan calistirma)
- GUI'ye gerek yok

## Constraints

- Zero external binary dependency (NirSoft exe'leri kullanilmayacak)
- Cross-platform: Windows + WSL + Linux
- HakanMCP MCP server icine entegre
- Her tool bagimsiz calisabilir
- JSON output zorunlu
