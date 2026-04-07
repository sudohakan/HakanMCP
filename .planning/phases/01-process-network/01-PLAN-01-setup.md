---
plan: "01"
wave: 0
depends_on: []
files_modified:
  - package.json
  - data/sysint/catalog.json
  - src/services/sysint/__tests__/fixtures/netstat-windows.txt
  - src/services/sysint/__tests__/fixtures/netstat-linux-tcp.txt
  - src/services/sysint/__tests__/fixtures/si-processes.json
  - src/services/sysint/__tests__/fixtures/si-interfaces.json
  - src/services/sysint/__tests__/fixtures/ping-windows.txt
  - src/services/sysint/__tests__/fixtures/ping-linux.txt
  - src/services/sysint/__tests__/fixtures/netsh-wifi-networks.txt
  - src/services/sysint/__tests__/fixtures/nmcli-wifi.txt
  - src/services/sysint/__tests__/fixtures/netsh-wifi-profiles.txt
  - src/services/sysint/__tests__/fixtures/route-windows.txt
  - src/services/sysint/__tests__/fixtures/route-linux.txt
  - src/services/sysint/__tests__/fixtures/arp-windows.txt
  - src/services/sysint/__tests__/fixtures/arp-linux.txt
  - src/services/sysint/__tests__/fixtures/get-service-windows.txt
  - src/services/sysint/__tests__/fixtures/systemctl-services-linux.txt
autonomous: true
requirements:
  - PRC-01
  - PRC-02
  - PRC-03
  - PRC-04
  - PRC-05
  - PRC-06
  - PRC-07
  - PRC-08
  - NET-01
  - NET-02
  - NET-03
  - NET-04
  - NET-05
  - NET-06
  - NET-07
  - NET-08
  - NET-09
  - NET-10
  - NET-11
  - NET-12
  - NET-13
  - NET-14
  - NET-15
  - NET-16
  - NET-17
  - NET-18
  - NET-19
  - NET-20
---

# Plan 01: Setup — Dependencies, Catalog Entries, Test Fixtures

**Goal:** All 28 Phase 1 tools registered in catalog; systeminformation installed; test fixtures written for command-output parsing.

**Wave 0** — runs before all implementation plans.

---

## Context

- `systeminformation` is NOT in package.json — must be added before Plans 02-05 can import it
- catalog.json needs 28 new tool entries with `"native": true`
- Test fixtures are sample command outputs captured from real systems — needed for all unit tests
- Plans 02-05 depend on this plan being complete

---

## Tasks

<task id="1-01-01" title="Install systeminformation dependency">

**What:** Add `systeminformation` to package.json and install.

**How:**
```bash
cd /mnt/c/dev/HakanMCP
npm install systeminformation
```

Verify TypeScript types are available (included in systeminformation package).

**Verify:**
```bash
node -e "const si = require('systeminformation'); console.log(typeof si.processes)"
# Expected: function
```

<automated>npx tsc --noEmit 2>&1 | head -20</automated>

</task>

<task id="1-01-02" title="Add 28 Phase 1 catalog entries to data/sysint/catalog.json">

**What:** Add catalog entries for all PRC-* and NET-* tools with `"native": true`.

**Process tools (category: "process"):**
```json
{ "id": "process-list", "name": "Process List", "description": "Lists all running processes with PID, name, CPU%, memory, user, and command line", "category": "process", "adminRequired": false, "timeout": 30, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "process-connections", "name": "Process Connections", "description": "Maps each process PID to its open TCP/UDP ports", "category": "process", "adminRequired": false, "timeout": 30, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "process-modules", "name": "Process Modules", "description": "Lists loaded DLLs/shared libraries for a given process", "category": "process", "adminRequired": false, "timeout": 30, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "process-threads", "name": "Process Threads", "description": "Lists threads for a given process", "category": "process", "adminRequired": false, "timeout": 30, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "process-handles", "name": "Process Handles", "description": "Lists open file handles/descriptors for a given process", "category": "process", "adminRequired": false, "timeout": 30, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "process-io", "name": "Process IO", "description": "Shows read/write byte counters for a process", "category": "process", "adminRequired": false, "timeout": 30, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "process-tree", "name": "Process Tree", "description": "Returns the full process tree showing parent-child relationships", "category": "process", "adminRequired": false, "timeout": 30, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "service-list", "name": "Service List", "description": "Lists Windows services or Linux systemd units with status", "category": "process", "adminRequired": false, "timeout": 30, "native": true, "platforms": ["win32", "linux", "wsl"] }
```

