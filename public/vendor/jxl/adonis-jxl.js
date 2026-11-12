/*
 * JPEG XL coderen en decoderen in de browser (WebAssembly: libjxl via @jsquash/jxl 1.3.0, Apache-2.0; zie LICENSE).
 * Eén thread en zonder SharedArrayBuffer, zodat het overal werkt (ook in de ADONIS-app).
 */
import decFactory from './jxl_dec.js';
import encFactory from './jxl_enc.js';
import { initEmscriptenModule } from './utils.js';

let dec = null;
let enc = null;
const OPTIONS = { effort: 5, quality: 85, progressive: false, epf: -1, lossyPalette: false, decodingSpeedTier: 0, photonNoiseIso: 0, lossyModular: false, lossless: false };

/** JPEG XL (ArrayBuffer) -> ImageData */
export async function decode(buffer) {
  if (!dec) dec = initEmscriptenModule(decFactory);
  const m = await dec;
  const r = m.decode(buffer);
  if (!r) throw new Error('Deze JPEG XL kon niet worden gelezen.');
  return r;
}
/** ImageData -> JPEG XL (ArrayBuffer). quality 0-100 (85 = nauwelijks verschil), effort 1-9 (hoger = kleiner maar trager). */
export async function encode(imageData, options = {}) {
  if (!enc) enc = initEmscriptenModule(encFactory);
  const m = await enc;
  const out = m.encode(imageData.data, imageData.width, imageData.height, { ...OPTIONS, ...options });
  if (!out) throw new Error('Omzetten naar JPEG XL lukte niet.');
  return out.buffer;
}
