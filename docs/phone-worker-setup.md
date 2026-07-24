# Phone media worker

Panther's backend runs on a datacenter IP (a free Koyeb box), which YouTube bot-blocks and googlevideo IP-locks. to get around both, a spare Android phone on a residential IP runs a small worker the backend delegates to: `yt-dlp` extraction (`POST /ytdlp`) and googlevideo media relay (`GET /media`). the phone is exposed through a Cloudflare quick-tunnel, and a watchdog publishes the rotating tunnel URL to Turso so the backend can discover it.

this guide turns a fresh phone into that worker. the backend side is already configured — a new phone only needs the **same `YTDLP_REMOTE_SECRET`** and the **same Turso database**.

run one worker phone at a time. all workers publish to a single Turso key (`YTDLP_SERVICE_URL`), so two running at once overwrite each other. treat a second phone as a backup/replacement, not a parallel worker.

## Prerequisites

install from **F-Droid** (not the Play Store — those builds are stale): **Termux**, **Termux:API**, and **Termux:Boot**. open each once so android registers it.

then, in Termux:

```bash
pkg update -y && pkg upgrade -y
pkg install -y nodejs git curl python yt-dlp termux-api
pkg install -y cloudflared || (pkg install -y tur-repo && pkg install -y cloudflared)
```

Node must be ≥ 18 (the worker uses the global `fetch`). verify with `node -v && yt-dlp --version && cloudflared --version`.

## Setup

clone the repo — no `npm install` needed, the worker uses only Node built-ins:

```bash
cd ~ && git clone https://github.com/ejjays/panther.git
```

create `~/panther/web/backend/.env` with the values that match Koyeb (see [`env-variables.md`](env-variables.md)):

```bash
YTDLP_REMOTE_SECRET=<same value as Koyeb>   # required — HMAC secret, byte-identical
TURSO_URL=libsql://<your-db>.turso.io       # required — same DB Koyeb uses
TURSO_AUTH_TOKEN=<your turso token>          # required
COOKIES_URL=<url returning a cookies.txt>    # recommended — avoids yt-dlp bot-blocks
```

without `YTDLP_REMOTE_SECRET` the watchdog won't start; without the Turso vars it can't publish its URL.

add the aliases (same as the primary phone):

```bash
cat >> ~/.bashrc <<'EOF'
alias pantherup='setsid nohup ~/panther/scripts/tunnels/keepalive-ytdlp.sh >> ~/.panther/ytdlp-keepalive.log 2>&1 & echo "starting (give it ~12s)..."'
alias pantherdown='pkill -f keepalive-ytdlp.sh; pkill -f ytdlp-service.cjs; pkill -f "cloudflared tunnel --url http://localhost:5055"; echo stopped'
alias panthercheck='pgrep -f ytdlp-service.cjs >/dev/null && echo "service: UP" || echo "service: DOWN"; pgrep -f "cloudflared tunnel --url http://localhost:5055" >/dev/null && echo "tunnel:  UP" || echo "tunnel:  DOWN"; echo "url: $(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" ~/.panther/ytdlp-cf.log 2>/dev/null | tail -1)"'
alias pantherlog='tail -n 30 -f ~/.panther/ytdlp-keepalive.log'
EOF
source ~/.bashrc
```

set up boot autostart with Termux:Boot:

```bash
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/start-nexstream.sh <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
exec ~/panther/scripts/tunnels/keepalive-ytdlp.sh >> ~/.panther/ytdlp-keepalive.log 2>&1
EOF
chmod +x ~/.termux/boot/start-nexstream.sh
```

register the auto-relaunch job — it restarts the watchdog every 15 min if android kills it:

```bash
bash ~/panther/scripts/tunnels/setup-resilience.sh
```

## Start and verify

```bash
pantherup        # wait ~15s
panthercheck     # expect service: UP, tunnel: UP, and a trycloudflare.com url
```

confirm it's reachable from the public internet:

```bash
URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' ~/.panther/ytdlp-cf.log | tail -1)
curl -s -m8 "$URL/health"     # -> ok
```

the watchdog publishes the URL to Turso (`configs.YTDLP_SERVICE_URL`); the backend re-discovers it within ~60s. during a download, `~/.panther/ytdlp-service.log` logs `[media] relaying <N> bytes`, and `[media] transient drop, retry N/5` when it recovers from a googlevideo reset.

## What's running

- `scripts/tunnels/ytdlp-service.cjs` — the worker (`/health`, `/ytdlp`, `/media`) on `127.0.0.1:5055`, Node built-ins only.
- `scripts/tunnels/keepalive-ytdlp.sh` — the watchdog: loads `web/backend/.env`, runs the service + cloudflared, health-checks both, publishes the URL, loops every 20s.
- `scripts/tunnels/ensure-ytdlp.sh` + `setup-resilience.sh` — the android job that relaunches the watchdog if it's killed.
- `~/.termux/boot/start-nexstream.sh` — starts it on boot.

logs live in `~/.panther/`. day-to-day it's `pantherup` / `pantherdown` / `panthercheck` / `pantherlog`. to load a code change to the service, `pkill -f ytdlp-service.cjs` and the watchdog respawns it. keep the phone on power and wifi, and disable battery optimization for Termux and Termux:API so android doesn't freeze it.

## Troubleshooting

- **service/tunnel DOWN** — `pantherup`, wait, then `pantherlog`; usually a missing `YTDLP_REMOTE_SECRET`.
- **tunnel URL keeps changing** — normal, quick-tunnels rotate on restart; the watchdog republishes each time.
- **`/media` returns 403** — the phone's `YTDLP_REMOTE_SECRET` doesn't match Koyeb's.
- **android keeps killing it** — check `termux-job-scheduler --pending`, disable battery optimization, keep the wake-lock on.
- **`cloudflared: command not found`** — `pkg install tur-repo && pkg install cloudflared`, or drop the `linux-arm64` binary on `PATH`.
