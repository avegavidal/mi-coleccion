/**
 * Identificación visual de figuras a partir de una foto.
 * 1) Gemini (key en localStorage / config) → relleno estructurado
 * 2) OCR Tesseract (gratis) → texto de caja / etiqueta
 */

const GEMINI_LS_KEY = 'mi_coleccion_gemini_api_key';

const BRANDS = [
  'Good Smile', 'Good Smile Company', 'Max Factory', 'Bandai', 'Banpresto',
  'Kotobukiya', 'Alter', 'MegaHouse', 'Megahouse', 'FREEing', 'Native',
  'Hot Toys', 'Sideshow', 'Funko', 'Hasbro', 'Mattel', 'McFarlane',
  'Square Enix', 'Sega', 'Taito', 'FuRyu', 'Aniplex', 'Kadokawa',
  'Prime 1', 'Pop Mart', 'Medicom', 'Kaiyodo', 'Revoltech', 'Figuarts',
  'Nendoroid', 'Figma', 'Pop Up Parade', 'SH Figuarts', 'S.H.Figuarts'
];

export function getGeminiApiKey() {
  try {
    const fromLs = localStorage.getItem(GEMINI_LS_KEY);
    if (fromLs && fromLs.trim()) return fromLs.trim();
  } catch {
    // ignore
  }
  return String(window.APP_CONFIG?.GEMINI_API_KEY || '').trim();
}

export function setGeminiApiKey(key) {
  const v = String(key || '').trim();
  try {
    if (v) localStorage.setItem(GEMINI_LS_KEY, v);
    else localStorage.removeItem(GEMINI_LS_KEY);
  } catch (err) {
    throw new Error('No se pudo guardar la key en este dispositivo');
  }
  return v;
}

export function hasGeminiApiKey() {
  return Boolean(getGeminiApiKey());
}

/**
 * @param {Blob|File} file
 * @param {{ onProgress?: (p:{stage:string,message:string})=>void }} [opts]
 */
export async function identifyFigureFromPhoto(file, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const apiKey = getGeminiApiKey();

  if (apiKey) {
    onProgress({ stage: 'gemini', message: 'Identificando figura con Gemini…' });
    try {
      const gemini = await identifyWithGemini(file, apiKey);
      if (gemini?.name) {
        return { ...gemini, source: 'gemini', confidence: gemini.confidence || 'high' };
      }
    } catch (err) {
      console.warn('[vision] Gemini falló, uso OCR', err);
      onProgress({ stage: 'ocr', message: `Gemini no respondió (${err.message}). Probando OCR…` });
    }
  }

  onProgress({ stage: 'ocr', message: 'Leyendo texto de la foto (caja / etiqueta)…' });
  const ocr = await identifyWithOcr(file, onProgress);
  if (!apiKey) {
    ocr.note = (ocr.note || '') + ' Tip: en Configuración guarda tu Gemini API key para mejores resultados.';
  }
  return ocr;
}

/**
 * @param {Blob|File} file
 * @param {string} apiKey
 */
async function identifyWithGemini(file, apiKey) {
  const base64 = await blobToBase64(file);
  const mime = file.type || 'image/jpeg';
  const prompt = `You identify collectibles from a photo: anime/game figures OR trading cards (Pokemon, MTG, Yu-Gi-Oh, One Piece, Lorcana, etc.).
Return ONLY valid JSON (no markdown) with keys:
name (string, product title people would search — for cards include set/code if visible),
manufacturer (string or null),
franchise (string or null),
series (string or null, e.g. Nendoroid / figma / Scarlet & Violet / Modern Horizons),
character_name (string or null),
item_number (string or null — collector number for cards),
year (number or null),
category (string or null — use "TCG" or "Carta" if it is a trading card),
confidence ("high"|"medium"|"low").
If unsure, still guess the best searchable product name. Prefer English or common romanization.`;

  const { geminiGenerateContent, geminiTextFromResponse } = await import('./geminiClient.js');
  const { data } = await geminiGenerateContent(apiKey, {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mime, data: base64 } }
      ]
    }],
    generationConfig: { temperature: 0.2 }
  });

  const text = geminiTextFromResponse(data);
  const parsed = parseJsonObject(text);
  if (!parsed) throw new Error('Gemini no devolvió JSON usable');
  return normalizeSuggestion(parsed);
}

/**
 * @param {Blob|File} file
 * @param {Function} onProgress
 */
