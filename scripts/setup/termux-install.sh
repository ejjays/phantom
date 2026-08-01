#!/bin/bash
set -e

echo "installing dependencies..."

pkg update -y && pkg upgrade -y
pkg install -y python ffmpeg nodejs-lts git build-essential curl openssl-tool deno
pip install yt-dlp

if [ -d "phantom" ]; then
    cd phantom && git pull
else
    git clone https://github.com/ejjays/phantom.git && cd phantom
fi

BASE=$(pwd)

# root tooling (also activates the git pre-commit hooks via `prepare`)
npm install --silent

# install + build the backend (tsc -> web/backend/dist; `npm start` runs from there)
# --force: libsql declares os darwin,linux,win32 — mocked at runtime on termux anyway
# --ignore-scripts: re2 & other native addons have no android prebuilt/NDK; app falls back
cd "$BASE/web/backend"
npm install --force --ignore-scripts --silent
npm run build --silent

if [ ! -f .env ]; then
    echo "GEMINI_API_KEY=your_key_here" > .env
    echo "GROQ_API_KEY=" >> .env
fi

echo "setup complete."
npm start
