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
    onProgress({ stage: 'identify', message: 'Identificando el ítem por foto…' });
    try {
      const gemini = await identifyWithGemini(file, apiKey, onProgress);
      const polished = polishSuggestionName(gemini || {});
      if (polished?.name && !isGarbageProductName(polished.name) && hasReadableLatinTitle(polished.name)) {
        return {
          ...polished,
          source: polished.source || gemini?.source || 'gemini-web',
          confidence: polished.confidence || 'high'
        };
      }
      // Campos parciales limpios → título compuesto (mejor que OCR basura)
      const composed = composeRetailName(polished || gemini || {});
      if (composed && !isGarbageProductName(composed) && hasReadableLatinTitle(composed)) {
        return {
          ...polished,
          name: composed,
          source: polished.source || 'gemini',
          confidence: 'medium',
          note: 'Nombre armado desde franquicia / línea / personaje'
        };
      }
      if (gemini?.name) {
        console.warn('[vision] nombre basura de Gemini, reintento/OCR', gemini.name);
      }
    } catch (err) {
      console.warn('[vision] Gemini falló, uso OCR', err);
      onProgress({ stage: 'ocr', message: 'Reintentando lectura de la foto…' });
    }
  }

  onProgress({ stage: 'ocr', message: 'Identificando el ítem por foto…' });
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
 * Nombre ilegible / OCR basura / caracteres raros / mojibake.
 * @param {string} name
 */
