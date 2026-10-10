import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Upload, Download, Copy, Check, RefreshCw, ZoomIn, ZoomOut, Move, MapPin,
  Calendar, Trophy, Sparkles, Share2, RotateCcw, AlertCircle,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */
const EVENT = {
  sub: 'Claude Impact Lab · Bhopal',
  place: 'SSR Global Skills Park, Bhopal',
  address: 'Hazrat Nizamuddin Colony, Sector B, Ayodhya Nagar, Bhopal, MP 462010',
  start: new Date('2026-10-10T16:00:00+05:30'),
  end: new Date('2026-10-11T19:30:00+05:30'),
};

const TAGS = ['Aniket Sahu', 'Arun Pratap Singh Chandel', 'Claude', 'Cerebras', 'MPSeDC', 'The Origin Guild'];

const TEMPLATES = [
  { id: 'template1', name: 'Azkaban', note: 'Vintage grey', filter: 'azkaban',
    hook: 'Escaped Azkaban just to build AI at Claude Impact Lab Bhopal!' },
  { id: 'template2', name: 'Wild West', note: 'Blue flash', filter: 'wildwest',
    hook: 'Wanted for building AI at Claude Impact Lab Bhopal!' },
  { id: 'template3', name: 'Cell 404', note: 'Hi-con B&W', filter: 'digital_prison',
    hook: 'Locked in Cell Block 404 and building AI at Claude Impact Lab Bhopal!' },
];

/* ------------------------------------------------------------------ */
/*  API base. Dev: '' (Vite proxies /api). Prod (Render): set         */
/*  VITE_API_URL to the backend host, e.g. poster-lab-api.onrender.com */
/* ------------------------------------------------------------------ */
const API_BASE = (() => {
  const raw = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
})();

/* ------------------------------------------------------------------ */
/*  Preview maths. These mirror process.py line for line, so the live  */
/*  preview and the downloaded HD poster use the same coordinates.     */
/* ------------------------------------------------------------------ */
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
// cv2.convertScaleAbs: |a*x + b| saturated to 0..255
const scaleAbs = (v) => Math.min(255, Math.round(Math.abs(v)));

// process.apply_filter(), on RGBA pixel data
function applyPosterFilter(d, type) {
  for (let i = 0; i < d.length; i += 4) {
    // OpenCV's fixed-point BGR2GRAY
    const g = (4899 * d[i] + 9617 * d[i + 1] + 1868 * d[i + 2] + 8192) >> 14;
    if (type === 'wildwest') {
      const c = scaleAbs(1.55 * g - 30);
      // numpy astype(uint8) truncates, so floor to match
      d[i] = Math.floor(clamp255(c * 0.7 - 10));
      d[i + 1] = Math.floor(clamp255(c * 1.05 + 10));
      d[i + 2] = Math.floor(clamp255(c * 1.35 + 40));
    } else {
      const c = type === 'digital_prison' ? scaleAbs(1.45 * g - 20) : scaleAbs(1.35 * g - 15);
      d[i] = d[i + 1] = d[i + 2] = c;
    }
  }
}

