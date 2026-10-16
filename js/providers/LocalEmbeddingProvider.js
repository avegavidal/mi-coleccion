/**
 * Embeddings visuales LOCALES en el navegador con Transformers.js + CLIP.
 *
 * Modelo: Xenova/clip-vit-base-patch32 (512 dimensiones)
 * Ejecución: WebAssembly / WebGPU en el dispositivo del usuario
 * Coste: $0 — no envía la foto a una API de IA de pago
 *
 * Primera carga: descarga ~90–150 MB del modelo (cacheado por el navegador).
 * En iPhone puede tardar; se muestra progreso en la UI.
 */
import {
  AutoProcessor,
  CLIPVisionModelWithProjection,
  RawImage,
  env
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/+esm';

import { EmbeddingProvider } from './EmbeddingProvider.js';

const MODEL_ID = 'Xenova/clip-vit-base-patch32';
const DIMENSIONS = 512;

env.allowLocalModels = false;
env.useBrowserCache = true;

function l2Normalize(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

/** CLIP usa ~224px; bajar a esto evita cuelgues de memoria en iPhone al hacer N embeddings. */
const EMBED_MAX_SIDE = 384;

/**
 * @param {Blob|File|HTMLImageElement|HTMLCanvasElement|string} input
 */
async function blobToRawImage(input) {
  if (typeof input === 'string') {
    return RawImage.read(input);
  }

  // Camino preferido: redimensionar antes de CLIP (mucho menos RAM en lotes).
  try {
    let bitmap = null;
    if (input instanceof HTMLImageElement || input instanceof HTMLCanvasElement) {
      bitmap = await createImageBitmap(input);
    } else if (input instanceof Blob || input instanceof File) {
      bitmap = await createImageBitmap(input);
    } else {
      throw new Error('Tipo de imagen no soportado para embedding');
    }
    try {
      const scale = Math.min(1, EMBED_MAX_SIDE / Math.max(bitmap.width, bitmap.height, 1));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.drawImage(bitmap, 0, 0, w, h);
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('No se pudo preparar imagen para embedding'))),
          'image/jpeg',
          0.85
        );
      });
      return RawImage.fromBlob(blob);
    } finally {
      try { bitmap.close?.(); } catch { /* ignore */ }
    }
  } catch {
    // Fallback (HEIC raro / createImageBitmap no disponible)
    if (input instanceof HTMLImageElement || input instanceof HTMLCanvasElement) {
      const canvas = document.createElement('canvas');
      const w = input.naturalWidth || input.width;
      const h = input.naturalHeight || input.height;
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(input, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      return RawImage.fromBlob(blob);
    }
    if (input instanceof Blob || input instanceof File) {
      return RawImage.fromBlob(input);
    }
    throw new Error('Tipo de imagen no soportado para embedding');
  }
}

export class LocalEmbeddingProvider extends EmbeddingProvider {
  constructor() {
    super();
    this._processor = null;
    this._model = null;
    this._loading = null;
    this._progress = 0;
    this._status = 'idle';
    this.onProgress = null;
  }

  getModelId() {
    return MODEL_ID;
  }

  getDimensions() {
    return DIMENSIONS;
  }

  isReady() {
    return Boolean(this._processor && this._model);
  }

  getStatus() {
    return { status: this._status, progress: this._progress };
  }

  async warmup() {
    if (this.isReady()) return this;
    if (this._loading) return this._loading;

    this._status = 'loading';
    this._loading = (async () => {
      try {
        const progressCallback = (data) => {
          if (data?.progress != null) {
            this._progress = Math.round(data.progress);
          } else if (data?.status === 'progress' && data?.loaded && data?.total) {
            this._progress = Math.round((data.loaded / data.total) * 100);
          }
          if (typeof this.onProgress === 'function') {
            this.onProgress(this.getStatus());
          }
        };

        this._processor = await AutoProcessor.from_pretrained(MODEL_ID, {
          progress_callback: progressCallback
        });

        // Preferir WebGPU si existe; WASM en Safari iOS
        let device = 'wasm';
        try {
          if (navigator.gpu) {
            const adapter = await navigator.gpu.requestAdapter();
            if (adapter) device = 'webgpu';
          }
        } catch {
          device = 'wasm';
        }

        this._model = await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, {
          dtype: device === 'webgpu' ? 'fp16' : 'q8',
          device,
          progress_callback: progressCallback
        });

        this._status = 'ready';
        this._progress = 100;
        if (typeof this.onProgress === 'function') this.onProgress(this.getStatus());
        return this;
      } catch (err) {
        this._status = 'error';
        this._loading = null;
        throw err;
      }
    })();

    return this._loading;
  }

  async embedImage(image) {
    await this.warmup();
    this._status = 'inferring';

    const raw = await blobToRawImage(image);
    let inputs;
    let output;
    try {
      inputs = await this._processor(raw);
      output = await this._model(inputs);
      const data = output.image_embeds.data;
      const vec = data instanceof Float32Array ? data : new Float32Array(data);
      return l2Normalize(vec);
    } finally {
      this._status = 'ready';
      // Liberar refs para que el GC pueda recuperar WASM heap entre piezas del lote
      try { inputs = null; output = null; } catch { /* ignore */ }
    }
  }
}

/** Instancia singleton del proveedor local. */
let _instance = null;
export function getLocalEmbeddingProvider() {
  if (!_instance) _instance = new LocalEmbeddingProvider();
  return _instance;
}