**Network tools (category: "network"):**
```json
{ "id": "cports", "name": "CurrPorts", "description": "Lists all active TCP/UDP connections with owning process PID and name", "category": "network", "adminRequired": false, "timeout": 30, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "network-interfaces", "name": "Network Interfaces", "description": "Lists all network interfaces with IP, MAC, speed, and status", "category": "network", "adminRequired": false, "timeout": 15, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "dns-lookup", "name": "DNS Lookup", "description": "Resolves DNS records (A, AAAA, MX, TXT, NS, CNAME) for a hostname", "category": "network", "adminRequired": false, "timeout": 15, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "wifi-scan", "name": "Wi-Fi Scanner", "description": "Lists available Wi-Fi networks with SSID, signal, channel, and security type", "category": "network", "adminRequired": false, "timeout": 30, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "wifi-history", "name": "Wi-Fi History", "description": "Lists previously connected Wi-Fi networks", "category": "network", "adminRequired": false, "timeout": 15, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "ping-test", "name": "Ping Test", "description": "Pings one or more hosts in parallel and returns RTT and packet loss", "category": "network", "adminRequired": false, "timeout": 30, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "port-scan", "name": "Port Scanner", "description": "Scans TCP ports on a target host using connect scan", "category": "network", "adminRequired": false, "timeout": 120, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "route-table", "name": "Route Table", "description": "Shows the system routing table", "category": "network", "adminRequired": false, "timeout": 15, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "arp-table", "name": "ARP Table", "description": "Shows the ARP cache (IP to MAC mappings)", "category": "network", "adminRequired": false, "timeout": 15, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "mac-resolve", "name": "MAC Resolver", "description": "Resolves a MAC address to its vendor/manufacturer via OUI lookup", "category": "network", "adminRequired": false, "timeout": 15, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "whois-lookup", "name": "WHOIS Lookup", "description": "Performs a WHOIS query for a domain or IP address", "category": "network", "adminRequired": false, "timeout": 15, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "traceroute", "name": "Traceroute", "description": "Traces the network path to a host, showing each hop with RTT", "category": "network", "adminRequired": false, "timeout": 60, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "http-headers", "name": "HTTP Headers", "description": "Retrieves HTTP response headers for a URL", "category": "network", "adminRequired": false, "timeout": 15, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "network-stats", "name": "Network Statistics", "description": "Shows bytes in/out and packet counters per network interface", "category": "network", "adminRequired": false, "timeout": 15, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "wake-on-lan", "name": "Wake-on-LAN", "description": "Sends a WOL magic packet to wake a remote machine by MAC address", "category": "network", "adminRequired": false, "timeout": 10, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "bandwidth-test", "name": "Bandwidth Test", "description": "Measures download speed by timing an HTTPS download", "category": "network", "adminRequired": false, "timeout": 60, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "connection-log", "name": "Connection Log", "description": "Shows historical network connection log", "category": "network", "adminRequired": false, "timeout": 30, "native": true, "platforms": ["win32", "wsl"] },
{ "id": "ssl-checker", "name": "SSL Certificate Checker", "description": "Checks SSL certificate details for a host (expiry, issuer, subject)", "category": "network", "adminRequired": false, "timeout": 15, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "bluetooth-scan", "name": "Bluetooth Scanner", "description": "Lists paired and nearby Bluetooth devices", "category": "network", "adminRequired": false, "timeout": 30, "native": true, "platforms": ["win32", "linux", "wsl"] },
{ "id": "network-shares", "name": "Network Shares", "description": "Lists SMB/NFS network shares on the local machine", "category": "network", "adminRequired": false, "timeout": 15, "native": true, "platforms": ["win32", "linux", "wsl"] }
```

**Verify:** Run `npx jest catalog` — catalog tests should pass with all new IDs present.

<automated>npx jest --testPathPattern="catalog" --no-coverage 2>&1 | tail -10</automated>

</task>

<task id="1-01-03" title="Create test fixture files">

**What:** Create `src/services/sysint/__tests__/fixtures/` directory with realistic command output samples.

**Files to create (content should be realistic sample output):**

`netstat-windows.txt` — Windows `netstat -ano` output:
```
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       904
  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4
  TCP    127.0.0.1:5354         0.0.0.0:0              LISTENING       4204
  TCP    192.168.1.100:51234    52.96.100.1:443        ESTABLISHED     7892
  UDP    0.0.0.0:5353           *:*                                    4204
  UDP    0.0.0.0:5355           *:*                                    1040
```

`netstat-linux-tcp.txt` — Linux `/proc/net/tcp` format:
```
  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:0035 00000000:0000 0A 00000000:00000000 00:00000000 00000000   101        0 12345 1 0000000000000000 100 0 0 10 0
   1: 0F02000A:D4E6 0101010A:01BB 01 00000000:00000000 02:000A2E0C 00000000  1000        0 23456 4 0000000000000000 20 4 24 10 -1
```

`si-processes.json` — systeminformation processes response:
```json
{"list":[{"pid":1,"name":"systemd","cpu":0.1,"mem":0.2,"user":"root","command":"/sbin/init","params":""},{"pid":1234,"name":"node","cpu":2.5,"mem":1.8,"user":"hakan","command":"node","params":"/mnt/c/dev/HakanMCP/src/index.js"}]}
```

