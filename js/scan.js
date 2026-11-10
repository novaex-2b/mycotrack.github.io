// Reading the QR codes printed on MycoTrack labels with the phone camera.
// Uses the browser's BarcodeDetector where there is one (Android Chrome), otherwise jsQR.

let stream = null, timer = null;

export async function startScan(video, onCode, onStatus) {
  stopScan();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    onStatus("This browser can't use the camera here. The app must be opened over https:// (or localhost).");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
  } catch (e) {
    onStatus(e.name === "NotAllowedError" ? "Camera permission was refused. Allow it in the browser's site settings to scan labels."
      : `Couldn't start the camera (${e.message}).`);
    return;
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  let detector = null;
  if ("BarcodeDetector" in window) {
    try { if ((await BarcodeDetector.getSupportedFormats()).includes("qr_code")) detector = new BarcodeDetector({ formats: ["qr_code"] }); }
    catch { detector = null; }
  }
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
  onStatus("Looking for a QR code…");
  const tick = async () => {
    if (!stream) return;
    try {
      if (video.readyState >= 2 && video.videoWidth) {
        let text = null;
        if (detector) {
          const found = await detector.detect(video);
          if (found.length) text = found[0].rawValue;
        } else if (window.jsQR) {
          const w = Math.min(640, video.videoWidth), h = Math.round(video.videoHeight * (w / video.videoWidth));
          canvas.width = w; canvas.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          const r = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
          if (r) text = r.data;
        }
        if (text) { if (navigator.vibrate) navigator.vibrate(40); onCode(text); return; }
      }
    } catch { /* keep trying */ }
    timer = setTimeout(tick, 180);
  };
  tick();
}

export function stopScan() {
  clearTimeout(timer);
  if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null; }
}

/** What a label's QR code points at. Culture labels start with the culture's code, grow labels with
 *  the grow label, batch labels with "B-003 2/6". Returns a route or null. */
export function routeFor(text, ds) {
  const first = String(text || "").split(/\r?\n/)[0].trim();
  if (!first) return null;
  const lower = first.toLowerCase();
  const byName = (arr, key) => arr.find((x) => (x[key] || "").toLowerCase() === lower);
  const c = byName([...ds.cultures.values()], "name");
  if (c) return `#/culture/${c.id}`;
  const g = byName(ds.grows, "label");
  if (g) return `#/grow/${g.id}`;
  const label = first.replace(/\s+\d+\/\d+$/, "").toLowerCase();
  const b = [...ds.batches.values()].find((x) => (x.label || "").toLowerCase() === label);
  if (b) return `#/batch/${b.id}`;
  return null;
}
