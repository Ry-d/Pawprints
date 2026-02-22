"""
PawPrints — Backend Server
FastAPI app serving the web UI and handling photo → 3D pipeline
"""
import os
import uuid
import time
import shutil
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, UploadFile, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import httpx

load_dotenv()

# ─── Config ───
UPLOAD_DIR = Path("uploads")
MODEL_DIR = Path("models")
UPLOAD_DIR.mkdir(exist_ok=True)
MODEL_DIR.mkdir(exist_ok=True)

REMOVEBG_KEY = os.getenv("REMOVEBG_API_KEY", "")  # legacy fallback
MESHY_KEY = os.getenv("MESHY_API_KEY", "")
GEMINI_KEY = os.getenv("NANOBANANA_API_KEY", "")
SHAPEWAYS_CLIENT_ID = os.getenv("SHAPEWAYS_CLIENT_ID", "")
SHAPEWAYS_CLIENT_SECRET = os.getenv("SHAPEWAYS_CLIENT_SECRET", "")

# ─── Anti-spam: rate limits + email gate ───
# { ip: { "count": int, "date": "YYYY-MM-DD", "email": str|None } }
_rate_limits: dict = {}
MAX_GENERATIONS_PER_DAY = 3  # includes rerolls

# Shapeways OAuth2 token cache
_shapeways_token = {"access_token": None, "expires_at": 0}

app = FastAPI(title="PawPrints", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# ─── Routes ───

@app.get("/", response_class=HTMLResponse)
async def root():
    """Serve the main app"""
    return FileResponse("static/index.html")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "removebg": bool(REMOVEBG_KEY),
        "meshy": bool(MESHY_KEY),
    }


@app.post("/api/upload")
async def upload_photo(file: UploadFile = File(...)):
    """Upload a pet photo"""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Only image files are accepted")

    # Save with unique name
    ext = Path(file.filename or "photo.jpg").suffix or ".jpg"
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = UPLOAD_DIR / filename

    with open(filepath, "wb") as f:
        content = await file.read()
        f.write(content)

    return {
        "filename": filename,
        "path": str(filepath),
        "size": len(content),
    }