export function isGarbageProductName(name) {
  const s = sanitizeProductName(name);
  if (s.length < 4) return true;
  if (/\uFFFD/.test(String(name || ''))) return true;
  if (/[\uE000-\uF8FF]/.test(String(name || ''))) return true;
  // Mojibake típico (UTF-8 leído como Latin-1)
  if (/[ÃÂÐÑ][\u0080-\u00FF]/.test(String(name || ''))) return true;
  if (/Ã.|Â.|â€/.test(String(name || ''))) return true;
  if (/^(thi|the|this|that|sin nombre|unknown|n\/a|null|untitled|producto)\b/i.test(s)) return true;
  if ((s.match(/\b(the|thi|ths|te|th|this)\b/gi) || []).length >= 2) return true;

  const letters = (s.match(/\p{L}/gu) || []).length;
  if (letters < 4) return true;

  const latin = (s.match(/[A-Za-z]/g) || []).length;
  const cjk = (s.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  // Caja JP mal leída: muchos símbolos/CJK rotos sin latín útil ni CJK coherente
  if (latin < 3 && cjk < 2 && letters < 8) return true;

  const weird = (s.match(/[^\p{L}\p{N}\s\-&:×x.'+/]/gu) || []).length;
  if (weird >= 2 && weird >= Math.max(2, letters * 0.2)) return true;

  const words = s.split(/\s+/).filter(Boolean);
  const junkWords = words.filter((w) => (
    /^[^\p{L}]{1,3}$/u.test(w)
    || /^(thi|ths|rn|vv|il|ii|lll|xx)$/i.test(w)
    || /^[bcdfghjklmnpqrstvwxz]{4,}$/i.test(w)
  ));
  if (junkWords.length >= 2 && words.length <= 6) return true;

  // Palabras “latinas” sin vocales (OCR basura)
  const latinWords = words.filter((w) => /^[A-Za-z]{3,}$/.test(w));
  const noVowel = latinWords.filter((w) => !/[aeiouy]/i.test(w));
  if (latinWords.length >= 2 && noVowel.length >= Math.ceil(latinWords.length * 0.6)) return true;

  if (s.length < 22 && /\b\d{1,2}\b\s*$/.test(s) && /^(thi|the|this)/i.test(s)) return true;

  return false;
}

/**
 * Limpia basura de encoding / símbolos; normaliza fullwidth; conserva × y &.
 * @param {string} name
 */
export function sanitizeProductName(name) {
  let s = String(name || '');
  try {
    s = s.normalize('NFKC');
  } catch {
    // ignore
  }
  s = s
    .replace(/\uFFFD/g, '')
    .replace(/[\u0000-\u001F\u007F\u0080-\u009F]/g, '')
    .replace(/[\uE000-\uF8FF]/g, '')
    // Mojibake frecuente
    .replace(/Ã.|Â.|â€[™œ]/g, ' ')
    .replace(/[□■◆◇※★☆●○・･]+/g, ' ')
    .replace(/[“”„«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—―]/g, '-')
    .replace(/×/g, '×')
    .replace(/\s+/g, ' ')
    .trim();

  // Solo letras/números y puntuación de retail
  s = s.replace(/[^\p{L}\p{N}\s\-&:×x.'+/]/gu, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\s*&\s*/g, ' & ').replace(/\s*×\s*/g, '×').replace(/\s+/g, ' ').trim();
  // Quitar restos tipo "The The" / puntuación huérfana
  s = s.replace(/^[\-–—|:.,]+/, '').replace(/[\-–—|:.,]+$/, '').trim();
  return s.slice(0, 140);
}

/**
 * ¿El texto tiene suficiente latín legible para título de tienda?
 * @param {string} name
 */
export function hasReadableLatinTitle(name) {
  const s = sanitizeProductName(name);
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  return latin >= 6 && !isGarbageProductName(s);
}

/**
 * @param {Blob|File} file
 * @param {string} apiKey
 * @param {(p:{stage:string,message:string})=>void} [onProgress]
 */
async function identifyWithGemini(file, apiKey, onProgress = () => {}) {
  const visionBlob = await prepareVisionBlob(file);
  const base64 = await blobToBase64(visionBlob);
  const mime = visionBlob.type || 'image/jpeg';

  const {
    geminiGenerateContent,
    geminiTextFromResponse,
    resolveGeminiModels
  } = await import('./geminiClient.js');

  const models = await resolveGeminiModels(apiKey, { purpose: 'vision' });
  const preferModel = models[0] || 'gemini-2.5-flash-lite';
  const genOpts = { models, preferModel, purpose: 'vision' };

  const visionPrompt = `You identify ONE collectible from a PHOTO of its BOX or CARD.

Return ONLY valid JSON (no markdown) with keys:
name, manufacturer, franchise, series, character_name, item_number, year, category, confidence.

RULES FOR name (MOST IMPORTANT):
- name MUST be a clean English/romaji retail title used by AmiAmi / eBay / Good Smile.
- Format for figures: "{Franchise} {Line} {Character}" e.g. "BLEACH Glitter & Glamours Nemu Kurotsuchi" or "The Legend of Zelda Nendoroid Link".
- If the box text is Japanese, TRANSLITERATE the character to romaji. Do NOT paste raw OCR garbage.
- NEVER output replacement chars, mojibake, boxes (□), or nonsense like "Thi The", "Ã©", "rn vv".
- If unsure of the character spelling, put best romaji in character_name and still build a clean name from franchise + series + character_name.
- Do NOT invent fake titles. Prefer empty character_name over garbage letters.

FIGURES (Banpresto, Glitter & Glamours, G×materia, Nendoroid, figma, Ichibansho, Pop Up Parade, Figuarts):
- category = "Figura" (never TCG).
- series = product line (Nendoroid, Glitter & Glamours, G×materia…).
- manufacturer when visible (Banpresto, Good Smile, Bandai Spirits…).

TRADING CARDS:
- Read collector code exactly (EXR-009, OP01-001). item_number = that code.
- category = "TCG". name = "{Game} {Card name} {CODE}".`;

  const webPrompt = `Using the PHOTO and live web search, find the EXACT product listing title in English/romaji.
FIGURE → AmiAmi/eBay/Good Smile style title. category "Figura".
TCG → include collector code. category "TCG".
name must be clean Latin/romaji — no OCR junk, no �, no mojibake.
Same JSON keys: name, manufacturer, franchise, series, character_name, item_number, year, category, confidence.`;

  const fixPrompt = `The previous read of this photo produced a BAD product name (garbage/OCR/strange characters).
Look at the PHOTO again and return a CLEAN English/romaji retail title.
Prefer composing: franchise + series/line + character_name (romaji).
If Japanese text is on the box, transliterate — never copy broken OCR.
Return ONLY JSON with the same keys. If you cannot read a clean name, use "" for name and fill franchise/series/character_name when possible.`;

  const imagePart = { inline_data: { mime_type: mime, data: base64 } };

  const runVision = async (prompt, temperature = 0.05) => {
    const out = await geminiGenerateContent(apiKey, {
      contents: [{ parts: [{ text: prompt }, imagePart] }],
      generationConfig: { temperature, responseMimeType: 'application/json' }
    }, genOpts);
    return normalizeSuggestion(parseJsonObject(geminiTextFromResponse(out.data)) || {});
  };

  // 1) Visión pura + JSON estricto
  onProgress({ stage: 'identify', message: 'Identificando el ítem por foto…' });
  let best = null;
  try {
    best = await runVision(visionPrompt, 0.05);
    best.source = 'gemini';
  } catch (err) {
    console.warn('[vision] pase visión falló', err);
  }

  // 2) Grounding web si el nombre es basura o flojo
  if (!best?.name || isGarbageProductName(best.name) || !hasReadableLatinTitle(best.name) || scoreIdentitySuggestion(best) < 40) {
    onProgress({ stage: 'identify', message: 'Buscando el producto en catálogos…' });
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

  // 3) Pase de reparación si el nombre sigue sucio
  if (!best?.name || isGarbageProductName(best.name) || !hasReadableLatinTitle(best.name)) {
    onProgress({ stage: 'identify', message: 'Corrigiendo el nombre leído…' });
    try {
      const again = await runVision(fixPrompt, 0);
      again.source = 'gemini';
      best = preferBetterSuggestion(best, again) || again || best;
    } catch {
      // keep
    }
  }

  if (!best) throw new Error('Gemini no devolvió JSON usable');

  best = polishSuggestionName(best);
  // Si el name sigue basura pero hay piezas limpias, forzar composición
  if (!best.name || isGarbageProductName(best.name) || !hasReadableLatinTitle(best.name)) {
    const composed = composeRetailName(best);
    if (composed && !isGarbageProductName(composed) && hasReadableLatinTitle(composed)) {
      best = normalizeSuggestion({ ...best, name: composed, confidence: best.confidence || 'medium' });
    }
  }

  if (!best.name || isGarbageProductName(best.name)) {
    throw new Error('Gemini no identificó un nombre limpio del producto');
  }
  return best;
}

/**
 * Reduce la foto para visión (mejor texto en caja, menos basura en el modelo).
 * @param {Blob|File} file
 * @returns {Promise<Blob>}
 */
async function prepareVisionBlob(file) {
  if (!file) return file;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const maxSide = 1280;
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height, 1));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);
      const blob = await new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.88);
      });
      return blob || file;
    } finally {
      try { bitmap.close?.(); } catch { /* ignore */ }
    }
  } catch {
    return file;
  }
}

