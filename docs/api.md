# API Reference

Panther exposes a small HTTP API. Responses are validated against the shared Zod schemas in [`../web/shared/schemas/media.schema.ts`](../web/shared/schemas/media.schema.ts) — that file is the source of truth for shapes.

## Auth

If the instance sets `API_KEY`, the endpoints below (except `/ping` and `/health`) require it: pass `Authorization: Bearer <key>`, `X-API-Key: <key>`, or `?key=<key>`. Localhost is exempt. See [`protect-an-instance.md`](protect-an-instance.md).

## `GET /info?url=<media-url>&id=<clientId>`

Resolves metadata and available formats. Resolution is progressive: `/info` may return a **partial** result quickly (`isPartial: true`) and push the full result over SSE (`/events`).

Response (`FinalResponse`):

```jsonc
{
  "id": "string",
  "title": "string",
  "artist": "string",
  "uploader": "string",
  "album": "string",
  "cover": "url",
  "thumbnail": "url",
  "duration": 0,
  "formats": [
    /* Format[] */
  ],
  "audioFormats": [
    /* Format[] */
  ],
  "isPartial": false,
  "isrc": "string?",
  "webpageUrl": "url",
}
```

`Format`:

```jsonc
{
  "formatId": "string",
  "url": "url",
  "extension": "mp4",
  "resolution": "1080p?",
  "vcodec": "string?",
  "acodec": "string?",
  "height": 1080,
  "filesize": 0,
  "isMuxed": false,
  "isVideo": true,
  "isAudio": false,
}
```

## `GET /events?id=<clientId>`

Server-Sent Events for that client id: resolution progress, early metadata, completion. Use the same `id` across `/events`, `/info`, and `/convert`.

## `GET|POST /convert?url=<media-url>&formatId=<id>&format=<ext>&id=<clientId>`

Streams the requested media to the client (server-side muxed to MP4 for merge formats). Progress emitted over `/events`. Honors `Range` / responds `206 Partial Content` — downloads are resumable.

## `GET /stream-urls?url=<media-url>&formatId=<id>&id=<clientId>`

Returns signed proxy tunnel URLs for client-side (edge) muxing instead of a server stream.

## `GET /proxy?...&exp=<ts>&sig=<hmac>`

Internal signed passthrough used by the responses above. The server mints and signs these URLs — you don't build them by hand. Unsigned/expired requests get `403`.

## Health

- `GET /ping` → `pong`
- `GET /health` → `{ "status": "ok", "port": <n> }`

## Remix Lab (async job API)

Mounted on the Kaggle/Colab Gradio instance (also callable directly if running locally):

| Method | Path                 | Purpose                                                         |
| ------ | -------------------- | --------------------------------------------------------------- |
| `POST` | `/process`           | Upload `file` + `remix` + `stems` → `{ task_id }`               |
| `GET`  | `/status/{task_id}`  | Poll job; on success returns stems, chords, beats, package path |
| `GET`  | `/download?path=...` | Fetch the results zip                                           |

Jobs run in background and expire after an hour.