@app.post("/api/register")
async def register_email(data: dict, request: Request):
    """Gate: collect email before allowing generation"""
    email = (data.get("email") or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(400, "Valid email required")

    ip = request.client.host if request.client else "unknown"
    today = time.strftime("%Y-%m-%d")

    entry = _rate_limits.get(ip, {"count": 0, "date": today, "email": None})
    if entry["date"] != today:
        entry = {"count": 0, "date": today, "email": None}

    entry["email"] = email
    _rate_limits[ip] = entry

    return {"ok": True, "remaining": MAX_GENERATIONS_PER_DAY - entry["count"]}


def _check_rate_limit(request) -> dict:
    """Check if IP has generations remaining today"""
    ip = request.client.host if request.client else "unknown"
    today = time.strftime("%Y-%m-%d")

    entry = _rate_limits.get(ip, {"count": 0, "date": today, "email": None})
    if entry["date"] != today:
        entry = {"count": 0, "date": today, "email": None}
        _rate_limits[ip] = entry

    if not entry.get("email"):
        return {"allowed": False, "reason": "Email required before generating"}
    if entry["count"] >= MAX_GENERATIONS_PER_DAY:
        return {"allowed": False, "reason": f"Daily limit reached ({MAX_GENERATIONS_PER_DAY} per day). Try again tomorrow!"}

    return {"allowed": True, "remaining": MAX_GENERATIONS_PER_DAY - entry["count"], "ip": ip}


@app.post("/api/process-image")
async def process_image(data: dict, request: Request):
    """
    Step 1: Gemini processes the image (bg removal or keyring charm).
    Cheap — user can reroll this multiple times before approving.
    """
    check = _check_rate_limit(request)
    if not check["allowed"]:
        raise HTTPException(429, check["reason"])

    image_path = Path(data.get("image_path", ""))
    if not image_path.exists():
        image_path = UPLOAD_DIR / image_path.name
    if not image_path.exists():
        raise HTTPException(400, f"Image not found: {image_path}")

    product_type = data.get("product_type", "statue")

    try:
        processed_path = await process_image_gemini(image_path, product_type)
    except Exception as e:
        print(f"Image processing error: {e}")
        raise HTTPException(500, "Image processing failed")

    # Serve the processed image
    return {
        "processed_image": f"/uploads/{processed_path.name}",
        "processed_path": str(processed_path),
        "product_type": product_type,
    }


@app.post("/api/generate-3d")
async def generate_3d(data: dict, request: Request):
    """
    Step 2: User approved the processed image — now spend the Meshy credits.
    Rate-limited: counts against daily allowance.
    """
    check = _check_rate_limit(request)
    if not check["allowed"]:
        raise HTTPException(429, check["reason"])

    processed_path = Path(data.get("processed_path", ""))
    if not processed_path.exists():
        processed_path = UPLOAD_DIR / processed_path.name
    if not processed_path.exists():
        raise HTTPException(400, "Processed image not found")

    # Deduct from daily allowance (Meshy is the expensive call)
    ip = check["ip"]
    _rate_limits[ip]["count"] += 1
    remaining = MAX_GENERATIONS_PER_DAY - _rate_limits[ip]["count"]

    try:
        task_id = await start_3d_generation(processed_path)
    except Exception as e:
        print(f"3D generation error: {e}")
        task_id = None

    if task_id:
        return {"task_id": task_id, "status": "processing", "remaining": remaining}

    return {"model_url": "/static/model.glb", "status": "demo", "remaining": remaining}


GEMINI_PROMPTS = {
    "statue": (
        "Isolate the animal from this image. Remove the entire background and replace it "
        "with a pure white background. Keep the animal exactly as it appears — do not alter, "
        "stylize, or add anything. Output a clean, high-resolution image of just the animal "
        "on white, suitable for 3D model generation."
    ),
    "keyring": (
        "Isolate the animal from the image and make the background white, turn it into a "
        "detailed bronze keychain that looks identical to the pet, don't include the chain "
        "or ring, just the fixed eyelet, the eyelet should be in full view."
    ),
}


async def process_image_gemini(image_path: Path, product_type: str) -> Path:
    """Process pet photo via Gemini — background removal (statue) or keyring charm generation"""
    if not GEMINI_KEY:
        # Fallback to remove.bg for statue, or return original
        if product_type == "statue" and REMOVEBG_KEY:
            return await remove_background_legacy(image_path)
        return image_path

    import base64
    image_data = base64.b64encode(image_path.read_bytes()).decode()

    # Detect mime type
    ext = image_path.suffix.lower()
    mime = {"jpg": "image/jpeg", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}.get(ext, "image/jpeg")

    prompt = GEMINI_PROMPTS.get(product_type, GEMINI_PROMPTS["statue"])
    out_path = UPLOAD_DIR / f"{image_path.stem}_{product_type}_processed.png"

    async with httpx.AsyncClient(timeout=120) as client:
        # Try multiple model names in order of likelihood
        models = [
            "gemini-2.5-flash-image",
            "gemini-2.0-flash",
        ]
        resp = None
        for model_name in models:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={GEMINI_KEY}"
            print(f"Trying Gemini model: {model_name}")
            resp = await client.post(
                url,
                json={
                    "contents": [{
                        "parts": [
                            {"text": prompt},
                            {"inline_data": {"mime_type": mime, "data": image_data}},
                        ]
                    }],
                    "generationConfig": {
                        "responseModalities": ["IMAGE", "TEXT"],
                    },
                },
            )
            if resp.status_code == 200:
                print(f"Gemini model {model_name} succeeded")
                break
            else:
                print(f"Gemini model {model_name} failed: {resp.status_code} - {resp.text[:300]}")
        
        if resp is None:
            print("No Gemini models available")
            return image_path

        if resp.status_code == 200:
            data = resp.json()
            # Extract image from response
            candidates = data.get("candidates", [])
            for candidate in candidates:
                parts = candidate.get("content", {}).get("parts", [])
                for part in parts:
                    if "inlineData" in part:
                        img_bytes = base64.b64decode(part["inlineData"]["data"])
                        out_path.write_bytes(img_bytes)
                        print(f"Gemini processed ({product_type}): {out_path.name}")
                        return out_path

            print(f"Gemini: no image in response. Full response: {data}")
            return image_path
        else:
            print(f"Gemini final error: {resp.status_code} - {resp.text[:500]}")
            # Fallback
            if product_type == "statue" and REMOVEBG_KEY:
                print("Falling back to remove.bg")
                return await remove_background_legacy(image_path)
            print("No fallback available, returning original image")
            return image_path


async def remove_background_legacy(image_path: Path) -> Path:
    """Legacy fallback: remove.bg API"""
    out_path = UPLOAD_DIR / f"{image_path.stem}_nobg.png"

    async with httpx.AsyncClient(timeout=30) as client:
        with open(image_path, "rb") as f:
            resp = await client.post(
                "https://api.remove.bg/v1.0/removebg",
                files={"image_file": f},
                data={"size": "auto"},
                headers={"X-Api-Key": REMOVEBG_KEY},
            )

        if resp.status_code == 200:
            out_path.write_bytes(resp.content)
            return out_path
        else:
            print(f"remove.bg error: {resp.status_code} - {resp.text}")
            return image_path


async def start_3d_generation(image_path: Path) -> Optional[str]:
    """Start 3D model generation via Meshy.ai"""
    if not MESHY_KEY:
        return None

    import base64 as b64mod
    image_data = b64mod.b64encode(image_path.read_bytes()).decode()
    ext = image_path.suffix.lower()
    mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}.get(ext, "image/jpeg")
    data_uri = f"data:{mime};base64,{image_data}"

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://api.meshy.ai/openapi/v1/image-to-3d",
            headers={
                "Authorization": f"Bearer {MESHY_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "image_url": data_uri,
                "ai_model": "meshy-6",
                "topology": "triangle",
                "target_polycount": 30000,
            },
        )

        if resp.status_code in (200, 201, 202):
            data = resp.json()
            task_id = data.get("result") or data.get("id")
            print(f"Meshy task started: {task_id}")
            return task_id
        else:
            print(f"Meshy error: {resp.status_code} - {resp.text[:500]}")
            return None


