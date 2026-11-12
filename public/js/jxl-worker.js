/* JPEG XL in een aparte thread (de pagina blijft soepel): { id, op: 'encode'|'decode', ... } -> { id, ok, ... } */
import { encode, decode } from '../vendor/jxl/adonis-jxl.js';

self.onmessage = async (e) => {
  const { id, op } = e.data;
  try {
    if (op === 'decode') {
      const img = await decode(e.data.buf);
      self.postMessage({ id, ok: true, width: img.width, height: img.height, buf: img.data.buffer }, [img.data.buffer]);
    } else {
      const { width, height } = e.data;
      const out = await encode({ data: new Uint8ClampedArray(e.data.buf), width, height }, e.data.opts || {});
      self.postMessage({ id, ok: true, buf: out }, [out]);
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
