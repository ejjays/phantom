# MuxProto — standalone MediaMuxer torture tests

Throwaway prototype answering one question: can Android's
`MediaExtractor` + `MediaMuxer` replace the hand-rolled TS mux core with
fewer bugs? NOT wired into the main build — open `proto/mux` on its own.

## Run

```bash
cd proto/mux
./gradlew installDebug
```

Needs a connected device (`adb connect` over wifi works) + the Termux
android-sdk (see `local.properties`).

## Tests (bundled assets, no network)

1. **Mux separate A/V -> MP4** — H.264 video-only + AAC audio-only
   (the exact shape YouTube serves) into one MP4.
2. **Remux TS segments -> MP4** — two MPEG-TS segments with restarted
   timestamps (the Vidrock/Luna case) into one MP4, PTS re-offset per file.

Each run logs track mimes, sample counts, PTS ranges, sizes, and a
re-parse verification of the output. `Copy log` puts it on the clipboard —
paste it back for diagnosis. The same log file survives crashes at
`<cache>/proto/muxproto-log.txt`.

## Promote criteria

- outputs open clean in ffprobe/VLC with correct duration + A/V sync
- no native crashes across repeated runs
- then port into `mobile/modules/` (Kotlin dumb, decisions in TS)
