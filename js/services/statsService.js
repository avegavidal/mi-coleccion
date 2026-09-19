import { supabase } from '../services/supabaseClient.js';

export async function getStatsData() {
  const { data: items, error } = await supabase
    .from('items')
    .select('id, name, manufacturer, year, quantity, purchase_price, currency, collection_id, created_at, collections(name)');
  if (error) throw error;
  const list = items || [];

  const byCollection = {};
  const byManufacturer = {};
  const byYear = {};
  const byMonth = {};
  let totalValue = 0;
  let duplicates = 0;

  for (const i of list) {
    const cName = i.collections?.name || 'Sin categoría';
    byCollection[cName] = (byCollection[cName] || 0) + (i.quantity || 1);

    const m = i.manufacturer || 'Sin marca';
    byManufacturer[m] = (byManufacturer[m] || 0) + (i.quantity || 1);

    const y = i.year || 'Sin año';
    byYear[y] = (byYear[y] || 0) + (i.quantity || 1);

    if ((i.quantity || 0) > 1) duplicates += 1;
    if (i.purchase_price) totalValue += Number(i.purchase_price) * (i.quantity || 1);

    if (i.created_at) {
      const d = new Date(i.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      byMonth[key] = (byMonth[key] || 0) + 1;
    }
  }

  return { byCollection, byManufacturer, byYear, byMonth, totalValue, duplicates, totalItems: list.length };
}

export function renderBarChart(container, dataMap, { maxBars = 8 } = {}) {
  const entries = Object.entries(dataMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxBars);
  if (!entries.length) {
    container.innerHTML = '<p class="muted">Sin datos aún.</p>';
    return;
  }
  const max = Math.max(...entries.map(([, v]) => v), 1);
  container.innerHTML = entries
    .map(
      ([label, value]) => `
      <div class="bar-row">
        <div class="bar-label">${escapeHtml(String(label))}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${(value / max) * 100}%"></div></div>
        <div class="bar-value">${value}</div>
      </div>`
    )
    .join('');
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
