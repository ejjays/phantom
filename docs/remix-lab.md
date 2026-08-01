# Remix Lab (Beta)

the Remix Lab is Phantom's music-analysis engine. hand it a track and it pulls the song apart — separating **stems**, tracking **beats and tempo**, detecting the **key**, and transcribing **time-stamped chords** — using state-of-the-art (SOTA) models.

> **beta.** the Lab runs end-to-end, but it's still maturing — chord & key detection is solid but not flawless, and the Kaggle/Colab runtime is hands-on (account verification, pasting the bundle, first-run model downloads). treat the output as a strong starting point, not ground truth.

it's a standalone Python engine (`remix/`) built to run on free **Kaggle / Colab** GPUs, so the heavy ML never touches your device or your server bill. that's the whole point: the notebook _is_ the GPU, which is how the Lab runs fine even from a phone. the main app talks to it over a small async API, or you can run it on its own.

## What you get

from a single audio file:

- **stems** — `4 Stems` (vocals · drums · bass · other) or `6 Stems` (+ guitar · piano), as WAV.
- **chords** — beat-synchronous `{ time, chord }` pairs (e.g. `Cm7`, `G/B`), saved to `chords.json`.
- **beats + tempo** — beat timestamps and an estimated BPM.
- **key** — the detected key, used to spell the chords correctly.
- **a results zip** — `Phantom_Remix_Results.zip` bundling `chords.json` and a readable `reasoning.txt`.

## The models

| Stage      | Model                                                                                                        | Notes                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| separation | **Demucs** (`htdemucs_ft` / `htdemucs_6s`) or **BS-RoFormer** (`BS-Roformer-SW.ckpt`, via `audio-separator`) | Demucs is the fast/balanced default; BS-RoFormer is the ultra-quality option. |
| chords     | **BTC** transformer ([BTC-ISMIR19](https://github.com/jayg996/BTC-ISMIR19), `large_voca`)                    | 170-chord vocabulary, run beat-by-beat.                                       |
| beats      | **madmom** RNN + DBN beat tracking                                                                           | tempo is `60 / median(beat gap)`.                                             |
| key        | **madmom** CNN key recognition                                                                               | falls back to C if it can't decide.                                           |
| features   | **nnAudio** CQT (on GPU)                                                                                     | a 144-bin transform for harmony, a 36-bin one for bass.                       |

everything runs on **PyTorch** at 22.05 kHz, with a **Gradio** UI on top.

## How it works

a few things make it more than a frame-by-frame chord guesser:

- **dual-GPU split.** on a free dual-T4 Kaggle instance the separation model runs on `cuda:0` while the chord transformer and CQT layers sit on `cuda:1`, so the two heavy stages don't fight over VRAM. with one GPU it folds onto a single device; with none it falls back to (slow) CPU.
- **bass-aware chords.** it doesn't just read the full mix — it runs a targeted low-frequency CQT on the _isolated bass stem_ to find the dominant bass note per beat, then uses that to resolve inversions. so a C major sitting on an E in the bass comes out as **C/E**, not a flat "C".
- **beat-synchronous + smoothed.** chord predictions are averaged inside each beat, then smoothed across beats with a Viterbi pass — so the output tracks real harmonic changes instead of flickering.
- **key-aware spelling.** the detected key decides sharps vs flats, and the raw model vocabulary is normalised into readable names (slash chords and enharmonics included).

## Running it on Kaggle / Colab

this is the easy path, and the one that works from a phone — you don't need a powerful machine, the notebook provides the GPU.

> **Kaggle is the one to use.** its free tier gives you **2× T4**, which is exactly what the dual-GPU pipeline is built for. Colab's free tier is a single T4 — the Lab still runs, but it folds onto one GPU and loses the split.

**first, generate the bundle.** it flattens the whole `remix/` into one paste-able file. this is plain Python (no deps), so it runs anywhere — even on the phone:

```bash
python scripts/kaggle/bundle_lab.py   # writes scripts/kaggle/kaggle_bundle.txt
```

**one-time on Kaggle:** GPUs and internet only unlock for **phone number verified** accounts — verify your number at [kaggle.com/settings](https://www.kaggle.com/settings) first, or the toggles below stay greyed out.

then, in a new notebook, open **Settings** (right-hand panel) and set:

- **Accelerator → GPU T4 x2** — the dual-GPU the engine is tuned for.
- **Internet → On** — the first run pip-installs the stack and downloads model weights, so this is required.

now paste the **entire contents of the generated `scripts/kaggle/kaggle_bundle.txt`** into a cell and run it — it unpacks the engine, installs the stack, downloads the models, and launches, then prints a shareable Gradio URL.

to wire a Kaggle run back into your own instance, set `PHANTOM_BACKEND_URL` and `PHANTOM_SESSION_ID` before launch — the engine then registers itself with your backend (`POST /api/remix/register-engine`) on startup. maintainers can push the kernel with [`scripts/kaggle/sync_kaggle.sh`](../scripts/kaggle/sync_kaggle.sh) (needs `KAGGLE_USERNAME` / `KAGGLE_KEY` — see [`env-variables.md`](env-variables.md)).

## Running it locally

if you have a good device that is capable of running them locally, you can skip the notebook and run it yourself:

```bash
# from the repo root
python -m remix.app
```

that serves the Gradio UI plus the async API on `:7860` (override with `PORT` / `HOST`). CPU technically works but is slow — the engine is tuned for the dual-T4 path, so a real GPU is strongly recommended.

## API

the engine exposes a small async job API (also mounted on the Kaggle Gradio instance):

| Method | Path                | Purpose                                                                     |
| ------ | ------------------- | --------------------------------------------------------------------------- |
| `POST` | `/process`          | upload `file` + `remix` + `stems` → `{ task_id }`                           |
| `GET`  | `/status/{task_id}` | poll the job; on success returns stems, chords, beats, and the package path |
| `GET`  | `/download?path=…`  | fetch the results zip                                                       |

jobs run in the background and expire after an hour.

## Layout

```text
remix/
├── app.py            # gradio ui + async api + kaggle/local launch
├── orchestrator.py   # the pipeline: separate → beats → chords → package
├── audio_engines.py  # demucs / bs-roformer separation
├── model_manager.py  # lazy-loads BTC, madmom, nnAudio (GPU placement)
├── processing.py     # CQT features, per-beat bass pitch, batched BTC, viterbi
├── theory_utils.py   # chord vocab, key detection, enharmonic spelling
├── config.py         # env/GPU detection, paths, sample rate
└── setup_env.py      # one-shot dependency + model bootstrap
```

## Notes

- models are downloaded on first run (BTC weights + separation checkpoints), so the first analysis is the slow one.
- a GPU is effectively required for usable speed; the dual-T4 notebook is what it's tuned for.
- this is research tooling — only analyse audio you have the right to process.
