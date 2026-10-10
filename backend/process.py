import os
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont


def apply_filter(user_img: np.ndarray, template_type: str = "azkaban") -> np.ndarray:
    """Apply template-specific filter. Returns RGB numpy array."""
    gray = cv2.cvtColor(user_img, cv2.COLOR_BGR2GRAY)
    t = (template_type or "azkaban").lower()

    if t == "wildwest":
        # Cool, blue-tinted high-contrast flash look
        contrast_gray = cv2.convertScaleAbs(gray, alpha=1.55, beta=-30)
        b = np.clip(contrast_gray * 1.35 + 40, 0, 255).astype(np.uint8)
        g = np.clip(contrast_gray * 1.05 + 10, 0, 255).astype(np.uint8)
        r = np.clip(contrast_gray * 0.70 - 10, 0, 255).astype(np.uint8)
        blue_tinted = cv2.merge([b, g, r])
        return cv2.cvtColor(blue_tinted, cv2.COLOR_BGR2RGB)
    elif t == "digital_prison":
        # High contrast B&W optimized to pop behind jail bars
        contrast_gray = cv2.convertScaleAbs(gray, alpha=1.45, beta=-20)
        return cv2.cvtColor(contrast_gray, cv2.COLOR_GRAY2RGB)
    else:
        # Standard Azkaban vintage grayscale
        contrast_gray = cv2.convertScaleAbs(gray, alpha=1.35, beta=-15)
        return cv2.cvtColor(contrast_gray, cv2.COLOR_GRAY2RGB)


def find_photo_window(poster_rgba: Image.Image):
    """
    Locate the user-photo window in a transparent-cutout template
    (frontend/public/templates/*.png, alpha == 0 window).
    Returns (gx_min, gx_max, gy_min, gy_max). Raises if no window found.
    """
    poster_np = np.array(poster_rgba)
    if poster_np.shape[2] < 4:
        raise ValueError("Template has no alpha channel — expected a transparent cutout.")
    ys, xs = np.where(poster_np[:, :, 3] == 0)
    if len(xs) == 0:
        raise ValueError("No transparent window found in template.")
    box = (int(np.min(xs)), int(np.max(xs)), int(np.min(ys)), int(np.max(ys)))
    if (box[1] - box[0]) < 50 or (box[3] - box[2]) < 50:
        raise ValueError("Transparent window too small — bad template cutout.")
    return box


def overlay_name(final_poster: Image.Image, name: str) -> Image.Image:
    """Draw prisoner name centered near the bottom slate area."""
    if not name or not name.strip():
        return final_poster
    name = name.strip().upper()[:28]
    draw = ImageDraw.Draw(final_poster)
    W, H = final_poster.size
    # Try a bold font, fall back to default
    font_size = max(24, int(W * 0.045))
    font = None
    for candidate in ["arial.ttf", "DejaVuSans-Bold.ttf"]:
        try:
            font = ImageFont.truetype(candidate, font_size)
            break
        except Exception:
            continue
    if font is None:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), name, font=font)
    tw = bbox[2] - bbox[0]
    tx = (W - tw) // 2
    ty = int(H * 0.885)  # slate / bottom band estimate
    # Slight shadow for legibility
    draw.text((tx + 2, ty + 2), name, font=font, fill=(0, 0, 0, 220))
    draw.text((tx, ty), name, font=font, fill=(235, 230, 210, 255))
    return final_poster


def process_user_poster(
    user_img_path,
    template_poster_path,
    output_path="output.png",
    template_type="azkaban",
    zoom: float = 1.0,
    offset_x: float = 0,
    offset_y: float = 0,
    prisoner_name: str = "",
):
    """
    Composite user photo into a transparent-cutout template's photo window.

    Same stacking as the React live preview: user photo UNDER the template
    frame, so bars / cuffs / slate stay on top.

    zoom: 0.5 - 4.0 multiplier on top of base cover-fit.
    offset_x / offset_y: pixel offsets (in template pixels) applied after centering.
    prisoner_name: text drawn on the bottom slate.
    """
    # --- Step 1: Load User Image ---
    if isinstance(user_img_path, np.ndarray):
        user_img = user_img_path
    else:
        user_img = cv2.imread(str(user_img_path))
    if user_img is None:
        raise FileNotFoundError(f"Could not load image: {user_img_path}")

    # --- Step 2: Apply filter ---
    processed_rgb = apply_filter(user_img, template_type)
    user_pil = Image.fromarray(processed_rgb)

    # --- Step 3: Photo-window replacement (transparent cutout) ---
    poster_pil = Image.open(template_poster_path).convert("RGBA")
    gx_min, gx_max, gy_min, gy_max = find_photo_window(poster_pil)
    box_w = gx_max - gx_min
    box_h = gy_max - gy_min

    # Base cover-fit: scale user photo to COVER the window (no gaps)
    orig_w, orig_h = user_pil.size
    base_scale = max(box_w / orig_w, box_h / orig_h)
    zoom = float(max(0.2, min(5.0, zoom or 1.0)))
    scale = base_scale * zoom
    new_w = max(1, int(orig_w * scale))
    new_h = max(1, int(orig_h * scale))
    user_resized = user_pil.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # Center + user pan offset
    paste_x = gx_min + (box_w - new_w) // 2 + int(offset_x)
    paste_y = gy_min + (box_h - new_h) // 2 + int(offset_y)

    person_layer = Image.new("RGBA", poster_pil.size, (0, 0, 0, 0))
    person_layer.paste(user_resized, (paste_x, paste_y))

    # Cutout already has its transparent window — composite photo underneath
    final_poster = Image.alpha_composite(person_layer, poster_pil)

    final_poster = overlay_name(final_poster, prisoner_name or "")
    final_poster.save(output_path, "PNG")
    print(f"Poster Generated ({template_type}, zoom={zoom}, off=({offset_x},{offset_y})): {output_path}")
    return output_path


if __name__ == "__main__":
    base_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(base_dir)
    frontend_tpl = os.path.join(project_root, "frontend", "public", "templates")
    user_file = os.path.join(project_root, "user.jpg")

    jobs = [
        (os.path.join(frontend_tpl, "template1.png"), "output_azkaban.png", "azkaban"),
        (os.path.join(frontend_tpl, "template2.png"), "output_wildwest.png", "wildwest"),
        (os.path.join(frontend_tpl, "template3.png"), "output_digital_prison.png", "digital_prison"),
    ]
    for tpl, out, ttype in jobs:
        process_user_poster(user_file, tpl, os.path.join(base_dir, out), template_type=ttype)