`si-interfaces.json` — systeminformation networkInterfaces response:
```json
[{"iface":"eth0","ip4":"192.168.1.100","ip6":"fe80::1","mac":"00:11:22:33:44:55","speed":1000,"operstate":"up","type":"wired"}]
```

`ping-windows.txt` — Windows ping output:
```
Pinging 8.8.8.8 with 32 bytes of data:
Reply from 8.8.8.8: bytes=32 time=12ms TTL=118
Reply from 8.8.8.8: bytes=32 time=11ms TTL=118
Reply from 8.8.8.8: bytes=32 time=13ms TTL=118

Ping statistics for 8.8.8.8:
    Packets: Sent = 3, Received = 3, Lost = 0 (0% loss),
Approximate round trip times in milli-seconds:
    Minimum = 11ms, Maximum = 13ms, Average = 12ms
```

`ping-linux.txt` — Linux ping output:
```
PING 8.8.8.8 (8.8.8.8) 56(84) bytes of data.
64 bytes from 8.8.8.8: icmp_seq=1 ttl=118 time=12.1 ms
64 bytes from 8.8.8.8: icmp_seq=2 ttl=118 time=11.8 ms
64 bytes from 8.8.8.8: icmp_seq=3 ttl=118 time=13.2 ms

--- 8.8.8.8 ping statistics ---
3 packets transmitted, 3 received, 0% packet loss, time 2003ms
rtt min/avg/max/mdev = 11.800/12.366/13.200/0.589 ms
```

`netsh-wifi-networks.txt` — Windows `netsh wlan show networks mode=bssid`:
```
SSID 1 : HomeNetwork
Network type            : Infrastructure
Authentication          : WPA2-Personal
Encryption              : CCMP 
BSSID 1                 : aa:bb:cc:dd:ee:ff
     Signal             : 85%
     Radio type         : 802.11n
     Channel            : 6
```

`nmcli-wifi.txt` — Linux `nmcli dev wifi list`:
```
IN-USE  BSSID              SSID           MODE   CHAN  RATE        SIGNAL  BARS  SECURITY
        AA:BB:CC:DD:EE:FF  HomeNetwork    Infra  6     130 Mbit/s  85      ▂▄▆█  WPA2
*       11:22:33:44:55:66  WorkWifi       Infra  36    270 Mbit/s  92      ▂▄▆█  WPA2 WPA3
```

`route-windows.txt` — Windows `route print` IPv4 section:
```
IPv4 Route Table
Active Routes:
Network Destination        Netmask          Gateway       Interface  Metric
          0.0.0.0          0.0.0.0      192.168.1.1    192.168.1.100     25
        127.0.0.0        255.0.0.0         On-link         127.0.0.1    331
```

`route-linux.txt` — Linux `ip route` output:
```
default via 192.168.1.1 dev eth0 proto dhcp metric 100
192.168.1.0/24 dev eth0 proto kernel scope link src 192.168.1.100
```

`arp-windows.txt` — Windows `arp -a`:
```
Interface: 192.168.1.100 --- 0x7
  Internet Address      Physical Address      Type
  192.168.1.1           aa-bb-cc-dd-ee-ff     dynamic
  192.168.1.255         ff-ff-ff-ff-ff-ff     static
```

`get-service-windows.txt` — Windows `Get-Service` JSON output (PowerShell):
```json
[{"Name":"Spooler","DisplayName":"Print Spooler","Status":4,"StartType":2},{"Name":"WinRM","DisplayName":"Windows Remote Management","Status":1,"StartType":3}]
```

`systemctl-services-linux.txt` — Linux `systemctl list-units --type=service --output=json`:
```json
[{"unit":"NetworkManager.service","load":"loaded","active":"active","sub":"running","description":"Network Manager"},{"unit":"ssh.service","load":"loaded","active":"active","sub":"running","description":"OpenBSD Secure Shell server"}]
```

<automated>ls src/services/sysint/__tests__/fixtures/ 2>/dev/null | wc -l</automated>

</task>

---

## Verification Criteria

- [ ] `npm install systeminformation` completes without errors
- [ ] `npx tsc --noEmit` passes (no type errors from new dep)
- [ ] `npx jest --testPathPattern="catalog" --no-coverage` passes — all 28 new tool IDs found in catalog
- [ ] All fixture files exist in `src/services/sysint/__tests__/fixtures/`
- [ ] No existing tests broken (full suite still green)

## Must-Haves

For Phase 1 goal "AI agents can query live process state and network activity":
- `systeminformation` must be importable from TypeScript
- All 28 tool IDs must return proper tool definitions via `sysint info <id>`
- Test fixtures must be realistic enough to validate parsers
