# API

Panther exposes a small HTTP API. responses are validated against the shared Zod schemas in [`../web/shared/schemas/media.schema.ts`](../web/shared/schemas/media.schema.ts) — that file is the source of truth for shapes.

## Auth

if the instance sets `API_KEY`, the endpoints below (except `/ping` and `/health`) require it: pass `Authorization: Bearer <key>`, `X-API-Key: <key>`, or `?key=<key>`. localhost is exempt. see [`protect-an-instance.md`](protect-an-instance.md).

## `GET /info?url=<media-url>&id=<clientId>`

resolves metadata and available formats. resolution is progressive: `/info` may return a **partial** result quickly (`isPartial: true`) and push the full result over SSE (`/events`). response (`FinalResponse`):

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

Server-Sent Events for that client id: resolution progress, early metadata, completion. use the same `id` across `/events`, `/info`, and `/convert`.

## `GET|POST /convert?url=<media-url>&formatId=<id>&format=<ext>&id=<clientId>`

streams the requested media to the client (server-side muxed to MP4 for merge formats). progress is emitted over `/events`. honors `Range` / responds `206 Partial Content`, so downloads are resumable.

## `GET /stream-urls?url=<media-url>&formatId=<id>&id=<clientId>`

returns signed proxy tunnel URLs for client-side (edge) muxing instead of a server stream.

## `GET /proxy?...&exp=<ts>&sig=<hmac>`

internal signed passthrough used by the responses above. the server mints and signs these URLs — you don't build them by hand, and unsigned/expired requests get `403`.

## Health

- `GET /ping` → `pong`
- `GET /health` → `{ "status": "ok", "port": <n> }`