@app.get("/api/model-status/{task_id}")
async def model_status(task_id: str):
    """Poll Meshy.ai for model generation status"""
    if not MESHY_KEY:
        return {"status": "completed", "model_url": "/static/model.glb"}

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"https://api.meshy.ai/openapi/v1/image-to-3d/{task_id}",
            headers={"Authorization": f"Bearer {MESHY_KEY}"},
        )

        if resp.status_code == 200:
            data = resp.json()
            status = data.get("status", "unknown")
            print(f"Meshy poll: {task_id} -> {status}")

            if status in ("SUCCEEDED", "succeeded"):
                # Download the model
                model_urls = data.get("model_urls", {})
                glb_url = model_urls.get("glb")
                stl_url = model_urls.get("stl")  # Shapeways prefers STL
                obj_url = model_urls.get("obj")

                download_url = glb_url or stl_url or obj_url
                if download_url:
                    # Save GLB for viewer
                    model_filename = f"{task_id}.glb"
                    model_path = MODEL_DIR / model_filename
                    if not model_path.exists() and glb_url:
                        model_resp = await client.get(glb_url)
                        if model_resp.status_code == 200:
                            model_path.write_bytes(model_resp.content)

                    # Save STL for Shapeways (prefer STL, fallback to GLB)
                    stl_filename = f"{task_id}.stl"
                    stl_path = MODEL_DIR / stl_filename
                    if not stl_path.exists() and stl_url:
                        stl_resp = await client.get(stl_url)
                        if stl_resp.status_code == 200:
                            stl_path.write_bytes(stl_resp.content)
                            print(f"Saved STL for Shapeways: {stl_filename}")

                    # Upload to Shapeways in background
                    sw_model_id = await upload_to_shapeways(stl_path if stl_path.exists() else model_path)

                    return {
                        "status": "completed",
                        "model_url": f"/models/{model_filename}",
                        "shapeways_model_id": sw_model_id,
                    }

                return {"status": "completed", "model_url": "/static/model.glb"}

            elif status in ("FAILED", "failed"):
                return {"status": "failed", "error": data.get("message", "Unknown error")}

            else:
                progress = data.get("progress", 0)
                return {"status": "processing", "progress": progress}

        return {"status": "error"}


