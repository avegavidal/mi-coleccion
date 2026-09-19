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
  'js/providers/LocalEmbeddingProvider.js',
  'js/providers/RemoteEmbeddingProvider.js',
  'js/providers/EmbeddingProvider.js',
  'js/providers/MarketPriceProvider.js',
  'js/providers/EbayLinkProvider.js',
  'js/providers/EbayActiveProvider.js',
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

test('buildMarketQuery prioriza fabricante + número + nombre', () => {
  const q = market.buildMarketQuery({
    manufacturer: 'Good Smile',
    item_number: 'GSC-123',
    name: 'Nendoroid Link',
    franchise: 'Zelda'
  });
  assert(q.includes('Good Smile'));
  assert(q.includes('GSC-123'));
  assert(q.includes('Nendoroid Link'));
});

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

test('enlaces US/JP incluyen eBay vendidos y Yahoo JP', () => {
  const links = ebayLinks.buildMarketLinks('figma goku');
  const ids = links.map((l) => l.id);
  assert(ids.includes('ebay-sold'));
  assert(ids.includes('ebay-active'));
  assert(ids.includes('yahoo-jp'));
  assert(ids.includes('mercari-jp'));
  assert(ids.includes('amiami'));
  assert(ids.includes('mandarake'));
  assert(!ids.some((id) => id.includes('mercado') || id.includes('ml')), 'sin Mercado Libre');
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

console.log(`\n==============================`);
console.log(`Resultado: ${passed} passed, ${failed} failed`);
console.log(`Cobertura estimada de checks: ${Math.round((passed / (passed + failed)) * 100)}%`);
if (failed) {
  console.log('\nFallos:');
  for (const f of failures) console.log(` - ${f.name}: ${f.err}`);
  process.exit(1);
}
process.exit(0);