/**
 * Arma título retail a partir de campos estructurados.
 * @param {object} s
 */
export function composeRetailName(s) {
  if (!s) return '';
  const franchise = sanitizeProductName(s.franchise || '');
  const series = sanitizeProductName(s.series || '');
  const character = sanitizeProductName(s.character_name || '');
  const manufacturer = sanitizeProductName(s.manufacturer || '');
  const itemNumber = s.item_number ? String(s.item_number).trim() : '';
  const parts = [];
  if (franchise) parts.push(franchise);
  if (series && !franchise.toLowerCase().includes(series.toLowerCase())) parts.push(series);
  if (character) parts.push(character);
  if (itemNumber && /^[A-Z0-9][A-Z0-9\-/]{2,}$/i.test(itemNumber)) {
    const joined = parts.join(' ');
    if (!joined.toUpperCase().includes(itemNumber.toUpperCase())) parts.push(itemNumber);
  }
  let name = sanitizeProductName(parts.join(' '));
  if ((!name || name.length < 8) && manufacturer && (series || character || itemNumber)) {
    name = sanitizeProductName([manufacturer, series || character, itemNumber].filter(Boolean).join(' '));
  }
  return name;
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
  let itemNumber = s.item_number ? String(s.item_number).trim() : null;
  if (!itemNumber || itemNumber.length < 3) {
    itemNumber = detectItemNumber([name, s.rawText, franchise, series].filter(Boolean).join(' ')) || itemNumber;
  }
  if (itemNumber) itemNumber = normalizeCollectorCode(itemNumber);

  const base = {
    ...s,
    name,
    series,
    character_name: character,
    franchise,
    manufacturer,
    item_number: itemNumber
  };

  if (isGarbageProductName(name) || !hasReadableLatinTitle(name) || name.length < 8) {
    const composed = composeRetailName(base);
    if (composed && !isGarbageProductName(composed) && (hasReadableLatinTitle(composed) || composed.length >= 10)) {
      name = composed;
    } else if (series && character && !isGarbageProductName(`${series} ${character}`)) {
      name = sanitizeProductName(`${series} ${character}`);
    } else if (itemNumber && (franchise || manufacturer)) {
      name = sanitizeProductName([franchise || manufacturer, itemNumber].join(' '));
    } else {
      name = '';
    }
  } else if (series && character) {
    const seriesKey = series.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
    const charFirst = character.toLowerCase().split(/\s+/)[0] || '';
    if (seriesKey && !name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(seriesKey)
      && charFirst && name.toLowerCase().includes(charFirst)) {
      const composed = composeRetailName(base);
      if (composed.length > name.length && !isGarbageProductName(composed)) {
        name = composed;
      }
    }
  }

  // Si hay código TCG, forzar categoría carta
  let category = s.category || null;
  if (itemNumber && /^[A-Z]{2,6}/i.test(itemNumber) && /[-_/]\d/.test(itemNumber)) {
    if (!category || /\bfigura\b/i.test(category)) category = 'TCG';
    if (name && !name.toUpperCase().includes(itemNumber.toUpperCase())) {
      name = sanitizeProductName(`${name} ${itemNumber}`);
    }
  }

  name = sanitizeProductName(name);
  if (isGarbageProductName(name)) name = '';

  return normalizeSuggestion({
    ...s,
    name,
    series,
    character_name: character,
    franchise,
    manufacturer,
    item_number: itemNumber,
    category
  });
}