# ─── Shapeways: Upload & Quote ───

# Cache: meshy_task_id -> shapeways_model_id
_shapeways_models: dict = {}


async def upload_to_shapeways(model_path: Path) -> Optional[str]:
    """Upload a 3D model to Shapeways and return the model ID"""
    token = await get_shapeways_token()
    if not token:
        print("Shapeways: no token, skipping upload")
        return None

    if not model_path.exists():
        print(f"Shapeways: model file not found: {model_path}")
        return None

    import base64
    model_data = base64.b64encode(model_path.read_bytes()).decode()
    filename = model_path.name

    print(f"Uploading to Shapeways: {filename} ({model_path.stat().st_size / 1024:.0f}KB)")

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            "https://api.shapeways.com/models/v1",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json={
                "fileName": filename,
                "file": model_data,
                "hasRightsToModel": 1,
                "acceptTermsAndConditions": 1,
                "units": "mm",
            },
        )

        if resp.status_code in (200, 201):
            data = resp.json()
            model_id = data.get("modelId") or data.get("model_id") or data.get("id")
            print(f"Shapeways model uploaded: {model_id}")
            # Cache it
            task_stem = model_path.stem  # the meshy task_id
            _shapeways_models[task_stem] = model_id
            return str(model_id) if model_id else None
        else:
            print(f"Shapeways upload error: {resp.status_code} - {resp.text[:500]}")
            return None


@app.get("/api/shapeways-quote/{task_id}")
async def get_shapeways_quote(task_id: str):
    """Get real Shapeways pricing for a model that was uploaded"""
    token = await get_shapeways_token()
    if not token:
        return {"source": "estimated", "error": "Shapeways not configured"}

    # Find the Shapeways model ID
    model_id = _shapeways_models.get(task_id)
    if not model_id:
        return {"source": "estimated", "error": "Model not yet uploaded to Shapeways"}

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"https://api.shapeways.com/models/{model_id}/v1",
            headers={"Authorization": f"Bearer {token}"},
        )

        if resp.status_code == 200:
            data = resp.json()
            materials_data = data.get("materials", {})

            # Map Shapeways material IDs to our material names
            # Common Shapeways material IDs:
            # 6 = White Strong & Flexible (Nylon)
            # 25 = Stainless Steel
            # 26 = Gold Plated Steel
            # 62 = Metallic Plastic
            # 81 = Frosted Detail Plastic
            # 85 = Raw Bronze
            # 86 = Polished Bronze
            # 87 = Raw Brass

            quotes = {}
            for mat_id, mat_info in materials_data.items():
                price = float(mat_info.get("price", 0))
                name = mat_info.get("title", f"Material {mat_id}")
                if price > 0:
                    quotes[mat_id] = {
                        "name": name,
                        "shapeways_cost": round(price, 2),
                    }

            # Extract key materials for our tiers
            result = {
                "source": "shapeways",
                "model_id": model_id,
                "all_materials": quotes,
                "dimensions": data.get("dimensions", {}),
            }

            # Find bronze specifically
            for mat_id, q in quotes.items():
                lower_name = q["name"].lower()
                if "bronze" in lower_name and "raw" in lower_name:
                    result["bronze_raw"] = q
                elif "bronze" in lower_name and "polished" in lower_name:
                    result["bronze_polished"] = q
                elif "bronze" in lower_name:
                    result["bronze"] = q

            print(f"Shapeways quote for model {model_id}: {len(quotes)} materials available")
            return result

        else:
            print(f"Shapeways quote error: {resp.status_code} - {resp.text[:300]}")
            return {"source": "error", "error": f"API error {resp.status_code}"}


# ─── User Profiles (in-memory for MVP, move to DB later) ───
_user_profiles: dict = {}

