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
  'js/providers/TcgPlayerProvider.js',
  'js/providers/MercariJpProvider.js',
  'js/utils/imageCrop.js',
  'js/utils/theme.js',
  'js/screens/categories.js',
  'js/screens/addBulk.js',
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
  assert(html.includes('mi_coleccion_theme_v1'));
  assert(/family=Manrope|Manrope/.test(html));
  assert(/family=Sora|Sora/.test(html));
});

test('tema adaptativo: tokens duales + applyTheme + selector', () => {
  const themeSrc = readFileSync(join(root, 'js/utils/theme.js'), 'utf8');
  assert(/export function getThemePreference/.test(themeSrc));
  assert(/export function setThemePreference/.test(themeSrc));
  assert(/export function applyTheme/.test(themeSrc));
  assert(/export function resolveTheme/.test(themeSrc));
  assert(/prefers-color-scheme/.test(themeSrc));
  const css = readFileSync(join(root, 'css/styles.css'), 'utf8');
  assert(/data-theme="dark"/.test(css));
  assert(/--glass-bg/.test(css));
  assert(/Manrope/.test(css) && /Sora/.test(css));
  const app = readFileSync(join(root, 'js/app.js'), 'utf8');
  assert(/applyTheme/.test(app));
  const settings = readFileSync(join(root, 'js/screens/wishlist.js'), 'utf8');
  assert(/theme-picker/.test(settings));
  assert(/setThemePreference/.test(settings));
  const dash = readFileSync(join(root, 'js/screens/dashboard.js'), 'utf8');
  assert(/stats-compact/.test(dash));
  assert(/Mi Colección/.test(dash));
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

test('multi-categoría: item_collections N:N', () => {
  const sql = readFileSync(join(root, 'sql/schema.sql'), 'utf8');
  assert(/CREATE TABLE IF NOT EXISTS public\.item_collections/.test(sql));
  assert(/PRIMARY KEY \(item_id, collection_id\)/.test(sql));
  assert(existsSync(join(root, 'sql/migrate_item_collections.sql')));
  const svc = readFileSync(join(root, 'js/services/collectionService.js'), 'utf8');
  assert(/export function attachItemCollections/.test(svc));
  assert(/export async function setItemCollections/.test(svc));
  assert(/export async function addItemToCollection/.test(svc));
  assert(/collection_ids/.test(svc));
  assert(/hydrateCollectionsClientSide/.test(svc), 'debe hidratar categorías en cliente');
  assert(!/collections!collection_id|collections!items_collection_id/.test(svc), 'no debe embeber collections desde items');
  const statsSrc = readFileSync(join(root, 'js/services/statsService.js'), 'utf8');
  assert(!/collections!|collections\(/.test(statsSrc), 'stats no debe embeber collections');
  assert(!/collections \( id, name, color \)/.test(svc), 'sin embed ambiguo');
  const col = readFileSync(join(root, 'js/screens/collection.js'), 'utf8');
  assert(/categoryMultiField|collection_ids/.test(col));
  assert(/name:\s*['"]collection_ids['"]/.test(col) || /name:\s*'collection_ids'/.test(col));
  const css = readFileSync(join(root, 'css/styles.css'), 'utf8');
  assert(/\.category-multi/.test(css));
  assert(/\.check-chip/.test(css));
});

test('attachItemCollections une varias categorías (fuente)', () => {
  const svc = readFileSync(join(root, 'js/services/collectionService.js'), 'utf8');
  assert(/collectionList\s*=/.test(svc));
  assert(/collectionNames\s*=/.test(svc));
  assert(/item_collections/.test(svc));
  assert(/fromJoin\.map/.test(svc) || /collectionList\.map/.test(svc));
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

test('CSS lista en móvil y vitrina en web (≥720px)', () => {
  const css = readFileSync(join(root, 'css/styles.css'), 'utf8');
  assert(/\.card-grid\s*\{[^}]*flex-direction:\s*column/s.test(css));
  assert(/\.item-card\s*\{[^}]*grid-template-columns:\s*76px/s.test(css));
  assert(/@media\s*\(\s*min-width:\s*720px\s*\)/.test(css));
  assert(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(css));
  assert(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(css));
  assert(/max-width:\s*1080px/.test(css));
  const dash = readFileSync(join(root, 'js/screens/dashboard.js'), 'utf8');
  assert(/item-card-main/.test(dash));
  assert(/item-card-aside/.test(dash));
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
  assert(typeof sim.isClearSimilarityMatch === 'function');
  assert(typeof sim.markNameAlignedMatches === 'function');
});

test('isClearSimilarityMatch exige umbral + gap', () => {
  const settings = { high_similarity_threshold: 0.88 };
  assert(!sim.isClearSimilarityMatch(0.87, 0.5, settings));
  assert(!sim.isClearSimilarityMatch(0.89, 0.88, settings), 'sin gap no es claro');
  assert(sim.isClearSimilarityMatch(0.90, 0.80, settings));
  assert(sim.isClearSimilarityMatch(0.93, 0.92, settings), '≥0.92 absoluto');
});

test('markNameAlignedMatches no inventa % visual', () => {
  const settings = { medium_similarity_threshold: 0.78, high_similarity_threshold: 0.88 };
  const out = sim.markNameAlignedMatches(
    [{ name: 'Glitter & Glamours Nemu Kurotsuchi', similarity: 0.80 }],
    { name: 'BLEACH Glitter & Glamours Nemu Kurotsuchi', series: 'Glitter & Glamours', character_name: 'Nemu' },
    settings
  );
  assert(out[0].preferredCandidate === true);
  assert(out[0].similarity === 0.80);
  const low = sim.markNameAlignedMatches(
    [{ name: 'Glitter & Glamours Nemu', similarity: 0.60 }],
    { series: 'Glitter & Glamours', character_name: 'Nemu' },
    settings
  );
  assert(!low[0].preferredCandidate);
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
  // Con nombre oficial, incluir "buy" / "for sale" para listados con precio
  assert(qs.some((q) => /\bbuy\b/i.test(q) || /for sale/i.test(q)), qs.join(' | '));
});

test('buildLooseQueries figuras usa nombre + buy', () => {
  const qs = market.buildLooseQueries({
    manufacturer: 'Banpresto',
    series: 'Glitter & Glamours',
    character_name: 'Nemu Kurotsuchi',
    name: 'BLEACH Glitter & Glamours Nemu Kurotsuchi',
    category: 'Figura'
  });
  assert(qs.some((q) => /Nemu/i.test(q) && /\bbuy\b/i.test(q)), qs.join(' | '));
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
  const mjp = links.find((l) => l.id === 'mercari-jp');
  assert(/jp\.mercari\.com\/search/i.test(mjp.url), mjp.url);
  assert(ids.includes('amiami'));
  assert(ids.includes('mandarake'));
  assert(ids.includes('tcgplayer'));
  assert(ids.includes('cardmarket'));
  assert(!ids.some((id) => id.includes('mercado') || id.includes('ml')), 'sin Mercado Libre');
});

test('TCGPlayer y Cardmarket priorizados para cartas', () => {
  assert(ebayLinks.isTcgCardItem({ category: 'TCG', name: 'Charizard ex' }));
  assert(ebayLinks.isTcgCardItem({ category: 'Carta', franchise: 'Pokemon', name: 'Pikachu 025' }));
  assert(ebayLinks.isTcgCardItem({ name: 'Charizard ex 223/197 holo', franchise: 'Pokemon' }));
  assert(!ebayLinks.isTcgCardItem({ series: 'Nendoroid', name: 'Link' }));
  assert(!ebayLinks.isTcgCardItem({
    manufacturer: 'Banpresto',
    series: 'Glitter & Glamours',
    name: 'Nemu Kurotsuchi',
    franchise: 'Bleach',
    category: 'Figura'
  }));
  assert(!ebayLinks.isTcgCardItem({
    manufacturer: 'Banpresto',
    name: 'Pokemon Pikachu prize figure',
    franchise: 'Pokemon'
  }));
  // Franchise solo (sin señales de carta) no basta
  assert(!ebayLinks.isTcgCardItem({ franchise: 'Pokemon', name: 'Pikachu' }));
  const links = ebayLinks.buildShopLinksForQuery('Charizard ex 223', { tcg: true });
  assert(links[0].id === 'tcgplayer', links[0].id);
  assert(links.some((l) => l.id === 'cardmarket'));
  assert(links.some((l) => l.id === 'pricecharting'));
  assert(/tcgplayer\.com\/search/.test(links[0].url));
});

test('storeLinkForMatch abre la tienda del precio', () => {
  const trusted = ebayLinks.storeLinkForMatch({
    source: 'ebay',
    title: 'Nendoroid Link',
    url: 'https://www.ebay.com/itm/123456789012',
    urlTrusted: true
  });
  assert(/\/itm\/123456789012/.test(trusted), trusted);
  assert(ebayLinks.isDirectListingUrl('https://www.ebay.com/itm/123456789012'));
  assert(ebayLinks.isPlausibleListingUrl('https://www.ebay.com/itm/123456789012'));
  assert(!ebayLinks.isPlausibleListingUrl('https://www.ebay.com/itm/123')); // Gemini inventado
  assert(!ebayLinks.isDirectListingUrl('https://www.ebay.com/sch/i.html?_nkw=test'));
  assert(!ebayLinks.normalizeMarketUrl('https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc'));
  const tcg = ebayLinks.storeLinkForMatch({ source: 'tcgplayer', title: 'Charizard ex 223' });
  assert(/tcgplayer\.com\/search/.test(tcg), tcg);
  assert(/Charizard/.test(decodeURIComponent(tcg)));
  const amz = ebayLinks.storeLinkForMatch({ source: 'amazon', title: 'Gxmateria Vegeta' });
  assert(/amazon\.com\/s\?k=/.test(amz), amz);
  const ebayBand = ebayLinks.storeLinkForMatch({ source: 'ebay', title: 'Nemu Figure', price: 28 });
  assert(/_udlo=/.test(ebayBand) && /_udhi=/.test(ebayBand), ebayBand);
  // Sin urlTrusted, un /itm/ de Gemini NO se abre (evita Not Found)
  const fakeItm = ebayLinks.listingLinkMeta({
    source: 'ebay',
    title: 'Nendoroid Link Twilight Princess',
    url: 'https://www.ebay.com/itm/999999999',
    price: 20
  });
  assert(!fakeItm.exact, 'no debe marcar exacto sin urlTrusted');
  assert(/sch\/i\.html|_nkw=/.test(fakeItm.url), fakeItm.url);
  assert(/Link|Nendoroid|Twilight/i.test(decodeURIComponent(fakeItm.url)), fakeItm.url);
  const metaTrusted = ebayLinks.listingLinkMeta({
    source: 'ebay',
    title: 'Nendoroid Link',
    url: 'https://www.ebay.com/itm/123456789012',
    price: 20,
    urlTrusted: true
  });
  assert(metaTrusted.exact);
  assert(/anuncio/i.test(metaTrusted.label));
  const metaSearch = ebayLinks.listingLinkMeta({ source: 'mercari', title: 'Nemu', price: 25 });
  assert(!metaSearch.exact);
  assert(/Buscar/i.test(metaSearch.label));
  assert(ebayLinks.storeLabel('cardmarket') === 'Cardmarket');
  const item = {
    name: 'BLEACH Glitter & Glamours Nemu Kurotsuchi',
    series: 'Glitter & Glamours',
    character_name: 'Nemu Kurotsuchi',
    manufacturer: 'Banpresto',
    category: 'Figura'
  };
  assert(ebayLinks.matchBelongsToItem({ title: 'BLEACH Glitter & Glamours Nemu Kurotsuchi Banpresto' }, item));
  assert(!ebayLinks.matchBelongsToItem({ title: 'BLEACH Glitter & Glamours Orihime Inoue figure' }, item));
  // urlTrusted scrapado: se abre la ficha (el filtro de pieza ocurre antes en display)
  const wrongListing = ebayLinks.listingLinkMeta({
    source: 'ebay',
    title: 'BLEACH Glitter & Glamours Orihime Inoue',
    url: 'https://www.ebay.com/itm/123456789012',
    price: 30,
    urlTrusted: true
  }, item);
  assert(wrongListing.exact, 'ficha scrapada debe abrir aunque el título sea de otra');
  assert(/\/itm\/123456789012/.test(wrongListing.url), wrongListing.url);
  const mercUs = ebayLinks.listingLinkMeta({
    source: 'mercari',
    title: 'HUNTERxHUNTER GREED ISLAND Gon Killua Hisoka',
    url: 'https://www.mercari.com/item/m54716522520',
    price: 149.99,
    urlTrusted: true,
    priceVerified: true
  }, {
    name: 'Hunter x Hunter Ichibansho',
    character_name: 'Gon Killua Hisoka',
    category: 'Figura'
  });
  assert(mercUs.exact && /m54716522520/.test(mercUs.url), mercUs.url);
});

test('enlaces visuales con imageUrl', () => {
  const links = ebayLinks.buildMarketLinks('test', { imageUrl: 'https://example.com/a.jpg' });
  const ids = links.map((l) => l.id);
  assert(ids.includes('google-lens'));
  assert(ids.includes('bing-visual'));
  assert(ids.includes('mercari-jp-photo'));
  const mercariPhoto = links.find((l) => l.id === 'mercari-jp-photo');
  assert(/jp\.mercari\.com/i.test(mercariPhoto.url));
  // Sin foto aún ofrece Mercari JP foto (subir en su web)
  const noImg = ebayLinks.buildVisualMarketLinks(null);
  assert(noImg.some((l) => l.id === 'mercari-jp-photo'));
});

test('imágenes lite: thumbs + compresión upload', () => {
  const imgSrc = readFileSync(join(root, 'js/services/imageService.js'), 'utf8');
  assert(/export function thumbStoragePath/.test(imgSrc));
  assert(/createSignedUrls/.test(imgSrc));
  assert(/compressImageThumb/.test(imgSrc));
  assert(/_t\.webp/.test(imgSrc));
  assert(/export async function ensureRemoteThumb/.test(imgSrc));
  assert(/export function scheduleThumbBackfill/.test(imgSrc));
  assert(/markThumbReady/.test(imgSrc));
  assert(/NUNCA devolver full|never.*full/i.test(imgSrc) || !/fullSigned/.test(imgSrc));
  const domSrc = readFileSync(join(root, 'js/utils/dom.js'), 'utf8');
  assert(/compressImageUpload/.test(domSrc));
  assert(/compressImageThumb/.test(domSrc));
  assert(/image\/webp/.test(domSrc));
  const exp = readFileSync(join(root, 'js/services/exportService.js'), 'utf8');
  assert(/variant:\s*'thumb'/.test(exp));
  assert(/thumbPath/.test(exp));
  const dash = readFileSync(join(root, 'js/screens/dashboard.js'), 'utf8');
  assert(/ids/.test(dash) && !/listItems\(\)/.test(dash));
  assert(/data-storage-path|dataset\.storagePath|storagePath/.test(dash));
  assert(/ensureRemoteThumb/.test(dash));
  const col = readFileSync(join(root, 'js/screens/collection.js'), 'utf8');
  assert(/PAGE_SIZE|limit:\s*PAGE_SIZE/.test(col));
  assert(/Cargar más/.test(col));
  const svc = readFileSync(join(root, 'js/services/collectionService.js'), 'utf8');
  assert(/filters\.limit/.test(svc));
  assert(/\.range\(/.test(svc));
  // Convención de path
  assert(imgSrc.includes("replace(/\\.[^.]+$/, '_t.webp')") || imgSrc.includes("_t.webp"));
});

test('OCR suggestionFromOcrText detecta marca y nombre', async () => {
  const vis = await import(pathToFileURL(join(root, 'js/services/visionIdentifyService.js')).href);
  const s = vis.suggestionFromOcrText('Good Smile Company\nNendoroid Link\nNo. 563');
  assert(s.manufacturer && /good smile/i.test(s.manufacturer));
  assert(s.name || s.item_number);
});

test('detectItemNumber lee códigos TCG tipo EXR-009', async () => {
  const vis = await import(pathToFileURL(join(root, 'js/services/visionIdentifyService.js')).href);
  assert(vis.detectItemNumber('SP EXR-009 [C+] [2]') === 'EXR-009');
  assert(vis.detectItemNumber('Union Arena EXR-009 EX Resource') === 'EXR-009');
  assert(vis.detectItemNumber('OP01-001 Romance Dawn') === 'OP01-001');
  assert(vis.detectItemNumber('Nendoroid No. 563 Link') === '563');
  const card = vis.suggestionFromOcrText(
    'EX RESOURCE TOKEN\nSP EXR-009 [C+] [2]\nBANDAI MADE IN JAPAN\nUnion Arena'
  );
  assert(card.item_number === 'EXR-009', card.item_number);
  assert(/tcg|carta/i.test(card.category || ''), card.category);
});

await testAsync('TCG queries y score priorizan el código de carta', async () => {
  const auto = await import(pathToFileURL(join(root, 'js/providers/AutoMarketSearchProvider.js')).href);
  const qs = market.buildLooseQueries({
    name: 'Union Arena EX Resource',
    item_number: 'EXR-009',
    franchise: 'Union Arena',
    manufacturer: 'Bandai',
    category: 'TCG'
  });
  assert(qs[0] === 'EXR-009' || qs.some((q) => /^EXR-009\b/.test(q)), qs.join(' | '));
  assert(qs.some((q) => /TCGPlayer/i.test(q)), qs.join(' | '));
  assert(ebayLinks.isTcgCardItem({ item_number: 'EXR-009', manufacturer: 'Bandai' }));
  const scored = auto.scoreAndSortMatches([
    { title: 'Random pink girl card', price: 5, source: 'ebay', currency: 'USD' },
    {
      title: 'Union Arena EXR-009 EX Resource',
      price: 2.5,
      source: 'tcgplayer',
      priceType: 'market',
      priceVerified: true,
      currency: 'USD',
      note: 'TCGPlayer Market Price (leído de la página)'
    }
  ], { item_number: 'EXR-009', category: 'TCG', franchise: 'Union Arena' });
  assert(/EXR-009/i.test(scored[0].title), scored.map((m) => m.title).join(' | '));
  assert(auto.isTcgMarketPriceMatch(scored[0]));
  const link = ebayLinks.preferredSearchQuery({
    item_number: 'EXR-009',
    franchise: 'Union Arena',
    category: 'TCG',
    name: 'Something else'
  });
  assert(/EXR-009/.test(link), link);
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
  assert(/lookupMarketPrice/.test(idSrc), 'identify debe buscar precio de mercado');
  assert(/identify-market|Precio de mercado/.test(idSrc));
  assert(/buildMarketProbeFromSuggestion|buildIdentifyProbeItem/.test(idSrc));
  assert(/runCollectionTrack|wireMarketTrack|identify-tracks/.test(idSrc), 'dos flujos paralelos');
  assert(/Flujo 1|Flujo 2/.test(idSrc));
  assert(/openExternal/.test(idSrc), 'tocar el precio debe abrir la tienda');
  assert(/market-match-open/.test(idSrc));
});

test('identify prioriza agregar nueva si similitud no es clara', () => {
  const idSrc = readFileSync(join(root, 'js/screens/identify.js'), 'utf8');
  assert(/isClearSimilarityMatch/.test(idSrc));
  assert(/high_similarity_threshold/.test(idSrc));
  assert(/Agregar figura nueva/.test(idSrc));
  assert(/identify-add-block|identify-primary-add/.test(idSrc));
  assert(/identify-collection-cta|identify-add-sticky/.test(idSrc));
  assert(!/similarity:\s*0\.92/.test(idSrc), 'no inventar 92% en matches por nombre');
  assert(/Solo por nombre|no es similitud visual|no confirmada/i.test(idSrc));
  assert(/markNameAlignedMatches|preferredCandidate/.test(idSrc));
  const cfg = readFileSync(join(root, 'js/config.js'), 'utf8');
  assert(/HIGH_SIMILARITY_THRESHOLD:\s*0\.88/.test(cfg));
  assert(/MEDIUM_SIMILARITY_THRESHOLD:\s*0\.78/.test(cfg));
});

test('Mercari JP busca con la misma foto automáticamente', () => {
  const auto = readFileSync(join(root, 'js/providers/AutoMarketSearchProvider.js'), 'utf8');
  assert(/searchMercariJpWithGemini|runMercariPass/.test(auto));
  assert(/Mercari JP por la misma foto/.test(auto));
  assert(/lookupMercariJpMarket/.test(auto));
  assert(/lookupMercariUsMarket/.test(auto));
  const merc = readFileSync(join(root, 'js/providers/MercariJpProvider.js'), 'utf8');
  assert(/export function extractMercariJpMatches/.test(merc));
  assert(/export function extractMercariUsMatches/.test(merc));
  assert(/jp\.mercari\.com/.test(merc));
  assert(/parseYen|originalYen/.test(merc));
});

await testAsync('buildMarketProbeFromSuggestion prioriza suggestion sobre match', async () => {
  const mkt = await import(pathToFileURL(join(root, 'js/services/marketPriceService.js')).href);
  const probe = mkt.buildMarketProbeFromSuggestion(
    { name: 'Nendoroid Link', manufacturer: 'Good Smile', series: 'Nendoroid' },
    { strongMatches: [{ name: 'Other', manufacturer: 'X' }], matches: [] }
  );
  assert(probe.name === 'Nendoroid Link');
  assert(probe.manufacturer === 'Good Smile');
  const fallback = mkt.buildMarketProbeFromSuggestion(null, {
    strongMatches: [],
    matches: [{ name: 'FromMatch', franchise: 'Zelda' }]
  });
  assert(fallback.name === 'FromMatch');
  assert(fallback.franchise === 'Zelda');
});

await testAsync('preferBetterSuggestion prioriza nombre web sobre OCR basura', async () => {
  const vis = await import(pathToFileURL(join(root, 'js/services/visionIdentifyService.js')).href);
  const ocr = { name: 'Thi The Vegeta 14', source: 'ocr', confidence: 'low' };
  const web = { name: 'Dragon Ball Z G×materia The Vegeta', source: 'market-web', confidence: 'high', series: 'G×materia' };
  const best = vis.preferBetterSuggestion(ocr, web);
  assert(best.name.includes('G×materia') || /materia/i.test(best.name), best.name);
  assert(vis.isGarbageProductName('Thi The Vegeta 14'));
  assert(vis.isGarbageProductName('ab\uFFFDcd'));
  assert(!vis.isGarbageProductName('BLEACH Glitter & Glamours Nemu Kurotsuchi'));
  const polished = vis.polishSuggestionName({
    name: 'Thi The',
    series: 'Glitter & Glamours',
    character_name: 'Nemu Kurotsuchi',
    franchise: 'BLEACH',
    source: 'gemini'
  });
  assert(/Nemu/i.test(polished.name) && /Glitter/i.test(polished.name), polished.name);
  const fromMarket = vis.suggestionFromMarketMatches([
    { title: 'Dragon Ball Z G×materia The Vegeta Banpresto', price: 28, source: 'ebay' },
    { title: 'Thi The Vegeta 14', price: 5, source: 'other' }
  ]);
  assert(/materia|Vegeta/i.test(fromMarket.name), fromMarket.name);
  assert(fromMarket.source === 'market-web');
});

await testAsync('formatMoneyDual muestra USD y JPY', async () => {
  const dom = await import(pathToFileURL(join(root, 'js/utils/dom.js')).href);
  const text = dom.formatMoneyDual(100, 'USD');
  assert(/US\$|USD|\$/.test(text), text);
  assert(/JP¥|JPY|¥/.test(text), text);
  const yen = dom.formatMoneyDual(14900, 'JPY');
  assert(/¥|JPY/.test(yen) && /\$|USD/.test(yen), yen);
});

test('CSS cropper overlay existe', () => {
  const css = readFileSync(join(root, 'css/styles.css'), 'utf8');
  assert(/\.cropper-overlay/.test(css));
  assert(/\.cropper-box/.test(css));
  assert(/\.cropper-handle/.test(css));
});

test('CSS barra de búsqueda de mercado existe', () => {
  const css = readFileSync(join(root, 'css/styles.css'), 'utf8');
  assert(/\.market-search-progress/.test(css));
  assert(/market-search-slide/.test(css));
  assert(/is-market-searching/.test(css));
  const idSrc = readFileSync(join(root, 'js/screens/identify.js'), 'utf8');
  const colSrc = readFileSync(join(root, 'js/screens/collection.js'), 'utf8');
  assert(/setMarketSearching/.test(idSrc) && /setMarketSearching/.test(colSrc));
});

console.log('\n=== Búsqueda automática de mercado ===');
const autoM = await import(pathToFileURL(join(root, 'js/providers/AutoMarketSearchProvider.js')).href);

await testAsync('geminiClient prioriza modelos free con visión y rota en 503', async () => {
  const gc = await import(pathToFileURL(join(root, 'js/services/geminiClient.js')).href);
  const models = await gc.resolveGeminiModels('');
  assert(models.every((m) => !/1\.5/.test(m)), models.join(','));
  assert(models.includes('gemini-2.5-flash-lite'), models.join(','));
  assert(models.includes('gemini-2.5-flash'), models.join(','));
  const vision = await gc.resolveGeminiModels('', { purpose: 'vision' });
  assert(vision[0] === 'gemini-2.5-flash-lite', vision.join(','));
  assert(vision.length >= 4, `vision models=${vision.length}`);
  assert(Array.isArray(gc.VISION_PREFERRED_MODELS) && gc.VISION_PREFERRED_MODELS[0] === 'gemini-2.5-flash-lite');
  assert(gc.shouldRotateGeminiModel(503, 'high demand'));
  assert(gc.shouldRotateGeminiModel(429, 'RESOURCE_EXHAUSTED'));
  assert(gc.shouldRotateGeminiModel(500, 'INTERNAL'));
  assert(!gc.shouldRotateGeminiModel(401, 'bad key'));
  assert(/503|saturado|otros modelos/i.test(gc.formatGeminiHttpError(503, 'high demand')));
  const grounded = gc.assignGroundingUrlsToMatches(
    [{ title: 'Nemu', price: 28, source: 'ebay', url: 'https://ebay.com/sch/i.html?_nkw=x', linkExact: false }],
    ['https://www.ebay.com/itm/1234567890', 'https://www.amiami.com/eng/detail/?gcode=FIGURE-123']
  );
  assert(grounded[0].linkExact === true, JSON.stringify(grounded[0]));
  assert(/\/itm\//.test(grounded[0].url));
  assert(gc.extractGroundingUrls({
    candidates: [{
      groundingMetadata: {
        groundingChunks: [{ web: { uri: 'https://www.ebay.com/itm/999' } }]
      }
    }]
  }).includes('https://www.ebay.com/itm/999'));
  assert(/429|Cuota|free/i.test(gc.formatGeminiHttpError(429, 'RESOURCE_EXHAUSTED')));
  assert(/free|0/i.test(gc.formatGeminiHttpError(429, 'generate_content_free_tier_requests limit: 0')));
  assert(typeof gc.sleep === 'function');
  const t0 = Date.now();
  await gc.sleep(20);
  assert(Date.now() - t0 >= 15);
});

await testAsync('extractEbayListings captura /itm/ cuando existe', async () => {
  const ebay = await import(pathToFileURL(join(root, 'js/providers/EbayActiveProvider.js')).href);
  const html2 = `href="https://www.ebay.com/itm/123456789012" class="s-item__link">
    <div class="s-item__title"><span>BLEACH Glitter Figure Banpresto</span></div>
    <span class="s-item__price">$29.99</span>`;
  const listings = ebay.extractEbayListings(html2, 4);
  assert(listings.length >= 1, JSON.stringify(listings));
  assert(listings[0].url.includes('/itm/'), listings[0].url);
  assert(listings[0].price === 29.99);
});

test('identityWeak detecta OCR flojo vs identidad sólida', () => {
  assert(autoM.identityWeak({ name: '' }));
  assert(autoM.identityWeak({ name: 'Thi The' }));
  assert(!autoM.identityWeak({
    name: 'BLEACH Glitter & Glamours Nemu Kurotsuchi',
    manufacturer: 'Banpresto',
    series: 'Glitter & Glamours',
    character_name: 'Nemu'
  }));
  assert(!autoM.identityWeak({
    series: 'Glitter & Glamours',
    character_name: 'Nemu Kurotsuchi'
  }));
});

test('hasUsefulMarketMatches exige precio > 0', () => {
  assert(!autoM.hasUsefulMarketMatches([]));
  assert(!autoM.hasUsefulMarketMatches([{ price: 0 }]));
  assert(autoM.hasUsefulMarketMatches([{ price: 12.5, title: 'x' }]));
});

test('shouldStopMarketSearch figuras exige score alto o varios sólidos', () => {
  const fig = {
    name: 'Glitter & Glamours Nemu Kurotsuchi',
    manufacturer: 'Banpresto',
    series: 'Glitter & Glamours',
    character_name: 'Nemu',
    category: 'Figura'
  };
  assert(!autoM.shouldStopMarketSearch([], fig, 1));
  assert(!autoM.shouldStopMarketSearch([
    { title: 'ruido', price: 20, source: 'web-snippet', priceType: 'estimate', score: -4 }
  ], fig, 1));
  // Un score flojo ya no basta
  assert(!autoM.shouldStopMarketSearch([
    { title: 'Nemu something', price: 12, source: 'ebay', priceType: 'listing', score: 2 }
  ], fig, 1));
  const scored = autoM.scoreAndSortMatches([
    {
      title: 'BLEACH Glitter & Glamours Nemu Kurotsuchi Banpresto figure',
      price: 28,
      source: 'ebay',
      priceType: 'listing',
      linkExact: false,
      url: 'https://www.ebay.com/sch/i.html?_nkw=Nemu'
    }
  ], fig);
  assert(scored[0].score >= 6, `score=${scored[0].score}`);
  assert(autoM.shouldStopMarketSearch(scored, fig, 1));
  // Dos sólidos con precios cercanos
  assert(autoM.shouldStopMarketSearch([
    { title: 'Glitter Nemu Banpresto', price: 30, source: 'ebay', priceType: 'listing', score: 5 },
    { title: 'Glitter Nemu figure', price: 32, source: 'mercari', priceType: 'listing', score: 4 }
  ], fig, 2));
  const refPick = autoM.pickFigureReferenceMatch([
    { id: 'est', title: 'a', price: 10, source: 'ebay', priceType: 'estimate', score: 8, url: 'https://www.ebay.com/sch/i.html?_nkw=a' },
    { id: 'b', title: 'b', price: 40, source: 'ebay', priceType: 'listing', score: 5, urlTrusted: true, linkExact: true, url: 'https://www.ebay.com/itm/123456789012' },
    { id: 'c', title: 'c', price: 42, source: 'mercari', priceType: 'listing', score: 5, urlTrusted: true, linkExact: true, url: 'https://jp.mercari.com/item/m123456789' }
  ]);
  assert(refPick && (refPick.price === 40 || refPick.price === 42), `ref=${refPick?.price}`);
  assert(refPick.isMedianAnchor === true);
  assert(refPick.urlTrusted === true);
});

test('isPricedListingMatch exige anuncio real, no estimate con búsqueda', () => {
  assert(!autoM.isPricedListingMatch({
    price: 48.5, source: 'mercari', priceType: 'estimate',
    url: 'https://jp.mercari.com/search?keyword=gon', linkExact: false
  }));
  assert(!autoM.isPricedListingMatch({
    price: 48.5, source: 'mercari', priceType: 'estimate',
    url: 'https://www.mercari.com/item/m54716522520', linkExact: true, urlTrusted: false
  }));
  assert(autoM.isPricedListingMatch({
    price: 149.99, source: 'mercari', priceType: 'listing',
    url: 'https://www.mercari.com/item/m54716522520', linkExact: true, urlTrusted: true
  }));
});

test('pickFigureReferenceMatch ancla mediana al listing más cercano', () => {
  const ref = autoM.pickFigureReferenceMatch([
    { id: 'low', title: 'HxH low', price: 40, source: 'mercari', priceType: 'listing', urlTrusted: true, linkExact: true, url: 'https://jp.mercari.com/item/m1111111111', score: 4 },
    { id: 'mid', title: 'HxH mid', price: 150, source: 'mercari', priceType: 'listing', urlTrusted: true, linkExact: true, url: 'https://www.mercari.com/item/m54716522520', score: 6 },
    { id: 'high', title: 'HxH high', price: 160, source: 'ebay', priceType: 'listing', urlTrusted: true, linkExact: true, url: 'https://www.ebay.com/itm/123456789012', score: 5 },
    { id: 'est', title: 'estimate', price: 48, source: 'mercari', priceType: 'estimate', linkExact: false, url: 'https://jp.mercari.com/search?keyword=hxh', score: 9 }
  ]);
  // mediana de [40,150,160] = 150 → enlace al ítem de $150
  assert(ref.price === 150, `esperado 150, got ${ref.price}`);
  assert(ref.id === 'mid');
  assert(/m54716522520/.test(ref.url));
  assert(ref.isMedianAnchor);
  assert(ref.medianSampleSize === 3);
});

test('finalizeGeminiMatchUrls deja búsqueda si no hay ficha', () => {
  const out = autoM.finalizeGeminiMatchUrls([
    { title: 'HxH figure', price: 48, source: 'mercari', priceType: 'estimate', url: '', linkExact: false }
  ], 'Hunter x Hunter Gon Killua');
  assert(out[0].searchOnly === true);
  assert(out[0].linkExact === false);
  assert(/mercari\.com\/search|jp\.mercari\.com\/search/i.test(out[0].url), out[0].url);
});

test('filterDisplayMatches oculta estimates si hay listings', () => {
  const item = { name: 'Hunter x Hunter Ichibansho Gon', character_name: 'Gon', category: 'Figura' };
  const out = autoM.filterDisplayMatches([
    { title: 'Hunter x Hunter Ichibansho Gon Killua', price: 149.99, source: 'mercari', priceType: 'listing', urlTrusted: true, linkExact: true, url: 'https://www.mercari.com/item/m54716522520', score: 8 },
    { title: 'Hunter x Hunter estimate', price: 48.5, source: 'mercari', priceType: 'estimate', linkExact: false, url: 'https://jp.mercari.com/search?keyword=hxh', score: 7 }
  ], item);
  assert(out.length === 1, `len=${out.length}`);
  assert(out[0].price === 149.99);
});

test('shouldStopMarketSearch cartas prioriza Market Price TCG', () => {
  const card = { category: 'TCG', name: 'Charizard ex', franchise: 'Pokemon' };
  assert(autoM.shouldStopMarketSearch([
    {
      id: 'b',
      title: 'Charizard Market',
      price: 42,
      source: 'tcgplayer',
      priceType: 'market',
      priceVerified: true,
      note: 'TCGPlayer Market Price (leído de la página)',
      score: 8
    }
  ], card, 1));
  assert(!autoM.shouldStopMarketSearch([
    { title: 'random', price: 5, source: 'ebay', priceType: 'listing', score: 1 }
  ], card, 1));
});

test('scoreAndSortMatches penaliza TCG en figuras y prioriza anuncio exacto', () => {
  const item = { name: 'Nemu Kurotsuchi', manufacturer: 'Banpresto', series: 'Glitter & Glamours', character_name: 'Nemu', category: 'Figura' };
  const ranked = autoM.scoreAndSortMatches([
    { title: 'Nemu Kurotsuchi TCGPlayer card', price: 5, source: 'tcgplayer', priceType: 'market' },
    { title: 'Glitter & Glamours Nemu Kurotsuchi Banpresto figure', price: 32, source: 'ebay', priceType: 'listing', linkExact: true, url: 'https://www.ebay.com/itm/99' },
    { title: 'random', price: 10, source: 'web-snippet', priceType: 'estimate' }
  ], item);
  assert(ranked[0].source === 'ebay', ranked[0].source);
  assert(ranked[0].linkExact);
  assert(ranked.find((m) => m.source === 'tcgplayer').score < ranked[0].score);
});

test('filterDisplayMatches oculta snippets si hay match fiable', () => {
  const item = { name: 'Nendoroid Link', series: 'Nendoroid', character_name: 'Link', category: 'Figura' };
  const out = autoM.filterDisplayMatches([
    { title: 'Nendoroid Link Twilight Princess', price: 55, source: 'ebay', priceType: 'listing', linkExact: true, url: 'https://www.ebay.com/itm/1', score: 9 },
    { title: 'noise $', price: 3, source: 'web-snippet', priceType: 'estimate', score: -2 }
  ], item);
  assert(out.length === 1);
  assert(out[0].source === 'ebay');
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
    {
      id: 'b',
      title: 'Charizard Market',
      price: 42,
      source: 'tcgplayer',
      priceType: 'market',
      priceVerified: true,
      note: 'TCGPlayer Market Price (leído de la página)'
    },
    { id: 'c', title: 'Charizard eBay', price: 55, source: 'ebay', priceType: 'listing' }
  ]);
  assert(ref.id === 'b');
  assert(autoM.isTcgMarketPriceMatch(ref));
});

test('parseGeminiMarketMatches no marca Market Price sin verificar página', () => {
  const m = autoM.parseGeminiMarketMatches(JSON.stringify({
    found: true,
    matches: [
      { title: 'Pikachu 025', price: 3.5, currency: 'USD', source: 'tcgplayer', priceType: 'market', note: 'TCGPlayer Market Price' }
    ]
  }));
  assert(m[0].priceType === 'estimate');
  assert(m[0].priceVerified !== true);
  assert(!autoM.isTcgMarketPriceMatch(m[0]));
});

test('extractTcgPlayerMarketMatches lee Market Price del HTML de la página', async () => {
  const tcg = await import(pathToFileURL(join(root, 'js/providers/TcgPlayerProvider.js')).href);
  const html = `
    <h1>EX Resource (EXR-009) (C+) (SP)</h1>
    <a href="https://www.tcgplayer.com/product/707591/gundam-ex-resource">Product</a>
    <div>Market Price $739.71</div>
    <div>Low Price $640.00</div>
  `;
  const hits = tcg.extractTcgPlayerMarketMatches(html, 'EXR-009');
  assert(hits.length >= 1, String(hits.length));
  assert(hits[0].price === 739.71, String(hits[0].price));
  assert(hits[0].priceVerified === true);
  assert(hits[0].priceType === 'market');
  assert(/707591/.test(hits[0].url || hits[0].productUrl || ''));
  // No hardcodear: otro HTML → otro precio
  const html2 = '<p>Market Price $12.34</p><a href="/product/1111">x</a>';
  const hits2 = tcg.extractTcgPlayerMarketMatches(html2, 'TEST');
  assert(hits2[0].price === 12.34);
});

test('extractMercariJpMatches lee yen y /item/ del HTML', async () => {
  const merc = await import(pathToFileURL(join(root, 'js/providers/MercariJpProvider.js')).href);
  const html = `
    Product Nendoroid Link
    https://jp.mercari.com/item/m12345678901
    ¥3,980
  `;
  const hits = merc.extractMercariJpMatches(html, 'Nendoroid Link');
  assert(hits.length >= 1, String(hits.length));
  assert(hits[0].source === 'mercari');
  assert(/m12345678901/.test(hits[0].url));
  assert(hits[0].originalYen === 3980);
  assert(hits[0].price > 0);
});

test('extractMercariUsMatches lee $USD y /item/ del HTML', async () => {
  const merc = await import(pathToFileURL(join(root, 'js/providers/MercariJpProvider.js')).href);
  const html = `
## "Hunter x Hunter" search result #1
[![Image 3: HUNTERxHUNTER GREED ISLAND Gon Killua Hisoka Ichiban Figure - Bandai](https://u-mercari-images.mercdn.net/photos/m54716522520_1.jpg?width=2560&quality=75&_=1784444901) HUNTERxHUNTER GREED ISLAND Gon Killua Hisoka Ichiban Figure $149.99](https://www.mercari.com/us/item/m54716522520/?ref=search_results)
[![Image 4: Other](https://u-mercari-images.mercdn.net/photos/m18361256604_1.jpg?width=2560&quality=75&_=1) Hunter X Hunter Gon Freecss / Killua Zoldyck $70.00](https://www.mercari.com/us/item/m18361256604/?ref=search_results)
  `;
  const hits = merc.extractMercariUsMatches(html, 'Hunter x Hunter Ichibansho');
  assert(hits.length >= 2, String(hits.length));
  const target = hits.find((h) => /m54716522520/.test(h.url));
  assert(target, 'debe hallar m54716522520');
  assert(target.price === 149.99, String(target.price));
  assert(/Gon Killua Hisoka/i.test(target.title), target.title);
  assert(target.urlTrusted === true);
  assert(target.currency === 'USD');
});

test('matchBelongsToItem acepta anuncio HxH sin Revible en título', () => {
  const item = {
    name: 'Hunter x Hunter Ichibansho Revible Moment Gon Killua Hisoka',
    series: 'Revible Moment',
    character_name: 'Gon Killua Hisoka',
    manufacturer: 'Bandai',
    category: 'Figura'
  };
  assert(ebayLinks.matchBelongsToItem({
    title: 'HUNTERxHUNTER GREED ISLAND Gon Killua Hisoka Ichiban Figure'
  }, item));
  assert(!ebayLinks.matchBelongsToItem({
    title: 'Dragon Ball Z GxMateria Android 16 Figure'
  }, item));
});

test('normalizeMatchPriceToUsd convierte yen etiquetado como USD', () => {
  const n = autoM.normalizeMatchPriceToUsd({
    price: 6200,
    currency: 'USD',
    source: 'mercari',
    note: 'approx 6200 JPY',
    priceType: 'estimate'
  });
  assert(n.price > 30 && n.price < 60, `esperado ~41, got ${n.price}`);
  assert(n.originalYen === 6200);
  const ok = autoM.normalizeMatchPriceToUsd({
    price: 149.99,
    currency: 'USD',
    source: 'mercari',
    note: 'Mercari US listing',
    priceType: 'listing'
  });
  assert(ok.price === 149.99, String(ok.price));
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
  assert(/onMatches/.test(src));
  // no debe haber dos ensureMarketPrice
  const count = (src.match(/export async function ensureMarketPrice/g) || []).length;
  assert(count === 1, `ensureMarketPrice count=${count}`);
});

test('búsqueda paralela foto+texto y progreso parcial', () => {
  const src = readFileSync(join(root, 'js/providers/AutoMarketSearchProvider.js'), 'utf8');
  assert(/Promise\.allSettled/.test(src));
  assert(/onMatches/.test(src));
  assert(/emitPartial/.test(src));
  assert(/foto \+ texto en paralelo/.test(src));
  assert(/sold:\s*true/.test(src));
  assert(/gemini-2\.5-flash/.test(src));
  const idSrc = readFileSync(join(root, 'js/screens/identify.js'), 'utf8');
  assert(/onMatches:\s*\(partial\)/.test(idSrc));
  const colSrc = readFileSync(join(root, 'js/screens/collection.js'), 'utf8');
  assert(/onMatches:\s*\(partial\)/.test(colSrc));
  const visionSrc = readFileSync(join(root, 'js/services/visionIdentifyService.js'), 'utf8');
  assert(/purpose:\s*'vision'/.test(visionSrc));
  assert(/gemini-2\.5-flash/.test(visionSrc));
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

test('alta masiva: ruta add-bulk + multi file + identify + save', () => {
  const app = readFileSync(join(root, 'js/app.js'), 'utf8');
  assert(/renderAddBulk/.test(app));
  assert(/defineRoute\('add-bulk'/.test(app));
  const bulk = readFileSync(join(root, 'js/screens/addBulk.js'), 'utf8');
  assert(/export async function renderAddBulk/.test(bulk));
  assert(/multiple/.test(bulk));
  assert(/skipCrop:\s*false/.test(bulk));
  assert(/identifyFigureFromPhoto/.test(bulk));
  assert(/createItem/.test(bulk));
  assert(/uploadItemImage/.test(bulk));
  assert(/CONCURRENCY\s*=\s*2/.test(bulk));
  assert(/collection_ids/.test(bulk));
  assert(/capture="environment"/.test(bulk) || /capture:\s*'environment'/.test(bulk));
  assert(/bulk-another|Tomar otra foto/.test(bulk));
  assert(/prepareImageForAnalysis/.test(bulk));
  const col = readFileSync(join(root, 'js/screens/collection.js'), 'utf8');
  assert(/#\/add-bulk/.test(col));
  const css = readFileSync(join(root, 'css/styles.css'), 'utf8');
  assert(/\.bulk-card/.test(css));
  assert(/\.bulk-list/.test(css));
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
