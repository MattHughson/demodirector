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
let delegate = 'GPU';

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
    if (delegate === 'GPU') {
      try {
        return await ImageSegmenter.createFromOptions(fileset, options('GPU'));
      } catch {
        delegate = 'CPU';
      }
    }
    return ImageSegmenter.createFromOptions(fileset, options('CPU'));
  })();
  return segmenterP;
}

// The canvas covers the video; the video stays visible underneath (never
// opacity 0, or Chrome may stop painting it and the frames freeze).
function showRaw(raw) {
  out.hidden = raw;
}

function applyBackground() {
  const on = bg.mode === 'color' || bg.mode === 'blur';
  out.hidden = !on;
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

// Self-check: some GPUs (seen on Macs) hand back an all-zero mask, which would
// paint only the background colour. If no frame in the first ~2s finds a person,
// retry on the CPU; if that can't find one either, show the plain camera rather
// than an empty bubble. Once a person has been seen, trust the segmenter.
const CHECK_MS = 2500;
let checkFrom = 0; // when the current segmenter's check started
let seen = false;
let warned = false;

function loop(segmenter) {
  let lastTime = -1;
  let stopped = false;
  const step = () => {
    if (stopped) return;
    if (!(bg.mode === 'color' || bg.mode === 'blur')) {
      running = false;
      return;
    }
    // Driven by the clock rather than requestVideoFrameCallback; only new frames are processed.
    if (video.readyState >= 2 && video.videoWidth && video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      const H = Math.round((W * video.videoHeight) / video.videoWidth);
      sizeTo(W, H);
      fctx.drawImage(video, 0, 0, W, H);
      segmenter.segmentForVideo(frame, performance.now(), (result) => {
        const masks = result.confidenceMasks || [];
        // selfie_segmenter gives one "person" mask; two-class models put person second.
        const m = (masks[1] || masks[0])?.getAsFloat32Array();
        if (!m) return;
        const d = maskData.data;
        let peak = 0;
        for (let i = 0, j = 3; i < m.length; i++, j += 4) {
          d[j] = ease(m[i]);
          if (m[i] > peak) peak = m[i];
        }
        if (!seen) {
          if (peak > 0.65) {
            seen = true;
            showRaw(false);
            console.info(`Demo Director: background replacement running (${delegate})`);
          } else if ((checkFrom ||= performance.now()) && performance.now() - checkFrom > CHECK_MS) {
            checkFrom = 0;
            if (delegate === 'GPU') {
              console.warn('Demo Director: GPU segmenter found no one; retrying on the CPU');
              delegate = 'CPU';
              stopped = true;
              segmenter.close?.();
              segmenterP = null;
              getSegmenter().then(loop, () => showRaw(true));
            } else {
              if (!warned) console.warn("Demo Director: segmenter can't find you; showing the plain camera");
              warned = true;
              showRaw(true); // keep checking: it switches back on as soon as you're found
            }
            return;
          }
        }
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
    requestAnimationFrame(step);
  };
  step();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) start();
});
addEventListener('pagehide', () => stream?.getTracks().forEach((t) => t.stop()));
start();
