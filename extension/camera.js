// Demo Director — camera bubble frame. Runs at the extension's origin, so the
// camera permission is granted once (in Settings) rather than per site.
// The content script creates this frame only while the bubble is on and the tab
// is visible, and removes it otherwise, which releases the camera.
//
// Background replacement: Google's MediaPipe selfie segmenter (bundled in
// vendor/mediapipe, runs locally) finds the person; we composite them over a
// solid colour or a blurred copy of the frame.
const video = document.querySelector('video');
const out = document.querySelector('#out');
const msg = document.querySelector('.msg');
let stream;
let current = '';
let bg = { mode: 'none', color: '#0b0f17' };

function say(text) {
  msg.textContent = text;
  msg.hidden = !text;
}

async function start() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const cam = settings.camera || {};
  const mirror = cam.mirror !== false;
  video.classList.toggle('mirror', mirror);
  out.classList.toggle('mirror', mirror);
  bg = { mode: 'none', color: '#0b0f17', ...(cam.background || {}) };
  applyBackground();

  const deviceId = cam.deviceId || '';
  if (stream && deviceId === current) return;
  stream?.getTracks().forEach((t) => t.stop());
  current = deviceId;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        ...(deviceId && { deviceId: { exact: deviceId } }),
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    });
    video.srcObject = stream;
    say('');
  } catch (e) {
    stream = null;
    if (e.name === 'NotAllowedError') say('Camera blocked. Open Demo Director settings → Grant camera access.');
    else if (e.name === 'OverconstrainedError' || e.name === 'NotFoundError') {
      // Chosen camera unplugged → fall back to the default one.
      if (deviceId) {
        current = '__fallback__';
        stream = await navigator.mediaDevices.getUserMedia({ video: true }).catch(() => null);
        if (stream) return void ((video.srcObject = stream), say(''));
      }
      say('Camera not found.');
    } else say(`Camera error: ${e.name}`);
  }
}

// ---------------- background replacement ----------------

const W = 640; // processing width; height follows the camera's aspect ratio
const frame = document.createElement('canvas');
const person = document.createElement('canvas');
const maskC = document.createElement('canvas');
const fctx = frame.getContext('2d', { willReadFrequently: false });
const pctx = person.getContext('2d');
const mctx = maskC.getContext('2d');
const octx = out.getContext('2d');
let maskData = null;
let segmenterP = null;
let running = false;

function getSegmenter() {
  segmenterP ??= (async () => {
    const { ImageSegmenter } = await import('./vendor/mediapipe/vision_bundle.mjs');
    const fileset = {
      wasmLoaderPath: chrome.runtime.getURL('vendor/mediapipe/vision_wasm_internal.js'),
      wasmBinaryPath: chrome.runtime.getURL('vendor/mediapipe/vision_wasm_internal.wasm'),
    };
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: chrome.runtime.getURL('vendor/mediapipe/selfie_segmenter.tflite'), delegate },
      runningMode: 'VIDEO',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
    try {
      return await ImageSegmenter.createFromOptions(fileset, options('GPU'));
    } catch {
      return ImageSegmenter.createFromOptions(fileset, options('CPU'));
    }
  })();
  return segmenterP;
}

function applyBackground() {
  const on = bg.mode === 'color' || bg.mode === 'blur';
  out.hidden = !on;
  video.style.opacity = on ? '0' : ''; // keep it playing (and painting) as the source
  if (on && !running) {
    running = true;
    getSegmenter()
      .then(loop)
      .catch((e) => {
        running = false;
        console.warn('Demo Director: background replacement unavailable', e);
        out.hidden = true;
        video.style.opacity = '';
      });
  }
}

function sizeTo(w, h) {
  for (const c of [frame, person, maskC, out]) {
    if (c.width !== w || c.height !== h) Object.assign(c, { width: w, height: h });
  }
  if (!maskData || maskData.width !== w || maskData.height !== h) maskData = mctx.createImageData(w, h);
}

// Soften the mask a little: below 0.35 is background, above 0.65 is person.
const ease = (p) => (p <= 0.35 ? 0 : p >= 0.65 ? 255 : ((p - 0.35) / 0.3) * 255);

function loop(segmenter) {
  const step = () => {
    if (!(bg.mode === 'color' || bg.mode === 'blur')) {
      running = false;
      return;
    }
    if (video.readyState >= 2 && video.videoWidth) {
      const H = Math.round((W * video.videoHeight) / video.videoWidth);
      sizeTo(W, H);
      fctx.drawImage(video, 0, 0, W, H);
      segmenter.segmentForVideo(frame, performance.now(), (result) => {
        const masks = result.confidenceMasks || [];
        // selfie_segmenter gives one "person" mask; two-class models put person second.
        const m = (masks[1] || masks[0])?.getAsFloat32Array();
        if (!m) return;
        const d = maskData.data;
        for (let i = 0, j = 3; i < m.length; i++, j += 4) d[j] = ease(m[i]);
        mctx.putImageData(maskData, 0, 0);
        // person = frame ∩ mask
        pctx.globalCompositeOperation = 'copy';
        pctx.drawImage(frame, 0, 0);
        pctx.globalCompositeOperation = 'destination-in';
        pctx.drawImage(maskC, 0, 0);
        // background, then person on top
        octx.globalCompositeOperation = 'copy';
        if (bg.mode === 'blur') {
          octx.filter = 'blur(14px)';
          octx.drawImage(frame, 0, 0);
          octx.filter = 'none';
        } else {
          octx.fillStyle = /^#[0-9a-f]{3,8}$/i.test(bg.color) ? bg.color : '#0b0f17';
          octx.fillRect(0, 0, W, H);
        }
        octx.globalCompositeOperation = 'source-over';
        octx.drawImage(person, 0, 0);
      });
    }
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(step);
    else requestAnimationFrame(step);
  };
  step();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) start();
});
addEventListener('pagehide', () => stream?.getTracks().forEach((t) => t.stop()));
start();