/**
 * @param {Blob|File} file
 * @param {Function} onProgress
 */
async function identifyWithOcr(file, onProgress) {
  const { createWorker } = await import('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/+esm');
  onProgress({ stage: 'ocr', message: 'Cargando lectura de texto…' });
  const worker = await createWorker('eng+jpn', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && m.progress != null) {
        onProgress({
          stage: 'ocr',
          message: `Identificando el ítem por foto… ${Math.round(m.progress * 100)}%`
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
  const looksTcg = Boolean(itemNumber && /[A-Z].*\d|\d.*[A-Z]/i.test(itemNumber) && /[-_/]/.test(itemNumber))
    || /union\s*arena|ex\s*resource|resource\s*token|tcgplayer|trading\s*card/i.test(full);
  return polishSuggestionName(normalizeSuggestion({
    name: name || [manufacturer, series, itemNumber].filter(Boolean).join(' '),
    manufacturer,
    franchise: looksTcg && /union\s*arena/i.test(full) ? 'Union Arena' : null,
    series,
    character_name: null,
    item_number: itemNumber,
    year: detectYear(full),
    category: looksFigure && !looksTcg ? 'Figura' : (looksTcg ? 'TCG' : null),
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
  if (/union\s*arena/.test(lower)) return 'Union Arena';
  if (/nendoroid/.test(lower)) return 'Nendoroid';
  if (/\bfigma\b/.test(lower)) return 'figma';
  if (/figuarts|s\.h\.figuarts/.test(lower)) return 'S.H.Figuarts';
  if (/pop up parade|popup parade/.test(lower)) return 'Pop Up Parade';
  if (/revoltech/.test(lower)) return 'Revoltech';
  if (/funko|pop!/.test(lower)) return 'Funko Pop';
  if (/g\s*[x×]\s*materia|gxmateria/i.test(lower)) return 'G×materia';
  if (/ichibansho|ichiban kuji/i.test(lower)) return 'Ichibansho';
  if (/glitter\s*&\s*glamours|glitter\s+and\s+glamours/i.test(lower)) return 'Glitter & Glamours';
  if (/ex\s*resource|resource\s*token/i.test(lower)) return 'EX Resource';
  return null;
}

/**
 * Extrae número de figura (No. 563) o código de carta TCG (EXR-009).
 * Prioriza códigos alfanuméricos con guion (cartas).
 * @param {string} text
 * @returns {string|null}
 */
export function detectItemNumber(text) {
  const s = String(text || '');
  if (!s.trim()) return null;

  // 1) Códigos TCG con guion: EXR-009, OP01-001, ST01-015, UA01BT-001
  const tcgHyphen = s.match(/\b([A-Z]{2,6}\d{0,2}[-_/][A-Z]?\d{2,4}(?:[-_/]\d{2,4})?[A-Z]?)\b/i);
  if (tcgHyphen) return normalizeCollectorCode(tcgHyphen[1]);

  // 2) Prefijos conocidos pegados: EXR009 → EXR-009
  const glued = s.match(/\b((?:EXR|OP|ST|UA|BT|EB|P|SP|CS)\d{2,4}[A-Z]?)\b/i);
  if (glued) return normalizeCollectorCode(glued[1]);

  // 3) Figuras: No. 563 / Item 1234
  const figNo = s.match(/\b(?:No\.?|NO\.?|#|Item)\s*(\d{2,5})\b/i);
  if (figNo) return figNo[1];

  // 4) Código alfanumérico compacto (GSC-123)
  const sku = s.match(/\b([A-Z]{2,5}[-_]?\d{2,5}[A-Z]?)\b/);
  if (sku && /[A-Z]/i.test(sku[1]) && /\d/.test(sku[1])) return normalizeCollectorCode(sku[1]);

  // 5) Solo dígitos sueltos (último recurso; evita confundir rarezas [2])
  const bare = s.match(/\b(\d{3,5})\b/);
  if (bare) return bare[1];

  return null;
}

function normalizeCollectorCode(raw) {
  let c = String(raw || '').trim().toUpperCase().replace(/_/g, '-');
  // EXR009 → EXR-009
  if (/^[A-Z]{2,6}\d{2,4}[A-Z]?$/.test(c) && !c.includes('-')) {
    c = c.replace(/^([A-Z]{2,6})(\d)/, '$1-$2');
  }
  return c.slice(0, 24);
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
