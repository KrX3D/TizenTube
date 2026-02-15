# TizenTube TEST

THIS IS ONLY FOR PERSONAL TESTS, ALl IMPROVEMENTS WILL BE LATER ADDED AS PR TO THE MAIN REPO



TizenTube is a TizenBrew module that enhances your favourite streaming websites viewing experience by removing ads and adding support for Sponsorblock.

Looking for an app for Android TVs? Check out [TizenTube Cobalt](https://github.com/reisxd/TizenTubeCobalt). It offers everything TizenTube has for Android TVs. [Download the latest release here](https://github.com/reisxd/TizenTubeCobalt/releases/latest).

[Discord Server Invite](https://discord.gg/m2P7v8Y2qR)

[Telegram Channel](https://t.me/tizentubeofficial)

# How to install

1. Install TizenBrew from [here](https://github.com/reisxd/TizenBrew) and follow the instructions.

2. TizenTube is installed to TizenBrew by default. It should be in the home screen. If not, add `@krx3d/tizentube` as a NPM module in TizenBrew module manager.

# Features

- Ad Blocker
- [SponsorBlock](https://sponsor.ajay.app/) Support
- Picture-in-Picture Mode
- [DeArrow](https://dearrow.ajay.app/) Support
- Customizable Themes (Custom Coloring)
- More to come, if you [request](https://github.com/reisxd/TizenTube/issues/new) it!

## Remote Logging (HTTP + WebSocket)

TizenTube can stream console logs to a receiver on your LAN.

### Settings
In **Developer Options → Remote Logging** configure:
- Enable/Disable
- Transport: `http` or `ws` (one active transport at a time)
- HTTP endpoint (example: `http://192.168.70.124:9000/log`)
- WebSocket endpoint (example: `ws://192.168.70.124:9001`)
- Optional auth token
- Test actions in **Test Console**

### Run a local HTTP receiver (Python)
```python
from http.server import BaseHTTPRequestHandler, HTTPServer

class H(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(n).decode('utf-8', errors='replace')
        print(body)
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

HTTPServer(('0.0.0.0', 9000), H).serve_forever()
```

### Run a local WebSocket receiver (Node.js)
```js
// npm i ws
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 9001 });

wss.on('connection', (ws) => {
  ws.on('message', (msg) => {
    console.log(String(msg));
  });
});

console.log('WS receiver listening on :9001');
```

Make sure TV and PC are on the same LAN and inbound ports are open in your firewall.


### Ports used by this setup
- **8765/TCP**: example HTTP receiver (legacy sample in app defaults)
- **9000/TCP**: HTTP receiver sample in this README
- **9001/TCP**: WebSocket receiver sample in this README

### Windows PowerShell firewall commands
> Run PowerShell as Administrator.

Open inbound rules (Domain + Private):
```powershell
New-NetFirewallRule `
  -DisplayName "Allow TCP 8765 In" `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 8765 `
  -Profile Domain,Private

New-NetFirewallRule `
  -DisplayName "Allow TCP 9000 In" `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 9000 `
  -Profile Domain,Private

New-NetFirewallRule `
  -DisplayName "Allow TCP 9001 In" `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 9001 `
  -Profile Domain,Private
```

Safer LocalSubnet-only variants:
```powershell
New-NetFirewallRule `
  -DisplayName "Allow TCP 8765 In (LocalSubnet)" `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 8765 `
  -Profile Domain,Private `
  -RemoteAddress LocalSubnet

New-NetFirewallRule `
  -DisplayName "Allow TCP 9000 In (LocalSubnet)" `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 9000 `
  -Profile Domain,Private `
  -RemoteAddress LocalSubnet

New-NetFirewallRule `
  -DisplayName "Allow TCP 9001 In (LocalSubnet)" `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 9001 `
  -Profile Domain,Private `
  -RemoteAddress LocalSubnet
```

Verify rule port mapping:
```powershell
Get-NetFirewallRule -DisplayName "Allow TCP 8765 In" | Get-NetFirewallPortFilter
Get-NetFirewallRule -DisplayName "Allow TCP 9000 In" | Get-NetFirewallPortFilter
Get-NetFirewallRule -DisplayName "Allow TCP 9001 In" | Get-NetFirewallPortFilter

Get-NetFirewallRule -DisplayName "Allow TCP 8765 In (LocalSubnet)" | Get-NetFirewallPortFilter
Get-NetFirewallRule -DisplayName "Allow TCP 9000 In (LocalSubnet)" | Get-NetFirewallPortFilter
Get-NetFirewallRule -DisplayName "Allow TCP 9001 In (LocalSubnet)" | Get-NetFirewallPortFilter
```

Test listeners are actually bound:
```powershell
Get-NetTCPConnection -LocalPort 8765 -State Listen
Get-NetTCPConnection -LocalPort 9000 -State Listen
Get-NetTCPConnection -LocalPort 9001 -State Listen
```

Test local TCP reachability:
```powershell
Test-NetConnection -ComputerName 127.0.0.1 -Port 8765
Test-NetConnection -ComputerName 127.0.0.1 -Port 9000
Test-NetConnection -ComputerName 127.0.0.1 -Port 9001
```

Test from another LAN device/PC to your host:
```powershell
Test-NetConnection -ComputerName <YOUR_PC_LAN_IP> -Port 8765
Test-NetConnection -ComputerName <YOUR_PC_LAN_IP> -Port 9000
Test-NetConnection -ComputerName <YOUR_PC_LAN_IP> -Port 9001
```

Close/remove rules later:
```powershell
Remove-NetFirewallRule -DisplayName "Allow TCP 8765 In"
Remove-NetFirewallRule -DisplayName "Allow TCP 9000 In"
Remove-NetFirewallRule -DisplayName "Allow TCP 9001 In"
Remove-NetFirewallRule -DisplayName "Allow TCP 8765 In (LocalSubnet)"
Remove-NetFirewallRule -DisplayName "Allow TCP 9000 In (LocalSubnet)"
Remove-NetFirewallRule -DisplayName "Allow TCP 9001 In (LocalSubnet)"
```
