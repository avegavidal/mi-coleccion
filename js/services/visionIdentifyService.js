/**
 * Identificación visual de figuras a partir de una foto.
 * 1) Gemini visión (JSON limpio, sin tools) → título oficial
 * 2) Gemini + Google Search si el nombre sale flojo
 * 3) OCR Tesseract solo si no hay API key / Gemini falla
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
    onProgress({ stage: 'gemini', message: 'Leyendo la foto con Gemini 2.5…' });
    try {
      const gemini = await identifyWithGemini(file, apiKey, onProgress);
      if (gemini?.name && !isGarbageProductName(gemini.name)) {
        return {
          ...gemini,
          source: gemini.source || 'gemini-web',
          confidence: gemini.confidence || 'high'
        };
      }
      if (gemini?.name) {
        console.warn('[vision] nombre basura de Gemini, reintento/OCR', gemini.name);
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
  if (ocr?.name && isGarbageProductName(ocr.name)) {
    return {
      ...ocr,
      name: '',
      confidence: 'low',
      note: 'La foto no dio un nombre claro. Prueba recortar la caja o usa Gemini en Configuración.'
    };
  }
  return ocr;
}

/**
 * Nombre ilegible / OCR basura / caracteres raros.
 * @param {string} name
 */
export function isGarbageProductName(name) {
  const s = String(name || '').trim();
  if (s.length < 4) return true;
  if (/\uFFFD/.test(s)) return true;
  if (/[\uE000-\uF8FF]/.test(s)) return true;
  if (/^(thi|the|this|that|sin nombre|unknown|n\/a|null)\b/i.test(s)) return true;
  if ((s.match(/\b(the|thi|ths|te|th|this)\b/gi) || []).length >= 2) return true;

  const letters = (s.match(/\p{L}/gu) || []).length;
  if (letters < 4) return true;

  const weird = (s.match(/[^\p{L}\p{N}\s\-&:×x.'+/]/gu) || []).length;
  if (weird >= 3 && weird >= letters * 0.25) return true;

  const words = s.split(/\s+/).filter(Boolean);
  const junkWords = words.filter((w) => /^[^\p{L}]{1,3}$/u.test(w) || /^(thi|ths|rn|vv|il)$/i.test(w));
  if (junkWords.length >= 2 && words.length <= 5) return true;

  if (s.length < 22 && /\b\d{1,2}\b\s*$/.test(s) && /^(thi|the|this)/i.test(s)) return true;

  return false;
}

/**
 * Limpia basura de encoding / símbolos sin matar japonés ni ×.
 * @param {string} name
 */
export function sanitizeProductName(name) {
  let s = String(name || '')
    .replace(/\uFFFD/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/[^\p{L}\p{N}\s\-&:×x.'+/]/gu, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\s*&\s*/g, ' & ').replace(/\s+/g, ' ').trim();
  return s.slice(0, 140);
}

/**
 * @param {Blob|File} file
 * @param {string} apiKey
 * @param {(p:{stage:string,message:string})=>void} [onProgress]
 */
async function identifyWithGemini(file, apiKey, onProgress = () => {}) {
  const base64 = await blobToBase64(file);
  const mime = file.type || 'image/jpeg';

  const {
    geminiGenerateContent,
    geminiTextFromResponse,
    resolveGeminiModels
  } = await import('./geminiClient.js');

  const models = await resolveGeminiModels(apiKey, { purpose: 'vision' });
  const preferModel = models[0] || 'gemini-2.5-flash-lite';
  const genOpts = { models, preferModel, purpose: 'vision' };

  const visionPrompt = `You are looking at ONE photo of a collectible (anime figure box or trading card).

Task: read the box/card and return the OFFICIAL retail product title in clear Latin letters when the product is sold that way internationally (AmiAmi / eBay / Bandai English name).

CRITICAL:
- Output a CLEAN human-readable title. No OCR garbage, no random fragments, no "Thi The…", no replacement characters (�).
- FIGURE boxes (Banpresto, Glitter & Glamours, G×materia, Nendoroid, figma, Ichibansho, Pop Up Parade) → category "Figura". Never call them TCG.
- Prefer: Franchise + line + character, e.g. "BLEACH Glitter & Glamours Nemu Kurotsuchi", "Dragon Ball Z G×materia The Vegeta", "Nendoroid Link: Twilight Princess".
- If the box is Japanese, still return the common English/romaji retail title used in Western shops when known.
- Fill series (Glitter & Glamours / G×materia / Nendoroid…), character_name, manufacturer when visible.
- name MUST be ASCII-friendly retail title (romaji OK). Do not dump raw noisy box OCR.

Return ONLY JSON with keys:
name, manufacturer, franchise, series, character_name, item_number, year, category, confidence.`;

  const webPrompt = `Using the PHOTO and live web search, find the EXACT retail listing title for this collectible.
Return the official English/romaji product name shops use (AmiAmi, eBay, Bandai).
Do NOT invent OCR-like fragments. No strange characters.
Same JSON keys: name, manufacturer, franchise, series, character_name, item_number, year, category, confidence.
FIGURE not TCG if the photo shows a figure box.`;

  const imagePart = { inline_data: { mime_type: mime, data: base64 } };

  // 1) Visión pura + JSON estricto (más fiable para el nombre que grounding)
  onProgress({ stage: 'gemini', message: 'Gemini 2.5 lee la caja…' });
  let best = null;
  try {
    const out = await geminiGenerateContent(apiKey, {
      contents: [{ parts: [{ text: visionPrompt }, imagePart] }],
      generationConfig: { temperature: 0.05, responseMimeType: 'application/json' }
    }, genOpts);
    best = normalizeSuggestion(parseJsonObject(geminiTextFromResponse(out.data)) || {});
    best.source = 'gemini';
  } catch (err) {
    console.warn('[vision] pase visión falló', err);
  }

  // 2) Si el nombre es basura o flojo, grounding web
  if (!best?.name || isGarbageProductName(best.name) || scoreIdentitySuggestion(best) < 40) {
    onProgress({ stage: 'gemini', message: 'Buscando título oficial en la web…' });
    try {
      const out = await geminiGenerateContent(apiKey, {
        contents: [{ parts: [{ text: webPrompt }, imagePart] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.1 }
      }, genOpts);
      const web = normalizeSuggestion(parseJsonObject(geminiTextFromResponse(out.data)) || {});
      web.source = 'gemini-web';
      best = preferBetterSuggestion(best, web) || web;
    } catch (err) {
      console.warn('[vision] pase web falló', err);
    }
  }

  // 3) Reintento visión si web ensució el nombre
  if (best?.name && isGarbageProductName(best.name)) {
    try {
      const out = await geminiGenerateContent(apiKey, {
        contents: [{ parts: [{ text: visionPrompt }, imagePart] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' }
      }, genOpts);
      const again = normalizeSuggestion(parseJsonObject(geminiTextFromResponse(out.data)) || {});
      again.source = 'gemini';
      best = preferBetterSuggestion(best, again) || again;
    } catch {
      // keep
    }
  }

  if (!best) throw new Error('Gemini no devolvió JSON usable');

  best = polishSuggestionName(best);
  if (!best.name || isGarbageProductName(best.name)) {
    throw new Error('Gemini no identificó un nombre limpio del producto');
  }
  return best;
}

/**
 * Arma un nombre oficial a partir de franchise/series/character si hace falta.
 * @param {object} s
 */
export function polishSuggestionName(s) {
  if (!s) return s;
  let name = sanitizeProductName(s.name || '');
  const series = sanitizeProductName(s.series || '') || null;
  const character = sanitizeProductName(s.character_name || '') || null;
  const franchise = sanitizeProductName(s.franchise || '') || null;
  const manufacturer = sanitizeProductName(s.manufacturer || '') || null;

  if (isGarbageProductName(name) || name.length < 8) {
    const composed = [franchise, series, character].filter(Boolean).join(' ').trim();
    if (composed.length >= 8 && !isGarbageProductName(composed)) {
      name = composed;
    } else if (series && character) {
      name = `${series} ${character}`.trim();
    }
  } else if (series && character) {
    const seriesKey = series.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
    const charFirst = character.toLowerCase().split(/\s+/)[0] || '';
    if (seriesKey && !name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(seriesKey)
      && charFirst && name.toLowerCase().includes(charFirst)) {
      const composed = [franchise, series, character].filter(Boolean).join(' ');
      if (composed.length > name.length && !isGarbageProductName(composed)) {
        name = composed;
      }
    }
  }

  return normalizeSuggestion({
    ...s,
    name,
    series,
    character_name: character,
    franchise,
    manufacturer
  });
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
    return polishSuggestionName(suggestionFromOcrText(text));
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
    .filter((l) => l.length >= 3 && !isGarbageProductName(l));

  const full = String(text || '').replace(/\r/g, ' ');
  const manufacturer = detectBrand(full) || detectBrand(lines.join(' | '));
  const itemNumber = detectItemNumber(full);
  const series = detectSeries(full);

  const nameLine = pickNameLine(lines, manufacturer) || lines[0] || '';
  let name = sanitizeProductName(cleanName(nameLine, manufacturer));
  if (isGarbageProductName(name)) name = '';

  if (!name && !manufacturer && !itemNumber && !series) {
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
  return polishSuggestionName(normalizeSuggestion({
    name: name || [manufacturer, series, itemNumber].filter(Boolean).join(' '),
    manufacturer,
    franchise: null,
    series,
    character_name: null,
    item_number: itemNumber,
    year: detectYear(full),
    category: looksFigure ? 'Figura' : null,
    confidence: name && (manufacturer || itemNumber || series) ? 'medium' : 'low',
    source: 'ocr',
    rawText: text
  }));
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
    if (isGarbageProductName(line)) score -= 80;
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
  return sanitizeProductName(s).slice(0, 120);
}

function normalizeSuggestion(obj) {
  const str = (v) => {
    if (v == null || v === '' || v === 'null' || v === 'undefined') return null;
    const cleaned = sanitizeProductName(String(v));
    return cleaned || null;
  };
  const year = obj.year != null && obj.year !== '' ? Number(obj.year) : null;
  let name = str(obj.name) || '';
  if (isGarbageProductName(name)) name = '';
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
  if (isGarbageProductName(name)) return -80;
  let score = Math.min(name.length, 40);
  if (s.source === 'market-web') score += 55;
  if (s.source === 'gemini-web') score += 50;
  if (s.source === 'gemini') score += 45;
  if (s.source === 'ocr') score += 4;
  if (s.confidence === 'high') score += 18;
  if (s.confidence === 'medium') score += 8;
  if (s.manufacturer) score += 10;
  if (s.series) score += 12;
  if (s.character_name) score += 12;
  if (/g\s*[x×]\s*materia|nendoroid|figma|figuarts|ichiban|glitter|scale|statue/i.test(name)) score += 22;
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
  if (!next?.name || isGarbageProductName(next.name)) return current || null;
  if (!current?.name || isGarbageProductName(current.name)) return next;
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
    const aGarbage = isGarbageProductName(cleanMarketProductTitle(a.title)) ? 1 : 0;
    const bGarbage = isGarbageProductName(cleanMarketProductTitle(b.title)) ? 1 : 0;
    if (aGarbage !== bGarbage) return aGarbage - bGarbage;
    const aTcg = /tcgplayer/i.test(a.source || '') ? 1 : 0;
    const bTcg = /tcgplayer/i.test(b.source || '') ? 1 : 0;
    if (bTcg !== aTcg) return bTcg - aTcg;
    // Preferir títulos más completos (oficiales suelen ser más largos)
    return String(b.title).length - String(a.title).length;
  });
  const title = cleanMarketProductTitle(ranked[0].title);
  if (!title || title.length < 4 || isGarbageProductName(title)) return null;
  const manufacturer = detectBrand(title);
  const series = detectSeries(title);
  return polishSuggestionName(normalizeSuggestion({
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
  }));
}

function cleanMarketProductTitle(raw) {
  let s = sanitizeProductName(String(raw || ''))
    .replace(/\b(new|used|nib|misb|sold|auction|bid|lot)\b/gi, ' ')
    .replace(/\$\s?\d+([.,]\d+)?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.split(/\s[-–|]\s/)[0].trim();
  return s.slice(0, 140);
}

function parseJsonObject(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
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
