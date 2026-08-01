import sys
import subprocess
import os
import shutil
from remix.config import logger, BTC_REPO_DIR

def bootstrap():
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "--upgrade", "pip"])
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "websockets>=15.0.1"])

    packages = [
        "psutil",
        "gradio>=5.0.0",
        "huggingface_hub",
        "demucs",
        "librosa",
        "scipy",
        "soundfile",
        "nnAudio",
        "fastapi",
        "uvicorn",
        "nest_asyncio"
    ]
    
    for mod in list(sys.modules.keys()):
        if any(x in mod for x in ['gradio', 'websockets', 'huggingface_hub']):
            del sys.modules[mod]

    for pkg in packages:
        try:
            __import__(pkg)
        except ImportError:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", pkg])
            
    try:
        import audio_separator
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "audio-separator[gpu]"])
    try:
        import madmom
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "git+https://github.com/CPJKU/madmom.git"])
    
    if not os.path.exists(BTC_REPO_DIR):
        logger.info("Downloading BTC-ISMIR19 repository directly to Kaggle...")
        
        git_path = shutil.which("git") or "git"
        
        subprocess.run([git_path, "clone", "https://github.com/jayg996/BTC-ISMIR19.git", BTC_REPO_DIR], check=True)
    
    import importlib
    importlib.invalidate_caches()
    
    weights_path = os.path.join(BTC_REPO_DIR, "test/btc_model_large_voca.pt")
    os.makedirs(os.path.dirname(weights_path), exist_ok=True)
    if not os.path.exists(weights_path) or os.path.getsize(weights_path) < 1000000:
        logger.info("Downloading BTC model weights (large_voca.pt)...")
        fallback_url = "https://github.com/jayg996/BTC-ISMIR19/raw/master/test/btc_model_large_voca.pt"
        import urllib.request
        try:
            # skipcq: BAN-B310
            with urllib.request.urlopen(fallback_url, timeout=30) as response, open(weights_path, 'wb') as out_file:
                data = response.read()
                out_file.write(data)
        except Exception as e:
            logger.error("Failed to download weights: %s", e)
            raise
