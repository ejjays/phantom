# Remix Lab engine

the Python engine behind Panther's **Remix Lab** — stem separation, beat/tempo tracking, key detection, and time-stamped chords, using State-of-the-Art models (Demucs / BS-RoFormer, the BTC transformer, madmom, nnAudio).

it's built to run on a free **Kaggle / Colab** GPU — the notebook _is_ the GPU, so it works even from a phone. for the full write-up (models, how it works, the API), see [`../docs/remix-lab.md`](../docs/remix-lab.md).

## Files

```text
app.py            # gradio ui + async api + kaggle/local launch
orchestrator.py   # the pipeline: separate → beats → chords → package
audio_engines.py  # demucs / bs-roformer separation
model_manager.py  # lazy-loads BTC, madmom, nnAudio (GPU placement)
processing.py     # CQT features, per-beat bass pitch, batched BTC, viterbi
theory_utils.py   # chord vocab, key detection, enharmonic spelling
config.py         # env/GPU detection, paths, sample rate
setup_env.py      # one-shot dependency + model bootstrap
```

## Running it

**Kaggle (recommended — free 2× T4):** run `python scripts/kaggle/bundle_lab.py` to generate `scripts/kaggle/kaggle_bundle.txt`, then paste its contents into a GPU notebook cell and run. needs a **phone number verified** Kaggle account with **Accelerator → GPU T4 x2** and **Internet → On**. (Colab's free tier is a single T4 — it works, but loses the dual-GPU split.)

**locally (needs a CUDA GPU):** from the repo root, `python -m remix.app` — serves the UI + API on `:7860`.

full details: [`../docs/remix-lab.md`](../docs/remix-lab.md).