async function identifyWithOcr(file, onProgress) {
  const { createWorker } = await import('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/+esm');
  onProgress({ stage: 'ocr', message: 'Cargando motor OCR (solo la 1ª vez)…' });
  const worker = await createWorker('eng+jpn', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && m.progress != null) {
        onProgress({
          stage: 'ocr',
          message: `Leyendo texto… ${Math.round(m.progress * 100)}%`
        });
      }
    }
  });

  try {
    const { data } = await worker.recognize(file);
    const text = (data?.text || '').replace(/\r/g, '');
    return suggestionFromOcrText(text);
  } finally {
    await worker.terminate().catch(() => {});
  }
}

/**
 * @param {string} text
 */
export function suggestionFromOcrText(text) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 3);

  const full = lines.join(' ');
  const manufacturer = detectBrand(full) || detectBrand(lines.join(' | '));
  const itemNumber = detectItemNumber(full);
  const series = detectSeries(full);

  const nameLine = pickNameLine(lines, manufacturer) || lines[0] || '';
  const name = cleanName(nameLine, manufacturer);

  if (!name && !manufacturer && !itemNumber) {
    return {
      name: '',
      manufacturer: null,
      franchise: null,
      series: null,
      character_name: null,
      item_number: null,
      year: null,
      category: null,
      source: 'ocr',
      confidence: 'low',
      rawText: text,
      note: 'No se leyó texto claro. Prueba foto de la caja o guarda Gemini en Configuración.'
    };
  }

  return normalizeSuggestion({
    name: name || [manufacturer, series, itemNumber].filter(Boolean).join(' '),
    manufacturer,
    franchise: null,
    series,
    character_name: null,
    item_number: itemNumber,
    year: detectYear(full),
    category: series || null,
    confidence: name && (manufacturer || itemNumber) ? 'medium' : 'low',
    source: 'ocr',
    rawText: text
  });
}

function detectBrand(text) {
  const lower = text.toLowerCase();
  let best = null;
  for (const b of BRANDS) {
    if (lower.includes(b.toLowerCase())) {
      if (!best || b.length > best.length) best = b;
    }
  }
  return best;
}

function detectSeries(text) {
  const lower = text.toLowerCase();
  if (/nendoroid/.test(lower)) return 'Nendoroid';
  if (/\bfigma\b/.test(lower)) return 'figma';
  if (/figuarts|s\.h\.figuarts/.test(lower)) return 'S.H.Figuarts';
  if (/pop up parade|popup parade/.test(lower)) return 'Pop Up Parade';
  if (/revoltech/.test(lower)) return 'Revoltech';
  if (/funko|pop!/.test(lower)) return 'Funko Pop';
  return null;
}

function detectItemNumber(text) {
  const patterns = [
    /\b(?:No\.?|NO\.?|#|Item\s*)(\d{2,5})\b/i,
    /\b([A-Z]{2,5}[-_]?\d{2,5}[A-Z]?)\b/,
    /\b(\d{3,5})\b/
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1] || m[0];
  }
  return null;
}

function detectYear(text) {
  const m = text.match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

function pickNameLine(lines, brand) {
  const scored = lines.map((line) => {
    let score = line.length;
    if (/^[0-9\W]+$/.test(line)) score -= 50;
    if (brand && line.toLowerCase() === brand.toLowerCase()) score -= 40;
    if (/www\.|\.com|http/i.test(line)) score -= 40;
    if (/nendoroid|figma|figuarts|statue|scale/i.test(line)) score += 20;
    if (/\p{L}{3,}/u.test(line)) score += 10;
    return { line, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.line || '';
}

function cleanName(line, brand) {
  let s = String(line || '').trim();
  if (brand) s = s.replace(new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '').trim();
  s = s.replace(/^[\-–—|:]+/, '').replace(/[\-–—|:]+$/, '').trim();
  return s.slice(0, 120);
}

function normalizeSuggestion(obj) {
  const str = (v) => {
    if (v == null || v === '' || v === 'null' || v === 'undefined') return null;
    return String(v).trim() || null;
  };
  const year = obj.year != null && obj.year !== '' ? Number(obj.year) : null;
  return {
    name: str(obj.name) || '',
    manufacturer: str(obj.manufacturer),
    franchise: str(obj.franchise),
    series: str(obj.series),
    character_name: str(obj.character_name),
    item_number: str(obj.item_number),
    year: Number.isFinite(year) ? year : null,
    category: str(obj.category),
    confidence: obj.confidence || 'medium',
    source: obj.source || 'unknown',
    rawText: obj.rawText || null,
    note: obj.note || null
  };
}

function parseJsonObject(text) {
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || '');
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer la imagen'));
    reader.readAsDataURL(blob);
  });
}
