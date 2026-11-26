// Demo Director — camera bubble frame. Runs at the extension's origin, so the
// camera permission is granted once (in Settings) rather than per site.
// The content script creates this frame only while the bubble is on and the tab
// is visible, and removes it otherwise, which releases the camera.
const video = document.querySelector('video');
const msg = document.querySelector('.msg');
let stream;
let current = '';

function say(text) {
  msg.textContent = text;
  msg.hidden = !text;
}

async function start() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const cam = settings.camera || {};
  video.classList.toggle('mirror', cam.mirror !== false);
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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) start();
});
addEventListener('pagehide', () => stream?.getTracks().forEach((t) => t.stop()));
start();
