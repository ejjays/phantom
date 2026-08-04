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
# native deps (e.g. re2) build from source — `.npmrc` supplies `android_ndk_path`,
# the compiler comes from `build-essential` above; libsql is substituted via overrides
npm install --silent

# shared extractor package (backend imports resolve to its dist)
(cd packages/extractors && npm run build --silent)

# build the backend (tsc -> web/backend/dist; `npm start` runs from there)
cd "$BASE/web/backend"
npm run build --silent

if [ ! -f .env ]; then
    echo "GEMINI_API_KEY=your_key_here" > .env
    echo "GROQ_API_KEY=" >> .env
fi

echo "setup complete."
npm start