// process.find_photo_window(): bounding box of the fully transparent pixels
function findPhotoWindow(img) {
  const tw = img.naturalWidth, th = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = tw; c.height = th;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, tw, th).data;
  let x0 = tw, x1 = -1, y0 = th, y1 = -1;
  for (let y = 0; y < th; y++) {
    const row = y * tw * 4 + 3;
    for (let x = 0; x < tw; x++) {
      if (d[row + x * 4] === 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 - x0 < 50 || y1 - y0 < 50) return null;
  return { tw, th, gx0: x0, gx1: x1, gy0: y0, gy1: y1 };
}

// process_user_poster() placement: cover-fit x zoom, centred in the window,
// plus a pan offset in TEMPLATE pixels. Pan is clamped so the photo always
// covers the window (no see-through gaps in the download).
function computeLayout(win, ow, oh, zoom, ox, oy) {
  const bw = win.gx1 - win.gx0, bh = win.gy1 - win.gy0;
  const scale = Math.max(bw / ow, bh / oh) * zoom;
  const nw = Math.max(1, Math.trunc(ow * scale));
  const nh = Math.max(1, Math.trunc(oh * scale));
  const mx = Math.max(0, Math.floor((nw - bw) / 2));
  const my = Math.max(0, Math.floor((nh - bh) / 2));
  const cx = Math.max(-mx, Math.min(mx, Math.trunc(ox)));
  const cy = Math.max(-my, Math.min(my, Math.trunc(oy)));
  return {
    nw, nh, mx, my, cx, cy,
    px: win.gx0 + Math.floor((bw - nw) / 2) + cx,
    py: win.gy0 + Math.floor((bh - nh) / 2) + cy,
  };
}

const buildCaption = (t) =>
  `${t.hook} 🚀🔥\n\nI'm attending the 2-day Claude Community × Cerebras Community event at SSR Global Skills Park, Bhopal (10–11 Oct).\n\nHosted by @Aniket Sahu & @Arun Pratap Singh Chandel x @MPSeDC x @The Origin Guild x @Cerebras Systems.\n\n#ClaudeImpactLab #Cerebras #AI #BhopalTech #ClaudeCode`;

const buildShortCaption = (t) => {
  const s = `${t.hook} 🚀\n\nClaude × Cerebras, 10–11 Oct, SSR Global Skills Park, Bhopal.\n#ClaudeImpactLab #Cerebras`;
  return s.length > 270 ? s.slice(0, 267) + '…' : s;
};

const clampZoom = (v) => Math.min(4, Math.max(1, Math.round(v * 100) / 100));
const enc = encodeURIComponent;

const RANGE_CSS = `
.pl-range{-webkit-appearance:none;appearance:none;background:transparent;height:44px;width:100%;margin:0;cursor:pointer}
.pl-range:disabled{opacity:.4;cursor:not-allowed}
.pl-range::-webkit-slider-runnable-track{height:6px;border-radius:9999px;background:#44403c}
.pl-range::-moz-range-track{height:6px;border-radius:9999px;background:#44403c}
.pl-range::-webkit-slider-thumb{-webkit-appearance:none;width:28px;height:28px;margin-top:-11px;border-radius:9999px;background:#f97316;border:3px solid #0c0a09;box-shadow:0 0 0 1px #f97316}
.pl-range::-moz-range-thumb{width:22px;height:22px;border-radius:9999px;background:#f97316;border:3px solid #0c0a09;box-shadow:0 0 0 1px #f97316}
.pl-range:focus-visible{outline:2px solid #fdba74;outline-offset:2px;border-radius:8px}
`;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function useCountdown() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  if (now < EVENT.start) {
    const m = Math.max(0, Math.floor((EVENT.start - now) / 60000));
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    return { label: `Starts in ${d ? d + 'd ' : ''}${h}h ${mm}m`, live: false };
  }
  if (now <= EVENT.end) return { label: 'Live now', live: true };
  return { label: 'Event wrapped', live: false };
}

const ring = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300';
const tap = 'min-h-[44px]';

