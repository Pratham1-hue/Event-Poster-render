import os
import shutil
import tempfile
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

from process import process_user_poster

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)

# Template id -> transparent cutout (same asset the React preview renders).
# frontend/public/templates/*.png are the ONLY template files in the project.
FRONTEND_TPL_DIR = os.path.join(PROJECT_ROOT, "frontend", "public", "templates")
TEMPLATES = {
    "azkaban": "template1.png",
    "wildwest": "template2.png",
    "digital_prison": "template3.png",
}
TEMPLATE_LABELS = {
    "azkaban": "Azkaban Wizard",
    "wildwest": "Wild West Bounty",
    "digital_prison": "Cell Block 404",
}


def resolve_template(template_id: str) -> str:
    fname = TEMPLATES.get((template_id or "azkaban").lower(), TEMPLATES["azkaban"])
    p = os.path.join(FRONTEND_TPL_DIR, fname)
    if os.path.exists(p):
        return p
    raise FileNotFoundError(f"Transparent template not found: {p}")


app = FastAPI(title="Poster Lab API")

# Comma-separated extra origins, e.g. CORS_ORIGINS=https://poster-lab-web.onrender.com
# Defaults to * (fetch() here uses no credentials, so this is safe).
CORS_EXTRA = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", *CORS_EXTRA],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/templates")
def list_templates():
    items = []
    for tid, label in TEMPLATE_LABELS.items():
        try:
            path = resolve_template(tid)
            size = os.path.getsize(path)
        except FileNotFoundError:
            path, size = None, 0
        items.append({"id": tid, "label": label, "available": path is not None, "bytes": size})
    return {"templates": items}


@app.post("/api/generate")
async def generate(
    photo: UploadFile = File(...),
    template: str = Form("azkaban"),
    name: str = Form(""),
    zoom: float = Form(1.0),
    offset_x: float = Form(0),
    offset_y: float = Form(0),
):
    template = (template or "azkaban").lower()
    if template not in TEMPLATES:
        raise HTTPException(status_code=400, detail=f"Unknown template '{template}'")
    try:
        template_path = resolve_template(template)
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))

    try:
        zoom = float(max(0.2, min(5.0, float(zoom))))
    except Exception:
        zoom = 1.0

    tmpdir = tempfile.mkdtemp(prefix="posterlab_")
    try:
        suffix = os.path.splitext(photo.filename or "upload.jpg")[1] or ".jpg"
        src_path = os.path.join(tmpdir, f"user{suffix}")
        with open(src_path, "wb") as f:
            shutil.copyfileobj(photo.file, f)
        out_path = os.path.join(tmpdir, f"poster_{template}.png")
        process_user_poster(
            src_path,
            template_path,
            out_path,
            template_type=template,
            zoom=zoom,
            offset_x=float(offset_x or 0),
            offset_y=float(offset_y or 0),
            prisoner_name=name or "",
        )
        # Stream the file, then delete the per-request temp dir (ephemeral disk on Render).
        task = BackgroundTask(shutil.rmtree, tmpdir, True)
        return FileResponse(
            out_path,
            media_type="image/png",
            filename=f"poster-{template}.png",
            background=task,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")


@app.get("/")
def root():
    return JSONResponse({"name": "Poster Lab API", "docs": "/docs", "health": "/api/health"})
