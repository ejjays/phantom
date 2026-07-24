import os
import nest_asyncio
import shutil
import uuid
import time
import asyncio
from fastapi import BackgroundTasks, UploadFile, File, Form
from remix.orchestrator import remix_audio_dual_gpu
from remix.config import API_PORT, BASE_DIR, logger, IS_KAGGLE

# task store
tasks: dict[str, dict] = {}
tasks_lock = asyncio.Lock()
TASK_TTL = 3600 # 1 hour

async def cleanup_tasks():
    while True:
        try:
            now = time.time()
            async with tasks_lock:
                expired = [tid for tid, t in tasks.items() if now - t.get("created_at", now) > TASK_TTL]
                for tid in expired:
                    logger.info("Cleaning up expired task: %s", tid)
                    task = tasks.get(tid)
                    if task and "data" in task:
                        stems = task["data"].get("stems", {})
                        for s_path in stems.values():
                            if s_path and os.path.exists(s_path): os.remove(s_path)
                        pkg = task["data"].get("package")
                        if pkg and os.path.exists(pkg): os.remove(pkg)
                    
                    if tid in tasks: del tasks[tid]
        except Exception as e:
            logger.error("Error in cleanup_tasks: %s", e)
        await asyncio.sleep(600) # every 10 mins

def create_ui():
    import gradio as gr
    with gr.Blocks(theme=gr.themes.Monochrome()) as interface:
        gr.Markdown("# Panther Nitro Lab")
        with gr.Row():
            audio_in = gr.Audio(type="filepath", label="Input")
            with gr.Column():
                engine_in = gr.Radio(["Demucs (Fast / Balanced)", "BS-RoFormer (Ultra Quality)"], value="Demucs (Fast / Balanced)", label="Engine")
                mode_in = gr.Radio(["4 Stems", "6 Stems"], value="4 Stems", label="Stems")
        
        btn = gr.Button("RUN ANALYSIS", variant="primary")
        with gr.Row(): v_o, d_o, b_o, o_o, g_o, p_o = [gr.Audio(label=x) for x in ["Vocals","Drums","Bass","Other","Guitar","Piano"]]
        c_json = gr.JSON(label="Chords")
        file_o = gr.File(label="Download package")
        
        b_json = gr.JSON(visible=False)
        sheet_o = gr.Textbox(visible=False)
        reason_o = gr.Textbox(visible=False)
        
        btn.click(remix_audio_dual_gpu, [audio_in, engine_in, mode_in], [v_o, d_o, b_o, o_o, g_o, p_o, c_json, b_json, sheet_o, file_o, reason_o])
    return interface

def run_separation_task(task_id, temp_path, engine, stems):
    try:
        res = remix_audio_dual_gpu(str(temp_path), engine, stems)
        v, d, b, o, g, p, chords, beats, _, zip_p, _ = res
        
        # handle sync context
        created_at = tasks.get(task_id, {}).get("created_at", time.time())
        
        tasks[task_id] = {
            "status": "success",
            "created_at": created_at,
            "data": {
                "status": "success",
                "metadata": { "tempo": beats.get("tempo") if beats else 120, "chords": chords, "beats": beats.get("beats") if beats else [] },
                "stems": { "vocals": v, "drums": d, "bass": b, "other": o, "guitar": g, "piano": p },
                "package": zip_p
            }
        }
    except Exception as e:
        logger.error("Task %s failed: %s", task_id, e)
        created_at = tasks.get(task_id, {}).get("created_at", time.time())
        tasks[task_id] = {"status": "error", "message": str(e), "created_at": created_at}
    finally:
        if os.path.exists(temp_path): os.remove(temp_path)

async def process_audio(background_tasks: BackgroundTasks, file: UploadFile = File(...), engine: str = Form(...), stems: str = Form(...)):
    task_id = str(uuid.uuid4())
    temp_path = BASE_DIR / f"temp_{task_id}_{file.filename}"
    with open(temp_path, "wb") as buffer: shutil.copyfileobj(file.file, buffer)
    
    async with tasks_lock:
        tasks[task_id] = {"status": "processing", "created_at": time.time()}
    background_tasks.add_task(run_separation_task, task_id, temp_path, engine, stems)
    
    return {"task_id": task_id, "status": "queued"}

async def get_task_status(task_id: str):
    from fastapi.responses import JSONResponse
    async with tasks_lock:
        if task_id not in tasks:
            return JSONResponse({"status": "not_found"}, status_code=404)
        return tasks[task_id]

async def download_file(path: str):
    from fastapi.responses import FileResponse, JSONResponse
    if os.path.exists(path): return FileResponse(path)
    return JSONResponse({"error": "file not found"}, status_code=404)

def launch():
    import gradio as gr
    # apply patches
    nest_asyncio.apply()
    ui = create_ui()
    
    if IS_KAGGLE:
        _launch_kaggle(ui)
    else:
        _launch_local(ui)

def _launch_kaggle(ui):
    import socket
    import requests
    import threading
    
    free_port = 7860
    for port in range(7870, 7890):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('localhost', port)) != 0:
                free_port = port
                break
    
# init UI
    # get public URL
    _, _, public_url = ui.launch(share=True, server_port=free_port, quiet=True, prevent_thread_lock=True)
    
    # attach routes
    if hasattr(ui, 'app') and ui.app:
        ui.app.add_api_route("/process", process_audio, methods=["POST"])
        ui.app.add_api_route("/status/{task_id}", get_task_status, methods=["GET"])
        ui.app.add_api_route("/download", download_file, methods=["GET"])
        logger.info("Nitro Async API routes attached to Gradio app instance")

    # register worker
    def register_worker():
        time.sleep(15) # wait for tunnel
        backend_url = os.environ.get("PANTHER_BACKEND_URL")
        session_id = os.environ.get("PANTHER_SESSION_ID")
        
        if public_url and backend_url and session_id:
            logger.info("Registering session %s at %s", session_id, backend_url)
            try:
                requests.post(
                    f"{backend_url}/api/remix/register-engine", 
                    json={"url": public_url, "session_id": session_id},
                    timeout=15
                )
                logger.info("Engine registration successful")
            except Exception as e:
                logger.error("Engine registration failed: %s", e)

    # bg register
    threading.Thread(target=register_worker, daemon=True).start()
    
    # init cleanup
    def run_cleanup():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.create_task(cleanup_tasks())
        loop.run_forever()

    threading.Thread(target=run_cleanup, daemon=True).start()
    
    try:
        while True: time.sleep(1)
    except KeyboardInterrupt:
        ui.close()

def _launch_local(ui):
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn
    import gradio as gr

    app = FastAPI(title="Panther Nitro Engine")
    cleanup_task = []

    @app.on_event("startup")
    async def startup_event():
        cleanup_task.append(asyncio.create_task(cleanup_tasks()))

    @app.on_event("shutdown")
    async def shutdown_event():
        for t in cleanup_task:
            t.cancel()
            try:
                await t
            except asyncio.CancelledError:
                pass

    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
    app.add_api_route("/process", process_audio, methods=["POST"])
    app.add_api_route("/status/{task_id}", get_task_status, methods=["GET"])
    app.add_api_route("/download", download_file, methods=["GET"])
    
    gr.mount_gradio_app(app, ui, path="/")
    host = os.getenv("HOST", "127.0.0.1")
    uvicorn.run(app, host=host, port=API_PORT)

if __name__ == "__main__":
    launch()