@app.post("/api/profile")
async def save_profile(data: dict):
    uid = data.get("uid")
    if not uid:
        raise HTTPException(400, "uid required")
    _user_profiles[uid] = {k: v for k, v in data.items() if k != "uid"}
    return {"ok": True}

@app.get("/api/profile/{uid}")
async def get_profile(uid: str):
    profile = _user_profiles.get(uid)
    return {"profile": profile}


# Serve uploaded/processed images
@app.get("/uploads/{filename}")
async def serve_upload(filename: str):
    filepath = UPLOAD_DIR / filename
    if not filepath.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(filepath)


# Serve generated models
@app.get("/models/{filename}")
async def serve_model(filename: str):
    filepath = MODEL_DIR / filename
    if not filepath.exists():
        raise HTTPException(404, "Model not found")
    return FileResponse(filepath, media_type="model/gltf-binary")


# ─── Shapeways Integration ───

async def get_shapeways_token() -> Optional[str]:
    """Get OAuth2 access token from Shapeways"""
    if not SHAPEWAYS_CLIENT_ID or not SHAPEWAYS_CLIENT_SECRET:
        return None

    now = time.time()
    if _shapeways_token["access_token"] and _shapeways_token["expires_at"] > now:
        return _shapeways_token["access_token"]

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.shapeways.com/oauth2/token",
            data={
                "grant_type": "client_credentials",
                "client_id": SHAPEWAYS_CLIENT_ID,
                "client_secret": SHAPEWAYS_CLIENT_SECRET,
            },
        )
        if resp.status_code == 200:
            data = resp.json()
            _shapeways_token["access_token"] = data["access_token"]
            _shapeways_token["expires_at"] = now + data.get("expires_in", 3600) - 60
            return data["access_token"]
        else:
            print(f"Shapeways token error: {resp.status_code} - {resp.text}")
            return None


@app.get("/api/shapeways/materials")
async def shapeways_materials():
    """Fetch available materials from Shapeways"""
    token = await get_shapeways_token()
    if not token:
        return {"error": "Shapeways not configured", "materials": []}

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            "https://api.shapeways.com/materials/v1",
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code == 200:
            return resp.json()
        return {"error": f"API error {resp.status_code}"}


@app.post("/api/shapeways/price")
async def shapeways_price(data: dict):
    """
    Get a price quote from Shapeways for a model + material.
    We add our 40% markup on top.
    """
    token = await get_shapeways_token()
    model_id = data.get("model_id")
    material_id = data.get("material_id")

    if not token or not model_id:
        # Fallback to local calculation
        return {"source": "estimated", "note": "Using local price estimate"}

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"https://api.shapeways.com/models/{model_id}/v1",
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code == 200:
            model_data = resp.json()
            materials = model_data.get("materials", {})

            if material_id and str(material_id) in materials:
                mat_info = materials[str(material_id)]
                base_price = float(mat_info.get("price", 0))
                markup = base_price * 0.40
                total = base_price + markup

                return {
                    "source": "shapeways",
                    "base_price": round(base_price, 2),
                    "markup": round(markup, 2),
                    "total": round(total, 2),
                    "currency": "USD",
                }

            return {"source": "shapeways", "materials": materials}

    return {"source": "estimated"}


@app.post("/api/shapeways/upload-model")
async def shapeways_upload_model(data: dict):
    """Upload a model file to Shapeways for quoting/ordering"""
    token = await get_shapeways_token()
    if not token:
        return {"error": "Shapeways not configured"}

    model_path = Path(data.get("model_path", ""))
    if not model_path.exists():
        raise HTTPException(400, "Model file not found")

    import base64
    model_data = base64.b64encode(model_path.read_bytes()).decode()
    filename = model_path.name

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            "https://api.shapeways.com/models/v1",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json={
                "fileName": filename,
                "file": model_data,
                "hasRightsToModel": 1,
                "acceptTermsAndConditions": 1,
            },
        )
        if resp.status_code in (200, 201):
            return resp.json()
        return {"error": f"Upload failed: {resp.status_code}", "detail": resp.text}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
