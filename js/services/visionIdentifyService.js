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
    onProgress({ stage: 'gemini', message: 'Identificando figura con Gemini + web…' });
    try {
      const gemini = await identifyWithGemini(file, apiKey);
      if (gemini?.name) {
        return {
          ...gemini,
          source: gemini.source || 'gemini-web',
          confidence: gemini.confidence || 'high'
        };
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
  const prompt = `You identify collectibles from a photo using LIVE web search when possible.
Products: anime/game FIGURES (Banpresto, Good Smile, Bandai Spirits, Kotobukiya…) OR trading cards (Pokemon TCG, MTG, Yu-Gi-Oh…).

CRITICAL — product type:
- A BOX or packaging that says "figure", "large scale figure", Banpresto, Ban Dai Spirits, Glitter & Glamours, G×materia, Nendoroid, figma, Ichibansho, Pop Up Parade → it is a FIGURE, never a trading card.
- Flat cardboard BOX of a figure is still a figure (not a TCG card).
- Only use category "TCG" / "Carta" for actual trading cards (holo card front, set symbol, collector number like 25/198).

CRITICAL — title:
- Prefer the OFFICIAL retail product title (Bandai, Good Smile, Banpresto, etc.), not OCR noise from the box.
- Good examples: "BLEACH Glitter & Glamours Nemu Kurotsuchi", "Dragon Ball Z G×materia The Vegeta", "Nendoroid Link: Twilight Princess".
- Bad examples (never invent these): "Thi The Vegeta 14", random partial box text.
- Include the line/series when known (Glitter & Glamours, G×materia, Ichibansho, Nendoroid, figma, S.H.Figuarts…).
- Search retailers / listings if unsure.

Return ONLY valid JSON (no markdown) with keys:
name (string, official searchable product title),
manufacturer (string or null),
franchise (string or null),
series (string or null, e.g. Glitter & Glamours / G×materia / Nendoroid / Scarlet & Violet),
character_name (string or null),
item_number (string or null),
year (number or null),
category (string or null — "Figura" for figures; "TCG" or "Carta" ONLY for trading cards),
confidence ("high"|"medium"|"low").`;

  const { geminiGenerateContent, geminiTextFromResponse } = await import('./geminiClient.js');
  const bodyPlain = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mime, data: base64 } }
      ]
    }],
    generationConfig: { temperature: 0.1 }
  };
  const bodyWithTools = {
    ...bodyPlain,
    tools: [{ google_search: {} }]
  };

  let data;
  try {
    const out = await geminiGenerateContent(apiKey, bodyWithTools);
    data = out.data;
  } catch {
    const out = await geminiGenerateContent(apiKey, bodyPlain);
    data = out.data;
  }

  let text = geminiTextFromResponse(data);
  let parsed = parseJsonObject(text);
  // Si grounding no dio nombre usable, reintentar sin tools
  if (!parsed?.name) {
    try {
      const out = await geminiGenerateContent(apiKey, bodyPlain);
      text = geminiTextFromResponse(out.data);
      parsed = parseJsonObject(text) || parsed;
    } catch {
      // keep first
    }
  }
  if (!parsed) throw new Error('Gemini no devolvió JSON usable');
  const normalized = normalizeSuggestion(parsed);
  if (!normalized.name) throw new Error('Gemini no identificó el producto');
  return {
    ...normalized,
    source: 'gemini-web'
  };
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

  const looksFigure = /\b(figure|figura|banpresto|glitter|nendoroid|figma|figuarts|scale|g\s*[x×]\s*materia|ichiban)\b/i.test(full)
    || /\b(banpresto|good\s*smile|bandai\s*spirits)\b/i.test(manufacturer || '');
  return normalizeSuggestion({
    name: name || [manufacturer, series, itemNumber].filter(Boolean).join(' '),
    manufacturer,
    franchise: null,
    series,
    character_name: null,
    item_number: itemNumber,
    year: detectYear(full),
    category: looksFigure ? 'Figura' : null,
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
  if (/g\s*[x×]\s*materia|gxmateria/i.test(lower)) return 'G×materia';
  if (/ichibansho|ichiban kuji/i.test(lower)) return 'Ichibansho';
  if (/glitter\s*&\s*glamours|glitter\s+and\s+glamours/i.test(lower)) return 'Glitter & Glamours';
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
    if (/glitter|glamours|nendoroid|figma|materia|ichiban|banpresto|bleach|dragon\s*ball/i.test(line)) score += 40;
    if (/nemu|kurotsuchi|vegeta|goku|link|zelda/i.test(line)) score += 30;
    if (brand && line.toLowerCase().includes(brand.toLowerCase())) score -= 10;
    if (brand && line.toLowerCase() === brand.toLowerCase()) score -= 40;
    if (/made in|copyright|spirits|namco|shueisha/i.test(line)) score -= 25;
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
  const name = str(obj.name) || '';
  const manufacturer = str(obj.manufacturer);
  const series = str(obj.series);
  const franchise = str(obj.franchise);
  const character_name = str(obj.character_name);
  const item_number = str(obj.item_number);
  let category = str(obj.category);
  const blob = [category, series, franchise, name, manufacturer].filter(Boolean).join(' ');
  if (/\b(figure|figura|nendoroid|figma|figuarts|banpresto|glitter\s*&\s*glamours|glitter\s+and\s+glamours|g\s*[x×]\s*materia|ichibansho|pop\s*up\s*parade|prize)\b/i.test(blob)) {
    category = 'Figura';
  }
  return {
    name,
    manufacturer,
    franchise,
    series,
    character_name,
    item_number,
    year: Number.isFinite(year) ? year : null,
    category,
    confidence: obj.confidence || 'medium',
    source: obj.source || 'unknown',
    rawText: obj.rawText || null,
    note: obj.note || null
  };
}

/**
 * Puntuación para elegir entre OCR basura vs nombre web oficial.
 * @param {object|null} s
 */
export function scoreIdentitySuggestion(s) {
  if (!s?.name) return -100;
  const name = String(s.name);
  let score = Math.min(name.length, 40);
  if (s.source === 'market-web') score += 55;
  if (s.source === 'gemini-web') score += 50;
  if (s.source === 'gemini') score += 28;
  if (s.source === 'ocr') score += 4;
  if (s.confidence === 'high') score += 18;
  if (s.confidence === 'medium') score += 8;
  if (s.manufacturer) score += 10;
  if (s.series) score += 12;
  if (/g\s*[x×]\s*materia|nendoroid|figma|figuarts|ichiban|scale|statue/i.test(name)) score += 22;
  // OCR basura típica
  if (/^(thi|the|this|that)\b/i.test(name.trim())) score -= 40;
  if (/\b\d{1,2}\b$/.test(name.trim()) && name.length < 22) score -= 15;
  if ((name.match(/\bthe\b/gi) || []).length >= 2) score -= 20;
  return score;
}

/**
 * Elige la mejor identidad (web/mercado gana sobre OCR).
 * @param {object|null} current
 * @param {object|null} next
 */
export function preferBetterSuggestion(current, next) {
  if (!next?.name) return current || null;
  if (!current?.name) return next;
  return scoreIdentitySuggestion(next) >= scoreIdentitySuggestion(current) ? next : current;
}

/**
 * Nombre oficial a partir de títulos de coincidencias de mercado (web).
 * @param {Array<{ title?: string, source?: string, price?: number }>} matches
 */
export function suggestionFromMarketMatches(matches) {
  const list = (matches || []).filter((m) => m?.title && Number(m.price) > 0);
  if (!list.length) return null;
  const ranked = [...list].sort((a, b) => {
    const aTcg = /tcgplayer/i.test(a.source || '') ? 1 : 0;
    const bTcg = /tcgplayer/i.test(b.source || '') ? 1 : 0;
    if (bTcg !== aTcg) return bTcg - aTcg;
    return String(a.title).length - String(b.title).length;
  });
  const title = cleanMarketProductTitle(ranked[0].title);
  if (!title || title.length < 4) return null;
  const manufacturer = detectBrand(title);
  const series = detectSeries(title);
  return normalizeSuggestion({
    name: title,
    manufacturer,
    franchise: null,
    series,
    character_name: null,
    item_number: detectItemNumber(title),
    year: null,
    category: series,
    confidence: 'high',
    source: 'market-web',
    note: 'Nombre tomado del resultado web de precios'
  });
}

function cleanMarketProductTitle(raw) {
  let s = String(raw || '')
    .replace(/\s+/g, ' ')
    .replace(/\b(new|used|nib|misb|sold|auction|bid|lot)\b/gi, ' ')
    .replace(/\$\s?\d+([.,]\d+)?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Quitar sufijos de listing largos
  s = s.split(/\s[-–|]\s/)[0].trim();
  return s.slice(0, 140);
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
