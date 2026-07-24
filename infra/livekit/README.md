# Self-hosted LiveKit relay

This directory is a single-node VPS template for Corro's optional voice chat. LiveKit is
the SFU and embedded TURN server; Redis is private loopback-only coordination state. Media
travels directly between browsers and this relay, never through the Corro App Service.

The template pins LiveKit `v1.13.4`. Review upstream release notes and rerun the complete
voice E2E flow before changing that pin.

## Prerequisites

- A Linux VPS with a public IPv4 address and Docker Compose.
- Two DNS names pointing at it: one for signaling (for example `voice.example.org`) and
  one whose certificate is presented by embedded TURN (for example `turn.example.org`).
- Trusted TLS certificates. Self-signed certificates do not work in browsers.
- An HTTPS reverse proxy for the signaling name, forwarding WebSocket/HTTP traffic to
  `127.0.0.1:7880`.

The host/cloud firewall must allow:

| Protocol | Port | Purpose |
| --- | ---: | --- |
| TCP | 443 | HTTPS/WSS reverse proxy for signaling |
| TCP | 7881 | WebRTC ICE/TCP fallback |
| UDP | 443 | Embedded TURN/UDP |
| TCP | 5349 | Embedded TURN/TLS on a single-IP host |
| UDP | 50000–60000 | WebRTC ICE media |

Do **not** expose Redis `6379`. Do not expose LiveKit `7880` directly; only the local
reverse proxy should reach it. For the broadest corporate-firewall compatibility, give
TURN a separate public IP (or a suitable layer-4 SNI proxy) and use TURN/TLS on TCP 443.

## Configure and start

1. Copy `livekit.yaml.example` to `livekit.yaml` on the VPS. The destination is gitignored.
2. Generate independent credentials. A practical starting point is a random API key of at
   least 16 bytes and a random secret of at least 32 bytes.
3. Replace `REPLACE_WITH_API_KEY`, `REPLACE_WITH_API_SECRET`, and
   `REPLACE_WITH_TURN_DOMAIN`. Restrict the file to the operator account.
4. Put the TURN domain certificate at `certs/fullchain.pem` and private key at
   `certs/privkey.pem`. The directory is gitignored. Restrict the private key.
5. Validate and start from this directory:

   ```text
   docker compose config
   docker compose pull
   docker compose up -d
   docker compose logs --tail=100 livekit
   ```

The Compose services use host networking because LiveKit recommends it for WebRTC
performance and correct candidate advertisement. `use_external_ip` discovers the VPS
address with STUN; if that is wrong for the host, replace it with the explicit `rtc.node_ip`
setting documented by LiveKit.

An nginx signaling proxy is typically equivalent to:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 443 ssl http2;
    server_name voice.example.org;

    ssl_certificate /etc/letsencrypt/live/voice.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/voice.example.org/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:7880;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600;
    }
}
```

Certificate renewal must copy/update the mounted TURN certificate and restart the
`livekit` service. Automate that with the certificate manager's deploy hook; never copy
private keys into this repository.

## Connect Corro

Configure these server-side settings on the Corro deployment:

| Setting | Example | Exposure |
| --- | --- | --- |
| `LiveKit__Url` | `wss://voice.example.org` | Returned only with a join token |
| `LiveKit__ApiUrl` | `https://voice.example.org` | Server only; optional when derivable from `Url` |
| `LiveKit__ApiKey` | generated API key | Server only |
| `LiveKit__ApiSecret` | generated API secret | Secret; server only |
| `LiveKit__TokenLifetimeMinutes` | `5` | Server only; valid range 1–60 |

Use the same key pair as `livekit.yaml`. Store the secret in the hosting platform's secret
store (an Azure Key Vault reference for App Service), not in source, a GitHub variable,
logs, or client configuration. Restart Corro after changing the settings. The public
`/api/config/voice` endpoint reveals one availability boolean and no URL or credential.

## Operational checks

- Join from two unrelated networks, not only two tabs on the same LAN.
- Verify direct UDP, ICE/TCP, TURN/UDP and TURN/TLS paths where possible.
- Watch VPS CPU, outbound bandwidth, packet loss, certificate expiry and disk use.
- Keep text chat available: relay failure must degrade to a game without voice.
- Back up configuration/credential material securely. Redis media-room state is disposable;
  audio is neither persisted nor recorded by Corro.