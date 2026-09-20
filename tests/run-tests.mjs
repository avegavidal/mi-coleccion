/**
 * Suite de pruebas sin dependencias externas.
 * Ejecutar: node tests/run-tests.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('..', import.meta.url));
let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err: err.message });
    console.log(`  ✗ ${name}`);
    console.log(`    → ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err: err.message });
    console.log(`  ✗ ${name}`);
    console.log(`    → ${err.message}`);
  }
}

// Cargar utilidades (ESM del proyecto)
const sim = await import(pathToFileURL(join(root, 'js/utils/similarity.js')).href);

console.log('\n=== Agrupación y similitud ===');
test('groupMatchesByItem agrupa por pieza y toma max similitud', () => {
  const rows = [
    { item_id: 'a', image_id: '1', similarity: 0.91, item_name: 'Spidey', storage_path: 'u/a/1.jpg', image_type: 'frontal' },
    { item_id: 'a', image_id: '2', similarity: 0.94, item_name: 'Spidey', storage_path: 'u/a/2.jpg', image_type: 'trasera' },
    { item_id: 'b', image_id: '3', similarity: 0.83, item_name: 'Batman', storage_path: 'u/b/3.jpg', image_type: 'frontal' }
  ];
  const g = sim.groupMatchesByItem(rows);
  assert(g.length === 2, `esperado 2, got ${g.length}`);
  assert(g[0].itemId === 'a', 'primero debe ser a');
  assert(g[0].similarity === 0.94, 'max similitud a = 0.94');
  assert(g[0].images.length === 2, 'a tiene 2 imágenes');
  assert(g[1].itemId === 'b', 'segundo b');
});

test('no duplica la misma pieza como resultados distintos', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    item_id: 'same',
    image_id: String(i),
    similarity: 0.7 + i * 0.02,
    item_name: 'X',
    storage_path: `p/${i}.jpg`,
    image_type: 'additional'
  }));
  const g = sim.groupMatchesByItem(rows);
  assert(g.length === 1, 'una sola pieza');
  assert(Math.abs(g[0].similarity - 0.78) < 1e-9, 'mejor similitud');
});

test('classifySimilarity respeta umbrales', () => {
  const s = { high_similarity_threshold: 0.82, medium_similarity_threshold: 0.7, low_similarity_threshold: 0.55 };
  assert(sim.classifySimilarity(0.9, s) === 'high');
  assert(sim.classifySimilarity(0.75, s) === 'medium');
  assert(sim.classifySimilarity(0.6, s) === 'low');
  assert(sim.classifySimilarity(0.4, s) === 'none');
});

test('formatSimilarity redondea a porcentaje', () => {
  assert(sim.formatSimilarity(0.943) === '94%');
  assert(sim.formatSimilarity(0) === '0%');
});

test('splitStrongWeak separa correctamente', () => {
  const s = { high_similarity_threshold: 0.82, medium_similarity_threshold: 0.7, low_similarity_threshold: 0.55 };
  const grouped = [
    { similarity: 0.94 },
    { similarity: 0.72 },
    { similarity: 0.6 },
    { similarity: 0.4 }
  ];
  const { strong, weak, hasClearMatch } = sim.splitStrongWeak(grouped, s);
  assert(strong.length === 2, '2 strong');
  assert(weak.length === 1, '1 weak');
  assert(hasClearMatch === true);
});

test('l2Normalize produce norma ~1', () => {
  const v = sim.l2Normalize([3, 4]);
  const n = Math.hypot(v[0], v[1]);
  assert(Math.abs(n - 1) < 1e-6, `norma ${n}`);
});

test('cosineSimilarity de vectores iguales = 1', () => {
  const a = sim.l2Normalize([1, 2, 3]);
  assert(Math.abs(sim.cosineSimilarity(a, a) - 1) < 1e-6);
});

test('parseHashRoute y rutas públicas', () => {
  assert(sim.parseHashRoute('#/identify').name === 'identify');
  assert(sim.parseHashRoute('#/item/abc').params[0] === 'abc');
  assert(sim.parseHashRoute('').name === 'dashboard');
  assert(sim.isPublicRoute('login'));
  assert(!sim.isPublicRoute('dashboard'));
});

test('storagePathOwnedBy valida ownership', () => {
  assert(sim.storagePathOwnedBy('uid-1/item/a.jpg', 'uid-1'));
  assert(!sim.storagePathOwnedBy('uid-2/item/a.jpg', 'uid-1'));
  assert(!sim.storagePathOwnedBy('', 'uid-1'));
});

test('escapeCsv maneja comillas', () => {
  assert(sim.escapeCsv('hola') === 'hola');
  assert(sim.escapeCsv('a,b') === '"a,b"');
  assert(sim.escapeCsv('say "hi"') === '"say ""hi"""');
});

console.log('\n=== Integridad del proyecto ===');
const required = [
  'index.html',
  'manifest.json',
  'service-worker.js',
  '.nojekyll',
  'css/styles.css',
  'js/config.js',
  'js/config.example.js',
  'js/app.js',
  'js/services/authService.js',
  'js/services/collectionService.js',
  'js/services/imageService.js',
  'js/services/embeddingService.js',
  'js/services/recognitionService.js',
  'js/services/wishlistService.js',
  'js/services/exportService.js',
  'js/services/statsService.js',
  'js/services/marketPriceService.js',
  'js/services/geminiClient.js',
  'js/providers/LocalEmbeddingProvider.js',
  'js/providers/RemoteEmbeddingProvider.js',
  'js/providers/EmbeddingProvider.js',
  'js/providers/MarketPriceProvider.js',
  'js/providers/EbayLinkProvider.js',
  'js/providers/EbayActiveProvider.js',
  'js/providers/AutoMarketSearchProvider.js',
  'js/utils/imageCrop.js',
  'js/screens/categories.js',
  'sql/schema.sql',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-180.png'
];

for (const f of required) {
  test(`existe ${f}`, () => {
    assert(existsSync(join(root, f)), `falta ${f}`);
  });
}

test('index.html referencia config, app, manifest y CSS', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert(html.includes('js/config.js'));
  assert(html.includes('js/app.js'));
  assert(html.includes('manifest.json'));
  assert(html.includes('css/styles.css'));
  assert(html.includes('apple-mobile-web-app-capable'));
});

test('config no asigna service_role key', () => {
  const cfg = readFileSync(join(root, 'js/config.js'), 'utf8');
  // Permitir mencionar el peligro en comentarios; prohibir asignar la key
  assert(!/SERVICE_ROLE|service_role\s*[:=]\s*['"`]eyJ/i.test(cfg), 'no debe asignar service_role');
  assert(cfg.includes('SUPABASE_ANON_KEY'), 'debe usar anon key');
});

test('schema SQL tiene RLS, match_item_images y auth.uid', () => {
  const sql = readFileSync(join(root, 'sql/schema.sql'), 'utf8');
  assert(sql.includes('ENABLE ROW LEVEL SECURITY'));
  assert(sql.includes('match_item_images'));
  assert(sql.includes('auth.uid()'));
  assert(sql.includes('vector(512)'));
  assert(sql.includes('item-photos'));
  assert(sql.includes('public = FALSE') || sql.includes('public, FALSE') || sql.includes('FALSE'));
});

test('RPC filtra por user autenticado', () => {
  const sql = readFileSync(join(root, 'sql/schema.sql'), 'utf8');
  assert(sql.includes('ii.user_id = auth.uid()'));
  assert(sql.includes('IF auth.uid() IS NULL'));
});

test('manifest es standalone PWA', () => {
  const m = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  assert(m.display === 'standalone');
  assert(m.icons?.length >= 2);
});

test('CSS define touch targets y safe areas', () => {
  const css = readFileSync(join(root, 'css/styles.css'), 'utf8');
  assert(css.includes('safe-area-inset'));
  assert(css.includes('min-height: 52px') || css.includes('min-height: 48px'));
  assert(css.includes('backdrop-filter'));
  assert(css.includes('prefers-reduced-motion'));
});

test('LocalEmbeddingProvider usa CLIP local', () => {
  const src = readFileSync(join(root, 'js/providers/LocalEmbeddingProvider.js'), 'utf8');
  assert(src.includes('clip-vit-base-patch32'));
  assert(src.includes('@huggingface/transformers'));
});

test('embeddingService apunta a proveedor local', () => {
  const src = readFileSync(join(root, 'js/services/embeddingService.js'), 'utf8');
  assert(src.includes('getLocalEmbeddingProvider'));
});

test('router protege rutas privadas', () => {
  const src = readFileSync(join(root, 'js/utils/router.js'), 'utf8');
  assert(src.includes('currentUser'));
  assert(src.includes('login'));
});

test('no hay secretos hardcodeados tipo sk-', () => {
  function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git') continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p, out);
      else if (['.js', '.html', '.json', '.md', '.css'].includes(extname(name))) out.push(p);
    }
    return out;
  }
  const files = walk(root);
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    assert(!/service_role\s*[:=]\s*['"]eyJ/.test(t), `posible service_role en ${f}`);
    assert(!/sk-[a-zA-Z0-9]{20,}/.test(t), `posible secret key en ${f}`);
  }
});

console.log('\n=== Import ESM de servicios críticos ===');
await testAsync('similarity.js exporta API completa', async () => {
  assert(typeof sim.groupMatchesByItem === 'function');
  assert(typeof sim.splitStrongWeak === 'function');
});

// Simular política: path de storage debe empezar por user id
test('política conceptual storage path', () => {
  const userA = 'aaa';
  const userB = 'bbb';
  const pathA = `${userA}/item1/foto.jpg`;
  assert(sim.storagePathOwnedBy(pathA, userA));
  assert(!sim.storagePathOwnedBy(pathA, userB));
});

console.log('\n=== Precio de mercado US/JP ===');
const market = await import(pathToFileURL(join(root, 'js/services/marketPriceService.js')).href);
const ebayProv = await import(pathToFileURL(join(root, 'js/providers/EbayActiveProvider.js')).href);
const ebayLinks = await import(pathToFileURL(join(root, 'js/providers/EbayLinkProvider.js')).href);

test('buildMarketQuery prioriza señales amplias (no título exacto)', () => {
  const q = market.buildMarketQuery({
    manufacturer: 'Good Smile',
    item_number: 'GSC-123',
    name: 'Nendoroid Link Twilight Princess Exclusive Edition Ver.2',
    franchise: 'Zelda'
  });
  assert(q.length > 0);
  assert(!/Exclusive Edition/i.test(q), 'no debe usar el título exacto largo');
  assert(wordCountSafe(q) <= 6);
});

test('buildLooseQueries prioriza serie+personaje y código', () => {
  const qs = market.buildLooseQueries({
    manufacturer: 'Bandai',
    series: 'S.H.Figuarts',
    character_name: 'Goku',
    name: 'S.H.Figuarts Son Goku Super Saiyan Ultra Instinct Sign Special Color Edition'
  });
  assert(qs.length >= 1);
  assert(qs.some((q) => /Figuarts/i.test(q) && /Goku/i.test(q)), qs.join(' | '));
  assert(qs.every((q) => !/Special Color Edition/i.test(q)));
  assert(/Figuarts|Goku/i.test(qs[0]), `primary debería ser serie/personaje: ${qs[0]}`);
});

function wordCountSafe(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean).length;
}

test('summarizePrices calcula mediana', () => {
  const s = market.summarizePrices([10, 20, 30, 40, 1000]);
  assert(s.count === 5);
  assert(s.median != null);
  assert(s.low <= s.median && s.median <= s.high);
});

test('classifyDeal marca buen precio bajo la mediana', () => {
  const d = market.classifyDeal(30, 50);
  assert(d.code === 'steal' || d.code === 'good', d.code);
});

test('classifyDeal marca caro sobre la mediana', () => {
  const d = market.classifyDeal(80, 50);
  assert(d.code === 'expensive' || d.code === 'high', d.code);
});

test('enlaces US/JP incluyen eBay, Amazon y Yahoo JP', () => {
  const links = ebayLinks.buildMarketLinks('figma goku');
  const ids = links.map((l) => l.id);
  assert(ids.includes('ebay-sold'));
  assert(ids.includes('ebay-active'));
  assert(ids.includes('amazon-us'));
  assert(ids.includes('amazon-jp'));
  assert(ids.includes('yahoo-jp'));
  assert(ids.includes('mercari-jp'));
  assert(ids.includes('amiami'));
  assert(ids.includes('mandarake'));
  assert(ids.includes('tcgplayer'));
  assert(ids.includes('cardmarket'));
  assert(!ids.some((id) => id.includes('mercado') || id.includes('ml')), 'sin Mercado Libre');
});

test('TCGPlayer y Cardmarket priorizados para cartas', () => {
  assert(ebayLinks.isTcgCardItem({ category: 'TCG', name: 'Charizard ex' }));
  assert(ebayLinks.isTcgCardItem({ franchise: 'Pokemon', name: 'Pikachu 025' }));
  assert(!ebayLinks.isTcgCardItem({ series: 'Nendoroid', name: 'Link' }));
  const links = ebayLinks.buildShopLinksForQuery('Charizard ex 223', { tcg: true });
  assert(links[0].id === 'tcgplayer', links[0].id);
  assert(links.some((l) => l.id === 'cardmarket'));
  assert(links.some((l) => l.id === 'pricecharting'));
  assert(/tcgplayer\.com\/search/.test(links[0].url));
});

test('enlaces visuales con imageUrl', () => {
  const links = ebayLinks.buildMarketLinks('test', { imageUrl: 'https://example.com/a.jpg' });
  const ids = links.map((l) => l.id);
  assert(ids.includes('google-lens'));
  assert(ids.includes('bing-visual'));
});

test('OCR suggestionFromOcrText detecta marca y nombre', async () => {
  const vis = await import(pathToFileURL(join(root, 'js/services/visionIdentifyService.js')).href);
  const s = vis.suggestionFromOcrText('Good Smile Company\nNendoroid Link\nNo. 563');
  assert(s.manufacturer && /good smile/i.test(s.manufacturer));
  assert(s.name || s.item_number);
});

test('extractEbayPrices lee montos del HTML', () => {
  const html = `
    <span class="s-item__price">$24.99</span>
    <span class="s-item__price">US $31.00</span>
    <span class="s-item__price">$18.50</span>
  `;
  const prices = ebayProv.extractEbayPrices(html);
  assert(prices.length >= 3, String(prices));
  assert(prices.includes(24.99));
});

test('market service no usa Mercado Libre', () => {
  const src = readFileSync(join(root, 'js/services/marketPriceService.js'), 'utf8');
  assert(!/MercadoLibre|mercadolibre\.com/i.test(src));
  assert(!existsSync(join(root, 'js/providers/MercadoLibreProvider.js')));
});

console.log('\n=== Recorte de imagen (anti-ruido) ===');
const crop = await import(pathToFileURL(join(root, 'js/utils/imageCrop.js')).href);

test('defaultCenterCrop centra y cabe en la imagen', () => {
  const r = crop.defaultCenterCrop(1000, 800, 0.7);
  assert(r.w > 0 && r.h > 0);
  assert(r.x >= 0 && r.y >= 0);
  assert(r.x + r.w <= 1000);
  assert(r.y + r.h <= 800);
  assert(Math.abs(r.x - (1000 - r.w) / 2) <= 1);
});

test('clampRect no sale de bounds y respeta minSide', () => {
  const r = crop.clampRect({ x: -50, y: 900, w: 2000, h: 10 }, { w: 500, h: 400 }, 40);
  assert(r.x >= 0 && r.y >= 0);
  assert(r.x + r.w <= 500);
  assert(r.y + r.h <= 400);
  assert(r.w >= 40 && r.h >= 40);
});

test('containLayout letterbox horizontal', () => {
  const L = crop.containLayout(2000, 1000, 400, 400);
  assert(Math.abs(L.w - 400) < 0.01);
  assert(Math.abs(L.h - 200) < 0.01);
  assert(Math.abs(L.top - 100) < 0.01);
  assert(Math.abs(L.left) < 0.01);
});

test('displayRectToNatural roundtrip aprox', () => {
  const natural = { w: 1000, h: 800 };
  const layout = crop.containLayout(1000, 800, 500, 400);
  const nat = crop.defaultCenterCrop(1000, 800, 0.5);
  const disp = crop.naturalRectToDisplay(nat, layout);
  const back = crop.displayRectToNatural(disp, layout, natural, 32);
  assert(Math.abs(back.x - nat.x) <= 2, `x ${back.x} vs ${nat.x}`);
  assert(Math.abs(back.y - nat.y) <= 2, `y ${back.y} vs ${nat.y}`);
  assert(Math.abs(back.w - nat.w) <= 2, `w ${back.w} vs ${nat.w}`);
  assert(Math.abs(back.h - nat.h) <= 2, `h ${back.h} vs ${nat.h}`);
});

test('recortar región central reduce área vs original', () => {
  const full = { w: 1200, h: 900 };
  const c = crop.defaultCenterCrop(full.w, full.h, 0.6);
  assert(c.w * c.h < full.w * full.h * 0.55, 'el recorte debe ser claramente más chico');
});

test('varios tamaños de foto (retrato/paisaje/cuadrado)', () => {
  for (const [w, h] of [[800, 1200], [1600, 900], [1024, 1024], [320, 240]]) {
    const r = crop.defaultCenterCrop(w, h, 0.72);
    assert(r.x + r.w <= w && r.y + r.h <= h, `${w}x${h}`);
    const L = crop.containLayout(w, h, 390, 520);
    assert(L.scale > 0 && L.w <= 390 + 0.01 && L.h <= 520 + 0.01);
  }
});

test('identify/collection usan prepareImageForAnalysis', () => {
  const idSrc = readFileSync(join(root, 'js/screens/identify.js'), 'utf8');
  const colSrc = readFileSync(join(root, 'js/screens/collection.js'), 'utf8');
  assert(/prepareImageForAnalysis/.test(idSrc));
  assert(/prepareImageForAnalysis/.test(colSrc));
  assert(/openImageCropper|prepareImageForAnalysis/.test(idSrc));
  assert(!/compressImage\(file\)/.test(idSrc), 'identify no debe comprimir sin recorte');
  assert(/clear-photo|Quitar foto/.test(colSrc), 'add form debe poder quitar la foto');
  assert(/URL\.revokeObjectURL/.test(colSrc));
});

test('CSS cropper overlay existe', () => {
  const css = readFileSync(join(root, 'css/styles.css'), 'utf8');
  assert(/\.cropper-overlay/.test(css));
  assert(/\.cropper-box/.test(css));
  assert(/\.cropper-handle/.test(css));
});

console.log('\n=== Búsqueda automática de mercado ===');
const autoM = await import(pathToFileURL(join(root, 'js/providers/AutoMarketSearchProvider.js')).href);

await testAsync('geminiClient no usa modelos 1.5 retireados', async () => {
  const gc = await import(pathToFileURL(join(root, 'js/services/geminiClient.js')).href);
  const models = await gc.resolveGeminiModels('');
  assert(models.every((m) => !/1\.5/.test(m)), models.join(','));
  assert(models.includes('gemini-2.0-flash'));
  assert(/429|Cuota|free/i.test(gc.formatGeminiHttpError(429, 'RESOURCE_EXHAUSTED')));
  assert(/free|0/i.test(gc.formatGeminiHttpError(429, 'generate_content_free_tier_requests limit: 0')));
  assert(typeof gc.sleep === 'function');
  const t0 = Date.now();
  await gc.sleep(20);
  assert(Date.now() - t0 >= 15);
});

test('hasUsefulMarketMatches exige precio > 0', () => {
  assert(!autoM.hasUsefulMarketMatches([]));
  assert(!autoM.hasUsefulMarketMatches([{ price: 0 }]));
  assert(autoM.hasUsefulMarketMatches([{ price: 12.5, title: 'x' }]));
});

test('autoSearch reintento usa delay local (no sleep importado)', () => {
  const src = readFileSync(join(root, 'js/providers/AutoMarketSearchProvider.js'), 'utf8');
  assert(/function delay\(/.test(src), 'debe definir delay local');
  assert(/await delay\(waitMs/.test(src), 'debe await delay(waitMs)');
  assert(!/await sleep\(/.test(src), 'no debe llamar sleep() del import');
  assert(!/\{ sleep[, ]/.test(src), 'no debe destructurar sleep del import');
});

test('pickTcgReferenceMatch prioriza Market Price de TCGPlayer', () => {
  const ref = autoM.pickTcgReferenceMatch([
    { id: 'a', title: 'Charizard Low', price: 10, source: 'tcgplayer', priceType: 'low', note: 'Low Price' },
    { id: 'b', title: 'Charizard Market', price: 42, source: 'tcgplayer', priceType: 'market', note: 'TCGPlayer Market Price' },
    { id: 'c', title: 'Charizard eBay', price: 55, source: 'ebay', priceType: 'listing' }
  ]);
  assert(ref.id === 'b');
  assert(autoM.isTcgMarketPriceMatch(ref));
});

test('parseGeminiMarketMatches conserva priceType market', () => {
  const m = autoM.parseGeminiMarketMatches(JSON.stringify({
    found: true,
    matches: [
      { title: 'Pikachu 025', price: 3.5, currency: 'USD', source: 'tcgplayer', priceType: 'market', note: 'TCGPlayer Market Price' }
    ]
  }));
  assert(m[0].priceType === 'market');
  assert(autoM.isTcgMarketPriceMatch(m[0]));
});

test('parseGeminiMarketMatches lee JSON con varias opciones', () => {
  const text = `{
    "found": true,
    "matches": [
      {"title": "Nendoroid Link Twilight Princess", "price": 52.5, "currency": "USD", "source": "ebay", "note": "sold similar"},
      {"title": "Nendoroid Link BOTW", "price": 48, "currency": "USD", "source": "amazon"},
      {"title": "fake", "price": 0, "currency": "USD"}
    ]
  }`;
  const m = autoM.parseGeminiMarketMatches(text, 'Nendoroid Link');
  assert(m.length === 2);
  assert(m[0].price === 52.5);
  assert(m[1].title.includes('BOTW'));
});

test('parseGeminiMarketMatches tolera markdown fence', () => {
  const text = "```json\n{\"found\":true,\"matches\":[{\"title\":\"figma Marth\",\"price\":60,\"currency\":\"USD\",\"source\":\"ebay\"}]}\n```";
  const m = autoM.parseGeminiMarketMatches(text);
  assert(m.length === 1 && m[0].price === 60);
});

test('mergeMatches deduplica título+precio', () => {
  const a = [{ id: '1', title: 'Nendoroid Link', price: 40, currency: 'USD', source: 'ebay' }];
  const b = [
    { id: '2', title: 'Nendoroid Link', price: 40, currency: 'USD', source: 'web' },
    { id: '3', title: 'Nendoroid Link BOTW', price: 55, currency: 'USD', source: 'ebay' }
  ];
  const m = autoM.mergeMatches(a, b);
  assert(m.length === 2, String(m.length));
});

test('scoreAndSortMatches prioriza título relevante', () => {
  const ranked = autoM.scoreAndSortMatches([
    { id: 'a', title: 'Random Barbie Doll', price: 20, currency: 'USD', source: 'web' },
    { id: 'b', title: 'Nendoroid Link Zelda Good Smile', price: 45, currency: 'USD', source: 'ebay' },
    { id: 'c', title: 'Link keychain', price: 10, currency: 'USD', source: 'web' }
  ], { name: 'Nendoroid Link', series: 'Nendoroid', character_name: 'Link', manufacturer: 'Good Smile' });
  assert(ranked[0].id === 'b', ranked.map((x) => x.id).join(','));
});

test('extractEbayPrices lee HTML clásico', () => {
  const html = '<span class="s-item__price">$24.99</span><span class="s-item__price">US $31.00</span>';
  const prices = autoM.extractEbayPrices(html);
  assert(prices.includes(24.99) && prices.includes(31));
});

test('lookupMarketPrice exporta auto search', async () => {
  const src = readFileSync(join(root, 'js/services/marketPriceService.js'), 'utf8');
  assert(/autoSearchMarketMatches/.test(src));
  assert(/ensureMarketPrice/.test(src));
  // no debe haber dos ensureMarketPrice
  const count = (src.match(/export async function ensureMarketPrice/g) || []).length;
  assert(count === 1, `ensureMarketPrice count=${count}`);
});

test('collection usa lookupMarketPrice automático', () => {
  const src = readFileSync(join(root, 'js/screens/collection.js'), 'utf8');
  assert(/lookupMarketPrice\(item/.test(src));
  assert(/onChooseMatch/.test(src));
  assert(/market-match-card|Usar este/.test(src));
});

test('AutoMarketSearchProvider existe en integridad', () => {
  assert(existsSync(join(root, 'js/providers/AutoMarketSearchProvider.js')));
});

await testAsync('autoSearch sin key responde empty/error estructurado', async () => {
  globalThis.APP_CONFIG = { GEMINI_API_KEY: '', MARKET_REGIONS: 'US,JP,VIS' };
  const result = await autoM.autoSearchMarketMatches({
    name: 'Nendoroid Link Twilight Princess Exclusive Edition',
    manufacturer: 'Good Smile',
    series: 'Nendoroid',
    character_name: 'Link',
    item_number: '563'
  }, { limit: 6, maxAttempts: 1 });
  assert(['found', 'empty', 'error'].includes(result.status), result.status);
  assert(Array.isArray(result.matches));
  assert(Array.isArray(result.queries) && result.queries.length >= 1);
  // Si encontró, debe poder elegirse; si no, note presente
  if (result.status === 'found') assert(result.matches.length >= 1 && result.matches[0].price > 0);
  else assert(result.note);
  console.log(`    → live status=${result.status} matches=${result.matches.length} queries=${result.queries.join(' | ')}`);
});

console.log(`\n==============================`);
console.log(`Resultado: ${passed} passed, ${failed} failed`);
console.log(`Cobertura estimada de checks: ${Math.round((passed / (passed + failed)) * 100)}%`);
if (failed) {
  console.log('\nFallos:');
  for (const f of failures) console.log(` - ${f.name}: ${f.err}`);
  process.exit(1);
}
if (passed / (passed + failed) < 0.98) {
  console.log('Confianza < 98%');
  process.exit(1);
}
process.exit(0);
