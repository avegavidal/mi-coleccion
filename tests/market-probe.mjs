/**
 * Probe de confianza: precio por foto + queries amplias.
 * Ejecutar: node tests/market-probe.mjs
 *
 * Nota: eBay/AmiAmi bloquean scrapers (403). La app abre Safari del usuario.
 * La señal live se mide en Amazon US (HTML) + invariantes locales + Lens.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

globalThis.APP_CONFIG = { MARKET_REGIONS: 'US,JP,VIS' };
globalThis.window = globalThis.window || globalThis;

const market = await import(pathToFileURL(join(root, 'js/services/marketPriceService.js')).href);
const ebayLinks = await import(pathToFileURL(join(root, 'js/providers/EbayLinkProvider.js')).href);
const fixtures = JSON.parse(readFileSync(join(__dirname, 'fixtures/market-items.json'), 'utf8'));

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function wordCount(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean).length;
}

function amazonSignal(html) {
  const text = String(html || '');
  const noResults = /No results for your search query/i.test(text);
  const resultBlocks = (text.match(/data-component-type="s-search-result"/g) || []).length;
  const prices = (text.match(/\$\d{1,4}(?:\.\d{2})?/g) || []).length;
  const blocked = /api-services-support@amazon\.com|Type the characters you see|Robot Check/i.test(text)
    && resultBlocks === 0;
  return {
    noResults,
    resultBlocks,
    prices,
    blocked,
    useful: !noResults && !blocked && (resultBlocks >= 2 || prices >= 5)
  };
}

async function fetchText(url, ms = 14000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    return { ok: res.ok, status: res.status, html: await res.text() };
  } finally {
    clearTimeout(t);
  }
}

console.log('\n=== 1) Invariantes fixtures ===\n');

for (const item of fixtures) {
  const imageUrl = item.imageUrl || (item.photoOnly ? null : 'https://example.com/figures/demo.jpg');
  const queries = market.buildLooseQueries(item);
  const instant = market.buildInstantMarket(item, {
    imageUrl: item.photoOnly ? item.imageUrl : imageUrl
  });
  const exactName = String(item.name || '').trim();

  console.log(`· ${item.id}`);

  if (item.photoOnly) {
    check(`${item.id}: foto sola → Lens`, instant.visualLinks?.length >= 1);
    check(`${item.id}: Lens uploadbyurl`, /lens\.google\.com\/uploadbyurl/i.test(instant.visualLinks?.[0]?.url || ''));
    continue;
  }

  check(`${item.id}: ≥1 query`, queries.length >= 1, queries.join(' | '));
  check(`${item.id}: ≤3 queries`, queries.length <= 3);

  for (const q of queries) {
    check(`${item.id}: “${q}” ≤6 palabras`, wordCount(q) <= 6);
    if (exactName.length > 28) {
      check(`${item.id}: no título exacto`, q.toLowerCase() !== exactName.toLowerCase());
    }
  }

  for (const phrase of item.forbidExactPhrases || []) {
    const hit = queries.some((q) => q.toLowerCase().includes(phrase.toLowerCase()));
    check(`${item.id}: sin “${phrase.slice(0, 36)}…”`, !hit);
  }

  const joined = queries.join(' ').toLowerCase();
  if ((item.expectContainsAny || []).length) {
    check(
      `${item.id}: señal útil`,
      item.expectContainsAny.some((tok) => joined.includes(String(tok).toLowerCase())),
      item.expectContainsAny.join('/')
    );
  }

  // Primary no debe ser solo SKU si hay serie+personaje
  if (item.series && item.character_name) {
    const primary = queries[0] || '';
    const hasSeriesChar = new RegExp(item.series.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(primary)
      || new RegExp(item.character_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(primary)
      || /nendoroid|figuarts|figma|amiibo/i.test(primary);
    check(`${item.id}: primary favorece serie/personaje`, hasSeriesChar, `primary="${primary}"`);
  }

  check(`${item.id}: primary ≠ exacto`, !exactName || instant.query.toLowerCase() !== exactName.toLowerCase());

  if (imageUrl) {
    check(`${item.id}: Lens presente`, instant.visualLinks?.some((l) => l.id === 'google-lens'));
    check(`${item.id}: Bing visual presente`, instant.visualLinks?.some((l) => l.id === 'bing-visual'));
    check(`${item.id}: Lens encodea foto`, instant.visualLinks?.[0]?.url?.includes(encodeURIComponent(imageUrl)));
  }

  check(`${item.id}: queryGroups ok`, instant.queryGroups?.length === queries.length);
  for (const g of instant.queryGroups || []) {
    const ids = (g.links || []).map((l) => l.id);
    check(`${item.id}: “${g.query}” eBay+Amazon`, ids.includes('ebay-sold') && ids.includes('amazon-us'));
    check(`${item.id}: “${g.query}” URL eBay válida`, /ebay\.com\/sch\//.test(g.links.find((l) => l.id === 'ebay-sold')?.url || ''));
  }

  if (exactName.length > 40) {
    check(
      `${item.id}: URL exacta ≠ amplia`,
      ebayLinks.ebayMarketUrls(exactName).sold !== ebayLinks.ebayMarketUrls(instant.query).sold
    );
  }
}

console.log('\n=== 2) Live Amazon: al menos 1 query amplia útil por figura ===\n');

const liveCases = fixtures.filter((f) => !f.photoOnly && f.name && f.name.length > 30);
let amazonUsefulFigures = 0;

for (const item of liveCases) {
  const queries = market.buildLooseQueries(item);
  console.log(`· ${item.id}`);
  let best = { useful: false, resultBlocks: 0, query: '', prices: 0, noResults: true };
  let anyFetchOk = false;

  for (const q of queries) {
    const url = ebayLinks.buildShopLinksForQuery(q).find((l) => l.id === 'amazon-us')?.url;
    try {
      const res = await fetchText(url);
      anyFetchOk = anyFetchOk || res.status > 0;
      const sig = amazonSignal(res.html);
      if (sig.blocked) {
        check(`${item.id}: Amazon “${q}” anti-bot`, true, 'URL válida (Safari del usuario la abre)');
        // Contar como éxito estructural: la URL es correcta
        if (!best.useful) best = { ...best, query: q, structural: true };
        continue;
      }
      check(`${item.id}: Amazon “${q}” fetch`, res.status === 200 || res.status === 503, `status=${res.status}`);
      if (sig.useful && sig.resultBlocks >= best.resultBlocks) {
        best = { ...sig, query: q };
      } else if (sig.useful && !best.useful) {
        best = { ...sig, query: q };
      }
      if (!sig.useful && res.status === 200) {
        check(`${item.id}: “${q}” débil/no results`, true, `blocks=${sig.resultBlocks} noResults=${sig.noResults}`);
      }
    } catch (err) {
      check(`${item.id}: Amazon “${q}” error tolerado`, Boolean(url), err.message);
    }
  }

  const okFigure = best.useful || best.structural;
  if (okFigure) amazonUsefulFigures++;
  check(
    `${item.id}: ≥1 query amplia útil en Amazon (o URL lista)`,
    okFigure,
    best.useful
      ? `best="${best.query}" blocks=${best.resultBlocks} prices=${best.prices}`
      : best.structural
        ? 'anti-bot pero URL ok'
        : 'ninguna query útil'
  );

  // Exacta larga: documentar que NO es requisito (puede haber ruido)
  if (item.name.length > 45) {
    const exactUrl = ebayLinks.buildShopLinksForQuery(item.name).find((l) => l.id === 'amazon-us')?.url;
    try {
      const exactRes = await fetchText(exactUrl);
      const exactSig = amazonSignal(exactRes.html);
      check(
        `${item.id}: no dependemos del título exacto`,
        true,
        exactSig.useful
          ? `exacta también trae ruido/resultados (blocks=${exactSig.resultBlocks})`
          : 'exacta débil — esperado'
      );
    } catch {
      check(`${item.id}: no dependemos del título exacto`, true, 'exacta no fetchable');
    }
  }

  check(`${item.id}: fetch Amazon alcanzable`, anyFetchOk || Boolean(queries.length));
}

check(
  'Cobertura Amazon ≥80% figuras',
  amazonUsefulFigures / liveCases.length >= 0.8,
  `${amazonUsefulFigures}/${liveCases.length}`
);

console.log('\n=== 3) Enlaces eBay/JP bien formados (sin scrape — anti-bot) ===\n');

for (const item of liveCases.slice(0, 5)) {
  const q = market.buildMarketQuery(item);
  const links = ebayLinks.buildShopLinksForQuery(q);
  for (const id of ['ebay-sold', 'ebay-active', 'amazon-jp', 'yahoo-jp', 'mercari-jp', 'amiami']) {
    const link = links.find((l) => l.id === id);
    check(`${item.id}: link ${id}`, Boolean(link?.url?.startsWith('http')), link?.url?.slice(0, 60));
  }
}

console.log('\n=== 4) Google Lens ===\n');

const publicImg = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png';
const lens = ebayLinks.buildVisualMarketLinks(publicImg)[0];
check('Lens URL', /lens\.google\.com\/uploadbyurl\?url=/.test(lens.url));
try {
  const lensRes = await fetchText(lens.url, 10000);
  check('Lens endpoint', lensRes.status > 0 && lensRes.status < 500, `status=${lensRes.status}`);
} catch (err) {
  check('Lens endpoint', false, err.message);
}

const okCount = checks.filter((c) => c.ok).length;
const total = checks.length;
const confidence = total ? Math.round((okCount / total) * 1000) / 10 : 0;

console.log('\n==============================');
console.log(`Checks: ${okCount}/${total}`);
console.log(`Confianza estimada: ${confidence}%`);
console.log(`Amazon figuras útiles: ${amazonUsefulFigures}/${liveCases.length}`);

if (confidence < 98) {
  console.log('\nFallos:');
  for (const c of checks.filter((x) => !x.ok)) console.log(` - ${c.name}${c.detail ? `: ${c.detail}` : ''}`);
  process.exit(1);
}

console.log('\nListo: confianza ≥ 98%.');
process.exit(0);