function StepTitle({ n, children, right }) {
  return (
    <div className="flex items-center justify-between mb-3 gap-3">
      <h2 className="flex items-center gap-2.5 text-sm font-semibold text-stone-100">
        <span className="grid place-items-center w-6 h-6 rounded-md bg-orange-500 text-stone-950 text-xs font-bold font-mono">{n}</span>
        {children}
      </h2>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */
export default function PosterLab() {
  const [selectedTemplate, setSelectedTemplate] = useState('template1');
  const [userImage, setUserImage] = useState(null);
  const [userFile, setUserFile] = useState(null);
  const [zoom, setZoom] = useState(1.0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [poster, setPoster] = useState(null);
  const [captionEdited, setCaptionEdited] = useState(false);
  const [captionText, setCaptionText] = useState('');
  const [copied, setCopied] = useState('');
  const [toast, setToast] = useState('');
  const [frameErr, setFrameErr] = useState({});
  const [canShareFiles, setCanShareFiles] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const [win, setWin] = useState({}); // per template: photo window { tw, th, gx0, gx1, gy0, gy1 }
  const [photo, setPhoto] = useState(null); // { url, ow, oh } filtered preview photo

  const fileInputRef = useRef(null);
  const stageRef = useRef(null);
  const toastTimer = useRef(null);
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const photoUrl = useRef(null);
  const countdown = useCountdown();

  const tpl = TEMPLATES.find((t) => t.id === selectedTemplate) || TEMPLATES[0];
  const caption = captionEdited ? captionText : buildCaption(tpl);

  // Where the photo sits, in template pixels. `eff` is exactly what the server receives.
  const winInfo = win[selectedTemplate] || null;
  const L = winInfo && photo ? computeLayout(winInfo, photo.ow, photo.oh, zoom, offset.x, offset.y) : null;
  const eff = L ? { x: L.cx, y: L.cy } : { x: Math.round(offset.x), y: Math.round(offset.y) };

  const sig = useMemo(
    () => JSON.stringify([
      userFile && [userFile.name, userFile.size, userFile.lastModified],
      tpl.filter, zoom.toFixed(2), eff.x, eff.y,
    ]),
    [userFile, tpl.filter, zoom, eff.x, eff.y]
  );
  const ready = !!poster && poster.sig === sig;

  /* ---------- effects ---------- */
  useEffect(() => {
    try {
      const f = new File([''], 'a.png', { type: 'image/png' });
      setCanShareFiles(!!(navigator.canShare && navigator.canShare({ files: [f] })));
    } catch { setCanShareFiles(false); }
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!userImage) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z + (e.deltaY < 0 ? 0.05 : -0.05)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [userImage]);

  // Find the template's transparent photo window (same rule as the server)
  useEffect(() => {
    if (win[selectedTemplate] || frameErr[selectedTemplate]) return undefined;
    let dead = false;
    const im = new Image();
    im.onload = () => {
      if (dead) return;
      const w = findPhotoWindow(im);
      if (w) setWin((p) => ({ ...p, [selectedTemplate]: w }));
      else setFrameErr((p) => ({ ...p, [selectedTemplate]: 'nowindow' }));
    };
    im.onerror = () => { if (!dead) setFrameErr((p) => ({ ...p, [selectedTemplate]: 'missing' })); };
    im.src = `/templates/${selectedTemplate}.png`;
    return () => { dead = true; };
  }, [selectedTemplate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter the photo exactly like process.apply_filter() so colours match the download
  useEffect(() => {
    if (!userImage) { setPhoto(null); return undefined; }
    let dead = false;
    const im = new Image();
    im.onload = () => {
      if (dead) return;
      const ow = im.naturalWidth, oh = im.naturalHeight;
      const k = Math.min(1, 1400 / Math.max(ow, oh)); // preview only needs a modest size
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(ow * k));
      c.height = Math.max(1, Math.round(oh * k));
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(im, 0, 0, c.width, c.height);
      const id = ctx.getImageData(0, 0, c.width, c.height);
      applyPosterFilter(id.data, tpl.filter);
      ctx.putImageData(id, 0, 0);
      c.toBlob((b) => {
        if (dead || !b) return;
        const url = URL.createObjectURL(b);
        if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
        photoUrl.current = url;
        setPhoto({ url, ow, oh });
      }, 'image/jpeg', 0.92);
    };
    im.src = userImage;
    return () => { dead = true; };
  }, [userImage, tpl.filter]);

  useEffect(() => () => {
    if (userImage) URL.revokeObjectURL(userImage);
    if (poster) URL.revokeObjectURL(poster.url);
    if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- utilities ---------- */
  const say = (m) => {
    setToast(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  };

  const copyText = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 1800);
      return true;
    } catch { return false; }
  };

  /* ---------- upload ---------- */
  const loadFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { say('Choose an image file (JPG, PNG or WebP).'); return; }
    if (userImage) URL.revokeObjectURL(userImage);
    setUserFile(file);
    setUserImage(URL.createObjectURL(file));
    setZoom(1.0);
    setOffset({ x: 0, y: 0 });
    setError('');
  };

  const handleImageUpload = (e) => { loadFile(e.target.files[0]); e.target.value = ''; };
  const onDrop = (e) => { e.preventDefault(); setDropOver(false); loadFile(e.dataTransfer.files[0]); };
  const onDragOver = (e) => { e.preventDefault(); setDropOver(true); };

  /* ---------- pan and pinch zoom ---------- */
  // template pixels per on-screen pixel (preview is a scaled-down copy of the template)
  const tplPerScreen = () => (winInfo && stageRef.current ? winInfo.tw / stageRef.current.clientWidth : 1);

  const onPointerDown = (e) => {
    if (!userImage) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: zoom };
      setIsDragging(false);
    } else {
      setIsDragging(true);
      const k = tplPerScreen();
      setDragStart({ x: e.clientX - eff.x / k, y: e.clientY - eff.y / k });
    }
  };

  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      setZoom(clampZoom((pinch.current.z * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.d));
      return;
    }
    if (isDragging && L) {
      const k = tplPerScreen();
      setOffset({
        x: Math.max(-L.mx, Math.min(L.mx, Math.round((e.clientX - dragStart.x) * k))),
        y: Math.max(-L.my, Math.min(L.my, Math.round((e.clientY - dragStart.y) * k))),
      });
    }
  };

  const endDrag = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()];
      const k = tplPerScreen();
      setDragStart({ x: p.x - eff.x / k, y: p.y - eff.y / k });
      setIsDragging(true);
    } else {
      setIsDragging(false);
    }
  };

  /* ---------- backend: HD render via Python ---------- */
  const generate = async () => {
    if (!userFile) return null;
    if (ready) return poster;
    setIsProcessing(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('photo', userFile);
      fd.append('template', tpl.filter);
      fd.append('zoom', String(zoom));
      // template pixels, already clamped: same numbers the preview used
      fd.append('offset_x', String(eff.x));
      fd.append('offset_y', String(eff.y));
      const res = await fetch(`${API_BASE}/api/generate`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`Server ${res.status}: ${await res.text()}`);
      const raw = await res.blob();
      const blob = raw.type === 'image/png' ? raw : new Blob([raw], { type: 'image/png' });
      if (poster) URL.revokeObjectURL(poster.url);
      const next = { blob, url: URL.createObjectURL(blob), sig };
      setPoster(next);
      return next;
    } catch (err) {
      console.error('Processing failed:', err);
      setError('Could not generate the poster. Check your connection and try again.');
      return null;
    } finally {
      setIsProcessing(false);
    }
  };

  const saveBlob = (p) => {
    const a = document.createElement('a');
    a.href = p.url;
    a.download = `claude-impact-lab-${tpl.filter}.png`;
    a.click();
  };

  const primaryAction = async () => {
    const p = await generate();
    if (p && ready) { saveBlob(p); say('Poster saved.'); }
    else if (p) say('Poster ready. Save it, or share it below.');
  };

  /* ---------- share ---------- */
  // Share buttons are always tappable. If the HD poster isn't ready yet we
  // generate it and tell the person, instead of ignoring the tap.
  const guardReady = () => {
    if (ready) return true;
    if (isProcessing) { say('Still generating your poster…'); return false; }
    if (!userImage) { say('Add a photo first, then share.'); return false; }
    say('Generating your poster first…');
    generate().then((p) => { if (p) say('Poster ready. Tap again to share it.'); });
    return false;
  };

  const shareNative = async () => {
    if (!guardReady()) return;
    const file = new File([poster.blob], `claude-impact-lab-${tpl.filter}.png`, { type: 'image/png' });
    try {
      await navigator.share({ files: [file], title: 'Claude Impact Lab Bhopal', text: caption });
    } catch (e) {
      if (e && e.name !== 'AbortError') say('Sharing failed. Try LinkedIn, X or WhatsApp instead.');
    }
  };

  const shareTo = async (net) => {
    if (!guardReady()) return;
    const text = net === 'x' ? buildShortCaption(tpl) : caption;
    const urls = {
      linkedin: `https://www.linkedin.com/feed/?shareActive=true&text=${enc(text)}`,
      x: `https://twitter.com/intent/tweet?text=${enc(text)}`,
      whatsapp: `https://wa.me/?text=${enc(text)}`,
    };
    window.open(urls[net], '_blank', 'noopener');
    const ok = await copyText(text, 'caption');
    say(ok ? 'Caption copied. Attach your poster in the post.' : 'Attach your poster in the post.');
  };

  const copyImage = async () => {
    if (!guardReady()) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': poster.blob })]);
      setCopied('image');
      setTimeout(() => setCopied(''), 1800);
      say('Poster copied. Paste it into your post.');
    } catch { say('This browser blocked image copy. Save the PNG instead.'); }
  };

  /* ---------- shared class strings ---------- */
  const solid = `${tap} rounded-lg text-sm font-bold bg-orange-500 hover:bg-orange-400 active:bg-orange-600 text-stone-950 disabled:bg-stone-800 disabled:text-stone-500 disabled:cursor-not-allowed ${ring}`;
  const ghost = `${tap} rounded-lg text-sm font-medium border border-stone-700 hover:border-orange-500 active:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed ${ring}`;
  const dim = ready ? '' : 'opacity-60';
  const iconBtn = `w-11 h-11 shrink-0 grid place-items-center rounded-lg border border-stone-800 bg-stone-950 hover:border-orange-500 active:bg-stone-800 disabled:opacity-40 ${ring}`;

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100 font-sans">
      <style>{RANGE_CSS}</style>

      {/* Header Banner */}
      <header
        className="bg-orange-500 text-stone-950 pt-[env(safe-area-inset-top)]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(0,0,0,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.07) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      >
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-5 md:py-12 grid md:grid-cols-12 gap-4 md:gap-8 items-end">
          <div className="md:col-span-7">
            <span className="inline-flex items-center gap-1.5 bg-stone-950 text-orange-400 text-xs font-mono px-2.5 py-1 rounded-md">
              <Sparkles className="w-3.5 h-3.5" /> Official digital swag
            </span>
            <h1 className="mt-3 text-3xl sm:text-4xl md:text-6xl font-black tracking-tight leading-[1.05]">
              Claude Community <span className="font-light">×</span> Cerebras
            </h1>
            <p className="mt-1.5 text-base md:text-xl font-semibold">{EVENT.sub}</p>
            <p className="hidden sm:block mt-2 max-w-xl text-stone-900/80">
              Build your wanted poster, then flex it on LinkedIn before the build begins.
            </p>
          </div>

          <div className="md:col-span-5 bg-stone-950 text-stone-100 rounded-xl p-4 md:p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <span className="text-xs font-mono text-stone-400">10–11 OCT 2026</span>
              <span className={`inline-flex items-center gap-1.5 text-xs font-mono px-2 py-0.5 rounded ${countdown.live ? 'bg-green-500/15 text-green-400' : 'bg-orange-500/15 text-orange-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${countdown.live ? 'bg-green-400' : 'bg-orange-400'} animate-pulse`} />
                {countdown.label}
              </span>
            </div>
            <ul className="space-y-2 text-sm">
              <li className="flex gap-2.5"><MapPin className="w-4 h-4 mt-0.5 text-orange-400 shrink-0" />
                <span><b className="text-white">{EVENT.place}</b><span className="hidden sm:block text-stone-400 text-xs">{EVENT.address}</span></span></li>
              <li className="flex gap-2.5"><Calendar className="w-4 h-4 mt-0.5 text-orange-400 shrink-0" />
                <span>Sat 10 Oct, 4–7 PM · Sun 11 Oct, 9 AM–7:30 PM</span></li>
              <li className="flex gap-2.5"><Trophy className="w-4 h-4 mt-0.5 text-orange-400 shrink-0" />
                <span>Claude Max for the winning team</span></li>
            </ul>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="max-w-6xl mx-auto px-4 md:px-8 pb-[calc(2.5rem+env(safe-area-inset-bottom))] flex flex-col gap-4 lg:grid lg:grid-cols-12 lg:gap-8 lg:py-8">
        
        {/* Controls Column */}
        <div className="contents lg:flex lg:flex-col lg:gap-5 lg:col-span-5">
          
          {/* Step 1: Upload */}
          <div className="order-2 lg:order-none bg-stone-900 border border-stone-800 rounded-xl p-4 md:p-5">
            <StepTitle n="1" right={<span className="text-xs font-mono text-stone-500 truncate max-w-[9rem]">{userFile ? userFile.name : 'no photo yet'}</span>}>
              Your photo
            </StepTitle>
            <button
              type="button"
              onClick={() => fileInputRef.current.click()}
              onDragOver={onDragOver}
              onDragLeave={() => setDropOver(false)}
              onDrop={onDrop}
              className={`w-full min-h-[88px] border-2 border-dashed rounded-lg p-4 text-center transition-colors ${ring} ${dropOver ? 'border-orange-400 bg-orange-500/10' : 'border-stone-700 hover:border-orange-500 bg-stone-950/60'}`}
            >
              <Upload className="mx-auto h-6 w-6 text-orange-400 mb-1.5" />
              <span className="block text-sm font-medium text-stone-200">{userFile ? 'Change photo' : 'Choose a photo'}</span>
              <span className="block text-xs text-stone-500">Gallery or camera. A clear, front-facing shot works best.</span>
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
          </div>

          {/* Step 2: Template Selection */}
          <div className="order-3 lg:order-none bg-stone-900 border border-stone-800 rounded-xl p-4 md:p-5">
            <StepTitle n="2">Poster style</StepTitle>
            <div className="grid grid-cols-3 gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={selectedTemplate === t.id}
                  onClick={() => setSelectedTemplate(t.id)}
                  className={`${tap} px-2 py-2.5 text-left rounded-lg border transition-colors ${ring} ${selectedTemplate === t.id ? 'border-orange-500 bg-orange-500/10' : 'border-stone-800 bg-stone-950 hover:border-stone-600'}`}
                >
                  <span className={`block text-sm font-semibold leading-tight ${selectedTemplate === t.id ? 'text-orange-400' : 'text-stone-200'}`}>{t.name}</span>
                  <span className="block text-xs text-stone-500 mt-0.5">{t.note}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Zoom controls (desktop view) */}
          <div className="hidden lg:block bg-stone-900 border border-stone-800 rounded-xl p-5">
            <StepTitle
              n="3"
              right={
                <button type="button" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}
                  className={`text-xs text-orange-400 hover:text-orange-300 inline-flex items-center gap-1 rounded ${ring}`}>
                  <RotateCcw className="w-3 h-3" /> Reset
                </button>
              }
            >
              Zoom and position
            </StepTitle>

            <div className="flex items-end gap-3 mb-2">
              <span className="text-5xl font-black font-mono tracking-tight text-orange-400 leading-none tabular-nums" aria-live="polite">
                {Math.round(zoom * 100)}%
              </span>
              <span className="text-sm font-mono text-stone-500 pb-1">×{zoom.toFixed(2)}</span>
              <span className="ml-auto text-xs font-mono text-stone-500 pb-1">X {eff.x}  Y {eff.y}</span>
            </div>

            <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden mb-3" aria-hidden="true">
              <div className="h-full bg-orange-500 transition-[width] duration-100" style={{ width: `${((zoom - 1) / 3) * 100}%` }} />
            </div>

            <div className="flex items-center gap-2">
              <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => clampZoom(z - 0.1))} className={iconBtn}>
                <ZoomOut className="w-4 h-4" />
              </button>
              <input type="range" min="1" max="4" step="0.05" value={zoom} aria-label="Zoom level"
                onChange={(e) => setZoom(parseFloat(e.target.value))} className="pl-range flex-1" />
              <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => clampZoom(z + 0.1))} className={iconBtn}>
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>

            <div className="flex gap-2 mt-3">
              {[[1, '100% fit'], [1.5, '150%'], [2, '200%'], [4, '400%']].map(([v, l]) => (
                <button key={l} type="button" onClick={() => setZoom(v)}
                  className={`px-2.5 py-1.5 text-xs rounded border font-mono ${ring} ${zoom === v ? 'border-orange-500 text-orange-400' : 'border-stone-800 bg-stone-950 text-stone-400 hover:border-stone-600'}`}>
                  {l}
                </button>
              ))}
            </div>
            <p className="text-xs text-stone-500 flex items-center gap-1.5 mt-3">
              <Move className="w-3.5 h-3.5" /> Drag the poster to reposition. Scroll over it to zoom.
            </p>
          </div>

          {/* Step 3: Generate */}
          <div className="order-4 lg:order-none bg-stone-900 border border-stone-800 rounded-xl p-4 md:p-5">
            <StepTitle n={<><span className="lg:hidden">3</span><span className="hidden lg:inline">4</span></>}>
              Generate and save
            </StepTitle>
            <button type="button" onClick={primaryAction} disabled={!userImage || isProcessing}
              className={`w-full py-3 min-h-[48px] flex items-center justify-center gap-2 transition-colors ${solid}`}>
              {isProcessing ? <RefreshCw className="w-4 h-4 animate-spin" /> : ready ? <Download className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
              {isProcessing ? 'Generating your poster…' : ready ? 'Save PNG' : 'Generate HD poster'}
            </button>
            {!userImage && <p className="text-xs text-stone-500 mt-2">Add a photo to unlock this step.</p>}
            {userImage && !ready && !isProcessing && poster && (
              <p className="text-xs text-orange-400 mt-2">You changed something. Generate again to refresh the HD file.</p>
            )}
            {error && (
              <p role="alert" className="mt-3 flex gap-2 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg p-2.5">
                <AlertCircle className="w-4 h-4 shrink-0" /> {error}
              </p>
            )}
          </div>
        </div>

        {/* Preview & Share Column */}
        <div className="contents lg:flex lg:flex-col lg:items-center lg:gap-6 lg:col-span-7">
          
          {/* Interactive Live Stage Preview */}
          <div className="order-1 lg:order-none sticky top-0 z-30 -mx-4 md:-mx-8 px-4 md:px-8 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 bg-stone-950/95 backdrop-blur border-b border-stone-800 lg:static lg:z-auto lg:m-0 lg:p-0 lg:bg-transparent lg:backdrop-blur-none lg:border-0 lg:w-full lg:max-w-[460px]">
            <div className="relative mx-auto w-[min(100%,36vh,300px)] lg:w-full">
              <span className="hidden lg:block absolute -top-2 -left-2 w-4 h-4 border-t-2 border-l-2 border-orange-500" />
              <span className="hidden lg:block absolute -bottom-2 -right-2 w-4 h-4 border-b-2 border-r-2 border-orange-500" />
              <div
                ref={stageRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onDragOver={onDragOver}
                onDragLeave={() => setDropOver(false)}
                onDrop={onDrop}
                style={{ aspectRatio: winInfo ? `${winInfo.tw} / ${winInfo.th}` : '3 / 4' }}
                className={`relative w-full bg-stone-900 ring-1 rounded-xl overflow-hidden shadow-2xl shadow-orange-950/40 select-none ${userImage ? `touch-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}` : ''} ${dropOver ? 'ring-orange-400' : 'ring-stone-800'}`}
              >
                {/* HUD Overlay */}
                <div className="absolute top-2 left-2 z-20 flex gap-1.5 pointer-events-none font-mono text-[11px] lg:text-xs">
                  <span className="bg-stone-950/85 border border-stone-700 px-1.5 py-0.5 rounded">
                    ZOOM <b className="text-orange-400">{Math.round(zoom * 100)}%</b>
                  </span>
                  <span className="hidden sm:inline bg-stone-950/85 border border-stone-700 px-1.5 py-0.5 rounded text-stone-300">
                    X {eff.x} Y {eff.y}
                  </span>
                </div>
                {ready && (
                  <span className="absolute top-2 right-2 z-20 pointer-events-none bg-orange-500 text-stone-950 text-[11px] font-bold font-mono px-1.5 py-0.5 rounded">
                    HD READY
                  </span>
                )}

                {userImage ? (
                  <div className="absolute inset-0 overflow-hidden">
                    {/* Photo: same placement as process.py, expressed as % of the template */}
                    {winInfo && photo && L && (
                      <img
                        src={photo.url}
                        alt="Your uploaded photo"
                        draggable={false}
                        style={{
                          position: 'absolute',
                          maxWidth: 'none',
                          left: `${(L.px / winInfo.tw) * 100}%`,
                          top: `${(L.py / winInfo.th) * 100}%`,
                          width: `${(L.nw / winInfo.tw) * 100}%`,
                          height: `${(L.nh / winInfo.th) * 100}%`,
                        }}
                        className="pointer-events-none select-none"
                      />
                    )}
                    {!frameErr[selectedTemplate] && !(winInfo && photo) && (
                      <div className="absolute inset-0 grid place-items-center text-xs font-mono text-stone-500">Preparing preview…</div>
                    )}
                    {/* Template frame on top of the photo, like the server composite */}
                    <div className="absolute inset-0 pointer-events-none z-10">
                      {frameErr[selectedTemplate] ? (
                        <div className="w-full h-full grid place-items-center border-2 border-dashed border-orange-500/60 text-center p-4 text-xs text-orange-300 font-mono">
                          {frameErr[selectedTemplate] === 'nowindow'
                            ? <>No transparent photo window in<br />/templates/{selectedTemplate}.png</>
                            : <>Template frame not found:<br />/templates/{selectedTemplate}.png</>}
                        </div>
                      ) : (
                        <img
                          src={`/templates/${selectedTemplate}.png`}
                          alt=""
                          style={{ maxWidth: 'none' }}
                          className="w-full h-full"
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => fileInputRef.current.click()}
                    className={`absolute inset-0 grid place-items-center text-center p-4 ${ring}`}>
                    <span>
                      <span className="mx-auto mb-2 grid place-items-center w-12 h-12 rounded-xl bg-orange-500/10 border border-orange-500/30">
                        <Upload className="w-5 h-5 text-orange-400" />
                      </span>
                      <span className="block text-sm font-semibold text-stone-200">Tap to add a photo</span>
                      <span className="block text-xs text-stone-500 mt-1">Your {tpl.name} poster previews here, live.</span>
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Mobile zoom dock */}
            <div className="lg:hidden mx-auto mt-2 max-w-[360px] flex items-center gap-1.5">
              <button type="button" aria-label="Zoom out" disabled={!userImage} onClick={() => setZoom((z) => clampZoom(z - 0.1))} className={iconBtn}>
                <ZoomOut className="w-4 h-4" />
              </button>
              <input type="range" min="1" max="4" step="0.05" value={zoom} disabled={!userImage}
                aria-label="Zoom level" onChange={(e) => setZoom(parseFloat(e.target.value))} className="pl-range flex-1 min-w-0" />
              <button type="button" aria-label="Zoom in" disabled={!userImage} onClick={() => setZoom((z) => clampZoom(z + 0.1))} className={iconBtn}>
                <ZoomIn className="w-4 h-4" />
              </button>
              <span className="w-[4.2ch] text-right text-sm font-mono font-bold text-orange-400 tabular-nums" aria-live="polite">
                {Math.round(zoom * 100)}%
              </span>
              <button type="button" aria-label="Reset zoom and position" disabled={!userImage}
                onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }} className={iconBtn}>
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
            <p className="lg:hidden text-center text-xs text-stone-500 mt-1">Drag to move · pinch to zoom</p>
            <p className="hidden lg:block text-xs text-stone-500 mt-2 text-center">What you see here is what gets exported.</p>
          </div>

          {/* Social Share Card */}
          <div className="order-5 lg:order-none w-full lg:max-w-[460px] bg-stone-900 border border-stone-800 rounded-xl p-4 md:p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Share2 className="w-4 h-4 text-orange-400" /> Share your poster
              </h3>
              {ready && poster && (
                <img src={poster.url} alt="Generated poster thumbnail" className="h-12 w-9 object-cover rounded border border-orange-500/50" />
              )}
            </div>

            {!ready && (
              <p className="text-sm text-stone-400 bg-stone-950 border border-stone-800 rounded-lg p-3">
                Your HD poster isn't generated yet. Tap any share button and it will be generated first.
              </p>
            )}

            {/* Caption Textarea */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="caption" className="text-xs text-stone-400">Caption</label>
                <div className="flex gap-1 text-xs">
                  {captionEdited && (
                    <button type="button" onClick={() => setCaptionEdited(false)}
                      className={`px-2 py-2 -my-2 text-stone-400 hover:text-stone-200 rounded ${ring}`}>Reset</button>
                  )}
                  <button type="button" onClick={() => copyText(caption, 'caption')}
                    className={`inline-flex items-center gap-1 px-2 py-2 -my-2 -mr-2 text-orange-400 hover:text-orange-300 rounded ${ring}`}>
                    {copied === 'caption' ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied === 'caption' ? 'Copied' : 'Copy caption'}
                  </button>
                </div>
              </div>
              <textarea
                id="caption"
                rows={6}
                value={caption}
                onChange={(e) => { setCaptionEdited(true); setCaptionText(e.target.value); }}
                className="w-full bg-stone-950 border border-stone-800 rounded-lg p-3 text-base lg:text-xs leading-relaxed font-mono text-stone-200 focus:outline-none focus:border-orange-500 resize-y"
              />
            </div>

            {/* Share Buttons */}
            <div className="space-y-2">
              {canShareFiles ? (
                <>
                  <button type="button" aria-disabled={!ready} onClick={shareNative} className={`w-full py-3 min-h-[48px] ${solid} ${dim}`}>
                    Share poster + caption
                  </button>
                  <div className="grid grid-cols-3 gap-2">
                    <button type="button" aria-disabled={!ready} onClick={() => shareTo('linkedin')} className={`${ghost} ${dim}`}>LinkedIn</button>
                    <button type="button" aria-disabled={!ready} onClick={() => shareTo('x')} className={`${ghost} ${dim}`}>X</button>
                    <button type="button" aria-disabled={!ready} onClick={() => shareTo('whatsapp')} className={`${ghost} ${dim}`}>WhatsApp</button>
                  </div>
                </>
              ) : (
                <>
                  <button type="button" aria-disabled={!ready} onClick={() => shareTo('linkedin')} className={`w-full py-3 min-h-[48px] ${solid} ${dim}`}>
                    Post on LinkedIn
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" aria-disabled={!ready} onClick={() => shareTo('x')} className={`${ghost} ${dim}`}>X</button>
                    <button type="button" aria-disabled={!ready} onClick={() => shareTo('whatsapp')} className={`${ghost} ${dim}`}>WhatsApp</button>
                  </div>
                </>
              )}
              <button type="button" aria-disabled={!ready} onClick={copyImage} className={`w-full ${ghost} ${dim}`}>
                {copied === 'image' ? 'Poster copied' : 'Copy poster image'}
              </button>
            </div>

            <p className="text-xs text-stone-500 leading-normal">
              Social sites cannot attach an image from a link. {canShareFiles ? '"Share poster + caption" sends both together. ' : ''}
              LinkedIn, X and WhatsApp copy your caption and open the composer, so attach the PNG there.
            </p>

            {/* LinkedIn Tags */}
            <div>
              <p className="text-xs text-stone-400 mb-2">Tag on LinkedIn (type @ and pick the profile). Tap to copy:</p>
              <div className="flex flex-wrap gap-2">
                {TAGS.map((t) => (
                  <button key={t} type="button" onClick={() => copyText('@' + t, 'tag-' + t)}
                    className={`min-h-[40px] text-xs px-3 py-2 rounded-lg border font-mono ${ring} ${copied === 'tag-' + t ? 'border-green-500/50 text-green-400' : 'border-stone-700 text-stone-300 hover:border-orange-500 active:bg-stone-800'}`}>
                    {copied === 'tag-' + t ? 'Copied' : '@' + t}
                  </button>
                ))}
              </div>
            </div>
          </div>

        </div>
      </main>

      {/* Toast Notification */}
      <div
        role="status"
        aria-live="polite"
        style={{ bottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
        className={`fixed left-1/2 -translate-x-1/2 z-50 w-max max-w-[90vw] bg-orange-500 text-stone-950 text-sm font-medium px-4 py-3 rounded-lg shadow-xl transition-all ${toast ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3 pointer-events-none'}`}
      >
        {toast}
      </div>
    </div>
  );
}