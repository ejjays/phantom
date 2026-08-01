import os
import subprocess
import json
import zipfile
import numpy as np
import shutil
from pathlib import Path
from remix.config import logger, GPU_0, OUTPUT_DIR, BASE_DIR
from remix.model_manager import clear_vram, get_beat_models
from remix.processing import get_chords_btc_max_accuracy

def _map_roformer_stems(stem_dir):
    v, d, b, o, g, p = [None] * 6
    for file in stem_dir.glob("*.wav"):
        fname = file.name.lower()
        if "(vocals)" in fname or "_vocals_" in fname: v = str(file)
        elif "(drums)" in fname or "_drums_" in fname: d = str(file)
        elif "(bass)" in fname or "_bass_" in fname: b = str(file)
        elif "(other)" in fname or "_other_" in fname: o = str(file)
        elif "(guitar)" in fname or "_guitar_" in fname: g = str(file)
        elif "(piano)" in fname or "_piano_" in fname: p = str(file)
    return v, d, b, o, g, p

def _apply_roformer_fallbacks(v, d, b, o, stem_dir):
    if not v: v = str(stem_dir/"vocals.wav") if (stem_dir/"vocals.wav").exists() else v
    if not d: d = str(stem_dir/"drums.wav") if (stem_dir/"drums.wav").exists() else d
    if not b: b = str(stem_dir/"bass.wav") if (stem_dir/"bass.wav").exists() else b
    if not o: o = str(stem_dir/"other.wav") if (stem_dir/"other.wav").exists() else o
    return v, d, b, o

def _run_roformer(audio_path, stem_dir, stems_mode):
    # roformer separation
    logger.info("starting roformer on %s", GPU_0)
    audio_sep_path = shutil.which("audio-separator") or "audio-separator"

    subprocess.run([
        audio_sep_path, audio_path,
        "--model_filename", "BS-Roformer-SW.ckpt",
        "--output_dir", str(stem_dir),
        "--output_format", "WAV",
        "--mdxc_segment_size", "256",    
        "--mdxc_overlap", "4"
    ], check=True, env={**os.environ, "CUDA_VISIBLE_DEVICES": GPU_0[-1] if 'cuda' in GPU_0 else '0'})
    
    v, d, b, o, g, p = _map_roformer_stems(stem_dir)
    v, d, b, o = _apply_roformer_fallbacks(v, d, b, o, stem_dir)
    
    if stems_mode == "4 Stems":
        g, p = None, None
    return v, d, b, o, g, p

def _run_demucs(audio_path, stem_dir, stems_mode):
    model_name = "htdemucs_ft" if stems_mode == "4 Stems" else "htdemucs_6s"
    logger.info("starting demucs on %s", GPU_0)
    demucs_path = shutil.which("demucs") or "demucs"

    subprocess.run([demucs_path, "-d", GPU_0, "-n", model_name, audio_path, "-o", OUTPUT_DIR], check=True)

    demucs_stem_dir = Path(OUTPUT_DIR) / model_name / Path(audio_path).stem
    for f in demucs_stem_dir.glob("*.wav"):
        shutil.move(str(f), str(stem_dir / f.name))
        
    v, d, b, o = [str(stem_dir/f"{s}.wav") for s in ["vocals", "drums", "bass", "other"]]
    g = str(stem_dir/"guitar.wav") if stems_mode == "6 Stems" and (stem_dir/"guitar.wav").exists() else None
    p = str(stem_dir/"piano.wav") if stems_mode == "6 Stems" and (stem_dir/"piano.wav").exists() else None
    return v, d, b, o, g, p

# dual-gpu pipeline
def remix_audio_dual_gpu(audio_path, engine_choice, stems_mode):
    try:
        if not audio_path: 
            return [None]*11
            
        if os.path.exists(OUTPUT_DIR):
            shutil.rmtree(OUTPUT_DIR, ignore_errors=True)
        os.makedirs(OUTPUT_DIR, exist_ok=True)

        clear_vram()
        
        stem_dir = Path(OUTPUT_DIR) / "stems"
        stem_dir.mkdir(parents=True, exist_ok=True)
        
        if "RoFormer" in engine_choice:
            v, d, b, o, g, p = _run_roformer(audio_path, stem_dir, stems_mode)
        else:
            v, d, b, o, g, p = _run_demucs(audio_path, stem_dir, stems_mode)
        
        # track beats
        BEAT_FEAT, BEAT_DECODE = get_beat_models()
        beat_activations = BEAT_FEAT(audio_path)
        beats = BEAT_DECODE(beat_activations).tolist()
        tempo = round(60 / np.median(np.diff(beats))) if len(beats) > 1 else 120
        
        # recognize chords
        chord_data, reasoning = get_chords_btc_max_accuracy(audio_path, beats, tempo=tempo, bass_audio_path=b, other_audio_path=o)
        
        sheet_text = f"MAX ACCURACY DUAL-T4 REPORT\nBPM: {tempo}\n" + "="*30 + "\n\n"
        for c in chord_data: sheet_text += f"[{c['time']}s] {c['chord']}\n"
        
        # package results
        zip_p = str(BASE_DIR / "Phantom_Remix_Results.zip")
        with zipfile.ZipFile(zip_p, 'w') as z:
            with open(stem_dir/"chords.json", "w") as f: json.dump(chord_data, f, indent=2)
            z.write(stem_dir/"chords.json", arcname="chords.json")
            with open(stem_dir/"reasoning.txt", "w") as f: f.write(reasoning)
            z.write(stem_dir/"reasoning.txt", arcname="reasoning.txt")
        
        clear_vram()
        return v, d, b, o, g, p, chord_data, {"beats": beats, "tempo": tempo}, sheet_text, zip_p, reasoning

    except Exception as e:
        logger.error("Error in remix_audio_dual_gpu: %s", e)
        return [None]*6 + [[], {}, f"FATAL ERROR:\n{str(e)}", None, f"Pipeline Crashed:\n{str(e)}"]
