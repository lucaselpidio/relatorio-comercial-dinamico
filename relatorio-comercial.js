/*!
 * Relatório Comercial v1.11.0 — painel comercial dinâmico
 * Web Component <relatorio-comercial>
 *
 * - Todo HTML/CSS do painel vive dentro de um Shadow DOM: o CSS da página onde ele
 *   for implantado não afeta o painel, e o CSS do painel não vaza para a página.
 * - Única variável global criada: window.RelatorioComercial. Eventos emitidos usam o prefixo "rc:".
 * - Sem dependências externas (gráficos em SVG próprio, leitor de .xlsx/.csv embutido).
 * - A persistência é feita por um "adaptador" plugável. Veja INTEGRACAO.md.
 */
(function (global) {
  'use strict';
  if (global.RelatorioComercial && global.RelatorioComercial.version) return;

  const VERSION = '1.11.0';
  const TAG = 'relatorio-comercial';
  // Senha pedida para "Apagar dados do navegador" (só existe com o adaptador local, isto é, no demo).
  // É uma trava contra cliques acidentais, não uma proteção de segurança: quem abre este arquivo vê a senha.
  // Troque com configure({ senhaApagarDados: '...' }).
  const RESET_PIN = '0000';

  // ==========================================================================
  // 1. UTILITÁRIOS
  // ==========================================================================
  const pad2 = (n) => String(n).padStart(2, '0');

  /** Datas sempre como string 'AAAA-MM-DD' (data local, sem fuso). */
  const D = {
    toISO: (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()),
    fromISO(s) { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); },
    today: () => D.toISO(new Date()),
    add(s, n) { const d = D.fromISO(s); d.setDate(d.getDate() + n); return D.toISO(d); },
    diff: (a, b) => Math.round((D.fromISO(b) - D.fromISO(a)) / 86400000),
    span: (a, b) => D.diff(a, b) + 1,
    each(a, b) { const out = []; for (let s = a; s <= b; s = D.add(s, 1)) out.push(s); return out; },
    weekStart(s, startDow) { const dow = D.fromISO(s).getDay(); return D.add(s, -((dow - (startDow == null ? 1 : startDow) + 7) % 7)); },
    monthStart: (s) => s.slice(0, 8) + '01',
    monthEnd(s) { const d = D.fromISO(s); return D.toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0)); },
    daysInMonth(s) { const d = D.fromISO(s); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); },
    fmt(s) { if (!s) return ''; const p = s.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; },
    fmtShort(s) { if (!s) return ''; const p = s.split('-'); return p[2] + '/' + p[1]; },
    dow: (s) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][D.fromISO(s).getDay()],
    dowLong: (s) => ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'][D.fromISO(s).getDay()],
    isISO: (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s),
  };

  const NF = {
    money: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }),
    money0: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }),
    int: new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }),
    dec: new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }),
    dec1: new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 }),
  };
  const bad = (v) => v == null || v === '' || !isFinite(v);
  const F = {
    money: (v) => (bad(v) ? '—' : NF.money.format(v)),
    money0: (v) => (bad(v) ? '—' : NF.money0.format(v)),
    moneyShort(v) {
      if (bad(v)) return '—';
      const a = Math.abs(v);
      if (a >= 1e6) return 'R$ ' + NF.dec1.format(v / 1e6) + ' mi';
      if (a >= 1e4) return 'R$ ' + NF.int.format(v / 1e3) + ' mil';
      if (a >= 1e3) return 'R$ ' + NF.dec1.format(v / 1e3) + ' mil';
      return NF.money0.format(v);
    },
    int: (v) => (bad(v) ? '—' : NF.int.format(v)),
    num: (v) => (bad(v) ? '—' : NF.dec.format(v)),
    pct(v, digits) {
      if (bad(v)) return '—';
      return (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: digits == null ? 0 : digits }) + '%';
    },
  };

  /** Escapa texto para uso seguro dentro de HTML (conteúdo e atributos). */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** Normaliza um nome para comparação: sem acento, minúsculo, espaços simples. */
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const sid = (v) => (v == null ? '' : String(v));
  const uid = () => (global.crypto && global.crypto.randomUUID ? global.crypto.randomUUID() : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
  const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function debounce(fn, ms) { let t; return function () { const args = arguments, self = this; clearTimeout(t); t = setTimeout(() => fn.apply(self, args), ms); }; }

  /** Similaridade 0..1 entre dois textos (Levenshtein normalizado). */
  function similarity(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const m = a.length, n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return 1 - prev[n] / Math.max(m, n);
  }

  /** Erro com mensagem amigável para o usuário final. */
  function userErr(msg, code) { const e = new Error(msg); e.userMessage = msg; if (code) e.code = code; return e; }

  // --------------------------------------------------------------------------
  // Conversão de valores digitados / importados
  // --------------------------------------------------------------------------
  /** "R$ 2.100,50" | "2100.5" | 2100.5 -> 2100.5 ; inválido -> null */
  function parseMoney(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).trim().replace(/R\$|\s| /gi, '');
    if (!s) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (s[0] === '-') { neg = true; s = s.slice(1); }
    if (!/^[\d.,]+$/.test(s)) return null;
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (lc > -1) s = s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
    else if (ld > -1 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = Number(s);
    return isFinite(n) ? (neg ? -n : n) : null;
  }

  function excelSerialToISO(n) {
    const d = new Date(Math.round((n - 25569) * 86400000));
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  /** Aceita AAAA-MM-DD, DD/MM/AAAA, DD/MM/AA, Date e número serial do Excel. */
  function parseDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : D.toISO(v);
    if (typeof v === 'number') return v > 59 && v < 2958466 ? excelSerialToISO(Math.floor(v)) : null;
    const s = String(v).trim();
    const ok = (y, mo, d) => { const dt = new Date(y, mo - 1, d); return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? D.toISO(dt) : null; };
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return ok(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; return ok(y, +m[2], +m[1]); }
    if (/^\d+(\.\d+)?$/.test(s)) return parseDate(Number(s));
    return null;
  }

  // --------------------------------------------------------------------------
  // Leitura de arquivos: CSV e XLSX (sem bibliotecas externas)
  // --------------------------------------------------------------------------
  /** CSV/TSV -> matriz. Detecta o separador (; , ou tab) e respeita aspas. */
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    const first = (text.split(/\r?\n/).find((l) => l.trim()) || '');
    const count = (d) => { let n = 0, q = false; for (const c of first) { if (c === '"') q = !q; else if (!q && c === d) n++; } return n; };
    const delim = ['\t', ';', ','].map((d) => [d, count(d)]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"' && field === '') inQ = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  async function readTextSmart(file) {
    const buf = await file.arrayBuffer();
    let t = new TextDecoder('utf-8').decode(buf);
    // Caractere de substituição (U+FFFD) = o arquivo não era UTF-8: CSV salvo pelo Excel em ANSI.
    if (t.indexOf(String.fromCharCode(0xFFFD)) > -1) { try { t = new TextDecoder('windows-1252').decode(buf); } catch (e) { /* mantém utf-8 */ } }
    return t;
  }

  const colIndex = (ref) => { const m = /^([A-Z]+)/.exec(ref); let n = 0; for (const ch of m ? m[1] : 'A') n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const colLetter = (i) => { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };

  /** Lê um .xlsx (zip + XML) e devolve [{name, rows}] com os valores (não as fórmulas). */
  async function readXlsx(buffer) {
    const u8 = new Uint8Array(buffer), dv = new DataView(buffer);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65558); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw userErr('O arquivo não parece ser um .xlsx válido. Salve-o novamente como "Pasta de Trabalho do Excel (.xlsx)" ou como .csv.');
    const total = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = {};
    const utf8 = new TextDecoder('utf-8');
    for (let i = 0; i < total; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      entries[utf8.decode(u8.subarray(p + 46, p + 46 + nlen))] = { method, csize, lho };
      p += 46 + nlen + elen + clen;
    }
    async function file(name) {
      const e = entries[name];
      if (!e) return null;
      const start = e.lho + 30 + dv.getUint16(e.lho + 26, true) + dv.getUint16(e.lho + 28, true);
      const data = u8.subarray(start, start + e.csize);
      if (e.method === 0) return utf8.decode(data);
      if (e.method !== 8) throw userErr('Compressão do .xlsx não suportada. Salve como .csv e tente de novo.');
      if (typeof DecompressionStream === 'undefined') throw userErr('Este navegador não consegue abrir .xlsx. Atualize o navegador ou use .csv.');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(stream).text();
    }
    const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
    const tags = (node, t) => Array.from(node.getElementsByTagNameNS('*', t));
    const ssText = await file('xl/sharedStrings.xml');
    const shared = ssText ? tags(xml(ssText), 'si').map((si) => tags(si, 't').filter((t) => !t.closest || !t.parentNode || t.parentNode.localName !== 'rPh').map((t) => t.textContent).join('')) : [];
    const wb = xml((await file('xl/workbook.xml')) || '<x/>');
    const relsDoc = xml((await file('xl/_rels/workbook.xml.rels')) || '<x/>');
    const rels = {};
    tags(relsDoc, 'Relationship').forEach((r) => { rels[r.getAttribute('Id')] = r.getAttribute('Target'); });
    const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const sheets = [];
    for (const s of tags(wb, 'sheet')) {
      const rid = s.getAttributeNS(RNS, 'id') || s.getAttribute('r:id');
      let target = rels[rid] || '';
      target = target.charAt(0) === '/' ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      const txt = await file(target);
      const rows = [];
      if (txt) {
        tags(xml(txt), 'row').forEach((r, ri) => {
          const idx = r.getAttribute('r') ? parseInt(r.getAttribute('r'), 10) - 1 : ri;
          const arr = [];
          tags(r, 'c').forEach((c, ci) => {
            const ref = c.getAttribute('r'), t = c.getAttribute('t');
            const col = ref ? colIndex(ref) : ci;
            let v;
            if (t === 'inlineStr') v = tags(c, 't').map((x) => x.textContent).join('');
            else {
              const vn = tags(c, 'v')[0];
              if (!vn) return;
              v = vn.textContent;
              if (t === 's') v = shared[+v];
              else if (t === 'b') v = v === '1';
              else if (t !== 'str' && t !== 'e' && t !== 'd') v = Number(v);
            }
            arr[col] = v;
          });
          rows[idx] = arr;
        });
      }
      sheets.push({ name: s.getAttribute('name'), rows: Array.from(rows, (r) => Array.from(r || [], (x) => (x === undefined ? '' : x))) });
    }
    return sheets;
  }

  /** Lê um arquivo enviado pelo usuário -> [{name, rows}] */
  async function readTabularFile(file) {
    const name = (file.name || '').toLowerCase();
    if (/\.xlsx$|\.xlsm$/.test(name)) return readXlsx(await file.arrayBuffer());
    if (/\.xls$/.test(name)) throw userErr('Arquivos .xls (Excel 97-2003) não são suportados. Salve como .xlsx ou .csv.');
    return [{ name: file.name, rows: parseCSV(await readTextSmart(file)) }];
  }

  /**
   * Matriz -> CSV com ; e BOM (abre corretamente no Excel em português).
   * Texto que começa com = + - @ (ou tab/CR) ganha um apóstrofo na frente: sem isso, o Excel executaria
   * um nome de lead como "=HIPERLINK(...)" como fórmula ao abrir o arquivo (injeção de fórmula em CSV).
   */
  function toCSV(rows) {
    const cell = (v) => {
      let s = v == null ? '' : String(v);
      if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
  }
  const csvMoney = (v) => (v == null ? '' : String(Math.round(v * 100) / 100).replace('.', ','));

  // ==========================================================================
  // 2. DADOS — coleções, adaptadores e Store
  // ==========================================================================
  /**
   * Coleções (equivalem às tabelas do banco — veja schema.sql):
   *  products       { id, name, owner_seller_id, show_in_goals, active, sort_order }
   *                   show_in_goals = false oculta o produto em "Metas por produto" e nos indicadores de meta do Painel
   *  sellers        { id, name, active, sort_order }
   *  origins        { id, name, product_id, active, sort_order }  (product_id != null => origem automática do produto)
   *  metrics        { id, name, kind:'count'|'money', funnel_order, audit_role:null|'sold_count'|'revenue', active, sort_order }
   *  goals          { id, target_type:'product'|'seller'|'total', target_id, period:'weekly'|'monthly', amount, valid_from }
   *                   'total' (v1.6) = meta geral, sem divisão por produto: target_id = 'all' (veja Store.generalGoalDays)
   *  sales          { id, date, lead_name, product_id, amount, seller_id, origin_id, notes }
   *  daily_entries  { id, date, product_id, seller_id, metric_id, quantity }
   *  presets        { id, name, items:[{product_id, seller_id, metric_id}] }
   *  settings       { id (chave), value (JSON em texto) }
   */
  const COLLECTIONS = ['products', 'sellers', 'origins', 'metrics', 'goals', 'sales', 'daily_entries', 'presets', 'settings'];
  const CATALOGS = ['products', 'sellers', 'origins', 'metrics'];
  const DATED = { sales: true, daily_entries: true };
  /** Alvo da meta geral na tabela goals (v1.6). */
  const GENERAL_GOAL = { type: 'total', id: 'all' };

  const toBool = (v) => !(v === false || v === 0 || v === '0' || v === 'false' || v === 'f');
  const toNum = (v) => (v == null || v === '' ? null : Number(v));
  const toDate = (v) => (v == null || v === '' ? null : String(v).slice(0, 10));

  /** Normaliza registros vindos do banco (números como texto, booleanos 0/1, datas com hora, JSON em texto...). */
  function normalize(c, r) {
    if (!r || typeof r !== 'object') return r;
    const o = Object.assign({}, r);
    if (CATALOGS.indexOf(c) > -1) { o.active = o.active == null ? true : toBool(o.active); o.sort_order = toNum(o.sort_order) || 0; }
    switch (c) {
      // Coluna ausente no banco (versões antigas do schema) = produto visível.
      case 'products': o.show_in_goals = o.show_in_goals == null ? true : toBool(o.show_in_goals); break;
      case 'sales': o.date = toDate(o.date); o.amount = toNum(o.amount) || 0; break;
      case 'daily_entries': o.date = toDate(o.date); o.quantity = toNum(o.quantity) || 0; break;
      case 'goals': o.amount = toNum(o.amount); o.valid_from = toDate(o.valid_from); o.period = o.period === 'monthly' ? 'monthly' : 'weekly'; break;
      case 'metrics': o.kind = o.kind === 'money' ? 'money' : 'count'; o.funnel_order = toNum(o.funnel_order); o.audit_role = o.audit_role || null; break;
      case 'presets':
        if (typeof o.items === 'string') { try { o.items = JSON.parse(o.items); } catch (e) { o.items = []; } }
        if (!Array.isArray(o.items)) o.items = [];
        break;
    }
    return o;
  }

  // --------------------------------------------------------------------------
  // Adaptador local (localStorage) — para demonstração e testes
  // --------------------------------------------------------------------------
  function createLocalAdapter(opts) {
    opts = opts || {};
    const key = opts.storageKey || 'relatorio-comercial:dados';
    let db = null, memoryOnly = false;
    const clone = (o) => JSON.parse(JSON.stringify(o));
    const fail = (msg, code) => { const e = new Error(msg); e.code = code; throw e; };
    const quota = (e) => !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
    /**
     * Grava no navegador. Sem acesso ao armazenamento (ex.: bloqueado pelo navegador), segue só na memória.
     * Armazenamento CHEIO é diferente: desfaz a última alteração (volta ao que estava gravado) e avisa,
     * para nada parecer salvo e sumir ao recarregar a página.
     */
    function persist() {
      if (memoryOnly) return;
      try { global.localStorage.setItem(key, JSON.stringify(db)); } catch (e) {
        if (!quota(e)) { memoryOnly = true; return; }
        try { const raw = global.localStorage.getItem(key); db = raw ? JSON.parse(raw) : db; } catch (e2) { /* mantém */ }
        COLLECTIONS.forEach((c) => { if (!Array.isArray(db[c])) db[c] = []; });
        throw userErr('O armazenamento deste navegador está cheio: a última alteração NÃO foi salva. Exporte um backup (Cadastros → Configurações) e leve os dados para o banco do time.', 'STORAGE_FULL');
      }
    }
    function load() {
      if (db) return db;
      try { const raw = global.localStorage.getItem(key); if (raw) db = JSON.parse(raw); } catch (e) { db = null; }
      if (!db) {
        db = {};
        const seed = typeof opts.seed === 'function' ? opts.seed() : opts.seed;
        COLLECTIONS.forEach((c) => { db[c] = seed && Array.isArray(seed[c]) ? clone(seed[c]) : []; });
        persist();
      }
      COLLECTIONS.forEach((c) => { if (!Array.isArray(db[c])) db[c] = []; });
      return db;
    }
    /**
     * Relê o que está gravado no navegador antes de cada operação: com o demo aberto em duas abas, cada uma
     * guardaria a sua cópia e a última a gravar apagaria o que a outra lançou. O localStorage é a fonte da verdade.
     */
    function reread() {
      if (memoryOnly || !db) return;
      try { const raw = global.localStorage.getItem(key); if (raw) { db = JSON.parse(raw); COLLECTIONS.forEach((c) => { if (!Array.isArray(db[c])) db[c] = []; }); } } catch (e) { /* mantém a cópia em memória */ }
    }
    const wait = () => { const p = opts.latency ? new Promise((r) => setTimeout(r, opts.latency)) : Promise.resolve(); return p.then(reread); };
    const has = (c, f, id) => db[c].some((x) => sid(x[f]) === id);
    function insert(c, rec) {
      const now = new Date().toISOString();
      const r = Object.assign({}, clone(rec), { id: rec.id != null ? rec.id : uid(), created_at: now, updated_at: now });
      if (db[c].some((x) => sid(x.id) === sid(r.id))) fail('Registro duplicado', 'DUPLICATE');
      db[c].push(r);
      return r;
    }
    const inUse = {
      products: (id) => has('sales', 'product_id', id) || has('daily_entries', 'product_id', id) ||
        db.origins.some((o) => sid(o.product_id) === id && has('sales', 'origin_id', sid(o.id))),
      sellers: (id) => has('sales', 'seller_id', id) || has('daily_entries', 'seller_id', id),
      origins: (id) => has('sales', 'origin_id', id),
      metrics: (id) => has('daily_entries', 'metric_id', id),
    };
    const api = {
      kind: 'local',
      async list(c, q) {
        await wait(); load();
        let rows = db[c] || [];
        if (q && DATED[c]) { if (q.from) rows = rows.filter((r) => r.date >= q.from); if (q.to) rows = rows.filter((r) => r.date <= q.to); }
        return clone(rows);
      },
      async create(c, rec) {
        await wait(); load();
        const r = insert(c, rec);
        persist();
        return clone(r);
      },
      async bulkCreate(c, recs) {
        await wait(); load();
        const out = recs.map((rec) => insert(c, rec));
        persist();
        return clone(out);
      },
      async update(c, id, patch) {
        await wait(); load();
        const r = db[c].find((x) => sid(x.id) === sid(id));
        if (!r) fail('Registro não encontrado', 'NOT_FOUND');
        Object.assign(r, clone(patch), { id: r.id, updated_at: new Date().toISOString() });
        persist();
        return clone(r);
      },
      async remove(c, id) {
        await wait(); load();
        id = sid(id);
        if (inUse[c] && inUse[c](id)) fail('Item com histórico de lançamentos', 'IN_USE');
        db[c] = db[c].filter((x) => sid(x.id) !== id);
        if (c === 'products') db.origins = db.origins.filter((o) => sid(o.product_id) !== id);
        if (c === 'products' || c === 'sellers') {
          const t = c === 'products' ? 'product' : 'seller';
          db.goals = db.goals.filter((g) => !(g.target_type === t && sid(g.target_id) === id));
        }
        if (c === 'sellers') db.products.forEach((p) => { if (sid(p.owner_seller_id) === id) p.owner_seller_id = null; });
        persist();
        return null;
      },
      /** Apaga todos os dados locais (volta ao seed na próxima leitura). */
      reset() { db = null; try { global.localStorage.removeItem(key); } catch (e) { /* ignora */ } },
    };
    return api;
  }

  // --------------------------------------------------------------------------
  // Adaptador REST — contrato documentado em INTEGRACAO.md
  // --------------------------------------------------------------------------
  function createRestAdapter(opts) {
    if (!opts || !opts.baseUrl) throw new Error('[relatorio-comercial] createRestAdapter: informe baseUrl');
    const base = String(opts.baseUrl).replace(/\/+$/, '');
    const paths = Object.assign({}, opts.paths);
    const fetchImpl = opts.fetch || global.fetch.bind(global);
    const p = (c) => '/' + (paths[c] || c);
    const unwrap = (r) => (Array.isArray(r) ? r : (r && (r.data || r.items || r.rows)) || []);
    const one = (r) => (r && r.data && !Array.isArray(r.data) ? r.data : r);
    async function req(method, path, body) {
      const extra = typeof opts.headers === 'function' ? await opts.headers() : (opts.headers || {});
      // Tempo limite (padrão 60 s; opts.timeoutMs, 0 = sem limite): sem ele, um servidor que nunca responde deixa
      // o "Salvar" esperando para sempre.
      const ms = opts.timeoutMs == null ? 60000 : Number(opts.timeoutMs);
      const ctrl = ms > 0 && global.AbortController ? new AbortController() : null;
      let timedOut = false;
      const timer = ctrl ? setTimeout(() => { timedOut = true; ctrl.abort(); }, ms) : null;
      let res, txt;
      try {
        res = await fetchImpl(base + path, {
          method,
          headers: Object.assign({ Accept: 'application/json' }, body !== undefined ? { 'Content-Type': 'application/json' } : {}, extra),
          body: body === undefined ? undefined : JSON.stringify(body),
          credentials: opts.credentials || 'same-origin',
          signal: ctrl ? ctrl.signal : undefined,
        });
        txt = await res.text();
      } catch (e) {
        // fetch só rejeita em falha de rede (servidor fora do ar, sem internet, CORS, DNS...) ou no tempo limite
        const err = timedOut
          ? userErr('O servidor demorou demais para responder (' + Math.round(ms / 1000) + ' s). ' + (method === 'GET' ? 'Tente novamente.' : 'Confira se o que você salvou aparece no histórico antes de tentar de novo.'), 'NETWORK')
          : userErr('Sem conexão com o servidor. Verifique a internet e tente novamente — nada do que você digitou foi perdido.', 'NETWORK');
        err.cause = e;
        if (timedOut) err.timeout = true;
        throw err;
      } finally { if (timer) clearTimeout(timer); }
      if (!res.ok) {
        let msg = '';
        try { const j = JSON.parse(txt); msg = (j && (j.message || j.error)) || ''; } catch (e) { /* corpo vazio ou HTML de proxy */ }
        const s = res.status;
        const err = new Error(msg || 'Erro ' + s + ' em ' + method + ' ' + path);
        err.status = s;
        if (s === 409) err.code = 'IN_USE'; // a mensagem padrão (sugerir "Arquivar") é aplicada pelo painel
        else if (s === 401) { err.code = 'UNAUTHORIZED'; err.userMessage = 'Sua sessão expirou ou você não está autenticado. Entre novamente na plataforma.'; }
        else if (s === 403) { err.code = 'FORBIDDEN'; err.userMessage = msg || 'Você não tem permissão para esta ação.'; }
        else if (s === 404) { err.code = 'NOT_FOUND'; err.userMessage = msg || 'Registro não encontrado (pode ter sido excluído por outra pessoa).'; }
        else if (s >= 500) { err.code = 'SERVER'; err.userMessage = 'O servidor encontrou um erro (' + s + '). Tente novamente em instantes — nada do que você digitou foi perdido.'; }
        else { err.code = 'REJECTED'; err.userMessage = msg || 'O servidor recusou os dados (' + s + ').'; }
        throw err;
      }
      if (res.status === 204) return null;
      try { return txt ? JSON.parse(txt) : null; }
      catch (e) { throw userErr('Resposta inválida do servidor (não é JSON). Verifique o endereço da API (baseUrl).', 'BAD_RESPONSE'); }
    }
    return {
      kind: 'rest',
      list(c, q) {
        const qs = q && (q.from || q.to) ? '?' + new URLSearchParams({ from: q.from || '', to: q.to || '' }).toString() : '';
        return req('GET', p(c) + qs).then(unwrap);
      },
      create: (c, rec) => req('POST', p(c), rec).then(one),
      bulkCreate: (c, recs) => req('POST', p(c) + '/bulk', { items: recs }).then(unwrap),
      update: (c, id, patch) => req('PATCH', p(c) + '/' + encodeURIComponent(id), patch).then(one),
      remove: (c, id) => req('DELETE', p(c) + '/' + encodeURIComponent(id)),
    };
  }

  // --------------------------------------------------------------------------
  // Store — cache dos cadastros + regras de negócio. Fala com o adaptador.
  // --------------------------------------------------------------------------
  /**
   * Configurações (tabela settings: id = chave, value = JSON). Chaves desconhecidas são ignoradas.
   *  funnel_hidden_metrics  [ids] métricas escondidas de "Outras métricas" no cartão Funil (v1.1). Sem uso na tela desde a v1.5
   *                         (o Funil saiu do Painel); continua lida, restaurada e devolvida em computeDashboard.otherMetrics.
   *  agent_views            Visão por Agente (aba Diário, v1.1):
   *                         { order: [ids de agentes, na ordem dos cartões],
   *                           hidden_agents: [ids de agentes ocultos],
   *                           agents: { "<id do agente>": { metrics: [ids de métricas, na ordem] } } }
   *                         Agente sem entrada em "agents" = automático (mostra as métricas que preencheu).
   *  lead_income            Renda dos Leads (aba Diário, v1.4):
   *                         { bands: [{ metric_id, color }],  -> faixas de renda, da menor para a maior; color "#rrggbb" ou null (cor padrão)
   *                           unqualified: metric_id | null } -> métrica "Sem qualificação" (fica fora do gráfico, num indicador próprio)
   *                         null / ausente = automático: o painel reconhece as métricas pelo nome (veja leadIncomeConfig).
   *  agent_dashboard        Dashboard Agentes (aba Diário, v1.7):
   *                         { conversion: { from: id, to: id } | null,  -> conversão de todos os agentes: "to" ÷ "from"
   *                                                                       (ex.: Vendidos ÷ Leads que Responderam); null = última etapa ÷ primeira
   *                           response: { from: id, to: id } | null,    -> taxa de resposta (v1.8): "to" ÷ "from"; null = automático pelo
   *                                                                       nome (Leads que Responderam ÷ Leads Contatadas, veja responsePair)
   *                           agents: { "<id do agente>": { kpis: [ids de métricas e/ou "__conv" (a conversão), na ordem] } } }
   *                         Agente sem entrada = automático (veja computeAgentDashboard).
   */
  const DEFAULT_SETTINGS = { red_below: 0.7, green_from: 1, include_today: false, week_start: 1, default_period: 'last_7', funnel_hidden_metrics: [], agent_views: {}, lead_income: null, agent_dashboard: {} };

  /** Normaliza settings.agent_views (tolerante a valores ausentes ou malformados vindos do banco). */
  function normAgentViews(v) {
    const ids = (a) => (Array.isArray(a) ? a.map(sid) : []);
    v = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    const agents = {};
    if (v.agents && typeof v.agents === 'object') {
      Object.keys(v.agents).forEach((k) => { const a = v.agents[k]; if (a && Array.isArray(a.metrics)) agents[sid(k)] = { metrics: ids(a.metrics) }; });
    }
    return { order: ids(v.order), hidden_agents: ids(v.hidden_agents), agents };
  }

  /** Normaliza settings.lead_income. null = automático (nada gravado ou valor malformado). */
  function normLeadIncome(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v) || !Array.isArray(v.bands)) return null;
    const seen = new Set(), bands = [];
    v.bands.forEach((b) => {
      const id = b && typeof b === 'object' ? sid(b.metric_id) : '';
      if (!id || seen.has(id)) return;
      seen.add(id);
      bands.push({ metric_id: id, color: typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color.toLowerCase() : null });
    });
    const u = sid(v.unqualified);
    return { bands, unqualified: u && !seen.has(u) ? u : null };
  }

  class Store {
    constructor(adapter) {
      this.a = adapter;
      this.c = {};
      COLLECTIONS.forEach((c) => { this.c[c] = []; });
      this.settings = Object.assign({}, DEFAULT_SETTINGS);
      this.listeners = new Set();
      this.index();
    }
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(type, detail) { this.listeners.forEach((fn) => { try { fn(type, detail); } catch (e) { console.error(e); } }); }

    async init() {
      const cats = ['products', 'sellers', 'origins', 'metrics', 'goals', 'presets', 'settings'];
      const res = await Promise.all(cats.map((c) => this.a.list(c)));
      cats.forEach((c, i) => { this.c[c] = (res[i] || []).map((r) => normalize(c, r)); });
      this._readSettings();
      // Todo produto precisa de uma origem automática (funil). Corrige bases antigas/incompletas.
      // Se não der para gravar (ex.: perfil só de leitura, sem permissão de escrita), o painel abre mesmo assim:
      // falta só a origem daquele produto nos seletores de Vendas, e a próxima abertura com permissão corrige.
      for (const pr of this.c.products) {
        if (!this.c.origins.some((o) => sid(o.product_id) === sid(pr.id))) {
          try {
            const o = await this.a.create('origins', { name: null, product_id: pr.id, active: pr.active !== false, sort_order: 0 });
            this.c.origins.push(normalize('origins', o));
          } catch (e) {
            if (e && e.code === 'UNAUTHORIZED') throw e; // sessão expirada: a plataforma precisa saber
            if (global.console) console.warn('[relatorio-comercial] origem automática do produto "' + pr.name + '" não foi criada:', e && (e.userMessage || e.message));
          }
        }
      }
      this.index();
    }

    index() {
      this.by = {};
      ['products', 'sellers', 'origins', 'metrics', 'presets', 'goals'].forEach((c) => {
        const m = new Map();
        this.c[c].forEach((r) => m.set(sid(r.id), r));
        this.by[c] = m;
      });
      this.originByProduct = new Map();
      this.c.origins.forEach((o) => { if (o.product_id != null && o.product_id !== '') this.originByProduct.set(sid(o.product_id), o); });
      this._goalIdx = new Map();
      this.c.goals.slice()
        .sort((a, b) => (a.valid_from || '').localeCompare(b.valid_from || '') || String(a.created_at || '').localeCompare(String(b.created_at || '')))
        .forEach((g) => {
          const k = g.target_type + ':' + sid(g.target_id);
          if (!this._goalIdx.has(k)) this._goalIdx.set(k, []);
          this._goalIdx.get(k).push(g);
        });
    }

    get(c, id) { return id == null || id === '' ? null : (this.by[c] && this.by[c].get(sid(id))) || null; }

    /** Nome de exibição (origens automáticas herdam o nome do produto). */
    label(c, r) {
      if (!r) return '';
      if (c === 'origins' && r.product_id != null && r.product_id !== '') { const p = this.get('products', r.product_id); return p ? p.name : (r.name || '(produto removido)'); }
      return r.name || '';
    }
    name(c, id) { const r = this.get(c, id); return r ? this.label(c, r) : (id == null || id === '' ? '' : '(removido)'); }
    isProductOrigin(o) { return !!o && o.product_id != null && o.product_id !== ''; }
    originProductId(originId) { const o = this.get('origins', originId); return this.isProductOrigin(o) ? sid(o.product_id) : null; }

    /** Lista ordenada. opts.all inclui arquivados. */
    list(c, opts) {
      const all = opts && opts.all;
      let rows = this.c[c].filter((r) => all || r.active !== false);
      if (c === 'origins') {
        const pOrder = new Map(this.list('products', { all: true }).map((p, i) => [sid(p.id), i]));
        return rows.sort((a, b) => {
          const pa = this.isProductOrigin(a), pb = this.isProductOrigin(b);
          if (pa !== pb) return pa ? -1 : 1;
          if (pa) return (pOrder.get(sid(a.product_id)) || 0) - (pOrder.get(sid(b.product_id)) || 0);
          return (a.sort_order - b.sort_order) || this.label(c, a).localeCompare(this.label(c, b), 'pt-BR');
        });
      }
      if (c === 'metrics') {
        return rows.sort((a, b) => {
          const fa = a.funnel_order == null ? 1e9 : a.funnel_order, fb = b.funnel_order == null ? 1e9 : b.funnel_order;
          return (fa - fb) || (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, 'pt-BR');
        });
      }
      if (c === 'presets') return rows.sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
      return rows.sort((a, b) => (a.sort_order - b.sort_order) || String(a.name).localeCompare(String(b.name), 'pt-BR'));
    }

    funnelMetrics() { return this.list('metrics', { all: true }).filter((m) => m.kind === 'count' && m.funnel_order != null); }

    // ---------------- configurações ----------------
    _readSettings() {
      const s = Object.assign({}, DEFAULT_SETTINGS);
      this.c.settings.forEach((r) => {
        let v = r.value;
        try { v = JSON.parse(v); } catch (e) { /* texto puro */ }
        if (sid(r.id) in DEFAULT_SETTINGS) s[sid(r.id)] = v;
      });
      s.red_below = Number(s.red_below); s.green_from = Number(s.green_from); s.week_start = Number(s.week_start);
      s.include_today = s.include_today === true || s.include_today === 'true';
      if (!(s.red_below >= 0)) s.red_below = DEFAULT_SETTINGS.red_below;
      if (!(s.green_from > 0)) s.green_from = DEFAULT_SETTINGS.green_from;
      s.funnel_hidden_metrics = Array.isArray(s.funnel_hidden_metrics) ? s.funnel_hidden_metrics.map(sid) : [];
      s.agent_views = normAgentViews(s.agent_views);
      s.lead_income = normLeadIncome(s.lead_income);
      s.agent_dashboard = normAgentDashboard(s.agent_dashboard);
      this.settings = s;
    }
    async setSetting(key, value) {
      const v = JSON.stringify(value);
      const ex = this.c.settings.find((r) => sid(r.id) === key);
      if (ex) { const r = await this.a.update('settings', ex.id, { value: v }); Object.assign(ex, r || {}, { value: v }); }
      else { const r = await this.a.create('settings', { id: key, value: v }); this.c.settings.push(normalize('settings', Object.assign({ id: key, value: v }, r || {}))); }
      this._readSettings();
      this.emit('change', { collection: 'settings' });
    }

    // ---------------- CRUD genérico ----------------
    async create(c, rec) {
      const r = normalize(c, (await this.a.create(c, rec)) || rec);
      if (!DATED[c]) { this.c[c].push(r); this.index(); }
      this.emit('change', { collection: c, action: 'create', record: r });
      return r;
    }
    async bulkCreate(c, recs, onProgress) {
      let out = [];
      const CHUNK = 1000; // por requisição; o lote é atômico no backend, então menos lotes = menos chance de importação parcial
      for (let i = 0; i < recs.length; i += CHUNK) {
        const part = recs.slice(i, i + CHUNK);
        let res;
        if (this.a.bulkCreate) res = await this.a.bulkCreate(c, part);
        else { res = []; for (const r of part) res.push(await this.a.create(c, r)); }
        out = out.concat((res || []).map((r) => normalize(c, r)));
        if (onProgress) onProgress(Math.min(i + CHUNK, recs.length), recs.length);
      }
      if (!DATED[c]) { this.c[c].push.apply(this.c[c], out); this.index(); }
      this.emit('change', { collection: c, action: 'bulk', count: recs.length });
      return out;
    }
    async update(c, id, patch) {
      const res = await this.a.update(c, id, patch);
      let r;
      if (!DATED[c]) {
        r = this.c[c].find((x) => sid(x.id) === sid(id));
        if (r) Object.assign(r, normalize(c, Object.assign({}, r, patch, res || {})));
        this.index();
      } else r = normalize(c, Object.assign({ id }, patch, res || {}));
      this.emit('change', { collection: c, action: 'update', record: r });
      return r;
    }
    async remove(c, id) {
      await this.a.remove(c, id);
      if (!DATED[c]) { this.c[c] = this.c[c].filter((x) => sid(x.id) !== sid(id)); this.index(); }
      this.emit('change', { collection: c, action: 'remove', id });
    }
    async fetchRange(c, from, to) {
      const rows = await this.a.list(c, { from, to });
      return (rows || []).map((r) => normalize(c, r)).filter((r) => r.date && (!from || r.date >= from) && (!to || r.date <= to));
    }
    async fetchAll(c) { return ((await this.a.list(c)) || []).map((r) => normalize(c, r)); }

    // ---------------- cadastros (produtos, vendedores, origens, métricas) ----------------
    findByName(c, name, exceptId) {
      const n = norm(name);
      return this.c[c].find((r) => sid(r.id) !== sid(exceptId) && norm(this.label(c, r)) === n) || null;
    }
    _checkName(c, name, exceptId) {
      name = String(name == null ? '' : name).trim().replace(/\s+/g, ' ');
      if (!name) throw userErr('Informe um nome.');
      // Origens e produtos dividem o mesmo "espaço de nomes" (o produto já é uma origem).
      const clash = this.findByName(c, name, exceptId) || (c === 'origins' ? this.findByName('products', name) : null) ||
        (c === 'products' ? this.c.origins.find((o) => !this.isProductOrigin(o) && norm(o.name) === norm(name)) : null);
      if (clash) throw userErr(clash.active === false ? '"' + name + '" já existe (arquivado). Restaure-o em vez de criar outro.' : '"' + name + '" já existe.');
      return name;
    }
    nextOrder(c) { return this.c[c].reduce((m, r) => Math.max(m, Number(r.sort_order) || 0), 0) + 1; }

    async addItem(c, data) {
      data = data || {};
      const name = this._checkName(c, data.name);
      const rec = { name, active: true, sort_order: this.nextOrder(c) };
      if (c === 'products') {
        rec.owner_seller_id = data.owner_seller_id || null;
        // Só envia show_in_goals quando difere do padrão do banco (TRUE): assim bases sem a coluna (v1.0) continuam criando produtos.
        if (data.show_in_goals === false) rec.show_in_goals = false;
      }
      if (c === 'origins') rec.product_id = null;
      if (c === 'metrics') {
        rec.kind = data.kind === 'money' ? 'money' : 'count';
        rec.funnel_order = data.funnel_order == null || data.funnel_order === '' ? null : Number(data.funnel_order);
        rec.audit_role = data.audit_role || null;
      }
      const r = await this.create(c, rec);
      if (c === 'products') await this.create('origins', { name: null, product_id: r.id, active: true, sort_order: 0 });
      return r;
    }
    async rename(c, id, name) {
      const r = this.get(c, id);
      if (c === 'origins' && this.isProductOrigin(r)) throw userErr('Esta origem é automática: renomeie o produto.');
      name = this._checkName(c, name, id);
      return this.update(c, id, { name });
    }
    async setActive(c, id, active) {
      const r = this.get(c, id);
      if (c === 'origins' && this.isProductOrigin(r)) throw userErr('Esta origem é automática: arquive o produto.');
      await this.update(c, id, { active: !!active });
      if (c === 'products') { const o = this.originByProduct.get(sid(id)); if (o) await this.update('origins', o.id, { active: !!active }); }
    }
    /** Move um item uma posição. scopeIds = ids visíveis na tela (troca só com o vizinho visível). */
    async move(c, id, dir, scopeIds) {
      const rows = this.list(c, { all: true });
      const scope = scopeIds ? rows.filter((r) => scopeIds.indexOf(sid(r.id)) > -1) : rows;
      const i = scope.findIndex((r) => sid(r.id) === sid(id)), j = i + dir;
      if (i < 0 || j < 0 || j >= scope.length) return;
      // Troca os dois vizinhos e renumera tudo para garantir ordem estável.
      const order = rows.map((r) => r.id);
      const ia = order.indexOf(scope[i].id), ib = order.indexOf(scope[j].id);
      order[ia] = scope[j].id; order[ib] = scope[i].id;
      for (let k = 0; k < order.length; k++) {
        const r = this.get(c, order[k]);
        if (r && r.sort_order !== k + 1) await this.update(c, r.id, { sort_order: k + 1 });
      }
    }
    async deleteItem(c, id) {
      const r = this.get(c, id);
      if (c === 'origins' && this.isProductOrigin(r)) throw userErr('Esta origem é automática: exclua ou arquive o produto.');
      await this.a.remove(c, id); // o backend deve recusar (409) se houver lançamentos ligados ao item
      const typ = c === 'products' ? 'product' : c === 'sellers' ? 'seller' : null;
      if (typ) {
        const gs = this.c.goals.filter((g) => g.target_type === typ && sid(g.target_id) === sid(id));
        for (const g of gs) { try { await this.a.remove('goals', g.id); } catch (e) { /* já removida em cascata */ } }
        this.c.goals = this.c.goals.filter((g) => gs.indexOf(g) < 0);
      }
      if (c === 'products') this.c.origins = this.c.origins.filter((o) => sid(o.product_id) !== sid(id));
      if (c === 'sellers') this.c.products.forEach((p) => { if (sid(p.owner_seller_id) === sid(id)) p.owner_seller_id = null; });
      const field = { products: 'product_id', sellers: 'seller_id', metrics: 'metric_id' }[c];
      if (field) {
        for (const ps of this.c.presets) {
          const items = ps.items.filter((it) => sid(it[field]) !== sid(id));
          if (items.length !== ps.items.length) { try { await this.update('presets', ps.id, { items }); } catch (e) { /* segue */ } }
        }
      }
      this.c[c] = this.c[c].filter((x) => sid(x.id) !== sid(id));
      this.index();
      this.emit('change', { collection: c, action: 'remove', id });
    }

    // ---------------- metas (com vigência) ----------------
    goalRecords(type, id) { return (this._goalIdx.get(type + ':' + sid(id)) || []).slice(); }
    /** Registro de meta válido numa data (ou null se não houver / se a meta estiver "zerada"). */
    goalAt(type, id, date) {
      const recs = this._goalIdx.get(type + ':' + sid(id));
      if (!recs) return null;
      let g = null;
      for (const r of recs) { if ((r.valid_from || '') <= date) g = r; else break; }
      return g && g.amount > 0 ? g : null;
    }
    /** Meta proporcional ao intervalo: semanal = valor/7 por dia; mensal = valor/dias do mês por dia. null = sem meta. */
    goalForRange(type, id, from, to, raw) {
      if (!from || !to || to < from || !this._goalIdx.has(type + ':' + sid(id))) return null;
      let total = 0, any = false;
      for (let d = from; d <= to; d = D.add(d, 1)) {
        const g = this.goalAt(type, id, d);
        if (!g) continue;
        any = true;
        total += g.period === 'monthly' ? g.amount / D.daysInMonth(d) : g.amount / 7;
      }
      return any ? (raw ? total : Math.round(total * 100) / 100) : null;
    }
    /**
     * Como a meta do intervalo foi calculada, em trechos (mesma meta e mesmo divisor), para mostrar a conta:
     * [{ amount, period, div (7 ou dias do mês), days, from, to, value }]. Dias sem meta não aparecem.
     */
    goalBreakdown(type, id, from, to, only) {
      const out = [];
      if (!from || !to || to < from || !this._goalIdx.has(type + ':' + sid(id))) return out;
      for (let d = from; d <= to; d = D.add(d, 1)) {
        const g = only && !only.has(d) ? null : this.goalAt(type, id, d);
        if (!g) continue;
        const div = g.period === 'monthly' ? D.daysInMonth(d) : 7;
        const last = out[out.length - 1];
        const same = last && last.g === g && last.div === div && D.add(last.to, 1) === d && (g.period !== 'monthly' || last.to.slice(0, 7) === d.slice(0, 7));
        if (same) { last.days++; last.to = d; } else out.push({ g, amount: g.amount, period: g.period, div, days: 1, from: d, to: d });
      }
      out.forEach((x) => { x.value = x.amount / x.div * x.days; delete x.g; });
      return out;
    }
    /** IDs dos produtos que entram nas metas (show_in_goals), arquivados inclusive. */
    goalProductIds() { return this.c.products.filter((p) => p.show_in_goals !== false).map((p) => sid(p.id)); }
    /**
     * Meta geral (v1.6, goals com target_type 'total' e target_id 'all'): meta da empresa, sem divisão por produto,
     * para o período em que ainda não havia meta por produto. Vale só nos dias em que NENHUM produto exibido nas
     * metas tem meta própria. Retorna Map dia → meta do dia (mensal = valor ÷ dias do mês; semanal = valor ÷ 7).
     */
    generalGoalDays(from, to) {
      const out = new Map();
      if (!from || !to || to < from || !this._goalIdx.has(GENERAL_GOAL.type + ':' + GENERAL_GOAL.id)) return out;
      const own = this.goalProductIds().filter((pid) => this._goalIdx.has('product:' + pid));
      for (let d = from; d <= to; d = D.add(d, 1)) {
        const g = this.goalAt(GENERAL_GOAL.type, GENERAL_GOAL.id, d);
        if (!g || own.some((pid) => this.goalAt('product', pid, d))) continue;
        out.set(d, g.period === 'monthly' ? g.amount / D.daysInMonth(d) : g.amount / 7);
      }
      return out;
    }
    // ---------------- restaurar backup (JSON exportado em Cadastros → Configurações) ----------------
    /**
     * Restaura um backup exportado pelo painel MESCLANDO com o que já existe (nunca apaga nem altera nada):
     *  - cadastros com o mesmo nome (sem diferenciar maiúsculas/acentos) são reaproveitados; os demais são criados;
     *  - os IDs do backup são REMAPEADOS para os que o banco gerar: vendas, Diário, metas, presets e as
     *    personalizações em settings passam a apontar para os registros certos (serve para migrar de uma base para outra);
     *  - vendas iguais (data, lead, valor, produto) e lançamentos do Diário já existentes são pulados — rodar de novo
     *    depois de uma interrupção continua de onde parou, sem duplicar;
     *  - configurações só entram nas chaves que a base ainda não tem (todas, com opts.replaceSettings);
     *  - métricas novas entram no fim do funil se a base já tiver um funil (não colidem de posição).
     * opts: { dryRun: só calcula a prévia, sem gravar; replaceSettings; onProgress(etapa, feito, total) }.
     * Retorna { counts: { coleção: { create, skip } }, issues: [avisos], settingsKeys: [chaves restauradas] }.
     */
    async restoreBackup(data, opts) {
      opts = opts || {};
      const dry = !!opts.dryRun, prog = opts.onProgress || (() => {});
      if (!data || typeof data !== 'object' || data.app !== 'relatorio-comercial') throw userErr('Este arquivo não é um backup do Relatório Comercial (o backup é exportado em Cadastros → Configurações).');
      const B = {};
      COLLECTIONS.forEach((c) => { B[c] = (Array.isArray(data[c]) ? data[c] : []).filter((r) => r && typeof r === 'object').map((r) => normalize(c, r)); });
      const counts = {}, issues = [];
      COLLECTIONS.forEach((c) => { counts[c] = { create: 0, skip: 0 }; });
      const issue = (t) => { if (issues.length < 500) issues.push(t); };
      const map = { products: new Map(), sellers: new Map(), origins: new Map(), metrics: new Map() };
      let fake = 0;
      const create = async (c, rec, silent) => { if (!silent) counts[c].create++; return dry ? { id: '__novo' + (++fake) } : this.create(c, rec); };
      const ref = (c, id) => (id == null || id === '' ? null : map[c].get(sid(id)) || null);
      const real = (c, id) => { const r = this.get(c, id); return r ? r.id : id; }; // mantém o tipo do ID do banco (número ou texto)
      const nameOf = (r) => String(r.name == null ? '' : r.name).trim().replace(/\s+/g, ' ');
      const flag = (r) => r.active !== false;

      prog('Cadastros', 0, 0);
      // vendedores / agentes
      for (const r of B.sellers) {
        const nm = nameOf(r);
        if (!nm) { issue('Vendedor sem nome ignorado.'); continue; }
        const ex = this.findByName('sellers', nm);
        if (ex) { map.sellers.set(sid(r.id), sid(ex.id)); counts.sellers.skip++; continue; }
        const n = await create('sellers', { name: nm, active: flag(r), sort_order: r.sort_order || 0 });
        map.sellers.set(sid(r.id), sid(n.id));
      }
      // produtos (+ a origem automática de cada produto novo)
      for (const r of B.products) {
        const nm = nameOf(r);
        if (!nm) { issue('Produto sem nome ignorado.'); continue; }
        const ex = this.findByName('products', nm);
        if (ex) { map.products.set(sid(r.id), sid(ex.id)); counts.products.skip++; continue; }
        const rec = { name: nm, owner_seller_id: ref('sellers', r.owner_seller_id) ? real('sellers', ref('sellers', r.owner_seller_id)) : null, active: flag(r), sort_order: r.sort_order || 0 };
        if (r.show_in_goals === false) rec.show_in_goals = false; // só envia quando difere do padrão (bancos sem a coluna)
        const n = await create('products', rec);
        map.products.set(sid(r.id), sid(n.id));
        const bo = B.origins.find((o) => sid(o.product_id) === sid(r.id));
        const no = await create('origins', { name: null, product_id: n.id, active: bo ? flag(bo) : flag(r), sort_order: 0 }, true);
        if (bo) map.origins.set(sid(bo.id), sid(no.id));
      }
      // origens
      for (const o of B.origins) {
        if (o.product_id != null && o.product_id !== '') {
          if (map.origins.has(sid(o.id))) continue;
          const pid = ref('products', o.product_id), eo = pid && this.originByProduct.get(pid);
          if (eo) map.origins.set(sid(o.id), sid(eo.id));
          else if (!pid) issue('Origem automática de um produto que não está no backup foi ignorada.');
          continue;
        }
        const nm = nameOf(o);
        if (!nm) { issue('Origem sem nome ignorada.'); continue; }
        const ex = this.c.origins.find((x) => !this.isProductOrigin(x) && norm(x.name) === norm(nm));
        if (ex) { map.origins.set(sid(o.id), sid(ex.id)); counts.origins.skip++; continue; }
        const n = await create('origins', { name: nm, product_id: null, active: flag(o), sort_order: o.sort_order || 0 });
        map.origins.set(sid(o.id), sid(n.id));
      }
      // métricas (na ordem do funil do backup; se a base já tem funil, as novas etapas entram no fim)
      const hadFunnel = this.funnelMetrics().length > 0;
      let nextFo = this.funnelMetrics().reduce((m, x) => Math.max(m, x.funnel_order), 0);
      const bm = B.metrics.slice().sort((a, b) => (a.funnel_order == null ? 1e9 : a.funnel_order) - (b.funnel_order == null ? 1e9 : b.funnel_order));
      for (const r of bm) {
        const nm = nameOf(r);
        if (!nm) { issue('Métrica sem nome ignorada.'); continue; }
        const ex = this.findByName('metrics', nm);
        if (ex) { map.metrics.set(sid(r.id), sid(ex.id)); counts.metrics.skip++; continue; }
        let fo = r.kind === 'count' && r.funnel_order != null ? r.funnel_order : null;
        if (fo != null && hadFunnel) fo = ++nextFo;
        const n = await create('metrics', { name: nm, kind: r.kind, funnel_order: fo, audit_role: r.audit_role || null, active: flag(r), sort_order: r.sort_order || 0 });
        map.metrics.set(sid(r.id), sid(n.id));
      }
      // metas (uma por alvo + vigência)
      for (const g of B.goals) {
        if (g.target_type === GENERAL_GOAL.type) { // meta geral: sem ID para remapear
          if (this.goalRecords(GENERAL_GOAL.type, GENERAL_GOAL.id).some((x) => (x.valid_from || null) === (g.valid_from || null))) { counts.goals.skip++; continue; }
          try {
            await create('goals', { target_type: GENERAL_GOAL.type, target_id: GENERAL_GOAL.id, period: g.period, amount: g.amount, valid_from: g.valid_from || null });
          } catch (e) {
            // banco anterior à v1.6 (CHECK de target_type sem 'total'): avisa e segue com vendas e Diário
            if (!e || e.code !== 'REJECTED') throw e;
            counts.goals.create--;
            issue('Meta geral' + (g.valid_from ? ' de ' + D.fmt(g.valid_from) : '') + ' não foi gravada: o banco recusou (' + (e.userMessage || e.message) + '). Ele precisa aceitar a meta geral (INTEGRACAO.md, seção 7.1).');
          }
          continue;
        }
        const typ = g.target_type === 'seller' ? 'seller' : 'product', c = typ === 'seller' ? 'sellers' : 'products';
        const tid = ref(c, g.target_id);
        if (!tid) { issue('Meta de um ' + (typ === 'seller' ? 'vendedor' : 'produto') + ' que não está no backup foi ignorada.'); continue; }
        if (this.goalRecords(typ, tid).some((x) => (x.valid_from || null) === (g.valid_from || null))) { counts.goals.skip++; continue; }
        await create('goals', { target_type: typ, target_id: real(c, tid), period: g.period, amount: g.amount, valid_from: g.valid_from || null });
      }
      // presets
      for (const ps of B.presets) {
        const nm = nameOf(ps);
        if (!nm) continue;
        if (this.c.presets.some((x) => norm(x.name) === norm(nm))) { counts.presets.skip++; continue; }
        const items = ps.items.map((it) => ({ p: ref('products', it.product_id), v: ref('sellers', it.seller_id), m: ref('metrics', it.metric_id) }))
          .filter((x) => x.p && x.v && x.m).map((x) => ({ product_id: real('products', x.p), seller_id: real('sellers', x.v), metric_id: real('metrics', x.m) }));
        if (!items.length) { issue('Preset "' + nm + '" ignorado: nenhuma linha com produto, agente e métrica do backup.'); continue; }
        await create('presets', { name: nm, items });
      }

      // vendas — sem duplicar (conta repetições: duas vendas idênticas no backup viram duas na base)
      const range = (arr) => { const ds = arr.map((x) => x.date).filter(D.isISO).sort(); return ds.length ? [ds[0], ds[ds.length - 1]] : null; };
      const sr = range(B.sales);
      const keyS = (x) => [x.date, norm(x.lead_name), Math.round(Number(x.amount) * 100), sid(x.product_id)].join('|');
      const haveS = new Map();
      if (sr) (await this.fetchRange('sales', sr[0], sr[1])).forEach((x) => haveS.set(keyS(x), (haveS.get(keyS(x)) || 0) + 1));
      const newSales = [];
      for (const x of B.sales) {
        const lead = String(x.lead_name == null ? '' : x.lead_name).trim();
        if (!D.isISO(x.date) || !lead || !(x.amount > 0)) { issue('Venda inválida ignorada (' + (x.date || 'sem data') + ', ' + (lead || 'sem lead') + ').'); continue; }
        const pid = ref('products', x.product_id), vid = ref('sellers', x.seller_id), oid = ref('origins', x.origin_id);
        if (!pid || !vid || !oid) { issue('Venda de ' + D.fmt(x.date) + ' (' + lead + ') ignorada: produto, vendedor ou origem não está no backup.'); continue; }
        const rec = { date: x.date, lead_name: lead, product_id: real('products', pid), amount: x.amount, seller_id: real('sellers', vid), origin_id: real('origins', oid), notes: x.notes || null };
        const k = keyS(rec), n = haveS.get(k) || 0;
        if (n > 0) { haveS.set(k, n - 1); counts.sales.skip++; continue; }
        newSales.push(rec);
      }
      counts.sales.create = newSales.length;
      if (!dry && newSales.length) await this.bulkCreate('sales', newSales, (d, t) => prog('Vendas', d, t));

      // Diário — um lançamento por (dia, produto, agente, métrica); o que já existe na base é mantido
      const dr = range(B.daily_entries);
      const keyD = (x) => [x.date, sid(x.product_id), sid(x.seller_id), sid(x.metric_id)].join('|');
      const haveD = new Set();
      if (dr) (await this.fetchRange('daily_entries', dr[0], dr[1])).forEach((x) => haveD.add(keyD(x)));
      const newDaily = [];
      for (const x of B.daily_entries) {
        if (!D.isISO(x.date) || !(x.quantity >= 0)) { issue('Lançamento do Diário inválido ignorado (' + (x.date || 'sem data') + ').'); continue; }
        const pid = ref('products', x.product_id), vid = ref('sellers', x.seller_id), mid = ref('metrics', x.metric_id);
        if (!pid || !vid || !mid) { issue('Lançamento do Diário de ' + D.fmt(x.date) + ' ignorado: produto, agente ou métrica não está no backup.'); continue; }
        const rec = { date: x.date, product_id: real('products', pid), seller_id: real('sellers', vid), metric_id: real('metrics', mid), quantity: x.quantity };
        const k = keyD(rec);
        if (haveD.has(k)) { counts.daily_entries.skip++; continue; }
        haveD.add(k);
        newDaily.push(rec);
      }
      counts.daily_entries.create = newDaily.length;
      if (!dry && newDaily.length) await this.bulkCreate('daily_entries', newDaily, (d, t) => prog('Diário', d, t));

      // configurações e personalizações (IDs remapeados)
      prog('Configurações', 0, 0);
      const ids = (c, arr) => (Array.isArray(arr) ? arr.map((id) => ref(c, id)).filter(Boolean) : []);
      const remap = (k, v) => {
        if (k === 'funnel_hidden_metrics') return ids('metrics', v);
        if (k === 'lead_income') {
          const li = normLeadIncome(v);
          if (!li) return null;
          return { bands: li.bands.map((b) => ({ metric_id: ref('metrics', b.metric_id), color: b.color })).filter((b) => b.metric_id), unqualified: ref('metrics', li.unqualified) };
        }
        if (k === 'agent_dashboard') {
          const a = normAgentDashboard(v), agents = {};
          Object.keys(a.agents).forEach((sv) => {
            const nv = ref('sellers', sv), o = a.agents[sv];
            if (!nv) return;
            agents[nv] = Object.assign({}, o); // order / hidden são nomes de seção: não mudam
            if (o.kpis) agents[nv].kpis = o.kpis.map((id) => (id === AGD_CONV || id === AGD_REACT ? id : ref('metrics', id))).filter(Boolean);
          });
          const pr = (x) => { const c = x && { from: ref('metrics', x.from), to: ref('metrics', x.to) }; return c && c.from && c.to ? c : null; };
          const so = a.social;
          return {
            conversion: pr(a.conversion), response: pr(a.response), reactivation: pr(a.reactivation), agents,
            social: { products: so.products ? ids('products', so.products) : null, metrics: so.metrics ? ids('metrics', so.metrics) : null },
          };
        }
        if (k !== 'agent_views') return v;
        const a = normAgentViews(v), agents = {};
        Object.keys(a.agents).forEach((sv) => { const nv = ref('sellers', sv); if (nv) agents[nv] = { metrics: ids('metrics', a.agents[sv].metrics) }; });
        return { order: ids('sellers', a.order), hidden_agents: ids('sellers', a.hidden_agents), agents };
      };
      const haveK = new Set(this.c.settings.map((r) => sid(r.id)));
      const settingsKeys = [];
      for (const r of B.settings) {
        const k = sid(r.id);
        if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k)) continue;
        if (haveK.has(k) && !opts.replaceSettings) { counts.settings.skip++; continue; }
        let v = r.value;
        try { v = JSON.parse(v); } catch (e) { /* texto puro */ }
        counts.settings.create++;
        settingsKeys.push(k);
        if (!dry) await this.setSetting(k, remap(k, v));
      }
      if (!dry) this.emit('change', { collection: '*', action: 'restore' });
      return { counts, issues, settingsKeys };
    }
    async setGoal(g) {
      const valid_from = g.valid_from || null;
      const rec = {
        target_type: g.target_type, target_id: g.target_id,
        amount: g.amount == null || g.amount === '' ? null : Number(g.amount),
        period: g.period === 'monthly' ? 'monthly' : 'weekly',
        valid_from,
      };
      const ex = this.goalRecords(g.target_type, g.target_id).find((x) => (x.valid_from || null) === valid_from);
      return ex ? this.update('goals', ex.id, rec) : this.create('goals', rec);
    }
  }

  // ==========================================================================
  // 3. PERÍODOS E CÁLCULOS DO PAINEL
  // ==========================================================================
  const PERIODS = [
    ['today', 'Hoje'], ['yesterday', 'Ontem'],
    ['last_7', 'Últimos 7 dias'], ['last_14', 'Últimos 14 dias'], ['last_28', 'Últimos 28 dias'], ['last_90', 'Últimos 90 dias'],
    ['this_week', 'Esta semana'], ['last_week', 'Semana passada'],
    ['this_month', 'Este mês'], ['last_month', 'Mês passado'],
    // v1.6: períodos longos (meses inteiros; o mês/ano atual vai até o fim, como "Este mês")
    ['last_6m', 'Últimos 6 meses'], ['last_12m', 'Últimos 12 meses'], ['this_year', 'Este ano'], ['last_year', 'Ano passado'],
  ];
  /** Só nas Tendências (v1.6): depende da primeira venda da base, que só essa aba lê. */
  const PERIOD_ALL = ['all', 'Desde a primeira venda'];
  /** Só no Dashboard Agentes (v1.7): desde o primeiro lançamento ou venda do agente escolhido. */
  const PERIOD_ALL_AGENT = ['all', 'Desde o primeiro registro'];
  const periodName = (p) => (p.preset === 'custom' ? 'Personalizado' : ((PERIODS.concat([PERIOD_ALL]).find((x) => x[0] === p.preset) || [0, 'Período'])[1]));

  /**
   * {preset, from?, to?} -> intervalo atual + intervalo anterior de mesmo tamanho (para comparação).
   * Meses e anos: o anterior são os meses (ou o ano) imediatamente antes. opts.firstSale: início do preset 'all';
   * opts.allName: nome do preset 'all' (o Dashboard Agentes usa "Desde o primeiro registro").
   */
  function computeRange(p, settings, opts) {
    const t = D.today();
    const mAdd = (s, k) => { const d = D.fromISO(s); return D.toISO(new Date(d.getFullYear(), d.getMonth() + k, 1)); }; // dia 1 do mês s + k
    let from, to, prevFrom, prevTo;
    switch (p.preset) {
      case 'today': from = to = t; break;
      case 'yesterday': from = to = D.add(t, -1); break;
      case 'last_7': case 'last_14': case 'last_28': case 'last_90': {
        const n = Number(p.preset.split('_')[1]);
        to = settings.include_today ? t : D.add(t, -1);
        from = D.add(to, -(n - 1));
        break;
      }
      case 'this_week': from = D.weekStart(t, settings.week_start); to = D.add(from, 6); break;
      case 'last_week': from = D.add(D.weekStart(t, settings.week_start), -7); to = D.add(from, 6); break;
      case 'this_month': from = D.monthStart(t); to = D.monthEnd(t); break;
      case 'last_month': to = D.add(D.monthStart(t), -1); from = D.monthStart(to); break;
      case 'last_6m': case 'last_12m': {
        const n = p.preset === 'last_6m' ? 6 : 12;
        from = mAdd(t, -(n - 1)); to = D.monthEnd(t);
        prevFrom = mAdd(from, -n); prevTo = D.add(from, -1);
        break;
      }
      case 'this_year': case 'last_year': {
        const y = Number(t.slice(0, 4)) - (p.preset === 'last_year' ? 1 : 0);
        from = y + '-01-01'; to = y + '-12-31';
        prevFrom = (y - 1) + '-01-01'; prevTo = (y - 1) + '-12-31';
        break;
      }
      case 'all': from = (opts && opts.firstSale) || t; to = t; if (to < from) to = from; break;
      default:
        from = D.isISO(p.from) ? p.from : t;
        to = D.isISO(p.to) ? p.to : from;
        if (to < from) { const x = from; from = to; to = x; }
    }
    if (prevFrom) { /* já definido (meses / anos) */ }
    else if (p.preset === 'this_month' || p.preset === 'last_month') { prevTo = D.add(from, -1); prevFrom = D.monthStart(prevTo); }
    else { const len = D.span(from, to); prevTo = D.add(from, -1); prevFrom = D.add(prevTo, -(len - 1)); }
    return { from, to, prevFrom, prevTo, days: D.span(from, to), name: p.preset === 'all' && opts && opts.allName ? opts.allName : periodName(p) };
  }

  function statusOf(pct, s) {
    if (pct == null || !isFinite(pct)) return null;
    if (pct < s.red_below) return 'critical';
    if (pct >= s.green_from) return 'good';
    return 'warning';
  }

  /**
   * Calcula tudo que o painel mostra.
   * Regra central: o faturamento entra na meta do FUNIL pela "Origem da Lead" — não pelo produto
   * comprado (venda cruzada conta para o funil de onde a lead veio). Vendas cuja origem não é um
   * produto (ex.: "Cliente Antigo") contam na meta do PRODUTO VENDIDO (v1.2; antes ficavam fora das metas).
   * "Faturado via funis" (k.funnelRevenue) continua sendo só o que veio de funis.
   * Produtos com show_in_goals = false ficam fora de "Metas por produto" e de tudo que é meta
   * (Meta · produtos com meta, Falta, Ritmo, gráfico acumulado × meta). "Meta × faturamento total" (v1.11) usa a
   * mesma meta, mas compara com TODO o faturamento (k.totalPct). Receita, vendedores, funil,
   * "O que foi vendido", origens e auditoria continuam com todos os produtos.
   * v1.6: o faturado de um produto só é comparado com a meta dele nos dias em que ela valia (p.revenueGoal);
   * nos dias sem meta de nenhum produto exibido vale a META GERAL (k.general), comparada com TODAS as vendas daqueles
   * dias (era a meta da empresa inteira: produtos ocultos nas metas entram). k.goal / k.goalRevenue / k.missing / ritmo somam as duas partes.
   */
  function computeDashboard(store, sales, daily, r) {
    const s = store.settings;
    const inR = (x) => x.date >= r.from && x.date <= r.to;
    const inP = (x) => x.date >= r.prevFrom && x.date <= r.prevTo;
    const S = sales.filter(inR), SP = sales.filter(inP), DL = daily.filter(inR);
    const today = D.today();
    // Até onde o "ritmo" deve ser cobrado (períodos que ainda não terminaram).
    const paceTo = r.to < today ? r.to : (r.from > today ? null : today);
    const opOf = (x) => store.originProductId(x.origin_id);
    // Produto cuja META recebe a venda: o funil de origem; se a origem for fora de funil, o produto vendido.
    const gpOf = (x) => opOf(x) || sid(x.product_id);

    // ---------- KPIs gerais ----------
    const revenue = sum(S, (x) => x.amount), prevRevenue = sum(SP, (x) => x.amount);
    const count = S.length, prevCount = SP.length;
    const k = {
      revenue, prevRevenue, count, prevCount,
      avg: count ? revenue / count : null, prevAvg: prevCount ? prevRevenue / prevCount : null,
      funnelRevenue: sum(S.filter((x) => opOf(x)), (x) => x.amount),
    };

    // ---------- metas por produto (funil de origem) ----------
    const prodIdsWithActivity = new Set();
    S.forEach((x) => { const op = opOf(x); if (op) prodIdsWithActivity.add(op); prodIdsWithActivity.add(sid(x.product_id)); });
    DL.forEach((x) => prodIdsWithActivity.add(sid(x.product_id)));
    const products = store.list('products', { all: true }).filter((p) => p.active !== false || prodIdsWithActivity.has(sid(p.id)));
    const prodRows = products.map((p) => {
      const pid = sid(p.id);
      const mine = S.filter((x) => gpOf(x) === pid);
      const other = mine.filter((x) => !opOf(x)); // vindas de origens fora de funil (ex.: Cliente Antigo)
      const goal = store.goalForRange('product', p.id, r.from, r.to);
      const goalToDate = paceTo && goal != null ? store.goalForRange('product', p.id, r.from, paceTo) : null;
      const rev = sum(mine, (x) => x.amount);
      // v1.6: só o faturado nos dias em que a meta do produto valia é comparado com ela
      const revGoal = goal != null ? sum(mine.filter((x) => store.goalAt('product', pid, x.date)), (x) => x.amount) : null;
      const pct = goal ? revGoal / goal : null;
      return {
        id: pid, name: p.name, active: p.active !== false, visible: p.show_in_goals !== false, owner: store.name('sellers', p.owner_seller_id),
        goal, goalToDate, revenue: rev, revenueGoal: revGoal, count: mine.length, pct, status: statusOf(pct, s),
        revenueOther: sum(other, (x) => x.amount), countOther: other.length,
        missing: goal != null ? Math.max(goal - revGoal, 0) : null,
        prevRevenue: sum(SP.filter((x) => gpOf(x) === pid), (x) => x.amount),
      };
    });
    const goalRows = prodRows.filter((p) => p.visible); // "Metas por produto" (sem os ocultos)
    const hiddenProducts = prodRows.filter((p) => !p.visible).map((p) => ({ id: p.id, name: p.name, hasGoal: p.goal != null }));
    const withGoal = goalRows.filter((p) => p.goal != null);
    // meta geral (v1.6): dias sem meta própria de nenhum produto exibido; compara com todas as vendas desses dias
    const gDays = store.generalGoalDays(r.from, r.to);
    let general = null;
    if (gDays.size) {
      const gs = S.filter((x) => gDays.has(x.date));
      const keys = Array.from(gDays.keys());
      const g = Array.from(gDays.values()).reduce((a, v) => a + v, 0);
      const rev = sum(gs, (x) => x.amount);
      const pct = g ? rev / g : null;
      general = {
        goal: Math.round(g * 100) / 100, revenue: rev, count: gs.length, pct, status: statusOf(pct, s),
        missing: Math.max(Math.round(g * 100) / 100 - rev, 0), days: gDays.size, from: keys[0], to: keys[keys.length - 1],
        goalToDate: paceTo ? keys.filter((d) => d <= paceTo).reduce((a, d) => a + gDays.get(d), 0) : null,
      };
    }
    const hasGoal = withGoal.length > 0 || !!general;
    k.general = general;
    k.goal = hasGoal ? sum(withGoal, (p) => p.goal) + (general ? general.goal : 0) : null;
    k.goalRevenue = sum(withGoal, (p) => p.revenueGoal) + (general ? general.revenue : 0);
    k.goalPct = k.goal ? k.goalRevenue / k.goal : null;
    k.goalStatus = statusOf(k.goalPct, s);
    k.missing = hasGoal ? sum(withGoal, (p) => p.missing) + (general ? general.missing : 0) : null;
    k.goalToDate = hasGoal && paceTo ? sum(withGoal, (p) => p.goalToDate || 0) + (general ? general.goalToDate : 0) : null;
    k.pacePct = k.goalToDate ? k.goalRevenue / k.goalToDate : null;
    k.paceStatus = statusOf(k.pacePct, s);
    k.inProgress = !!paceTo && paceTo < r.to;
    // v1.11: dias do período já cobrados no ritmo (de r.from até hoje) — para o cartão mostrar "5 de 7 dias da meta"
    k.paceTo = paceTo; k.paceDays = paceTo ? D.span(r.from, paceTo) : null;
    // v1.11 "Meta × faturamento total": a MESMA meta (k.goal), comparada com TODO o faturamento do período
    // (produtos sem meta, como os high ticket, e produtos ocultos entram). Ritmo: o mesmo esperado até hoje (k.goalToDate).
    k.totalPct = k.goal ? revenue / k.goal : null;
    k.totalStatus = statusOf(k.totalPct, s);
    k.totalMissing = hasGoal ? Math.max(Math.round(k.goal * 100) / 100 - revenue, 0) : null;
    k.totalPacePct = k.goalToDate ? revenue / k.goalToDate : null;
    k.totalPaceStatus = statusOf(k.totalPacePct, s);
    k.shownRevenue = sum(goalRows, (p) => p.revenue); // faturado nos produtos exibidos (funis + origens fora de funil)
    k.shownCount = sum(goalRows, (p) => p.count);

    // ---------- vendedores ----------
    const sellerIdsWithSales = new Set(S.map((x) => sid(x.seller_id)));
    const sellers = store.list('sellers', { all: true }).filter((v) => v.active !== false || sellerIdsWithSales.has(sid(v.id)));
    const sellerRows = sellers.map((v) => {
      const vid = sid(v.id);
      const mine = S.filter((x) => sid(x.seller_id) === vid);
      const rev = sum(mine, (x) => x.amount);
      const goal = store.goalForRange('seller', v.id, r.from, r.to);
      const pct = goal ? rev / goal : null;
      return {
        id: vid, name: v.name, active: v.active !== false, revenue: rev, count: mine.length,
        avg: mine.length ? rev / mine.length : null, goal, pct, status: statusOf(pct, s),
        missing: goal != null ? Math.max(goal - rev, 0) : null,
        prevRevenue: sum(SP.filter((x) => sid(x.seller_id) === vid), (x) => x.amount),
        cross: mine.filter((x) => { const op = opOf(x); return op && op !== sid(x.product_id); }).length,
      };
    }).sort((a, b) => b.revenue - a.revenue || b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'));

    // ---------- o que foi vendido (produto comprado) ----------
    const groupBy = (arr, keyFn) => { const m = new Map(); arr.forEach((x) => { const kk = keyFn(x); if (!m.has(kk)) m.set(kk, []); m.get(kk).push(x); }); return m; };
    const sold = Array.from(groupBy(S, (x) => sid(x.product_id)).entries()).map(([pid, arr]) => ({
      id: pid, name: store.name('products', pid), count: arr.length, value: sum(arr, (x) => x.amount),
      share: revenue ? sum(arr, (x) => x.amount) / revenue : 0,
      cross: arr.filter((x) => { const op = opOf(x); return op && op !== pid; }).length,
    })).sort((a, b) => b.value - a.value);
    const originsAgg = Array.from(groupBy(S, (x) => sid(x.origin_id)).entries()).map(([oid, arr]) => ({
      id: oid, name: store.name('origins', oid), isProduct: !!store.originProductId(oid), count: arr.length,
      value: sum(arr, (x) => x.amount), share: revenue ? sum(arr, (x) => x.amount) / revenue : 0,
    })).sort((a, b) => b.value - a.value);
    k.cross = S.filter((x) => { const op = opOf(x); return op && op !== sid(x.product_id); }).length;

    // ---------- funil (aba Diário) ----------
    const stages = store.funnelMetrics().filter((m) => m.active !== false || DL.some((x) => sid(x.metric_id) === sid(m.id)));
    const qty = (pid, mid) => sum(DL.filter((x) => (pid == null || sid(x.product_id) === pid) && sid(x.metric_id) === mid), (x) => x.quantity);
    const funnelRows = products.map((p) => {
      const pid = sid(p.id);
      const values = stages.map((m) => qty(pid, sid(m.id)));
      const registered = S.filter((x) => opOf(x) === pid).length;
      return { id: pid, name: p.name, values, registered, conv: values.length > 1 && values[0] ? values[values.length - 1] / values[0] : null, any: values.some((v) => v) || registered > 0 };
    }).filter((x) => x.any);
    const funnelTotals = stages.map((m) => qty(null, sid(m.id)));
    const hiddenSide = new Set(s.funnel_hidden_metrics); // "Oculta no painel" em Personalizar funil
    const otherMetrics = store.list('metrics', { all: true })
      .filter((m) => !(m.kind === 'count' && m.funnel_order != null) && !hiddenSide.has(sid(m.id)))
      .map((m) => ({ id: sid(m.id), name: m.name, kind: m.kind, total: qty(null, sid(m.id)) }))
      .filter((m) => m.total || store.get('metrics', m.id).active !== false);

    // ---------- série diária ----------
    const goalProducts = withGoal.map((p) => p.id);
    const days = D.each(r.from, r.to);
    const byDay = groupBy(S, (x) => x.date);
    const dByDay = groupBy(DL, (x) => x.date);
    let cumRev = 0, cumGoal = 0, cumGoalRev = 0;
    const daySeries = days.map((d) => {
      const arr = byDay.get(d) || [];
      const rev = sum(arr, (x) => x.amount);
      // dia de meta geral: meta da empresa × todas as vendas do dia; senão, cada produto no dia em que tem meta
      const gen = gDays.has(d);
      const goalRev = gen ? rev
        : sum(arr.filter((x) => goalProducts.indexOf(gpOf(x)) > -1 && store.goalAt('product', gpOf(x), d)), (x) => x.amount);
      const g = gen ? gDays.get(d) : goalProducts.reduce((a, pid) => a + (store.goalForRange('product', pid, d, d, true) || 0), 0);
      cumRev += rev; cumGoalRev += goalRev; cumGoal += g;
      const dl = dByDay.get(d) || [];
      return {
        date: d, revenue: rev, count: arr.length, goal: g, general: gen, future: d > today,
        cumRevenue: cumRev, cumGoalRevenue: cumGoalRev, cumGoal,
        stages: stages.map((m) => sum(dl.filter((x) => sid(x.metric_id) === sid(m.id)), (x) => x.quantity)),
      };
    });

    // ---------- auditoria Diário x Vendas (exibida no Diário → Histórico desde a v1.5) ----------
    const audit = computeAudit(store, S, DL, r);

    return { range: r, k, products: goalRows, hiddenProducts, sellers: sellerRows, sold, origins: originsAgg, stages, funnelRows, funnelTotals, otherMetrics, days: daySeries, audit, hasGoals: hasGoal };
  }

  /**
   * Auditoria Diário × Vendas (aba Diário → Histórico): por produto (funil), compara o que os agentes
   * informaram no Diário (métricas com audit_role) com as vendas registradas cuja origem é aquele funil.
   * null quando nenhuma métrica tem audit_role. Cada linha: { id, name, dSold, sCount, dRev, sRev, diff, ok };
   * a lista traz hasSold / hasRev (quais conferências estão ligadas).
   */
  function computeAudit(store, sales, daily, r) {
    const inR = (x) => x.date >= r.from && x.date <= r.to;
    const S = sales.filter(inR), DL = daily.filter(inR);
    const soldMetrics = store.c.metrics.filter((m) => m.audit_role === 'sold_count').map((m) => sid(m.id));
    const revMetrics = store.c.metrics.filter((m) => m.audit_role === 'revenue').map((m) => sid(m.id));
    if (!soldMetrics.length && !revMetrics.length) return null;
    const opOf = (x) => store.originProductId(x.origin_id);
    const audit = store.list('products', { all: true }).map((p) => {
      const pid = sid(p.id);
      const dSold = sum(DL.filter((x) => sid(x.product_id) === pid && soldMetrics.indexOf(sid(x.metric_id)) > -1), (x) => x.quantity);
      const dRev = sum(DL.filter((x) => sid(x.product_id) === pid && revMetrics.indexOf(sid(x.metric_id)) > -1), (x) => x.quantity);
      const mine = S.filter((x) => opOf(x) === pid);
      const sRev = sum(mine, (x) => x.amount);
      const okSold = !soldMetrics.length || dSold === mine.length;
      const okRev = !revMetrics.length || Math.abs(dRev - sRev) < 0.005;
      return { id: pid, name: p.name, dSold, sCount: mine.length, dRev, sRev, diff: sRev - dRev, ok: okSold && okRev, any: dSold || dRev || mine.length };
    }).filter((x) => x.any);
    audit.hasSold = soldMetrics.length > 0;
    audit.hasRev = revMetrics.length > 0;
    return audit;
  }

  /**
   * Visão por Agente (aba Diário). Para cada agente com lançamentos no período:
   *  - métricas: as escolhidas para ele em settings.agent_views.agents[id].metrics (na ordem escolhida)
   *    ou, sem escolha ("automático"), as que ele preencheu no período, na ordem do funil;
   *  - colunas: os produtos em que ele lançou algo no período, mais o total.
   * Agentes sem lançamentos no período vão para "idle"; os ocultos (hidden_agents), para "hidden".
   */
  function computeAgentView(store, entries, r) {
    const cfg = store.settings.agent_views || normAgentViews(null);
    const E = entries.filter((x) => x.date >= r.from && x.date <= r.to);
    const bySeller = new Map();
    E.forEach((x) => { const k = sid(x.seller_id); if (!bySeller.has(k)) bySeller.set(k, []); bySeller.get(k).push(x); });
    const metricOrder = store.list('metrics', { all: true }).map((m) => sid(m.id));
    const prodOrder = store.list('products', { all: true }).map((p) => sid(p.id));
    const hidden = new Set(cfg.hidden_agents);
    const pos = new Map(cfg.order.map((id, i) => [id, i]));
    const sellers = store.list('sellers', { all: true }).map((v, i) => ({ v, i }))
      .sort((a, b) => ((pos.has(sid(a.v.id)) ? pos.get(sid(a.v.id)) : 1e6) - (pos.has(sid(b.v.id)) ? pos.get(sid(b.v.id)) : 1e6)) || a.i - b.i)
      .map((x) => x.v);
    const agents = [], idle = [], hiddenList = [];
    sellers.forEach((v) => {
      const vid = sid(v.id), mine = bySeller.get(vid) || [];
      if (hidden.has(vid)) { hiddenList.push({ id: vid, name: v.name, entries: mine.length }); return; }
      if (!mine.length) { if (v.active !== false) idle.push({ id: vid, name: v.name }); return; }
      const used = new Set(mine.map((x) => sid(x.metric_id)));
      const conf = cfg.agents[vid];
      const metricIds = conf ? conf.metrics.filter((id) => store.get('metrics', id)) : metricOrder.filter((id) => used.has(id));
      const inEntries = new Set(mine.map((x) => sid(x.product_id)));
      const prodIds = prodOrder.filter((id) => inEntries.has(id)).concat(Array.from(inEntries).filter((id) => prodOrder.indexOf(id) < 0));
      const rows = metricIds.map((mid) => {
        const m = store.get('metrics', mid), arr = mine.filter((x) => sid(x.metric_id) === mid);
        return {
          id: mid, name: m.name, kind: m.kind, filled: arr.length > 0, total: sum(arr, (x) => x.quantity),
          values: prodIds.map((pid) => sum(arr.filter((x) => sid(x.product_id) === pid), (x) => x.quantity)),
        };
      });
      const shown = new Set(metricIds);
      agents.push({
        id: vid, name: v.name, active: v.active !== false, custom: !!conf,
        products: prodIds.map((pid) => ({ id: pid, name: store.name('products', pid) })),
        metrics: rows, used: metricOrder.filter((id) => used.has(id)),
        unshown: metricOrder.filter((id) => used.has(id) && !shown.has(id)).map((id) => store.name('metrics', id)),
        entries: mine.length, days: new Set(mine.map((x) => x.date)).size,
      });
    });
    return { range: r, agents, idle, hidden: hiddenList };
  }

  // ---------------- Dashboard Agentes (aba Diário, v1.7) ----------------
  /** Id do indicador "Conversão" na lista de KPIs personalizada (settings.agent_dashboard). */
  const AGD_CONV = '__conv';
  /** Id do indicador "Resposta da reativação" (v1.9). */
  const AGD_REACT = '__react';
  /**
   * Seções do dashboard de um agente (v1.9), na ordem padrão: [id, nome, largura]. "half" fica lado a lado com a
   * seção "half" seguinte; cada agente pode reordenar e esconder (settings.agent_dashboard.agents[id].order / hidden).
   */
  const AGD_SECTIONS = [
    ['kpis', 'Indicadores do topo', 'full'], ['funnel', 'Funil do período', 'half'], ['evol', 'Evolução', 'half'],
    ['rates', 'Taxas', 'half'], ['income', 'Renda dos leads', 'half'], ['react', 'Reativação', 'full'], ['social', 'Mídias sociais', 'full'],
    ['prod', 'Por produto', 'full'], ['others', 'Outras atividades', 'half'], ['cal', 'Constância de preenchimento', 'half'], ['sales', 'Vendas como vendedor', 'full'],
  ];
  /** Ordem das seções de um agente: a escolhida, com as seções que ela não cita no lugar padrão (seção nova numa versão futura). */
  function agdLayout(conf) {
    const def = AGD_SECTIONS.map((x) => x[0]);
    const order = conf && conf.order ? conf.order.filter((id, i, a) => def.indexOf(id) > -1 && a.indexOf(id) === i) : [];
    def.forEach((id, i) => {
      if (order.indexOf(id) > -1) return;
      let at = 0;
      for (let j = i - 1; j >= 0; j--) { const k = order.indexOf(def[j]); if (k > -1) { at = k + 1; break; } }
      order.splice(at, 0, id);
    });
    const hidden = new Set(conf && conf.hidden ? conf.hidden : []);
    return { order, hidden: order.filter((id) => hidden.has(id)), visible: order.filter((id) => !hidden.has(id)) };
  }
  /** Grupos (dia / semana / mês) de um período, cortados nos limites (a mesma montagem das Tendências). */
  function timeBuckets(from, to, unit, weekStart, today) {
    const out = [];
    let a = unit === 'day' ? from : unit === 'week' ? D.weekStart(from, weekStart) : D.monthStart(from);
    while (a <= to) {
      const z0 = unit === 'day' ? a : unit === 'week' ? D.add(a, 6) : D.monthEnd(a);
      out.push(bucketInfo(a < from ? from : a, z0 > to ? to : z0, unit, today));
      a = D.add(z0, 1);
    }
    return out;
  }
  function bucketInfo(f, t, unit, today, note) {
    const mes = MONTHS[Number(f.slice(5, 7)) - 1];
    const cut = unit === 'month' && (f !== D.monthStart(f) || t !== D.monthEnd(f));
    return {
      from: f, to: t, future: f > today, partial: f <= today && t > today,
      label: unit === 'month' ? mes + '/' + f.slice(2, 4) : D.fmtShort(f),
      head: (unit === 'day' ? D.dowLong(f) + ', ' + D.fmt(f)
        : unit === 'week' ? 'Semana de ' + D.fmt(f) + (f !== t ? ' a ' + D.fmt(t) : '')
          : mes + '/' + f.slice(0, 4) + (cut ? ' (' + D.fmtShort(f) + ' a ' + D.fmtShort(t) + ')' : '')) + (note ? ' (' + note + ')' : ''),
    };
  }
  /** Tira os grupos futuros e os que terminam antes de `start`; o grupo em que `start` cai passa a começar nele. */
  function trimBuckets(list, start, unit, today, note) {
    const out = list.filter((b) => !b.future && (!start || b.to >= start));
    if (start && out.length && out[0].from < start) out[0] = bucketInfo(start, out[0].to, unit, today, note);
    return out;
  }

  /**
   * Normaliza settings.agent_dashboard:
   *  { conversion, response, reactivation: { from, to } | null (cada um),
   *    social: { products: [ids] | null, metrics: [ids] | null } (null = automático),
   *    agents: { "<id do agente>": { kpis?: [ids de métricas, "__conv" ou "__react"], order?: [seções], hidden?: [seções] } } }.
   */
  function normAgentDashboard(v) {
    v = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    const agents = {}, known = AGD_SECTIONS.map((x) => x[0]);
    const ids = (a) => a.map(sid).filter(Boolean);
    if (v.agents && typeof v.agents === 'object') {
      Object.keys(v.agents).forEach((k) => {
        const a = v.agents[k], o = {};
        if (!a || typeof a !== 'object') return;
        if (Array.isArray(a.kpis)) o.kpis = ids(a.kpis);
        if (Array.isArray(a.order)) o.order = ids(a.order).filter((x) => known.indexOf(x) > -1);
        if (Array.isArray(a.hidden)) o.hidden = ids(a.hidden).filter((x) => known.indexOf(x) > -1);
        if (Object.keys(o).length) agents[sid(k)] = o;
      });
    }
    const pair = (c) => { c = c && typeof c === 'object' ? c : {}; const from = sid(c.from), to = sid(c.to); return from && to && from !== to ? { from, to } : null; };
    const so = v.social && typeof v.social === 'object' ? v.social : {};
    const list = (a) => (Array.isArray(a) ? ids(a).filter((x, i, arr) => arr.indexOf(x) === i) : null);
    return { conversion: pair(v.conversion), response: pair(v.response), reactivation: pair(v.reactivation), social: { products: list(so.products), metrics: list(so.metrics) }, agents };
  }

  /**
   * Taxa de resposta (v1.8): a escolhida em settings.agent_dashboard.response ou, no automático, reconhecida pelo nome (como
   * a Renda dos Leads): métrica de quantidade com "contatad" (ex.: Leads Contatadas) → com "respond" (ex.: Leads que Responderam).
   * { from, to, custom } ou null. onlyAuto: ignora a escolha (para mostrar o que o automático usaria).
   */
  function responsePair(store, onlyAuto) {
    const c = store.settings.agent_dashboard.response;
    if (!onlyAuto && c && store.get('metrics', c.from) && store.get('metrics', c.to)) return { from: sid(c.from), to: sid(c.to), custom: true };
    // as de reativação (ex.: "Leads que Responderam - Reativação") têm a taxa delas (reactivationPair)
    const ms = store.list('metrics', { all: true }).filter((m) => m.kind === 'count' && !/reativ/.test(norm(m.name)));
    const f = ms.find((m) => /contatad/.test(norm(m.name))), t = ms.find((m) => /respond/.test(norm(m.name)));
    return f && t && f !== t ? { from: sid(f.id), to: sid(t.id), custom: false } : null;
  }

  /**
   * Resposta da reativação (v1.9): a escolhida em settings.agent_dashboard.reactivation ou, no automático, pelo nome:
   * métrica de quantidade com "reativ" (ex.: Reativação) → com "reativ" e "respond" (ex.: Leads que Responderam - Reativação).
   * A Reativação é contada à parte de Leads Contatadas (decidido com o usuário). { from, to, custom } ou null.
   */
  function reactivationPair(store, onlyAuto) {
    const c = store.settings.agent_dashboard.reactivation;
    if (!onlyAuto && c && store.get('metrics', c.from) && store.get('metrics', c.to)) return { from: sid(c.from), to: sid(c.to), custom: true };
    const ms = store.list('metrics', { all: true }).filter((m) => m.kind === 'count' && /reativ/.test(norm(m.name)));
    const f = ms.find((m) => !/respond/.test(norm(m.name))), t = ms.find((m) => /respond/.test(norm(m.name)));
    return f && t ? { from: sid(f.id), to: sid(t.id), custom: false } : null;
  }

  // produtos reconhecidos como mídia social no automático (pelo nome)
  const SOCIAL_RE = /\b(tik ?tok|instagram|facebook|youtube|kwai|linkedin|pinterest|twitter)\b/;
  /**
   * Mídias sociais (v1.9): produtos com fluxo próprio (ex.: TikTok e Instagram). Saem do funil, das taxas e do "Por produto"
   * do agente e ganham a seção deles. products: os escolhidos em settings.agent_dashboard.social ou, no automático, pelo
   * nome; metrics: as escolhidas (para todos os agentes, na ordem) ou null = as que o agente lançou, na ordem do funil.
   */
  function socialConfig(store) {
    const c = store.settings.agent_dashboard.social;
    const products = c.products ? c.products.filter((id) => store.get('products', id))
      : store.list('products', { all: true }).filter((p) => SOCIAL_RE.test(norm(p.name))).map((p) => sid(p.id));
    return { products, metrics: c.metrics ? c.metrics.filter((id) => store.get('metrics', id)) : null, customProducts: !!c.products, customMetrics: !!c.metrics };
  }

  /**
   * Dashboard Agentes (aba Diário, v1.7): tudo de UM agente num período.
   *  entries / sales: lançamentos do Diário e vendas da base inteira (o início de cada agente depende do histórico);
   *  opts: { agent, product ('' = todos), unit ('day' | 'week' | 'month' | null = automático), weekStart, today }.
   * Regras (decididas com o usuário):
   *  - Diário: lançamentos com o agente; vendas: as vendas em que ele é o VENDEDOR (coluna Vendedor), de qualquer produto;
   *  - filtro de produto: Diário pelo produto do lançamento; vendas pelo produto vendido (a meta individual some, porque
   *    não é dividida por produto);
   *  - taxa entre duas métricas (ex.: Responderam ÷ Contatadas) só conta os dias + produtos em que o agente lançou AS DUAS
   *    (dia com só uma delas distorceria a taxa); `days` = em quantos dias a taxa se apoia;
   *  - média diária = total ÷ dias em que o agente lançou algo (no filtro de produto);
   *  - comparação com o período anterior de mesmo tamanho; período em andamento compara até o mesmo ponto
   *    (ex.: 1 a 21 deste mês × 1 a 21 do anterior);
   *  - o Diário de cada agente começa no primeiro lançamento dele: grupos antes disso não aparecem e, se o período
   *    anterior começa antes, não há comparação (não é "0"). As vendas seguem a primeira venda da base (como nas Tendências);
   *  - conversão: a escolhida para todos os agentes em settings.agent_dashboard.conversion ("to" ÷ "from", ex.: Vendidos ÷
   *    Leads que Responderam; mesma regra das taxas) ou, sem escolha, a última etapa do funil que ele lançou ÷ a primeira.
   *    Agente que não lançou uma das duas no período: conversão "—" e d.conv.missing com o nome dela;
   *  - taxa de resposta (v1.8, d.response): Leads que Responderam ÷ Leads Contatadas (responsePair), mesma regra das taxas;
   *    aparece no cartão da métrica "Responderam" (k.resp) e na Equipe;
   *  - KPIs: os escolhidos em settings.agent_dashboard ou, no automático, a primeira e a última etapa do funil que ele
   *    preencheu, a conversão e as métricas em R$;
   *  - reativação (v1.9, d.react): Responderam (Reativação) ÷ Reativação (reactivationPair), mesma regra das taxas; só para
   *    quem já lançou alguma das duas; comparação só se o período anterior começa depois do primeiro lançamento delas.
   *    As duas saem de "Outras atividades";
   *  - mídias sociais (v1.9, d.social): os produtos de socialConfig saem do funil, das taxas, dos KPIs e do "Por produto"
   *    (e do filtro de produto) e vão para uma seção própria, só para quem lança neles e só sem filtro de produto.
   *    Constância e "dias com lançamento" contam todos os lançamentos;
   *  - seções (v1.9, out.layout): ordem e ocultas escolhidas para o agente (agdLayout).
   */
  function computeAgentDashboard(store, entries, sales, r, opts) {
    opts = opts || {};
    const s = store.settings, today = opts.today || D.today();
    const unit = trendUnit(r, opts.unit);
    const inR = (x) => x.date >= r.from && x.date <= r.to;
    // início de cada agente (Diário e vendas) e primeira venda da base
    const firstE = new Map(), firstS = new Map();
    let baseFirstSale = null;
    const early = (m, k, d) => { if (!m.has(k) || d < m.get(k)) m.set(k, d); };
    entries.forEach((x) => early(firstE, sid(x.seller_id), x.date));
    sales.forEach((x) => { early(firstS, sid(x.seller_id), x.date); if (!baseFirstSale || x.date < baseFirstSale) baseFirstSale = x.date; });
    const nE = new Map(), nS = new Map();
    entries.forEach((x) => { if (inR(x)) nE.set(sid(x.seller_id), (nE.get(sid(x.seller_id)) || 0) + 1); });
    sales.forEach((x) => { if (inR(x)) nS.set(sid(x.seller_id), (nS.get(sid(x.seller_id)) || 0) + 1); });
    // agentes: na ordem da Visão por Agente; ativos ou com registro no período (e o já escolhido, mesmo arquivado)
    const pos = new Map(s.agent_views.order.map((id, i) => [id, i]));
    const want = sid(opts.agent);
    const agents = store.list('sellers', { all: true }).map((v, i) => ({ v, i }))
      .sort((a, b) => ((pos.has(sid(a.v.id)) ? pos.get(sid(a.v.id)) : 1e6) - (pos.has(sid(b.v.id)) ? pos.get(sid(b.v.id)) : 1e6)) || a.i - b.i)
      .map((x) => x.v).filter((v) => v.active !== false || nE.has(sid(v.id)) || nS.has(sid(v.id)) || sid(v.id) === want)
      .map((v) => {
        const id = sid(v.id), fe = firstE.get(id) || null, fs = firstS.get(id) || null;
        return { id, name: v.name, active: v.active !== false, entries: nE.get(id) || 0, sales: nS.get(id) || 0, first: fe && fs ? (fe < fs ? fe : fs) : fe || fs };
      });
    const out = { range: r, unit, today, agents, agent: null, product: '', products: [] };
    if (!agents.length) { out.status = 'noagents'; return out; }
    const ag = agents.find((a) => a.id === want) || agents.find((a) => a.entries) || agents.find((a) => a.sales) || agents[0];
    const aid = ag.id;
    out.agent = ag;
    out.status = r.from > today ? 'future' : 'ok';
    const myE = entries.filter((x) => sid(x.seller_id) === aid), myS = sales.filter((x) => sid(x.seller_id) === aid);
    const soc = socialConfig(store), isSoc = new Set(soc.products);
    const notSoc = (x) => !isSoc.has(sid(x.product_id));
    // produtos do agente no período (Diário + vendas), fora as mídias sociais — o filtro só oferece estes
    const pset = new Set(myE.filter(inR).map((x) => sid(x.product_id)).concat(myS.filter(inR).map((x) => sid(x.product_id))).filter((id) => !isSoc.has(id)));
    const order = store.list('products', { all: true }).map((p) => sid(p.id));
    out.products = order.filter((id) => pset.has(id)).concat(Array.from(pset).filter((id) => order.indexOf(id) < 0))
      .map((id) => { const p = store.get('products', id); return { id, name: store.name('products', id), active: !p || p.active !== false }; });
    const product = opts.product && pset.has(sid(opts.product)) ? sid(opts.product) : '';
    out.product = product;
    const pf = (x) => !product || sid(x.product_id) === product;
    // período anterior: de mesmo tamanho; em andamento, só até o mesmo ponto
    const end = r.to < today ? r.to : today;
    const elapsed = end >= r.from ? D.span(r.from, end) : 0;
    const prevTo = elapsed && elapsed < r.days ? (D.add(r.prevFrom, elapsed - 1) < r.prevTo ? D.add(r.prevFrom, elapsed - 1) : r.prevTo) : r.prevTo;
    out.prev = { from: r.prevFrom, to: prevTo, same: prevTo !== r.prevTo };
    const inP = (x) => x.date >= r.prevFrom && x.date <= prevTo;

    // ---------- Diário ----------
    const startE = firstE.get(aid) || null;
    const EA = myE.filter((x) => inR(x) && pf(x)); // tudo, com as mídias sociais (dias com lançamento e constância)
    const E = EA.filter(notSoc);
    const noPrevD = !startE || r.prevFrom < startE;
    const EP = noPrevD ? [] : myE.filter((x) => inP(x) && pf(x) && notSoc(x));
    const d = { start: startE, noPrev: noPrevD };
    out.daily = d;
    d.status = !startE ? 'none' : r.from > today ? 'future' : r.to < startE ? 'before' : !EA.length ? 'empty' : 'ok';
    // índice: métrica -> (dia|produto) -> quantidade, para as taxas
    const index = (arr) => {
      const m = new Map();
      arr.forEach((x) => {
        const mid = sid(x.metric_id), k = x.date + '|' + sid(x.product_id);
        if (!m.has(mid)) m.set(mid, new Map());
        const mm = m.get(mid);
        mm.set(k, (mm.get(k) || 0) + (Number(x.quantity) || 0));
      });
      return m;
    };
    const rateOf = (ix, a, b, from, to) => {
      const qa = ix.get(a), qb = ix.get(b);
      let den = 0, num = 0;
      const days = new Set();
      if (qa && qb) qa.forEach((v, k) => { const dt = k.slice(0, 10); if (qb.has(k) && (!from || (dt >= from && dt <= to))) { den += v; num += qb.get(k); days.add(dt); } });
      return { value: den ? num / den : null, num, den, days: days.size };
    };
    const tot = (arr, mid) => sum(arr.filter((x) => sid(x.metric_id) === mid), (x) => x.quantity);
    const ixE = index(E), ixP = index(EP);
    const used = new Set(E.map((x) => sid(x.metric_id)));
    const allM = store.list('metrics', { all: true });
    const stages = store.funnelMetrics().filter((m) => used.has(sid(m.id))); // já na ordem do funil
    const income = leadIncomeConfig(store);
    const incIds = new Set(income.bands.map((b) => b.id).concat(income.unqualified ? [income.unqualified.id] : []));
    d.days = new Set(EA.map((x) => x.date)).size;
    const dStart = startE && startE > r.from ? startE : r.from;
    d.periodDays = end >= dStart ? D.span(dStart, end) : 0;
    const metricRow = (m) => {
      const id = sid(m.id), total = tot(E, id);
      return { id, name: m.name, kind: m.kind, total, prev: noPrevD ? null : tot(EP, id), avg: d.days ? total / d.days : null };
    };
    d.stages = stages.map((m, i) => Object.assign(metricRow(m), {
      step: i ? rateOf(ixE, sid(stages[i - 1].id), sid(m.id)) : null,
      prevStep: i && !noPrevD ? rateOf(ixP, sid(stages[i - 1].id), sid(m.id)) : null,
    }));
    // conversão: a escolhida para todos (ex.: Vendidos ÷ Leads que Responderam) ou a última etapa ÷ a primeira
    const cc = s.agent_dashboard.conversion;
    const ccOk = !!(cc && store.get('metrics', cc.from) && store.get('metrics', cc.to));
    const convPair = ccOk ? [sid(cc.from), sid(cc.to)] : stages.length > 1 ? [sid(stages[0].id), sid(stages[stages.length - 1].id)] : null;
    d.conv = convPair ? Object.assign(rateOf(ixE, convPair[0], convPair[1]), {
      prev: noPrevD ? null : rateOf(ixP, convPair[0], convPair[1]).value, from: store.name('metrics', convPair[0]), to: store.name('metrics', convPair[1]),
      custom: ccOk, missing: convPair.filter((id) => !used.has(id)).map((id) => store.name('metrics', id)),
    }) : null;
    const rp = responsePair(store);
    d.response = rp ? Object.assign(rateOf(ixE, rp.from, rp.to), {
      prev: noPrevD ? null : rateOf(ixP, rp.from, rp.to).value, fromId: rp.from, toId: rp.to, from: store.name('metrics', rp.from), to: store.name('metrics', rp.to),
      custom: rp.custom, missing: [rp.from, rp.to].filter((id) => !used.has(id)).map((id) => store.name('metrics', id)),
    }) : null;
    // reativação: só para quem já lançou (em qualquer data) alguma das duas métricas
    const rx = reactivationPair(store);
    const rxSet = new Set(rx ? [rx.from, rx.to] : []);
    const rxAll = myE.filter((x) => notSoc(x) && rxSet.has(sid(x.metric_id)));
    d.react = null;
    if (rxAll.length) {
      const rxStart = rxAll.reduce((a, x) => (x.date < a ? x.date : a), rxAll[0].date);
      const rxNoPrev = r.prevFrom < rxStart; // antes de começar a lançar reativação não há com o que comparar
      d.react = Object.assign(rateOf(ixE, rx.from, rx.to), {
        fromId: rx.from, toId: rx.to, from: store.name('metrics', rx.from), to: store.name('metrics', rx.to), custom: rx.custom,
        start: rxStart, noPrev: rxNoPrev, status: r.to < rxStart ? 'before' : E.some((x) => rxSet.has(sid(x.metric_id))) ? 'ok' : 'empty',
        total: tot(E, rx.from), answered: tot(E, rx.to), prevTotal: rxNoPrev ? null : tot(EP, rx.from), prevAnswered: rxNoPrev ? null : tot(EP, rx.to),
        prev: rxNoPrev ? null : rateOf(ixP, rx.from, rx.to).value, missing: [rx.from, rx.to].filter((id) => !used.has(id)).map((id) => store.name('metrics', id)),
      });
    }
    const isStage = new Set(stages.map((m) => sid(m.id)));
    d.money = allM.filter((m) => m.kind === 'money' && used.has(sid(m.id))).map(metricRow);
    d.income = income.bands.length ? (() => {
      const bands = income.bands.map((b) => ({ id: b.id, name: b.name, color: b.color, def: b.def, qty: tot(E, b.id) }));
      const qualified = sum(bands, (b) => b.qty), unq = income.unqualified ? tot(E, income.unqualified.id) : null;
      bands.forEach((b) => { b.share = qualified ? b.qty / qualified : null; });
      return E.some((x) => incIds.has(sid(x.metric_id))) ? { bands, qualified, unqualified: unq, unqName: income.unqualified ? income.unqualified.name : null } : null;
    })() : null;
    d.others = allM.filter((m) => m.kind !== 'money' && used.has(sid(m.id)) && !isStage.has(sid(m.id)) && !incIds.has(sid(m.id)) && !(d.react && rxSet.has(sid(m.id)))).map(metricRow);
    // taxas que podem ser acompanhadas no tempo: cada passo do funil + a conversão total
    d.rates = d.stages.slice(1).map((st, i) => ({ id: d.stages[i].id + '>' + st.id, name: st.name + ' ÷ ' + d.stages[i].name, a: d.stages[i].id, b: st.id }));
    if (convPair && !d.conv.missing.length) { // a conversão vem primeiro (se for igual a um passo do funil, ocupa o lugar dele)
      const cid = convPair[0] + '>' + convPair[1];
      d.rates = d.rates.filter((x) => x.id !== cid);
      d.rates.unshift({ id: cid, name: 'Conversão (' + d.conv.to + ' ÷ ' + d.conv.from + ')', a: convPair[0], b: convPair[1] });
    }
    // KPIs
    const conf = s.agent_dashboard.agents[aid];
    let autoK = stages.length ? [sid(stages[0].id)] : [];
    if (stages.length > 1) autoK.push(sid(stages[stages.length - 1].id));
    if (convPair) autoK.push(AGD_CONV);
    d.money.forEach((m) => autoK.push(m.id));
    autoK = autoK.slice(0, 6);
    d.autoKpis = autoK;
    const kpiIds = conf && conf.kpis ? conf.kpis.filter((id) => id === AGD_CONV || id === AGD_REACT || store.get('metrics', id)) : autoK;
    d.custom = !!(conf && conf.kpis);
    out.layout = agdLayout(conf);
    // grupos no tempo (sem futuro; desde o primeiro lançamento do agente)
    const full = timeBuckets(r.from, r.to, unit, opts.weekStart, today);
    const B = trimBuckets(full, startE, unit, today, 'desde o primeiro lançamento');
    d.trimmed = full.filter((b) => !b.future).length - B.length;
    const shift = D.diff(r.prevFrom, r.from);
    const PB = noPrevD ? [] : (unit === 'month' ? timeBuckets(r.prevFrom, r.prevTo, unit, opts.weekStart, today)
      : B.map((b) => ({ from: D.add(b.from, -shift) < r.prevFrom ? r.prevFrom : D.add(b.from, -shift), to: D.add(b.to, -shift) > r.prevTo ? r.prevTo : D.add(b.to, -shift) })));
    const ids = Array.from(used);
    const fill = (b, arr, ix) => {
      const inB = arr.filter((x) => x.date >= b.from && x.date <= b.to);
      // métrica sem lançamento no grupo = null ("sem lançamento", a linha é interrompida), não 0
      const has = new Set(inB.map((x) => sid(x.metric_id)));
      b.m = {};
      ids.forEach((id) => { b.m[id] = has.has(id) ? tot(inB, id) : null; });
      b.days = new Set(inB.map((x) => x.date)).size;
      b.rates = {};
      d.rates.forEach((rt) => { b.rates[rt.id] = rateOf(ix, rt.a, rt.b, b.from, b.to); });
      if (d.react) b.react = rateOf(ix, rx.from, rx.to, b.from, b.to);
      return b;
    };
    d.buckets = B.map((b) => fill(b, E, ixE));
    d.prevBuckets = PB.map((b) => fill(Object.assign({}, b), EP, ixP));
    d.kpis = kpiIds.map((id) => {
      if (id === AGD_CONV) {
        if (!d.conv) return null;
        const rid = convPair[0] + '>' + convPair[1];
        return { id, conv: true, name: 'Conversão', value: d.conv.value, prev: d.conv.prev, noPrev: noPrevD, days: d.conv.days, missing: d.conv.missing, sub: d.conv.to + ' ÷ ' + d.conv.from, spark: d.buckets.map((b) => (b.rates[rid] ? b.rates[rid].value : null)) };
      }
      if (id === AGD_REACT) {
        if (!d.react) return null;
        return { id, conv: true, name: 'Resposta da reativação', value: d.react.value, prev: d.react.prev, noPrev: d.react.noPrev, days: d.react.days, missing: d.react.missing, sub: d.react.to + ' ÷ ' + d.react.from, spark: d.buckets.map((b) => (b.react ? b.react.value : null)) };
      }
      const m = store.get('metrics', id);
      return Object.assign(metricRow(m), { spark: d.buckets.map((b) => (b.m[id] === undefined ? null : b.m[id])), resp: d.response && d.response.toId === id ? d.response : null });
    }).filter(Boolean);
    // por produto: as etapas do funil + R$ + conversão, em cada produto em que o agente lançou
    const cols = stages.map((m) => sid(m.id)).concat(d.money.map((m) => m.id));
    d.cols = cols.map((id) => ({ id, name: store.name('metrics', id), kind: (store.get('metrics', id) || {}).kind }));
    const ePids = new Set(E.map((x) => sid(x.product_id)));
    d.byProduct = out.products.filter((p) => ePids.has(p.id)).map((p) => {
      const arr = E.filter((x) => sid(x.product_id) === p.id);
      return Object.assign({}, p, { values: cols.map((id) => tot(arr, id)), conv: convPair ? rateOf(index(arr), convPair[0], convPair[1]).value : null, entries: arr.length });
    });
    // constância: um quadrado por dia, do início (período ou primeiro lançamento) até hoje
    const perDay = new Map();
    EA.forEach((x) => perDay.set(x.date, (perDay.get(x.date) || 0) + 1));
    d.calendar = d.periodDays ? D.each(dStart, end).map((dt) => ({ date: dt, n: perDay.get(dt) || 0 })) : [];

    // mídias sociais: só para quem lança nelas; com filtro de produto, ficam de fora
    const socAll = product ? [] : myE.filter((x) => !notSoc(x));
    d.social = null;
    if (socAll.length) {
      const sStart = socAll.reduce((a, x) => (x.date < a ? x.date : a), socAll[0].date);
      const sNoPrev = r.prevFrom < sStart;
      const SE = socAll.filter(inR), SPE = sNoPrev ? [] : socAll.filter(inP);
      const ppos = new Map(store.list('products', { all: true }).map((p, i) => [sid(p.id), i]));
      const at = (id) => (ppos.has(id) ? ppos.get(id) : 1e6);
      const nets = Array.from(new Set(SE.map((x) => sid(x.product_id)))).sort((a, b) => at(a) - at(b))
        .map((id) => { const p = store.get('products', id); return { id, name: store.name('products', id), active: !p || p.active !== false }; });
      const usedS = new Set(SE.map((x) => sid(x.metric_id)));
      // automático: as que o agente lançou, na ordem da lista de métricas (que já põe o funil primeiro)
      const mids = soc.metrics ? soc.metrics.slice() : allM.map((m) => sid(m.id)).filter((id) => usedS.has(id));
      const of = (arr, nid) => arr.filter((x) => sid(x.product_id) === nid);
      const val = (arr, id) => (arr.some((x) => sid(x.metric_id) === id) ? tot(arr, id) : null); // sem lançamento = null
      const ixS = index(SE), ixSP = index(SPE), ixN = new Map(nets.map((n) => [n.id, index(of(SE, n.id))]));
      const mk = (b, arr) => {
        const inB = arr.filter((x) => x.date >= b.from && x.date <= b.to), o = { from: b.from, to: b.to, label: b.label, head: b.head, partial: b.partial, m: {}, net: {} };
        mids.forEach((id) => { o.m[id] = val(inB, id); });
        nets.forEach((n) => { const a = of(inB, n.id); o.net[n.id] = {}; mids.forEach((id) => { o.net[n.id][id] = val(a, id); }); });
        return o;
      };
      d.social = {
        start: sStart, noPrev: sNoPrev, status: r.to < sStart ? 'before' : SE.length ? 'ok' : 'empty', custom: soc.customMetrics,
        days: new Set(SE.map((x) => x.date)).size, networks: nets,
        // % de cada métrica sobre a anterior da lista (mesma regra das taxas: só dia + rede com as duas)
        metrics: mids.map((id, i) => {
          const m = store.get('metrics', id);
          return {
            id, name: m.name, kind: m.kind, total: val(SE, id), prev: sNoPrev ? null : tot(SPE, id),
            step: i ? rateOf(ixS, mids[i - 1], id) : null, prevStep: i && !sNoPrev ? rateOf(ixSP, mids[i - 1], id).value : null,
            nets: nets.map((n) => ({ total: val(of(SE, n.id), id), prev: sNoPrev ? null : tot(of(SPE, n.id), id), step: i ? rateOf(ixN.get(n.id), mids[i - 1], id).value : null })),
          };
        }),
        buckets: B.map((b) => mk(b, SE)), prevBuckets: sNoPrev ? [] : PB.map((b) => mk(b, SPE)),
      };
    }

    // ---------- Vendas (o agente como vendedor) ----------
    const S = myS.filter((x) => inR(x) && pf(x));
    const noPrevS = !baseFirstSale || r.prevFrom < baseFirstSale;
    const SP = noPrevS ? [] : myS.filter((x) => inP(x) && pf(x));
    const v = { first: firstS.get(aid) || null, baseFirst: baseFirstSale, noPrev: noPrevS };
    out.sales = v;
    v.revenue = sum(S, (x) => x.amount); v.count = S.length; v.avg = v.count ? v.revenue / v.count : null;
    v.prevRevenue = noPrevS ? null : sum(SP, (x) => x.amount); v.prevCount = noPrevS ? null : SP.length;
    v.prevAvg = noPrevS || !SP.length ? null : v.prevRevenue / SP.length;
    // meta individual (Cadastros → Vendedores): a mesma conta do Painel; não vale com filtro de produto
    v.goal = product ? null : store.goalForRange('seller', aid, r.from, r.to);
    v.hasGoal = !product && store.goalRecords('seller', aid).length > 0;
    v.goalToDate = v.goal != null && r.to > today && r.from <= today ? store.goalForRange('seller', aid, r.from, today) || 0 : null;
    v.pct = v.goal ? v.revenue / v.goal : null;
    v.status = statusOf(v.pct, s);
    const sFull = timeBuckets(r.from, r.to, unit, opts.weekStart, today);
    v.buckets = trimBuckets(sFull, baseFirstSale, unit, today, 'desde a primeira venda').map((b) => {
      const arr = S.filter((x) => x.date >= b.from && x.date <= b.to);
      return Object.assign(b, { revenue: sum(arr, (x) => x.amount), count: arr.length, goal: product ? null : store.goalForRange('seller', aid, b.from, b.to) });
    });
    const byP = new Map();
    S.forEach((x) => { const k = sid(x.product_id); if (!byP.has(k)) byP.set(k, { count: 0, value: 0 }); const o = byP.get(k); o.count++; o.value += x.amount; });
    v.byProduct = Array.from(byP.entries()).map(([id, o]) => ({ id, name: store.name('products', id), count: o.count, value: o.value, share: v.revenue ? o.value / v.revenue : 0 }))
      .sort((a, b) => b.value - a.value || b.count - a.count);
    return out;
  }

  /**
   * Dashboard Agentes → Equipe (v1.8): os agentes lado a lado, com as MESMAS contas do dashboard de cada um
   * (uma chamada de computeAgentDashboard por agente).
   *  - linhas: agentes com lançamento no Diário ou venda (como vendedor) no período, fora os ocultos da Visão por Agente
   *    (Agentes e ordem); com filtro de produto, só os que têm registro naquele produto;
   *  - colunas: as etapas do funil lançadas por alguém (na ordem do funil), a conversão (a mesma de todos), constância
   *    (dias com lançamento ÷ dias desde o início do agente), vendas e meta individual;
   *  - total da equipe: soma das etapas e das vendas; conversão = Σ numeradores ÷ Σ denominadores dos agentes (o mesmo
   *    que contar os pares agente + dia + produto), só dos que lançaram as duas métricas; taxa de resposta e resposta da
   *    reativação (v1.9), idem; as mídias sociais ficam fora (como no dashboard de cada um);
   *  - tendência (`spark`): a métrica `opts.metric` (padrão: a primeira etapa) por grupo, alinhada nos mesmos grupos para todos;
   *  - constância por dia (`days`, períodos de até 62 dias): para cada agente, lançamentos por dia; antes do início dele = null.
   */
  function computeTeamDashboard(store, entries, sales, r, opts) {
    opts = opts || {};
    const today = opts.today || D.today();
    const base = computeAgentDashboard(store, entries, sales, r, Object.assign({}, opts, { agent: null, product: '' }));
    const out = { range: r, unit: base.unit, status: base.status, prev: base.prev, product: '', products: [], rows: [], hidden: [], stages: [], conv: null, metric: '', metrics: [], buckets: [], total: null };
    if (base.status === 'noagents' || base.status === 'future') return out;
    const hidden = new Set(store.settings.agent_views.hidden_agents);
    const act = base.agents.filter((a) => a.entries || a.sales);
    out.hidden = act.filter((a) => hidden.has(a.id)).map((a) => a.name);
    const one = (id, product) => computeAgentDashboard(store, entries, sales, r, Object.assign({}, opts, { agent: id, product }));
    let dash = act.filter((a) => !hidden.has(a.id)).map((a) => one(a.id, ''));
    // produtos: os de todos os agentes listados, na ordem do cadastro
    const pset = new Set();
    dash.forEach((v) => v.products.forEach((p) => pset.add(p.id)));
    const order = store.list('products', { all: true }).map((p) => sid(p.id));
    out.products = order.filter((id) => pset.has(id)).concat(Array.from(pset).filter((id) => order.indexOf(id) < 0))
      .map((id) => { const p = store.get('products', id); return { id, name: store.name('products', id), active: !p || p.active !== false }; });
    const product = opts.product && pset.has(sid(opts.product)) ? sid(opts.product) : '';
    out.product = product;
    if (product) dash = dash.filter((v) => v.products.some((p) => p.id === product)).map((v) => one(v.agent.id, product));
    // grupos comuns (sem futuro), para alinhar as tendências
    out.buckets = timeBuckets(r.from, r.to, base.unit, opts.weekStart, today).filter((b) => !b.future);
    const usedM = new Set();
    dash.forEach((v) => v.daily.buckets.forEach((b) => Object.keys(b.m).forEach((id) => usedM.add(id))));
    const stageSet = new Set();
    dash.forEach((v) => v.daily.stages.forEach((s) => stageSet.add(s.id)));
    out.stages = store.funnelMetrics().filter((m) => stageSet.has(sid(m.id))).map((m) => ({ id: sid(m.id), name: m.name }));
    out.metrics = store.list('metrics', { all: true }).filter((m) => usedM.has(sid(m.id))).map((m) => ({ id: sid(m.id), name: m.name, kind: m.kind }));
    out.metric = opts.metric && usedM.has(sid(opts.metric)) ? sid(opts.metric) : out.stages.length ? out.stages[0].id : out.metrics.length ? out.metrics[0].id : '';
    const end = r.to < today ? r.to : today;
    out.days = D.span(r.from, r.to) <= 62 && end >= r.from ? D.each(r.from, end) : null;
    out.rows = dash.map((v) => {
      const d = v.daily, x = v.sales, byTo = new Map(d.buckets.map((b) => [b.to, b]));
      const st = new Map(d.stages.map((s) => [s.id, s]));
      const perDay = new Map(d.calendar.map((c) => [c.date, c.n]));
      return {
        id: v.agent.id, name: v.agent.name, active: v.agent.active, status: d.status, start: d.start, noPrev: d.noPrev,
        days: d.days, periodDays: d.start ? d.periodDays : 0, constancy: d.start && d.periodDays ? d.days / d.periodDays : null, // quem nunca lançou no Diário: —
        stages: out.stages.map((s) => (st.has(s.id) ? { total: st.get(s.id).total, prev: st.get(s.id).prev } : null)),
        conv: d.conv, response: d.response, react: d.react, spark: out.buckets.map((b) => { const k = byTo.get(b.to); return k && k.m[out.metric] != null ? k.m[out.metric] : null; }),
        calendar: out.days && d.start ? out.days.map((dt) => (d.start && dt >= d.start ? perDay.get(dt) || 0 : null)) : null,
        sales: { revenue: x.revenue, count: x.count, prevRevenue: x.prevRevenue, goal: x.goal, pct: x.pct, status: x.status, noPrev: x.noPrev },
      };
    });
    const withConv = out.rows.filter((w) => w.conv && !w.conv.missing.length && w.conv.den);
    const withResp = out.rows.filter((w) => w.response && !w.response.missing.length && w.response.den);
    const withReact = out.rows.filter((w) => w.react && w.react.den);
    const x0 = dash.find((v) => v.daily.react);
    out.react = x0 ? { fromId: x0.daily.react.fromId, toId: x0.daily.react.toId, from: x0.daily.react.from, to: x0.daily.react.to, custom: x0.daily.react.custom } : null;
    const r0 = dash.find((v) => v.daily.response);
    out.response = r0 ? { fromId: r0.daily.response.fromId, toId: r0.daily.response.toId, from: r0.daily.response.from, to: r0.daily.response.to, custom: r0.daily.response.custom } : null;
    const c0 = dash.find((v) => v.daily.conv);
    // conversão automática (última etapa ÷ primeira de cada um) pode ter pares diferentes: aí não há total da equipe
    const pairs = new Set(out.rows.filter((w) => w.conv).map((w) => w.conv.from + '÷' + w.conv.to));
    out.conv = c0 ? { from: c0.daily.conv.from, to: c0.daily.conv.to, custom: c0.daily.conv.custom, mixed: pairs.size > 1 } : null;
    out.total = {
      stages: out.stages.map((s, i) => sum(out.rows, (w) => (w.stages[i] ? w.stages[i].total : 0))),
      conv: withConv.length && pairs.size === 1 ? sum(withConv, (w) => w.conv.num) / sum(withConv, (w) => w.conv.den) : null,
      response: withResp.length ? sum(withResp, (w) => w.response.num) / sum(withResp, (w) => w.response.den) : null,
      react: withReact.length ? sum(withReact, (w) => w.react.num) / sum(withReact, (w) => w.react.den) : null,
      reactTotal: sum(out.rows, (w) => (w.react ? w.react.total : 0)),
      revenue: sum(out.rows, (w) => w.sales.revenue), count: sum(out.rows, (w) => w.sales.count),
    };
    return out;
  }

  // ---------------- Renda dos Leads (aba Diário, v1.4) ----------------
  // Cores padrão: faixas "Sem ..." em cinza; as demais num só tom (azul), do claro ao escuro conforme a renda sobe.
  // Os tons ficam nas variáveis CSS --inc-r0..--inc-r8 e --inc-none (uma versão para o tema claro e outra para o escuro).
  const INCOME_STEPS = 9;
  const isNoIncome = (name) => /^sem\b/.test(norm(name));
  /** Cor padrão (variável CSS) de cada faixa, na ordem das faixas. */
  function incomeDefaults(names) {
    const colored = names.filter((n) => !isNoIncome(n)).length;
    let k = 0;
    return names.map((n) => {
      if (isNoIncome(n)) return 'var(--inc-none)';
      const step = colored === 1 ? 4 : Math.round(k * (INCOME_STEPS - 1) / (colored - 1));
      k++;
      return 'var(--inc-r' + Math.min(step, INCOME_STEPS - 1) + ')';
    });
  }
  /** Posição de uma faixa reconhecida pelo nome (automático): Sem < Muito baixa < Baixa < Média < Alta < Muito alta. */
  function incomeRank(name) {
    const n = norm(name);
    if (/^sem\b/.test(n)) return 0;
    const muito = /\bmuito\b/.test(n);
    if (/\bbaixa\b/.test(n)) return muito ? 1 : 2;
    if (/\bmedia\b/.test(n)) return 3;
    if (/\balta\b/.test(n)) return muito ? 5 : 4;
    return 6;
  }

  /**
   * Configuração em uso na Renda dos Leads.
   *  - settings.lead_income gravado: as faixas e a métrica "Sem qualificação" escolhidas (métricas excluídas ou em R$ são ignoradas);
   *  - automático (nada gravado): faixas = métricas de quantidade com "renda" no nome, ordenadas por Sem/Baixa/Média/Alta;
   *    "Sem qualificação" = métrica com "sem qualifica", "não qualifica" ou "desqualifica" no nome.
   * Retorna { auto, bands: [{ id, name, active, color (personalizada ou null), def (cor padrão, variável CSS) }], unqualified: { id, name, active } | null }.
   */
  function leadIncomeConfig(store) {
    const v = store.settings.lead_income;
    const okm = (m) => m && m.kind === 'count';
    let bands, unq;
    if (v) {
      bands = v.bands.map((b) => ({ m: store.get('metrics', b.metric_id), color: b.color })).filter((x) => okm(x.m));
      unq = v.unqualified ? store.get('metrics', v.unqualified) : null;
      if (!okm(unq)) unq = null;
    } else {
      const all = store.list('metrics', { all: true }).filter(okm);
      bands = all.filter((m) => /\brenda\b/.test(norm(m.name))).map((m, i) => ({ m, i, color: null }))
        .sort((a, b) => incomeRank(a.m.name) - incomeRank(b.m.name) || a.i - b.i);
      unq = all.find((m) => /(sem|nao) qualifica|desqualifica/.test(norm(m.name)) && !/\brenda\b/.test(norm(m.name))) || null;
    }
    const defs = incomeDefaults(bands.map((x) => x.m.name));
    return {
      auto: !v,
      bands: bands.map((x, i) => ({ id: sid(x.m.id), name: x.m.name, active: x.m.active !== false, color: x.color || null, def: defs[i] })),
      unqualified: unq ? { id: sid(unq.id), name: unq.name, active: unq.active !== false } : null,
    };
  }

  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  /**
   * Renda dos Leads: distribuição das leads pelas faixas de renda lançadas no Diário.
   *  entries: lançamentos do Diário — de preferência TODO o histórico das métricas de renda (o "início do
   *           acompanhamento" de cada produto é o primeiro dia com alguma faixa ou "Sem qualificação" lançada);
   *  r: { from, to }; opts: { product: id ('' = todos), weekStart, today, cfg }.
   * Regras:
   *  - % de cada faixa = quantidade da faixa ÷ soma das faixas (as qualificadas). "Sem qualificação" fica fora do %;
   *  - nada é projetado: dias sem lançamento não entram na conta (dia lançado com 0 conta como acompanhado);
   *  - produtos que nunca tiveram essas métricas não aparecem.
   * status: 'nocfg' (nenhuma faixa configurada) | 'notracked' (nenhum lançamento das faixas) | 'future' (período no futuro) |
   *         'before' (período todo antes do início do acompanhamento) | 'empty' (sem lançamento no período) | 'ok'.
   */
  function computeLeadIncome(store, entries, r, opts) {
    opts = opts || {};
    const cfg = opts.cfg || leadIncomeConfig(store);
    const today = opts.today || D.today();
    const bandIdx = new Map(cfg.bands.map((b, i) => [b.id, i]));
    const unqId = cfg.unqualified ? cfg.unqualified.id : null;
    const nb = cfg.bands.length;
    const out = {
      range: r, cfg, product: '', tracked: [], start: null, status: 'ok', bands: [], qualified: 0, unqualified: cfg.unqualified ? 0 : null,
      registered: 0, periodDays: 0, covered: 0, lateStarts: [], products: [], silent: [], buckets: { unit: 'week', items: [] },
    };
    if (!nb) { out.status = 'nocfg'; return out; }
    const E = entries.filter((x) => bandIdx.has(sid(x.metric_id)) || (unqId && sid(x.metric_id) === unqId));
    // produtos acompanhados (histórico todo): primeiro e último dia com lançamento
    const span = new Map();
    E.forEach((x) => {
      const pid = sid(x.product_id), s = span.get(pid);
      if (!s) span.set(pid, { start: x.date, last: x.date });
      else { if (x.date < s.start) s.start = x.date; if (x.date > s.last) s.last = x.date; }
    });
    const order = store.list('products', { all: true }).map((p) => sid(p.id));
    const pids = order.filter((id) => span.has(id)).concat(Array.from(span.keys()).filter((id) => order.indexOf(id) < 0));
    out.tracked = pids.map((id) => { const p = store.get('products', id); return { id, name: store.name('products', id), active: !p || p.active !== false, start: span.get(id).start, last: span.get(id).last }; });
    if (!pids.length) { out.status = 'notracked'; return out; }
    const sel = opts.product && span.has(sid(opts.product)) ? [sid(opts.product)] : pids;
    out.product = sel.length === 1 && opts.product ? sel[0] : '';
    out.start = sel.map((id) => span.get(id).start).sort()[0];
    const selSet = new Set(sel);
    const end = r.to < today ? r.to : today; // dias que já aconteceram
    out.periodDays = end >= r.from ? D.span(r.from, end) : 0;
    if (r.from > today) { out.status = 'future'; return out; }
    if (r.to < out.start) { out.status = 'before'; return out; }
    out.lateStarts = out.tracked.filter((p) => selSet.has(p.id) && p.start > r.from).map((p) => ({ id: p.id, name: p.name, start: p.start }));

    const ER = E.filter((x) => x.date >= r.from && x.date <= r.to && selSet.has(sid(x.product_id)));
    if (!ER.length) { out.status = 'empty'; return out; }
    // acumulador: quantidades por faixa + sem qualificação + dias com registro
    const acc = () => ({ values: new Array(nb).fill(0), unq: 0, days: new Set() });
    const add = (a, x) => {
      const i = bandIdx.get(sid(x.metric_id)), q = Number(x.quantity) || 0;
      if (i != null) a.values[i] += q; else a.unq += q;
      a.days.add(x.date);
    };
    const tot = acc(), byProd = new Map();
    ER.forEach((x) => {
      add(tot, x);
      const pid = sid(x.product_id);
      if (!byProd.has(pid)) byProd.set(pid, acc());
      add(byProd.get(pid), x);
    });
    const qOf = (a) => a.values.reduce((s, v) => s + v, 0);
    out.qualified = qOf(tot);
    if (unqId) out.unqualified = tot.unq;
    out.registered = out.qualified + (unqId ? tot.unq : 0);
    out.covered = Array.from(tot.days).filter((d) => d <= end).length;
    out.bands = cfg.bands.map((b, i) => ({ id: b.id, name: b.name, color: b.color, def: b.def, qty: tot.values[i], share: out.qualified ? tot.values[i] / out.qualified : null }));
    const row = (a) => ({ values: a.values, qualified: qOf(a), unqualified: unqId ? a.unq : null, covered: a.days.size });
    out.products = pids.filter((id) => byProd.has(id)).map((id) => Object.assign({ id, name: store.name('products', id), start: span.get(id).start }, row(byProd.get(id))));
    out.silent = out.tracked.filter((p) => selSet.has(p.id) && !byProd.has(p.id) && p.start <= r.to).map((p) => p.name);

    // evolução: semanas (ou meses, em períodos longos), cortadas nos limites do período e no início do acompanhamento
    const monthly = D.span(r.from, r.to) > 26 * 7;
    out.buckets.unit = monthly ? 'month' : 'week';
    for (let a = monthly ? D.monthStart(r.from) : D.weekStart(r.from, opts.weekStart); a <= r.to; a = monthly ? D.add(D.monthEnd(a), 1) : D.add(a, 7)) {
      const z0 = monthly ? D.monthEnd(a) : D.add(a, 6);
      const from = a < r.from ? r.from : a, to = z0 > r.to ? r.to : z0;
      const b = acc();
      ER.forEach((x) => { if (x.date >= from && x.date <= to) add(b, x); });
      out.buckets.items.push(Object.assign({
        from, to, future: from > today,
        label: monthly ? MONTHS[Number(from.slice(5, 7)) - 1] + '/' + from.slice(2, 4) : D.fmtShort(from),
        head: monthly ? 'Mês de ' + MONTHS[Number(from.slice(5, 7)) - 1] + '/' + from.slice(0, 4) : 'Semana de ' + D.fmt(from) + (from !== to ? ' a ' + D.fmt(to) : ''),
      }, row(b)));
    }
    // sem colunas antes do início do acompanhamento nem no futuro (os buracos no meio continuam, como "sem registro")
    const it = out.buckets.items;
    while (it.length && it[0].to < out.start) it.shift();
    while (it.length && it[it.length - 1].future) it.pop();
    return out;
  }

  // ---------------- Tendências (aba nova, v1.5) ----------------
  /** Agrupamento: o pedido ('day' | 'week' | 'month') ou, sem pedido, pelo tamanho do período (até 14 dias: dia; até 92: semana; acima: mês). */
  function trendUnit(r, unit) {
    if (unit === 'day' || unit === 'week' || unit === 'month') return unit;
    const n = D.span(r.from, r.to);
    return n <= 14 ? 'day' : n <= 92 ? 'week' : 'month';
  }
  /**
   * Tendências: o mesmo dinheiro do Painel, agrupado no tempo.
   *  sales: vendas de r.prevFrom a r.to (o período anterior é usado na comparação);
   *  opts: { unit: 'day' | 'week' | 'month' | null (automático), weekStart, today }.
   * Regras (as mesmas do Painel):
   *  - meta do grupo = soma das metas dos produtos exibidos nas metas (show_in_goals), proporcional aos dias do grupo;
   *  - "faturado com meta" = vendas atribuídas (funil de origem; fora de funil → produto vendido) aos produtos que têm
   *    meta naquele grupo, só nos dias em que a meta valia (v1.6); grupo em andamento compara com a meta até hoje;
   *  - meta geral (v1.6): nos dias sem meta de nenhum produto exibido, soma a meta geral e todas as vendas
   *    daqueles dias (b.general = { goal, days, revenue }); o "Por produto" não usa a meta geral;
   *  - grupos nas pontas são cortados nos limites do período (a meta acompanha o corte);
   *  - comparação: faturamento acumulado dia a dia × o período anterior de mesmo tamanho (mês × mês anterior);
   *  - os registros começam na PRIMEIRA VENDA da base (opts.firstSale): grupos inteiros antes dela não aparecem
   *    (o painel ainda não era usado — não é "0% da meta") e o período anterior só conta a partir dela.
   * opts.firstSale: 'AAAA-MM-DD' da primeira venda registrada (null = nenhuma venda; undefined = não cortar).
   * opts.daily: lançamentos do Diário do período (opcional): um produto ARQUIVADO com lançamento entra na lista, como no Painel.
   * status: 'nosales' (nenhuma venda na base) | 'before' (período todo antes da primeira venda) | 'ok'.
   * Retorna { range, unit, status, firstSale, trimmed, buckets, products, hiddenProducts, compare, hasGoals }.
   */
  function computeTrends(store, sales, r, opts) {
    opts = opts || {};
    const s = store.settings, today = opts.today || D.today();
    const unit = trendUnit(r, opts.unit);
    const opOf = (x) => store.originProductId(x.origin_id);
    const gpOf = (x) => opOf(x) || sid(x.product_id);
    const S = sales.filter((x) => x.date >= r.from && x.date <= r.to);
    const first = opts.firstSale === undefined ? null : opts.firstSale;
    const empty = (status) => ({ range: r, unit, status, firstSale: first, trimmed: 0, buckets: [], products: [], hiddenProducts: [], compare: null, hasGoals: false, hasGeneral: false });
    if (opts.firstSale === null) return empty('nosales');
    if (first && r.to < first) return empty('before');
    // grupos (dia / semana / mês), cortados nos limites do período
    let buckets = [];
    const dayIdx = new Map();
    let a = unit === 'day' ? r.from : unit === 'week' ? D.weekStart(r.from, opts.weekStart) : D.monthStart(r.from);
    while (a <= r.to) {
      const z0 = unit === 'day' ? a : unit === 'week' ? D.add(a, 6) : D.monthEnd(a);
      const from = a < r.from ? r.from : a, to = z0 > r.to ? r.to : z0;
      const mes = MONTHS[Number(from.slice(5, 7)) - 1];
      const cut = unit === 'month' && (from !== D.monthStart(from) || to !== D.monthEnd(from));
      buckets.push({
        from, to, future: from > today, partial: from <= today && to > today,
        label: unit === 'month' ? mes + '/' + from.slice(2, 4) : D.fmtShort(from),
        head: unit === 'day' ? D.dowLong(from) + ', ' + D.fmt(from)
          : unit === 'week' ? 'Semana de ' + D.fmt(from) + (from !== to ? ' a ' + D.fmt(to) : '')
            : mes + '/' + from.slice(0, 4) + (cut ? ' (' + D.fmtShort(from) + ' a ' + D.fmtShort(to) + ')' : ''),
      });
      a = D.add(z0, 1);
    }
    const nAll = buckets.length;
    if (first) buckets = buckets.filter((b) => b.to >= first); // antes da primeira venda: o painel ainda não era usado
    const trimmed = nAll - buckets.length;
    // o grupo em que está a primeira venda começa nela (a meta acompanha: só os dias desde então)
    if (first && buckets.length && buckets[0].from < first) {
      const b = buckets[0];
      b.from = first;
      if (unit === 'week') b.head = 'Semana de ' + D.fmt(first) + (first !== b.to ? ' a ' + D.fmt(b.to) : '') + ' (desde a primeira venda)';
      else if (unit === 'month') b.head = MONTHS[Number(first.slice(5, 7)) - 1] + '/' + first.slice(0, 4) + ' (' + D.fmtShort(first) + ' a ' + D.fmtShort(b.to) + ', desde a primeira venda)';
      if (unit !== 'month') b.label = D.fmtShort(first);
      b.partial = b.from <= today && b.to > today;
    }
    buckets.forEach((b, i) => D.each(b.from, b.to).forEach((d) => dayIdx.set(d, i)));
    const nb = buckets.length;
    // produtos: os mesmos de "Metas por produto" (exibidos nas metas; ativos ou com atividade no período: venda atribuída,
    // venda do próprio produto ou lançamento no Diário — opts.daily, igual ao Painel)
    const withSales = new Set(S.map(gpOf));
    const activity = new Set(withSales);
    S.forEach((x) => activity.add(sid(x.product_id)));
    (opts.daily || []).forEach((x) => { if (x.date >= r.from && x.date <= r.to) activity.add(sid(x.product_id)); });
    const all = store.list('products', { all: true }).filter((p) => p.active !== false || activity.has(sid(p.id)));
    const products = all.filter((p) => p.show_in_goals !== false).map((p) => {
      const pid = sid(p.id);
      const values = new Array(nb).fill(0), counts = new Array(nb).fill(0), goalValues = new Array(nb).fill(0);
      S.forEach((x) => {
        if (gpOf(x) !== pid || !dayIdx.has(x.date)) return;
        const i = dayIdx.get(x.date);
        values[i] += x.amount; counts[i]++;
        if (store.goalAt('product', pid, x.date)) goalValues[i] += x.amount; // só os dias em que a meta do produto valia
      });
      const goals = buckets.map((b) => store.goalForRange('product', pid, b.from, b.to, true));
      const goalsToDate = buckets.map((b, i) => (b.partial && goals[i] != null ? store.goalForRange('product', pid, b.from, today, true) || 0 : goals[i]));
      const total = values.reduce((x, y) => x + y, 0), goalTotal = goals.some((g) => g != null) ? goals.reduce((x, g) => x + (g || 0), 0) : null;
      // % da meta até hoje (grupos futuros fora; o em andamento conta só os dias que já passaram)
      const goalSoFar = goalTotal == null ? null : buckets.reduce((x, b, i) => x + (b.future ? 0 : goalsToDate[i] || 0), 0);
      const totalGoalDays = goalValues.reduce((x, y) => x + y, 0);
      return { id: pid, name: p.name, active: p.active !== false, values, goalValues, counts, goals, goalsToDate, total, goalTotal, hasGoal: goalTotal != null, goalSoFar, pct: goalSoFar ? totalGoalDays / goalSoFar : null };
    }).filter((p) => p.total || p.hasGoal);
    const hiddenProducts = all.filter((p) => p.show_in_goals === false && withSales.has(sid(p.id))).map((p) => p.name);
    // meta geral (v1.6): dias sem meta própria de nenhum produto exibido
    const gDays = nb ? store.generalGoalDays(buckets[0].from, buckets[nb - 1].to) : new Map();
    // totais por grupo
    buckets.forEach((b, i) => {
      const arr = S.filter((x) => dayIdx.get(x.date) === i);
      b.revenue = sum(arr, (x) => x.amount);
      b.count = arr.length;
      b.avg = b.count ? b.revenue / b.count : null;
      let gg = 0, ggToDate = 0, gn = 0;
      D.each(b.from, b.to).forEach((d) => { if (gDays.has(d)) { gn++; gg += gDays.get(d); if (d <= today) ggToDate += gDays.get(d); } });
      b.general = gn ? { goal: gg, days: gn, revenue: sum(arr.filter((x) => gDays.has(x.date)), (x) => x.amount) } : null;
      const g = products.filter((p) => p.goals[i] != null);
      b.goal = g.length || gn ? sum(g, (p) => p.goals[i]) + gg : null;
      b.goalToDate = g.length || gn ? sum(g, (p) => p.goalsToDate[i]) + (b.partial ? ggToDate : gg) : null;
      b.goalRevenue = sum(g, (p) => p.goalValues[i]) + (b.general ? b.general.revenue : 0);
      if (b.general) b.general.only = !g.length; // grupo todo na meta geral (nenhum produto com meta própria)
      b.pct = b.future || !b.goal ? null : b.partial ? (b.goalToDate ? b.goalRevenue / b.goalToDate : null) : b.goalRevenue / b.goal;
      b.status = statusOf(b.pct, s);
    });
    // este período × anterior: acumulado dia a dia (dia 1 com dia 1)
    const n = D.span(r.from, r.to), pn = D.span(r.prevFrom, r.prevTo);
    const byDay = new Map();
    sales.forEach((x) => byDay.set(x.date, (byDay.get(x.date) || 0) + x.amount));
    const cur = [], prev = [], dates = [], prevDates = [];
    let c = 0, p0 = 0, last = -1;
    for (let i = 0; i < n; i++) {
      const d = D.add(r.from, i);
      dates.push(d);
      c += byDay.get(d) || 0;
      if (d > today) cur.push(null);
      else { cur.push(first && d < first ? null : c); last = i; } // antes da primeira venda: sem linha
      if (i < pn) {
        const pd = D.add(r.prevFrom, i);
        p0 += byDay.get(pd) || 0;
        prevDates.push(pd);
        prev.push(p0);
      } else { prevDates.push(null); prev.push(null); }
    }
    const prevTotal = sum(sales.filter((x) => x.date >= r.prevFrom && x.date <= r.prevTo), (x) => x.amount);
    const at = last < 0 ? -1 : Math.min(last, pn - 1);
    const compare = {
      dates, prevDates, cur, prev, last, prevTotal,
      // período anterior que começa antes da primeira venda não é comparável (só teria parte dos dias)
      noPrev: !!first && r.prevFrom < first,
      now: last < 0 || cur[last] == null ? null : cur[last], nowDate: last < 0 ? null : dates[last],
      prevSame: at < 0 || prev[at] == null ? null : prev[at], prevSameDate: at < 0 ? null : prevDates[at],
    };
    compare.delta = compare.now != null && compare.prevSame ? compare.now / compare.prevSame - 1 : null;
    return { range: r, unit, status: 'ok', firstSale: first, trimmed, buckets, products, hiddenProducts, compare, hasGoals: buckets.some((b) => b.goal != null), hasGeneral: buckets.some((b) => b.general) };
  }

  // ==========================================================================
  // 4. ESTILO (vive só dentro do Shadow DOM) E ÍCONES
  // ==========================================================================
  const DARK_TOKENS = `
    --page:#0d0d0d;--surface:#1a1a19;--surface-2:#232321;--raised:#222221;--input:#141413;
    --ink:#ffffff;--ink-2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--axis:#383835;
    --border:rgba(255,255,255,.10);--border-2:rgba(255,255,255,.18);--hover:rgba(255,255,255,.05);
    --accent:#3987e5;--accent-hover:#5598e7;--accent-ink:#ffffff;--accent-wash:rgba(57,135,229,.16);--focus:rgba(57,135,229,.55);
    --s1:#3987e5;--s1-wash:rgba(57,135,229,.12);--track:#1c2f47;--ref:#898781;
    --up:#0ca30c;--down:#e66767;--danger:#e66767;--danger-wash:rgba(230,103,103,.12);
    --warn-wash:rgba(250,178,25,.12);--good-wash:rgba(12,163,12,.14);--crit-wash:rgba(208,59,59,.16);
    --inc-none:#898781;--inc-r0:#184f95;--inc-r1:#1c5cab;--inc-r2:#256abf;--inc-r3:#2a78d6;--inc-r4:#3987e5;--inc-r5:#5598e7;--inc-r6:#6da7ec;--inc-r7:#86b6ef;--inc-r8:#9ec5f4;
    --shadow:0 16px 40px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.4);color-scheme:dark;`;

  const CSS = `
  :host{all:initial;display:block}
  :host([hidden]){display:none}
  *,*::before,*::after{box-sizing:border-box}
  [hidden]{display:none!important}
  .amr{
    --page:#f6f6f3;--surface:#fcfcfb;--surface-2:#f1f0ec;--raised:#ffffff;--input:#ffffff;
    --ink:#0b0b0b;--ink-2:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;
    --border:rgba(11,11,11,.10);--border-2:rgba(11,11,11,.20);--hover:rgba(11,11,11,.045);
    --accent:#2a78d6;--accent-hover:#256abf;--accent-ink:#ffffff;--accent-wash:rgba(42,120,214,.10);--focus:rgba(42,120,214,.45);
    --s1:#2a78d6;--s1-wash:rgba(42,120,214,.10);--track:#e2ecf9;--ref:#898781;
    --good:#0ca30c;--warning:#fab219;--critical:#d03b3b;
    --up:#006300;--down:#b42a2a;--danger:#c03333;--danger-wash:rgba(208,59,59,.08);
    --warn-wash:rgba(250,178,25,.16);--good-wash:rgba(12,163,12,.10);--crit-wash:rgba(208,59,59,.10);
    /* Renda dos Leads: cinza para "Sem renda" + um tom do claro ao escuro (validado para daltonismo; no escuro, a ordem se inverte) */
    --inc-none:#8f8d86;--inc-r0:#86b6ef;--inc-r1:#6da7ec;--inc-r2:#5598e7;--inc-r3:#3987e5;--inc-r4:#2a78d6;--inc-r5:#256abf;--inc-r6:#1c5cab;--inc-r7:#184f95;--inc-r8:#104281;
    --shadow:0 16px 40px rgba(0,0,0,.14),0 2px 8px rgba(0,0,0,.06);--radius:10px;color-scheme:light;
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
    font-size:14px;line-height:1.45;font-weight:400;font-style:normal;letter-spacing:normal;word-spacing:normal;
    text-align:left;text-transform:none;text-indent:0;text-shadow:none;white-space:normal;direction:ltr;
    color:var(--ink);background:var(--page);border-radius:var(--radius);padding:16px 20px 28px;
    -webkit-font-smoothing:antialiased;position:relative;min-width:0;
  }
  /* tema (v1.10): data-theme no .amr = a escolha da pessoa, o atributo theme da plataforma ou o escuro (padrão) — veja _applyTheme */
  .amr[data-theme="dark"]{${DARK_TOKENS}}
  @media (prefers-color-scheme:dark){.amr[data-theme="auto"]{${DARK_TOKENS}}}
  @media (max-width:640px){.amr{padding:12px 16px 24px}}

  h1,h2,h3,h4,p{margin:0}
  h2{font-size:17px;font-weight:650}
  h3{font-size:15px;font-weight:650}
  button,input,select,textarea{font:inherit;color:inherit;margin:0;letter-spacing:inherit}
  a{color:var(--accent)}
  .muted{color:var(--muted)}
  .ink2{color:var(--ink-2)}
  .num{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
  .nowrap{white-space:nowrap}
  .spacer{flex:1 1 auto}
  .small{font-size:12.5px}
  .strong{font-weight:650}

  /* ---------- topo e abas ---------- */
  .top{display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin-bottom:16px;border-bottom:1px solid var(--grid)}
  .brand{display:flex;align-items:center;gap:10px;padding-bottom:10px;min-width:0}
  .brand-mark{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:var(--accent);color:var(--accent-ink);flex:none}
  .brand-title{font-size:17px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tabs{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;margin-bottom:-1px;max-width:100%}
  .tabs::-webkit-scrollbar{display:none}
  .tab{appearance:none;background:none;border:0;border-bottom:2px solid transparent;padding:8px 12px 12px;cursor:pointer;color:var(--ink-2);font-weight:550;white-space:nowrap}
  .tab:hover{color:var(--ink)}
  .tab.on{color:var(--ink);border-bottom-color:var(--accent)}
  .top-actions{display:flex;align-items:center;gap:6px;margin-left:auto;padding-bottom:8px}
  .subnav{display:inline-flex;gap:2px;padding:3px;border-radius:9px;background:var(--surface-2);margin-bottom:14px;flex-wrap:wrap;max-width:100%}
  .subnav button{appearance:none;border:0;background:none;padding:6px 12px;border-radius:7px;cursor:pointer;color:var(--ink-2);font-weight:550;white-space:nowrap}
  .subnav button:hover{color:var(--ink)}
  .subnav button.on{background:var(--raised);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.08),0 0 0 1px var(--border)}

  /* ---------- botões e campos ---------- */
  .btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 13px;border-radius:8px;border:1px solid var(--border-2);background:var(--raised);color:var(--ink);cursor:pointer;font-weight:550;white-space:nowrap;text-decoration:none;line-height:1}
  .btn:hover{background:var(--surface-2)}
  .btn:disabled{opacity:.5;cursor:default}
  .btn-primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
  .btn-primary:hover{background:var(--accent-hover)}
  .btn-danger{background:var(--danger);border-color:var(--danger);color:#fff}
  .btn-danger:hover{filter:brightness(.95);background:var(--danger)}
  .btn-ghost{background:transparent;border-color:transparent;color:var(--ink-2)}
  .vis-toggle.off{color:var(--muted)}
  .has-tip{cursor:help;text-decoration:underline dotted var(--axis);text-underline-offset:3px}
  .ag-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,420px),1fr));grid-auto-flow:row dense;gap:16px;align-items:start}
  .ag-grid>.card,.ag-grid>.card+.card{margin:0}
  .ag-grid>.card.span{grid-column:1/-1}
  .ol{border:1px solid var(--border);border-radius:8px;overflow:hidden}
  .ol-row{display:flex;align-items:center;gap:10px;padding:6px 10px;border-bottom:1px solid var(--grid);min-height:44px}
  .ol-row:last-child{border-bottom:0}
  .ol-row.off .ol-label{color:var(--muted)}
  .ol-arrows{display:inline-flex;flex:none}
  .ol-name{flex:1;min-width:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .ol-row .ol-sel{width:auto;min-width:170px;flex:none}
  @media (max-width:560px){.ol-row{flex-wrap:wrap}.ol-row .ol-sel{width:100%}}
  .link{appearance:none;background:none;border:0;padding:0;font:inherit;color:var(--accent);cursor:pointer;text-decoration:underline;text-underline-offset:2px}
  .btn-ghost:hover{background:var(--hover);color:var(--ink)}
  .btn-sm{height:28px;padding:0 9px;font-size:13px;border-radius:7px}
  .icon-btn{appearance:none;display:inline-grid;place-items:center;width:28px;height:28px;border-radius:7px;border:0;background:transparent;color:var(--muted);cursor:pointer;flex:none}
  .icon-btn:hover{background:var(--hover);color:var(--ink)}
  .icon-btn.danger:hover{color:var(--danger);background:var(--danger-wash)}
  .icon-btn:disabled{opacity:.35;cursor:default;background:transparent}
  :is(.btn,.icon-btn,.tab,.subnav button,.chip):focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .inp{height:34px;padding:0 10px;border-radius:8px;border:1px solid var(--border-2);background:var(--input);color:var(--ink);min-width:0;width:100%;outline:none}
  textarea.inp{height:auto;padding:8px 10px;resize:vertical;min-height:90px;font-family:ui-monospace,Consolas,monospace;font-size:12.5px}
  select.inp{padding-right:28px;appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--muted) 50%),linear-gradient(135deg,var(--muted) 50%,transparent 50%);background-position:calc(100% - 15px) 50%,calc(100% - 10px) 50%;background-size:5px 5px;background-repeat:no-repeat;cursor:pointer;text-overflow:ellipsis}
  .inp:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--focus)}
  .inp.err{border-color:var(--critical);box-shadow:0 0 0 2px var(--crit-wash)}
  .inp.sm{height:30px;font-size:13px}
  .inp-money{text-align:right;font-variant-numeric:tabular-nums}
  .field{display:flex;flex-direction:column;gap:5px;min-width:0}
  .field>span{font-size:12.5px;color:var(--ink-2);font-weight:550}
  .field .hint{font-size:12px;color:var(--muted)}
  .check{display:inline-flex;align-items:center;gap:8px;cursor:pointer;user-select:none}
  .check input{width:16px;height:16px;accent-color:var(--accent);margin:0}
  .form{display:grid;gap:14px}
  .form-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}

  /* ---------- layout ---------- */
  .toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px;min-width:0}
  .chip{max-width:100%}.chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .range-note{color:var(--ink-2);font-size:13px}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;min-width:0}
  .card+.card,.grid-2+.card,.card+.grid-2,.grid-2+.grid-2,.kpis+.card,.kpis+.grid-2{margin-top:16px}
  .card-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:12px}
  .card-head .sub{color:var(--ink-2);font-size:13px;margin-top:2px}
  .grid-2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr));gap:16px}
  .grid-2>.card{margin:0}
  .empty{padding:28px 12px;text-align:center;color:var(--ink-2)}
  .empty strong{display:block;color:var(--ink);margin-bottom:4px}
  .note{display:flex;gap:8px;align-items:flex-start;padding:10px 12px;border-radius:8px;background:var(--surface-2);color:var(--ink-2);font-size:13px}
  .note svg{flex:none;margin-top:2px}
  .general-goal{display:flex;gap:10px 16px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:10px 12px;margin-bottom:12px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2)}
  .general-goal>div{min-width:0;flex:1 1 260px}
  .note.warn{background:var(--warn-wash);color:var(--ink)}
  .loading-bar{height:2px;background:linear-gradient(90deg,transparent,var(--accent),transparent);background-size:200% 100%;animation:rc-load 1s linear infinite;border-radius:2px;margin:-2px 0 0}
  @keyframes rc-load{from{background-position:100% 0}to{background-position:-100% 0}}
  .view{transition:opacity .15s}
  /* Exportar PDF (v1.10): a tela é refeita fora da vista, na largura da folha */
  .view.pdf-capture{position:absolute;left:-100000px;top:0}
  .pdf-wait{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:var(--page);color:var(--ink-2);font-size:14px}
  .pdf-wait>div{min-width:220px;text-align:center}
  .view.busy{opacity:.55;pointer-events:none}

  /* ---------- KPIs ---------- */
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(158px,1fr));gap:12px}
  /* Painel (v1.11): duas linhas de até 4 cartões (faturamento e metas), cada uma ocupando a largura toda */
  @media (min-width:641px){.kpis-row{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}.kpis-row .kpi-hero{grid-column:auto}}
  .kpis+.kpis{margin-top:12px}
  @media (max-width:640px){.kpis+.kpis{margin-top:8px}.kpis-row .kpi-hero~.kpi:last-child:nth-child(even),.kpis-goals .kpi:last-child:nth-child(odd){grid-column:1/-1}}
  .kpi{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;min-width:0;display:flex;flex-direction:column;gap:6px}
  .kpi-label{font-size:13px;color:var(--ink-2);font-weight:550;display:flex;align-items:flex-start;gap:4px}
  .kpi-label>span{min-width:0}
  /* v1.11: ⓘ com a definição do indicador (tooltip ao passar o mouse; tocar/Enter também mostra) */
  .kpi-info{all:unset;box-sizing:border-box;flex:none;display:inline-grid;place-items:center;width:18px;height:18px;margin:-1px 0 -1px auto;border-radius:50%;color:var(--muted);cursor:help}
  .kpi-info svg{width:14px;height:14px}
  .kpi-info:hover,.kpi-info[aria-expanded="true"]{color:var(--ink)}
  .kpi-info:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
  .kpi-unit{font-size:.5em;font-weight:550;color:var(--ink-2);letter-spacing:0}
  .kpi-value{font-size:22px;font-weight:650;line-height:1.15;letter-spacing:-.01em;white-space:nowrap;min-width:0}
  .kpi-value.wrap{white-space:normal;overflow-wrap:anywhere}
  .kpi-hero{grid-column:span 2}
  .kpi-hero .kpi-value{font-size:40px;letter-spacing:-.02em}
  @media (max-width:640px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.kpi{padding:12px}.kpi-hero{grid-column:1/-1}.kpi-hero .kpi-value{font-size:32px}.kpi-value{font-size:18px}.kpi-label{font-size:12px}}
  .kpi-foot{font-size:12.5px;color:var(--ink-2);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .delta{display:inline-flex;align-items:center;gap:3px;font-weight:650;font-variant-numeric:tabular-nums}
  .delta.up{color:var(--up)}
  .delta.down{color:var(--down)}
  .delta.flat{color:var(--ink-2)}

  /* ---------- status / medidores ---------- */
  .badge{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:var(--ink);white-space:nowrap}
  .badge .dot{display:inline-grid;place-items:center;width:15px;height:15px;border-radius:50%;color:#fff;flex:none}
  .badge .dot svg{width:10px;height:10px;stroke-width:3.2}
  .st-good .dot{background:var(--good)}
  .st-warning .dot{background:var(--warning);color:#3d2a00}
  .st-critical .dot{background:var(--critical)}
  .st-none{color:var(--muted);font-weight:500}
  .pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:11.5px;font-weight:600;background:var(--surface-2);color:var(--ink-2);white-space:nowrap}
  .pill.ok{background:var(--good-wash);color:var(--up)}
  .pill.bad{background:var(--crit-wash);color:var(--down)}
  .pill.warn{background:var(--warn-wash);color:var(--ink)}
  .pill.info{background:var(--accent-wash);color:var(--accent)}
  .meter{position:relative;height:8px;border-radius:4px;background:var(--track);overflow:hidden;min-width:60px}
  .meter-fill{position:absolute;inset:0 auto 0 0;border-radius:4px;background:var(--s1)}
  .meter-fill.good{background:var(--good)}
  .meter-fill.warning{background:var(--warning)}
  .meter-fill.critical{background:var(--critical)}
  .meter-cell{display:flex;align-items:center;gap:8px;min-width:150px}
  .meter-cell .meter{flex:1}
  .meter-cell .pct{width:44px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
  .share{display:flex;align-items:center;gap:8px;min-width:120px}
  .share .bar{height:8px;border-radius:0 4px 4px 0;background:var(--s1);min-width:2px}

  /* ---------- tabelas ---------- */
  .tbl-wrap{overflow-x:auto;margin:0 -2px;padding:0 2px}
  .tbl{width:100%;border-collapse:collapse;font-size:13.5px}
  .tbl th{font-size:12px;font-weight:600;color:var(--ink-2);text-align:left;padding:8px 10px;border-bottom:1px solid var(--grid);white-space:nowrap;background:var(--surface);position:sticky;top:0;z-index:1}
  .tbl td{padding:8px 10px;border-bottom:1px solid var(--grid);vertical-align:middle}
  .tbl tbody tr:hover td{background:var(--hover)}
  .tbl tfoot td{font-weight:650;border-bottom:0;border-top:1px solid var(--axis)}
  .tbl tfoot td .small{font-weight:400}
  .tbl .rank{color:var(--muted);width:28px;font-variant-numeric:tabular-nums}
  .tbl tr.archived td{color:var(--muted)}
  .tbl td.actions{white-space:nowrap;text-align:right;width:1%}
  .tbl th.num{text-align:right}
  .th-tools{display:inline-flex;align-items:center;gap:2px;vertical-align:middle}
  .th-tools .icon-btn{width:22px;height:22px}
  .scroll-y{max-height:520px;overflow:auto}

  /* ---------- grade de digitação ---------- */
  .grid-edit td{padding:4px 4px;border-bottom:1px solid var(--grid)}
  .grid-edit th{padding:6px 4px}
  .grid-edit .inp{height:32px;border-color:var(--border);background-color:var(--input)}
  .grid-edit .inp:hover{border-color:var(--border-2)}
  .grid-edit tr.g-alt td{background:var(--surface-2)}
  .grid-edit tr:hover td{background:transparent}
  .grid-edit td.idx{color:var(--muted);font-size:12px;text-align:right;width:28px;padding-right:6px;font-variant-numeric:tabular-nums}
  .grid-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px}
  .unit{position:relative}
  .unit::before{content:attr(data-unit);position:absolute;left:9px;top:50%;transform:translateY(-50%);font-size:12px;color:var(--muted);pointer-events:none}
  .unit .inp{padding-left:30px}
  .dirty-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--warning);margin-right:6px}
  .day-nav{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .day-nav .inp{width:auto}

  /* ---------- gráficos ---------- */
  .charts-2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr));gap:20px}
  .chart{position:relative;min-height:60px}
  .chart svg{display:block;overflow:visible}
  .chart-title{font-size:13px;font-weight:600;margin-bottom:2px}
  .chart-sub{font-size:12px;color:var(--ink-2);margin-bottom:8px}
  .legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--ink-2);margin-bottom:6px}
  .legend span{display:inline-flex;align-items:center;gap:6px}
  .key-line{display:inline-block;width:14px;height:2px;border-radius:1px}
  .key-rect{display:inline-block;width:10px;height:10px;border-radius:2px}
  .ax{font-size:11px;fill:var(--muted);font-variant-numeric:tabular-nums}
  .ax-end{font-size:11.5px;fill:var(--ink);font-weight:600;font-variant-numeric:tabular-nums}
  .gridline{stroke:var(--grid);stroke-width:1;shape-rendering:crispEdges}
  .baseline{stroke:var(--axis);stroke-width:1;shape-rendering:crispEdges}
  .mark-hit{fill:transparent;cursor:default}
  .mark:hover .bar,.mark:focus .bar{opacity:.78}
  .funnel{display:grid;gap:4px}
  .funnel-row{display:grid;grid-template-columns:minmax(90px,170px) 1fr 70px;align-items:center;gap:10px;font-size:13px}
  .funnel-row .lbl{color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .funnel-row .track{height:20px;position:relative}
  .funnel-row .fill{position:absolute;left:0;top:0;bottom:0;background:var(--s1);border-radius:0 4px 4px 0;min-width:2px}
  .funnel-row .val{text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
  .funnel-conv{display:grid;grid-template-columns:minmax(90px,170px) 1fr 70px;gap:10px;font-size:11.5px;color:var(--muted)}
  .funnel-conv span:nth-child(2){padding-left:2px}
  /* Tendências */
  .subnav button:disabled{opacity:.45;cursor:default}
  .mini-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr));gap:12px}
  .mini{border:1px solid var(--border);border-radius:8px;padding:10px 12px 4px;min-width:0}
  .mini-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:4px;font-size:13px}
  .mini-head .strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
  .trend-head{font-size:14px;color:var(--ink-2);margin-bottom:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .trend-head b{color:var(--ink);font-size:17px}
  /* Renda dos Leads */
  .inc-dist{display:flex;align-items:center;gap:20px;flex-wrap:wrap}
  .inc-dist svg{flex:none;display:block}
  .inc-dist .tbl{flex:1 1 220px;width:auto}
  .donut-num{font-size:24px;font-weight:700;fill:var(--ink);font-variant-numeric:tabular-nums}
  .donut-lbl{font-size:11.5px;fill:var(--ink-2)}
  .donut-empty{fill:none;stroke:var(--grid)}
  .key-rect.hollow{background:transparent;border:1.5px dashed var(--muted)}
  .inc-rows{display:grid;gap:10px}
  .inc-row{display:grid;grid-template-columns:minmax(80px,160px) 1fr auto;align-items:center;gap:10px;font-size:13px}
  .inc-row .lbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink-2)}
  .inc-row .val{font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}
  @media (max-width:560px){.inc-row{grid-template-columns:1fr auto;row-gap:4px}.inc-row .stack{grid-column:1/-1;grid-row:2}}
  .stack{display:flex;gap:2px;height:22px;min-width:0}
  .stack .seg{min-width:2px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:650;overflow:hidden;white-space:nowrap;font-variant-numeric:tabular-nums}
  .stack .seg:first-child{border-radius:4px 0 0 4px}
  .stack .seg:last-child{border-radius:0 4px 4px 0}
  .stack .seg:only-child{border-radius:4px}
  .stack.none{border:1px dashed var(--border-2);border-radius:4px;align-items:center;padding:0 8px;font-size:11.5px;color:var(--muted)}
  .inc-cols{display:flex;gap:6px;align-items:flex-end;overflow-x:auto;padding-bottom:2px}
  .inc-col{flex:1 0 34px;max-width:80px;display:flex;flex-direction:column;align-items:stretch;gap:4px;text-align:center;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
  .inc-col .stack{flex-direction:column-reverse;height:150px;width:100%}
  .inc-col .stack .seg:first-child{border-radius:0 0 4px 4px}
  .inc-col .stack .seg:last-child{border-radius:4px 4px 0 0}
  .inc-col .stack .seg:only-child{border-radius:4px}
  .inc-col .stack.none{padding:0;justify-content:center}
  /* Dashboard Agentes */
  .agd-head{display:flex;gap:6px 8px;align-items:baseline;flex-wrap:wrap;margin:-6px 0 14px;color:var(--ink-2);font-size:13px}
  .agd-head b{color:var(--ink);font-size:16px}
  .agd-actions{display:inline-flex;gap:6px;align-items:center;align-self:center}
  [data-ref=agdash] .card+.kpis,[data-ref=agdash] .grid-2+.kpis,[data-ref=agdash] .note+.card,[data-ref=agdash] .note+.grid-2,[data-ref=agdash] .note+.kpis{margin-top:16px}
  .agd-layout{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));align-items:start}
  .agd-layout h4{font-size:13px;margin:0 0 8px;color:var(--ink-2)}
  .spark{display:block;width:100%;height:24px;margin-top:auto;overflow:visible}
  .spark path{fill:none;stroke:var(--s1);stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}
  .agd-cal-wrap{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px}
  .agd-cal-days{display:grid;grid-template-rows:repeat(7,14px);gap:3px;font-size:10px;line-height:14px;color:var(--muted);flex:none}
  .agd-cal{display:grid;grid-template-rows:repeat(7,14px);grid-auto-flow:column;grid-auto-columns:14px;gap:3px}
  .agd-cal .c{border-radius:3px;background:transparent;border:1.5px dashed var(--border-2)}
  .agd-cal .c.on{background:var(--s1);border:0}
  .agd-cal .c.today{outline:2px solid var(--ink-2);outline-offset:1px}
  .agd-cal .c.pad{visibility:hidden}
  /* Dashboard Agentes → Equipe (v1.8) */
  .th-sort{appearance:none;background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer;white-space:nowrap}
  .th-sort:hover,.th-sort.on{color:var(--ink)}
  .th-sort:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .team-tbl td{vertical-align:top}
  .kpi-foot .ink{color:var(--ink)}
  .team-tbl th{white-space:normal;vertical-align:bottom;min-width:64px;line-height:1.25}
  .team-tbl th .th-sort{white-space:normal;text-align:inherit}
  .team-tbl th:first-child{min-width:0}
  .team-tbl .share{min-width:0;justify-content:flex-end}
  .team-tbl .meter-cell{min-width:110px}
  .spark-cell{width:96px;min-width:80px}
  .spark-cell .spark{margin-top:4px}
  .team-cal{overflow-x:auto;display:grid;gap:3px;padding-bottom:4px}
  .team-cal-row{display:grid;grid-template-columns:minmax(90px,150px) auto 1fr;align-items:center;gap:10px;font-size:12.5px}
  .team-cal-row .lbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink-2)}
  .team-cal-row .cells{display:grid;grid-auto-flow:column;grid-auto-columns:12px;gap:2px;height:12px}
  .team-cal-row.head .cells{height:auto}
  .team-cal-row .val{color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
  .team-cal-row .d{font-size:10px;color:var(--muted);white-space:nowrap;overflow:visible;width:12px}
  .team-cal .c{border-radius:3px;border:1.5px dashed var(--border-2)}
  .team-cal .c.on{background:var(--s1);border:0}
  .team-cal .c.today{outline:2px solid var(--ink-2);outline-offset:1px}
  .team-cal .c.pad{border:0}
  .inc-col .n{color:var(--ink-2)}
  .ol-row input[type=color]{width:34px;height:28px;padding:2px;border:1px solid var(--border-2);border-radius:6px;background:var(--input);cursor:pointer;flex:none}
  details.more{margin-top:14px}
  details.more summary{cursor:pointer;color:var(--accent);font-size:13px;font-weight:550;list-style:none;display:inline-flex;align-items:center;gap:4px}
  details.more summary::-webkit-details-marker{display:none}
  details.more[open] summary svg{transform:rotate(180deg)}
  details.more .tbl-wrap{margin-top:10px}

  /* ---------- tooltip, popover, modal, toast ---------- */
  .tip{position:fixed;z-index:2147483600;pointer-events:none;background:var(--raised);color:var(--ink);border:1px solid var(--border);box-shadow:var(--shadow);border-radius:8px;padding:8px 10px;font-size:12.5px;max-width:280px;line-height:1.4}
  .tip .t-head{font-weight:600;color:var(--ink-2);margin-bottom:4px;font-size:12px}
  .tip .t-row{display:flex;align-items:center;gap:8px;white-space:nowrap}
  .tip .t-row b{font-weight:700;font-variant-numeric:tabular-nums}
  .tip .t-row .muted{margin-left:auto;padding-left:8px}
  .popover{position:fixed;z-index:2147483500;background:var(--raised);border:1px solid var(--border);box-shadow:var(--shadow);border-radius:10px;padding:6px;min-width:230px}
  .pop-item{display:flex;align-items:center;gap:8px;width:100%;appearance:none;border:0;background:none;padding:8px 10px;border-radius:7px;cursor:pointer;text-align:left;color:var(--ink)}
  .pop-item:hover{background:var(--hover)}
  .pop-item .ck{width:16px;display:inline-grid;place-items:center;color:var(--accent)}
  .pop-item.on{font-weight:650}
  .pop-foot{border-top:1px solid var(--grid);margin-top:6px;padding:10px 6px 4px;display:grid;gap:8px}
  .pop-foot .row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .chip{appearance:none;display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 12px;border-radius:8px;border:1px solid var(--border-2);background:var(--raised);cursor:pointer;font-weight:600;color:var(--ink)}
  .chip:hover{background:var(--surface-2)}
  .chip .muted{font-weight:500}
  .overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(10,10,10,.42);display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px 16px;overflow-y:auto}
  .modal{background:var(--surface);color:var(--ink);border-radius:12px;box-shadow:var(--shadow);width:min(560px,100%);border:1px solid var(--border);display:flex;flex-direction:column;max-height:none}
  .modal:focus{outline:none}
  .modal.wide{width:min(980px,100%)}
  .modal.small{width:min(440px,100%)}
  .modal-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--grid)}
  .modal-head h2{flex:1;font-size:16px}
  .modal-body{padding:16px 18px;min-width:0}
  .modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--grid);flex-wrap:wrap}
  .confirm-msg{white-space:pre-line;color:var(--ink-2)}
  .toasts{position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;max-width:min(420px,calc(100vw - 32px))}
  .toast{background:var(--raised);color:var(--ink);border:1px solid var(--border);border-left:4px solid var(--good);box-shadow:var(--shadow);border-radius:8px;padding:10px 14px;font-size:13.5px;animation:rc-in .18s ease-out}
  .toast.error{border-left-color:var(--critical)}
  .toast.info{border-left-color:var(--accent)}
  .toast.out{opacity:0;transform:translateY(6px);transition:.25s}
  @keyframes rc-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

  /* ---------- importação ---------- */
  .drop{border:1.5px dashed var(--border-2);border-radius:10px;padding:26px 16px;text-align:center;background:var(--surface-2);cursor:pointer;display:block}
  .drop:hover,.drop.over{border-color:var(--accent);background:var(--accent-wash)}
  .drop input{display:none}
  .drop strong{display:block;margin:6px 0 2px}
  .steps{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;font-size:12.5px;color:var(--muted)}
  .steps span{padding:3px 10px;border-radius:99px;background:var(--surface-2)}
  .steps span.on{background:var(--accent);color:var(--accent-ink);font-weight:600}
  .steps span.done{color:var(--ink-2)}
  .map-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
  .stat-row{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
  .row-err td{background:var(--crit-wash)!important}
  .row-dup td{background:var(--warn-wash)!important}
  .err-txt{color:var(--down);font-size:12px}
  .raw{font-family:ui-monospace,Consolas,monospace;font-size:12px}

  @media (max-width:640px){
    .top{gap:8px}
    .brand-title{font-size:16px}
    .card{padding:14px}
    .modal-body{padding:14px}
  }
  @media (forced-colors:active){.meter-fill,.funnel-row .fill,.share .bar{background:CanvasText}.stack .seg{border:1px solid CanvasText}}
  @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
  `;

  const svgIcon = (path, size) => '<svg width="' + (size || 16) + '" height="' + (size || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + path + '</svg>';
  const ICON = {
    chart: svgIcon('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', 17),
    x: svgIcon('<path d="M18 6L6 18M6 6l12 12"/>'),
    eye: svgIcon('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    eyeOff: svgIcon('<path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.4 0 10 7 10 7a17 17 0 0 1-2.16 3.19M6.6 6.6A16.6 16.6 0 0 0 2 12s3.6 7 10 7a9.3 9.3 0 0 0 5.4-1.6M14.12 14.12A3 3 0 1 1 9.88 9.88M2 2l20 20"/>'),
    plus: svgIcon('<path d="M12 5v14M5 12h14"/>'),
    trash: svgIcon('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>'),
    edit: svgIcon('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>'),
    archive: svgIcon('<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v12h14V8M10 12h4"/>'),
    restore: svgIcon('<path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8"/><path d="M3 3v5h5"/>'),
    gear: svgIcon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>', 14),
    up: svgIcon('<path d="M12 19V5M5 12l7-7 7 7"/>', 13),
    down: svgIcon('<path d="M12 5v14M19 12l-7 7-7-7"/>', 13),
    arrowUp: svgIcon('<path d="M18 15l-6-6-6 6"/>', 14),
    arrowDown: svgIcon('<path d="M6 9l6 6 6-6"/>', 14),
    check: svgIcon('<path d="M20 6L9 17l-5-5"/>'),
    bang: svgIcon('<path d="M12 6v8M12 18h.01"/>'),
    alert: svgIcon('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>'),
    info: svgIcon('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'),
    upload: svgIcon('<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>', 22),
    download: svgIcon('<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>'),
    copy: svgIcon('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>'),
    left: svgIcon('<path d="M15 18l-6-6 6-6"/>'),
    right: svgIcon('<path d="M9 18l6-6-6-6"/>'),
    cal: svgIcon('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
    chevron: svgIcon('<path d="M6 9l6 6 6-6"/>', 14),
    layers: svgIcon('<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>'),
    repeat: svgIcon('<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>'),
    save: svgIcon('<path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>'),
    refresh: svgIcon('<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0114.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0020.5 15"/>'),
    sun: svgIcon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    moon: svgIcon('<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>'),
    file: svgIcon('<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M9 15h6M9 18h4"/>'),
  };
  // v1.11: "Abaixo" virou "Crítico" (ao lado de "41%" era lido como "41% abaixo").
  const STATUS = { good: ['Na meta', ICON.check], warning: ['Atenção', ICON.bang], critical: ['Crítico', ICON.x] };
  /** Faixa do status pelos limites de Configurações (ex.: "menos de 70% da meta"). */
  function statusRange(st, s) {
    if (!s || !STATUS[st]) return '';
    const red = Math.round(s.red_below * 100) + '%', green = Math.round(s.green_from * 100) + '%';
    if (st === 'critical') return 'menos de ' + red + ' da meta';
    if (st === 'good') return green + ' da meta ou mais';
    return 'de ' + red + ' até menos de ' + green + ' da meta';
  }
  /** Rótulo do status com a faixa, para o title (ex.: "Crítico: menos de 70% da meta"). */
  function statusTitle(st, s) { const r = statusRange(st, s); return STATUS[st] ? STATUS[st][0] + (r ? ': ' + r : '') : ''; }
  function badge(st, s) {
    if (!st) return '<span class="badge st-none">sem meta</span>';
    const t = statusTitle(st, s);
    return '<span class="badge st-' + st + '"' + (s ? ' title="' + esc(t) + '"' : '') + ' data-status="' + st + '"><span class="dot">' + STATUS[st][1] + '</span>' + STATUS[st][0] + '</span>';
  }
  function meterCell(pct, st, s) {
    if (pct == null) return '<span class="badge st-none">sem meta</span>';
    const label = statusTitle(st, s);
    return '<div class="meter-cell" title="' + esc(label) + '"><div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct * 100) + '" aria-label="' + esc(F.pct(pct) + ' da meta — ' + label) + '"><div class="meter-fill ' + (st || '') + '" style="width:' + (clamp(pct, 0, 1) * 100).toFixed(1) + '%"></div></div><span class="pct">' + F.pct(pct) + '</span>' + (st ? '<span class="badge st-' + st + '" style="gap:0"><span class="dot">' + STATUS[st][1] + '</span></span>' : '') + '</div>';
  }
  function deltaHTML(cur, prev, opts) {
    opts = opts || {};
    if (prev == null || cur == null) return '';
    if (!prev) return cur ? '<span class="delta flat">novo</span>' : '';
    const d = (cur - prev) / Math.abs(prev);
    if (Math.abs(d) < 0.0005) return '<span class="delta flat">= 0%</span>';
    const up = d > 0, good = opts.invert ? !up : up;
    // neutral: métricas em que subir não é necessariamente bom (ex.: "Outras atividades" do Dashboard Agentes)
    return '<span class="delta ' + (opts.neutral ? 'flat' : good ? 'up' : 'down') + '" title="Anterior: ' + esc(opts.money ? F.money(prev) : F.num(prev)) + '">' + (up ? ICON.up : ICON.down) + F.pct(Math.abs(d), Math.abs(d) < 0.1 ? 1 : 0) + '</span>';
  }

  // ==========================================================================
  // 5. WEB COMPONENT — núcleo (shell, eventos, modais, popover, tooltip)
  // ==========================================================================
  // Handlers delegados: elementos usam data-act (clique), data-chg (change) e data-inp (input).
  const ACT = {}, CHG = {}, INP = {};

  const TABS = [
    { id: 'painel', label: 'Painel' },
    { id: 'tendencias', label: 'Tendências' },
    { id: 'vendas', label: 'Vendas', edit: true },
    { id: 'diario', label: 'Diário', edit: true },
    { id: 'cadastros', label: 'Cadastros', edit: true },
  ];

  // escolha de tema de cada pessoa (v1.10), guardada só neste navegador (não em settings: não muda a tela dos outros)
  const THEME_KEY = 'relatorio-comercial:tema';

  class RelatorioComercialElement extends HTMLElement {
    static get observedAttributes() { return ['titulo', 'readonly', 'theme']; }

    constructor() {
      super();
      this._shadow = this.attachShadow({ mode: 'open' });
      this._adapter = null;
      this.store = null;
      this.tab = 'painel';
      this.periods = {};
      this.ui = {};
      this._modals = [];
      this._pending = new Set();
      this._tok = 0;
      this._bootTok = 0;
      this._resetPin = RESET_PIN;
    }

    // ---------------- ciclo de vida / API pública ----------------
    connectedCallback() {
      if (!this._shell) this._mountShell();
      if (!this._adapter && this.getAttribute('adapter') === 'local') {
        this._adapter = createLocalAdapter({ storageKey: this.getAttribute('storage-key') || undefined });
      }
      if (this._adapter && !this.store) this._boot();
      else if (!this._adapter) this._view.innerHTML = '<div class="empty"><strong>Aguardando configuração</strong>Chame <code>elemento.configure({ adapter })</code> — veja INTEGRACAO.md.</div>';
    }
    disconnectedCallback() { this._closePopover(); this._hideTip(); }
    attributeChangedCallback(name) {
      if (!this._shell) return;
      if (name === 'theme') { this._applyTheme(); return; }
      if (name === 'readonly' && this.readonly && TABS.find((t) => t.id === this.tab).edit) this.tab = 'painel';
      this._renderHeader();
      if (name === 'readonly' && this.store) this.render();
    }
    get readonly() { return this.hasAttribute('readonly'); }

    /**
     * Configura o componente. Opções:
     *  adapter  — objeto adaptador (obrigatório; ver createRestAdapter/createLocalAdapter)
     *  theme    — 'light' | 'dark' | 'auto': tema inicial (padrão: escuro); a escolha da pessoa no botão do topo prevalece
     *  titulo   — título exibido no topo
     *  aba      — aba inicial: 'painel' | 'tendencias' | 'vendas' | 'diario' | 'cadastros'
     *  senhaApagarDados — senha do botão "Apagar dados do navegador" (só no adaptador local; padrão em RESET_PIN)
     *  readonly — true esconde as abas de edição
     */
    configure(opts) {
      opts = opts || {};
      if (opts.theme) this.setAttribute('theme', opts.theme);
      if (opts.titulo) this.setAttribute('titulo', opts.titulo);
      if (opts.readonly != null) this.toggleAttribute('readonly', !!opts.readonly);
      if (opts.aba) this.tab = opts.aba;
      if (opts.senhaApagarDados != null && String(opts.senhaApagarDados) !== '') this._resetPin = String(opts.senhaApagarDados);
      if (opts.adapter) {
        this._adapter = opts.adapter;
        this.store = null;
        this._tok++; // telas carregando com a fonte antiga não devem terminar (veja _stale)
        this.ui = {}; // rascunhos e telas carregadas pertencem à fonte de dados anterior
        if (this.isConnected) { if (!this._shell) this._mountShell(); this._boot(); }
      }
      return this;
    }
    set adapter(a) { this.configure({ adapter: a }); }
    get adapter() { return this._adapter; }
    /** Recarrega cadastros e a aba atual (ex.: depois de alterações feitas fora do painel). */
    async refresh() {
      if (!this.store) return;
      await this.store.init();
      // Força recarregar o dia do Diário (exceto se houver edição não salva).
      if (this.ui.diario && !this.ui.diario.dirty) this.ui.diario.loadedFor = null;
      // Tendências: a "primeira venda" pode ter mudado fora do painel (outra pessoa lançou uma venda mais antiga)
      if (this.ui.tendencias) this.ui.tendencias.firstFor = null;
      // Dashboard Agentes: relê Diário e vendas
      if (this.ui.diario) this.ui.diario.agdData = null;
      await this.render();
    }
    go(tab) { if (!TABS.some((t) => t.id === tab)) return; this.tab = tab; this._renderHeader(); return this.render(); }
    /** Abre o fluxo protegido (senha + confirmação) que apaga os dados do adaptador local e volta aos de exemplo. */
    resetLocalData() { return this._guarded('cfg-reset', () => ACT['cfg-reset'].call(this)); }

    async _boot() {
      const tok = ++this._bootTok;
      this._view.innerHTML = '<div class="loading-bar"></div><div class="empty">Carregando…</div>';
      try {
        const st = new Store(this._adapter);
        await st.init();
        if (tok !== this._bootTok) return;
        this.store = st;
        st.on((type, detail) => {
          // vendas mudaram (lançar, importar, excluir, restaurar): a "primeira venda" das Tendências precisa ser relida
          if (this.ui.tendencias && detail && (detail.collection === 'sales' || detail.collection === '*')) this.ui.tendencias.firstFor = null;
          // Diário ou vendas mudaram: o Dashboard Agentes relê a base
          if (this.ui.diario && detail && (detail.collection === 'sales' || detail.collection === 'daily_entries' || detail.collection === '*')) this.ui.diario.agdData = null;
          this._emit('rc:change', detail);
        });
        const aba = this.getAttribute('aba');
        if (aba && TABS.some((t) => t.id === aba) && this.tab === 'painel') this.tab = aba;
        if (this.readonly && TABS.find((t) => t.id === this.tab).edit) this.tab = 'painel';
        this._renderHeader();
        await this.render();
        this._emit('rc:ready', { version: VERSION });
      } catch (e) {
        if (tok !== this._bootTok) return;
        this._view.innerHTML = '<div class="empty"><strong>Não foi possível carregar os dados.</strong>' + esc(e && e.message || e) + '<br><br><button type="button" class="btn" data-act="retry">' + ICON.refresh + 'Tentar novamente</button></div>';
        this._error(e, true);
      }
    }
    _emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true })); }

    // ---------------- shell ----------------
    _mountShell() {
      this._shadow.innerHTML = '<style>' + CSS + '</style><div class="amr" part="root"><header class="top"></header><main class="view"></main><div class="toasts" role="status" aria-live="polite"></div><div class="tip" role="tooltip" hidden></div></div>';
      const q = (s) => this._shadow.querySelector(s);
      this._shell = q('.amr'); this._top = q('.top'); this._view = q('.view'); this._toasts = q('.toasts'); this._tipEl = q('.tip');
      const sh = this._shell;
      // Isolamento: teclas digitadas nos campos do painel não disparam atalhos da página hospedeira.
      ['keydown', 'keyup', 'keypress'].forEach((t) => sh.addEventListener(t, (e) => {
        const tg = e.composedPath()[0];
        if (tg && /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName)) e.stopPropagation();
      }));
      sh.addEventListener('click', (e) => this._onClick(e));
      sh.addEventListener('change', (e) => this._onDelegated(e, 'chg', CHG));
      sh.addEventListener('input', (e) => this._onDelegated(e, 'inp', INP));
      sh.addEventListener('keydown', (e) => this._onKey(e));
      sh.addEventListener('paste', (e) => this._onPaste && this._onPaste(e));
      sh.addEventListener('pointermove', (e) => this._onPointerMove(e));
      sh.addEventListener('pointerleave', () => this._hideTip());
      sh.addEventListener('dragover', (e) => { const d = e.target.closest && e.target.closest('.drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
      sh.addEventListener('dragleave', (e) => { const d = e.target.closest && e.target.closest('.drop'); if (d) d.classList.remove('over'); });
      sh.addEventListener('drop', (e) => { const d = e.target.closest && e.target.closest('.drop'); if (d) { e.preventDefault(); d.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f && this._importFile) this._run(() => this._importFile(d.dataset.kind, f)); } });
      this._lastW = 0;
      if (global.ResizeObserver) {
        this._ro = new ResizeObserver(debounce(() => {
          const w = this._view.clientWidth;
          if (w !== this._lastW) { this._lastW = w; if (this.tab === 'painel' && this._dash) this._drawCharts(); if (this.tab === 'tendencias' && this._trend) this._drawTrends(); if (this.tab === 'diario' && this._agd) this._drawAgd(); this._fitKpis(); }
        }, 120));
        this._ro.observe(this._view);
      }
      this._applyTheme();
    }

    // ---------------- tema (v1.10) ----------------
    /** Escolha da pessoa neste navegador ('light' | 'dark') ou null. Sem acesso ao armazenamento, vale só nesta página. */
    _themePref() {
      if (this._themeMem) return this._themeMem;
      try { const v = global.localStorage.getItem(THEME_KEY); return v === 'light' || v === 'dark' ? v : null; } catch (e) { return null; }
    }
    /** Tema configurado pela plataforma (atributo theme); sem ele, escuro. */
    _themeBase() { const a = this.getAttribute('theme'); return a === 'light' || a === 'dark' || a === 'auto' ? a : 'dark'; }
    /** Tema que está na tela agora ('light' | 'dark'), resolvendo 'auto' pelo sistema. */
    _themeNow() {
      const t = this._shell && this._shell.dataset.theme || this._themePref() || this._themeBase();
      return t === 'auto' ? (global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
    }
    /** Aplica o tema: o forçado pelo PDF, a escolha da pessoa, o da plataforma ou o escuro. */
    _applyTheme() {
      if (!this._shell) return;
      this._shell.dataset.theme = this._themeForced || this._themePref() || this._themeBase();
      this._renderHeader();
      // avisa a página quando o tema da tela muda (ex.: para ela acompanhar o fundo); o PDF não conta
      const now = this._themeNow();
      if (!this._themeForced && now !== this._themeLast) { this._themeLast = now; this._emit('rc:theme', { theme: now }); }
    }
    /** Tema na tela agora: 'dark' | 'light' (API pública, v1.10). */
    get currentTheme() { return this._shell ? this._themeNow() : this._themePref() || (this._themeBase() === 'light' ? 'light' : 'dark'); }
    _setThemePref(t) {
      this._themeMem = null;
      try { global.localStorage.setItem(THEME_KEY, t); } catch (e) { this._themeMem = t; }
      this._applyTheme();
    }

    _renderHeader() {
      if (!this._top) return;
      const title = this.getAttribute('titulo') || 'Relatório Comercial';
      const tabs = TABS.filter((t) => !(this.readonly && t.edit));
      const dark = this._themeNow() === 'dark';
      this._top.innerHTML = '<div class="brand"><span class="brand-mark">' + ICON.chart + '</span><span class="brand-title">' + esc(title) + '</span></div>' +
        '<nav class="tabs" role="tablist" aria-label="Seções">' + tabs.map((t) => '<button type="button" role="tab" class="tab' + (t.id === this.tab ? ' on' : '') + '" aria-selected="' + (t.id === this.tab) + '" data-act="tab" data-tab="' + t.id + '">' + esc(t.label) + '</button>').join('') + '</nav>' +
        '<div class="top-actions"><button type="button" class="btn btn-sm btn-ghost" data-act="pdf-open" data-ref="pdf-btn" title="Exportar esta tela em PDF"' + (this._pdfScope() ? '' : ' hidden') + '>' + ICON.file + 'Exportar PDF</button>' +
        '<button type="button" class="icon-btn" data-act="theme-toggle" data-ref="theme-btn" aria-label="' + (dark ? 'Usar o tema claro' : 'Usar o tema escuro') + '" title="' + (dark ? 'Tema escuro (clique para o claro)' : 'Tema claro (clique para o escuro)') + '">' + (dark ? ICON.sun : ICON.moon) + '</button></div>';
    }
    /** O botão "Exportar PDF" só aparece nas telas de relatório (as de formulário e Cadastros, não). */
    _syncPdfBtn() { const b = this._top && this._top.querySelector('[data-ref=pdf-btn]'); if (b) b.hidden = !this._pdfScope(); }

    async render() {
      if (!this.store) return;
      this._hideTip();
      this._closePopover();
      const tok = ++this._tok;
      try {
        if (this.tab === 'painel') await this._renderPainel(tok);
        else if (this.tab === 'tendencias') await this._renderTendencias(tok);
        else if (this.tab === 'vendas') await this._renderVendas(tok);
        else if (this.tab === 'diario') await this._renderDiario(tok);
        else if (this.tab === 'cadastros') this._renderCadastros();
        if (tok === this._tok) this._fitKpis();
      } catch (e) { this._error(e); } finally { if (tok === this._tok) { this._view.classList.remove('busy'); this._syncPdfBtn(); } }
    }
    /**
     * Valores dos indicadores (KPIs) numa linha só: se algum não cabe no cartão (ex.: "R$ 578.007,40" num cartão
     * estreito), diminui a fonte de todos os cartões do grupo juntos, até caber (o destaque, à parte). Abaixo do
     * mínimo, o valor volta a poder quebrar. Roda depois de desenhar e quando a largura muda.
     */
    _fitKpis() {
      if (!this._view) return;
      this._view.querySelectorAll('.kpis').forEach((g) => {
        [[':not(.kpi-hero)', 13], ['.kpi-hero', 22]].forEach(([sel, min]) => {
          const vals = Array.from(g.querySelectorAll('.kpi' + sel + ' .kpi-value'));
          vals.forEach((v) => { v.style.fontSize = ''; v.classList.remove('wrap'); });
          if (!vals.length || !vals[0].clientWidth) return; // aba escondida: nada para medir
          const over = () => vals.some((v) => v.scrollWidth > v.clientWidth + 1);
          let size = parseFloat(getComputedStyle(vals[0]).fontSize);
          while (over() && size > min) { size -= 1; vals.forEach((v) => { v.style.fontSize = size + 'px'; }); }
          vals.forEach((v) => { if (v.scrollWidth > v.clientWidth + 1) v.classList.add('wrap'); });
        });
      });
    }
    // Tela "vencida": outra renderização começou ou a fonte de dados foi trocada (configure) enquanto esta esperava o banco.
    _stale(tok) { return !this.store || (tok != null && tok !== this._tok); }
    _busy() { this._view.classList.add('busy'); }

    // ---------------- eventos delegados ----------------
    _onClick(e) {
      if (this._tipEl && !this._tipEl.hidden && !(e.target.closest && e.target.closest('.kpi-info'))) this._hideTip(); // ⓘ aberto pelo toque: outro clique fecha
      if (this._popover && !this._popover.el.contains(e.target) && !(e.target.closest && e.target.closest('[data-pop-anchor]'))) this._closePopover();
      const el = e.target.closest && e.target.closest('[data-act]');
      if (!el || !this._shell.contains(el) || el.disabled) return;
      const top = this._modals[this._modals.length - 1];
      if (top && !top.ov.contains(el) && !(this._popover && this._popover.el.contains(el))) return; // modal aberto: ignora cliques atrás dele
      const fn = ACT[el.dataset.act];
      if (!fn) return;
      if (el.tagName === 'A' || el.tagName === 'BUTTON') e.preventDefault();
      this._guarded(el.dataset.act, () => fn.call(this, el, e));
    }
    /** Executa uma ação ignorando novos disparos da mesma ação enquanto ela não termina (evita salvar duas vezes). */
    _guarded(key, fn) {
      if (this._pending.has(key)) return Promise.resolve();
      this._pending.add(key);
      return this._run(fn).finally(() => this._pending.delete(key));
    }
    _onDelegated(e, kind, map) {
      const el = e.target.closest && e.target.closest('[data-' + kind + ']');
      if (!el) return;
      const fn = map[el.dataset[kind]];
      if (fn) this._run(() => fn.call(this, el, e));
    }
    _onKey(e) {
      if (e.key === 'Tab' && this._modals.length) { this._trapTab(e); return; }
      if (e.key === 'Escape') {
        if (this._tipEl && !this._tipEl.hidden) { this._hideTip(); if (!this._popover && !this._modals.length) return; }
        if (this._popover) { this._closePopover(); return; }
        const top = this._modals[this._modals.length - 1];
        if (top && !top.locked) { e.preventDefault(); this._closeModal(false, top); }
        return;
      }
      const t = e.target;
      if (e.key === 'Enter' && t.tagName === 'INPUT' && t.type !== 'checkbox') {
        const entry = this._modals.find((m) => m.ov.contains(t));
        if (entry && entry.fields) { e.preventDefault(); ACT['form-submit'].call(this, t); return; }
        if (t.dataset.enter && ACT[t.dataset.enter]) { e.preventDefault(); this._guarded(t.dataset.enter, () => ACT[t.dataset.enter].call(this, t, e)); return; }
      }
      if (this._onGridKey) this._onGridKey(e);
    }
    /** Mantém o Tab dentro do modal aberto (não deixa o foco ir para o que está atrás dele). */
    _trapTab(e) {
      const top = this._modals[this._modals.length - 1];
      const els = Array.from(top.modal.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex]:not([tabindex="-1"])'))
        .filter((x) => !x.disabled && x.offsetParent !== null);
      if (!els.length) { e.preventDefault(); top.modal.focus(); return; }
      const cur = this._shadow.activeElement, i = els.indexOf(cur);
      if (i < 0) { e.preventDefault(); (e.shiftKey ? els[els.length - 1] : els[0]).focus(); }
      else if (e.shiftKey && i === 0) { e.preventDefault(); els[els.length - 1].focus(); }
      else if (!e.shiftKey && i === els.length - 1) { e.preventDefault(); els[0].focus(); }
    }
    async _run(fn) { try { return await fn(); } catch (err) { this._error(err); } }
    _error(err, silent) {
      if (err && err.code === 'IN_USE' && !err.userMessage) err.userMessage = 'Este item possui lançamentos ligados a ele e não pode ser excluído. Use "Arquivar" — ele some dos seletores e o histórico é preservado.';
      const msg = err && err.userMessage ? err.userMessage : 'Erro: ' + (err && err.message ? err.message : String(err));
      if (!(err && err.userMessage)) console.error('[relatorio-comercial]', err);
      if (!silent) this._toast(msg, 'error');
      this._emit('rc:error', { error: err, message: msg });
    }

    // ---------------- toast ----------------
    _toast(msg, kind) {
      const t = document.createElement('div');
      t.className = 'toast ' + (kind || 'ok');
      t.textContent = msg;
      this._toasts.appendChild(t);
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, kind === 'error' ? 7000 : 3600);
    }

    // ---------------- modais (empilháveis) ----------------
    _openModal(o) {
      const ov = document.createElement('div');
      ov.className = 'overlay';
      const n = Math.random().toString(36).slice(2, 8);
      ov.innerHTML = '<div class="modal ' + (o.size || '') + '" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="mh-' + n + '"><div class="modal-head"><h2 id="mh-' + n + '">' + esc(o.title) + '</h2><button type="button" class="icon-btn" data-act="modal-close" aria-label="Fechar">' + ICON.x + '</button></div><div class="modal-body">' + (o.body || '') + '</div>' + (o.footer ? '<div class="modal-foot">' + o.footer + '</div>' : '') + '</div>';
      this._shell.appendChild(ov);
      const entry = { ov, modal: ov.firstElementChild, body: ov.querySelector('.modal-body'), onClose: o.onClose, fields: o.fields, validate: o.validate, ctx: o.ctx };
      this._modals.push(entry);
      // O foco entra no modal na hora (no Safari, clicar num botão não move o foco para ele,
      // e sem isto Esc/Tab ficariam fora do painel até o campo abaixo ser focado).
      entry.modal.focus({ preventScroll: true });
      const first = ov.querySelector('.modal-body input:not([type=checkbox]):not([type=hidden]),.modal-body select,.modal-body textarea') || ov.querySelector('.modal-foot .btn-primary,.modal-foot .btn-danger');
      if (first && o.autofocus !== false) setTimeout(() => first.focus(), 20);
      return entry;
    }
    _closeModal(result, entry) {
      entry = entry || this._modals[this._modals.length - 1];
      if (!entry) return;
      const i = this._modals.indexOf(entry);
      if (i > -1) this._modals.splice(i, 1);
      entry.ov.remove();
      this._hideTip();
      if (entry.onClose) entry.onClose(result);
    }
    _modalOf(el) { return this._modals.find((m) => m.ov.contains(el)) || null; }

    _confirm(message, o) {
      o = o || {};
      return new Promise((resolve) => {
        this._openModal({
          title: o.title || 'Confirmar', size: 'small', body: '<p class="confirm-msg">' + esc(message) + '</p>',
          footer: '<button type="button" class="btn" data-act="modal-close">Cancelar</button><button type="button" class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" data-act="modal-ok">' + esc(o.ok || 'Confirmar') + '</button>',
          onClose: (r) => resolve(r === true),
        });
      });
    }

    /** Formulário em modal. Resolve com {chave: valor} ou null se cancelado. */
    _form(o) {
      return new Promise((resolve) => {
        const body = (o.intro ? '<p class="ink2" style="margin-bottom:14px">' + o.intro + '</p>' : '') + '<div class="form">' + o.fields.map((f) => this._fieldHTML(f)).join('') + '</div>';
        this._openModal({
          title: o.title, size: o.size || '', body, fields: o.fields, validate: o.validate,
          footer: '<button type="button" class="btn" data-act="modal-close">Cancelar</button><button type="button" class="btn btn-primary" data-act="form-submit">' + esc(o.ok || 'Salvar') + '</button>',
          onClose: (r) => resolve(r && typeof r === 'object' ? r : null),
        });
      });
    }
    _fieldHTML(f) {
      const v = f.value == null ? '' : f.value;
      const req = f.required ? ' <span class="muted">*</span>' : '';
      const hint = f.hint ? '<span class="hint">' + esc(f.hint) + '</span>' : '';
      if (f.type === 'checkbox') return '<label class="check"><input type="checkbox" data-k="' + f.key + '"' + (v ? ' checked' : '') + '> ' + esc(f.label) + '</label>' + hint;
      if (f.type === 'checks') {
        const vals = (Array.isArray(v) ? v : []).map(sid);
        return '<div class="field"><span>' + esc(f.label) + req + '</span><div style="display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(190px,1fr))">' + f.options.map((op) => '<label class="check"><input type="checkbox" data-k="' + f.key + '" value="' + esc(op[0]) + '"' + (vals.indexOf(sid(op[0])) > -1 ? ' checked' : '') + '> ' + esc(op[1]) + '</label>').join('') + '</div>' + hint + '</div>';
      }
      let ctl;
      if (f.type === 'select') ctl = '<select class="inp" data-k="' + f.key + '">' + f.options.map((op) => '<option value="' + esc(op[0]) + '"' + (sid(op[0]) === sid(v) ? ' selected' : '') + '>' + esc(op[1]) + '</option>').join('') + '</select>';
      else if (f.type === 'textarea') ctl = '<textarea class="inp" data-k="' + f.key + '" rows="3" style="font-family:inherit;font-size:14px">' + esc(v) + '</textarea>';
      else if (f.type === 'money') ctl = '<input class="inp inp-money" data-k="' + f.key + '" inputmode="decimal" autocomplete="off" value="' + esc(v) + '" placeholder="' + esc(f.placeholder || '0,00') + '">';
      else ctl = '<input class="inp" type="' + (f.type || 'text') + '" data-k="' + f.key + '" autocomplete="off" value="' + esc(v) + '" placeholder="' + esc(f.placeholder || '') + '">';
      return '<label class="field"' + (f.wrapStyle ? ' style="' + f.wrapStyle + '"' : '') + '><span>' + esc(f.label) + req + '</span>' + ctl + hint + '</label>';
    }
    _readForm(entry) {
      const out = {};
      (entry.fields || []).forEach((f) => {
        const els = Array.from(entry.modal.querySelectorAll('[data-k="' + f.key + '"]'));
        if (f.type === 'checks') out[f.key] = els.filter((x) => x.checked).map((x) => x.value);
        else if (f.type === 'checkbox') out[f.key] = !!(els[0] && els[0].checked);
        else out[f.key] = els[0] ? els[0].value.trim() : '';
      });
      return out;
    }

    // ---------------- popover ----------------
    _openPopover(anchor, html) {
      this._closePopover();
      const el = document.createElement('div');
      el.className = 'popover';
      el.innerHTML = html;
      this._shell.appendChild(el);
      const place = () => {
        if (!anchor.isConnected) { this._closePopover(); return; }
        const r = anchor.getBoundingClientRect();
        el.style.maxHeight = ''; el.style.overflowY = '';
        const w = el.offsetWidth, h = el.offsetHeight;
        let left = r.left, top = r.bottom + 6;
        if (left + w > global.innerWidth - 8) left = Math.max(8, global.innerWidth - w - 8);
        // cabe embaixo? senão em cima; se não couber em nenhum (tela baixa), rola dentro do lado com mais espaço
        const below = global.innerHeight - 8 - top, above = r.top - 6 - 8;
        if (h > below) {
          if (h <= above) top = r.top - h - 6;
          else if (above > below) { top = 8; el.style.maxHeight = above + 'px'; el.style.overflowY = 'auto'; }
          else { el.style.maxHeight = Math.max(below, 120) + 'px'; el.style.overflowY = 'auto'; }
        }
        el.style.left = left + 'px'; el.style.top = top + 'px';
      };
      place();
      // Acompanha rolagem e redimensionamento em vez de fechar: no celular, abrir o teclado
      // virtual (ex.: nas datas do "Personalizado") redimensiona a tela.
      global.addEventListener('scroll', place, true);
      global.addEventListener('resize', place);
      this._popover = { el, anchor, off: () => { global.removeEventListener('scroll', place, true); global.removeEventListener('resize', place); } };
      return el;
    }
    _closePopover() { if (!this._popover) return; const p = this._popover; this._popover = null; p.off(); p.el.remove(); }

    // ---------------- período (filtro de datas) ----------------
    _period(scope) {
      // Tendências abre em 90 dias e o Dashboard Agentes em 28 (o período padrão do painel, curto, mostraria pouca evolução)
      if (!this.periods[scope]) this.periods[scope] = { preset: scope === 'tendencias' ? 'last_90' : scope === 'agdash' ? 'last_28' : (this.store && this.store.settings.default_period) || 'last_7' };
      return this.periods[scope];
    }
    _range(scope) {
      const opts = scope === 'tendencias' ? { firstSale: this._ts().first } : scope === 'agdash' ? { firstSale: this._agdFirst(), allName: PERIOD_ALL_AGENT[1] } : null;
      return computeRange(this._period(scope), this.store.settings, opts);
    }
    /** Períodos do menu: os comuns + "Desde a primeira venda" nas Tendências e "Desde o primeiro registro" no Dashboard Agentes. */
    _periodList(scope) { return scope === 'tendencias' ? PERIODS.concat([PERIOD_ALL]) : scope === 'agdash' ? PERIODS.concat([PERIOD_ALL_AGENT]) : PERIODS; }
    _periodChip(scope) {
      const r = this._range(scope);
      return '<button type="button" class="chip" data-act="period-open" data-scope="' + scope + '" data-pop-anchor aria-haspopup="dialog">' + ICON.cal + '<span>' + esc(r.name) + '</span><span class="muted">' + D.fmt(r.from) + (r.from !== r.to ? ' – ' + D.fmt(r.to) : '') + '</span>' + ICON.chevron + '</button>';
    }

    // ---------------- tooltip ----------------
    _onPointerMove(e) {
      const t = e.target;
      if (!t || !t.closest) return;
      const xc = t.closest('[data-xchart]');
      if (xc && this._chartHover) { this._chartHover(xc, e); return; }
      if (this._hoverChart) this._chartLeave();
      const tipEl = t.closest('[data-tip]');
      if (tipEl) this._showTip(tipEl.getAttribute('data-tip'), e.clientX, e.clientY);
      else this._hideTip();
    }
    _showTip(html, x, y) {
      const t = this._tipEl;
      if (t.dataset.html !== html) { t.innerHTML = html; t.dataset.html = html; }
      t.hidden = false;
      const w = t.offsetWidth, h = t.offsetHeight;
      let left = x + 14, top = y + 14;
      if (left + w > global.innerWidth - 8) left = x - w - 14;
      if (top + h > global.innerHeight - 8) top = y - h - 14;
      t.style.left = Math.max(8, left) + 'px';
      t.style.top = Math.max(8, top) + 'px';
    }
    _hideTip() { const t = this._tipEl; if (!t || t.hidden) return; t.hidden = true; if (this._shell) this._shell.querySelectorAll('.kpi-info[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false')); }

    // ---------------- auxiliares de formulário ----------------
    /** <option>s de um cadastro. Mantém o valor atual mesmo se arquivado. */
    _options(c, current, o) {
      o = o || {};
      const items = this.store.list(c);
      let html = '<option value="">' + esc(o.placeholder || 'Selecione…') + '</option>';
      const cur = sid(current);
      let found = false;
      items.forEach((r) => {
        const on = sid(r.id) === cur;
        if (on) found = true;
        html += '<option value="' + esc(r.id) + '"' + (on ? ' selected' : '') + '>' + esc(this.store.label(c, r)) + '</option>';
      });
      if (cur && !found) {
        const r = this.store.get(c, cur);
        html += '<option value="' + esc(cur) + '" selected>' + esc(r ? this.store.label(c, r) + ' (arquivado)' : '(removido)') + '</option>';
      }
      if (o.allowNew) html += '<option value="__new">+ Adicionar novo…</option>';
      return html;
    }
    _optionPairs(c, o) {
      o = o || {};
      const pairs = this.store.list(c).map((r) => [r.id, this.store.label(c, r)]);
      return o.empty ? [['', o.empty]].concat(pairs) : pairs;
    }
    _download(name, content, mime) {
      const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.style.display = 'none';
      this._shell.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    }
    /** Cria um item de cadastro a partir de um seletor ("+ Adicionar novo…"). */
    async _quickAdd(c) {
      const titles = { products: 'Novo produto', sellers: 'Novo vendedor / agente', origins: 'Nova origem de lead', metrics: 'Nova métrica' };
      const fields = [{ key: 'name', label: 'Nome', required: true }];
      if (c === 'products') fields.push({ key: 'owner_seller_id', label: 'Agente responsável (opcional)', type: 'select', options: this._optionPairs('sellers', { empty: '— nenhum —' }) });
      if (c === 'metrics') {
        fields.push({ key: 'kind', label: 'Tipo', type: 'select', options: [['count', 'Quantidade'], ['money', 'Valor (R$)']] });
        fields.push({ key: 'funnel', label: 'Faz parte do funil (entra no fim do funil)', type: 'checkbox', value: true });
      }
      const v = await this._form({ title: titles[c], fields, ok: 'Adicionar', validate: (vals) => { try { this.store._checkName(c, vals.name); } catch (e) { return e.userMessage; } return null; } });
      if (!v) return null;
      if (c === 'metrics') {
        const max = this.store.funnelMetrics().reduce((m, x) => Math.max(m, x.funnel_order), 0);
        v.funnel_order = v.funnel && v.kind !== 'money' ? max + 1 : null;
      }
      const r = await this.store.addItem(c, v);
      this._toast('"' + this.store.label(c, r) + '" ' + gen(c, 'adicionado') + '.');
      return r;
    }

    // ---------------- lista ordenável (usada em "Personalizar funil" e na Visão por Agente) ----------------
    /**
     * Lista de itens com setas para reordenar e um controle de estado por item.
     *   ol = {
     *     items:   [{ id, name, hint?, state, deny?: [estados não permitidos para este item] }],
     *     states:  [[valor, rótulo], ...]   -> <select> por item
     *     check:   'rótulo'                 -> em vez de states, uma caixa de seleção (state true/false)
     *     off(it): true se o item está "desligado" (aparece esmaecido)
     *     badge(it, i, items): HTML curto antes do nome (ex.: "Etapa 2")
     *     extra(it, i, items): HTML de um controle a mais, antes do seletor (ex.: cor da faixa na Renda dos Leads)
     *     onState(it, items):  chamado quando o estado de um item muda, antes de redesenhar (ex.: só um item pode ter tal estado)
     *   }
     * Fica em entry.ctx.ol do modal; as ações "ol-move" e "ol-state" alteram e redesenham [data-ol].
     * Mais de uma lista no mesmo modal (v1.9): as outras ficam em entry.ctx.ols[nome], dentro de [data-ol="nome"].
     */
    _olHTML(ol) {
      if (!ol.items.length) return '<div class="empty">' + esc(ol.empty || 'Nada para configurar.') + '</div>';
      const n = ol.items.length;
      return '<div class="ol" role="list">' + ol.items.map((it, i) => {
        const ctl = ol.check
          ? '<label class="check small"><input type="checkbox" data-chg="ol-state"' + (it.state ? ' checked' : '') + ' aria-label="' + esc(ol.check + ': ' + it.name) + '"> ' + esc(ol.check) + '</label>'
          : '<select class="inp sm ol-sel" data-chg="ol-state" aria-label="' + esc('Exibição de ' + it.name) + '">' + ol.states.map((st) => '<option value="' + st[0] + '"' + (it.state === st[0] ? ' selected' : '') + ((it.deny || []).indexOf(st[0]) > -1 ? ' disabled' : '') + '>' + esc(st[1]) + '</option>').join('') + '</select>';
        return '<div class="ol-row' + (ol.off && ol.off(it) ? ' off' : '') + '" role="listitem" data-ol-id="' + esc(it.id) + '">' +
          '<span class="ol-arrows"><button type="button" class="icon-btn" data-act="ol-move" data-dir="-1" aria-label="' + esc('Subir ' + it.name) + '" title="Subir"' + (i === 0 ? ' disabled' : '') + '>' + ICON.arrowUp + '</button>' +
          '<button type="button" class="icon-btn" data-act="ol-move" data-dir="1" aria-label="' + esc('Descer ' + it.name) + '" title="Descer"' + (i === n - 1 ? ' disabled' : '') + '>' + ICON.arrowDown + '</button></span>' +
          '<span class="ol-name">' + (ol.badge ? ol.badge(it, i, ol.items) : '') + '<span class="ol-label">' + esc(it.name) + '</span>' + (it.hint ? ' <span class="small muted">' + esc(it.hint) + '</span>' : '') + '</span>' + (ol.extra ? ol.extra(it, i, ol.items) : '') + ctl + '</div>';
      }).join('') + '</div>';
    }
    /** Redesenha a lista do modal mantendo o foco no mesmo controle (setas e seletores são usados pelo teclado). */
    _olRedraw(entry, focusId, focusSel, key) {
      const box = entry.body.querySelector('[data-ol="' + (key || '') + '"]');
      box.innerHTML = this._olHTML(key ? entry.ctx.ols[key] : entry.ctx.ol);
      if (entry.ctx.olChange) entry.ctx.olChange(entry);
      if (focusId == null) return;
      const row = Array.from(box.querySelectorAll('[data-ol-id]')).find((r) => r.dataset.olId === String(focusId));
      const ctl = row && (row.querySelector(focusSel + ':not(:disabled)') || row.querySelector('[data-act=ol-move]:not(:disabled)'));
      if (ctl) ctl.focus();
    }
  }

  // ---------------- ações do núcleo ----------------
  Object.assign(ACT, {
    tab(el) { this.go(el.dataset.tab); },
    async 'theme-toggle'() {
      this._setThemePref(this._themeNow() === 'dark' ? 'light' : 'dark');
      const b = this._top.querySelector('[data-ref=theme-btn]');
      if (b) b.focus();
      await this.render(); // cores calculadas no tema (ex.: faixas da Renda dos Leads)
    },
    retry() { this._boot(); },
    'modal-close'(el) { this._closeModal(false, this._modalOf(el)); },
    'modal-ok'(el) { this._closeModal(true, this._modalOf(el)); },
    'ol-move'(el) {
      const entry = this._modalOf(el), key = el.closest('[data-ol]').dataset.ol, items = (key ? entry.ctx.ols[key] : entry.ctx.ol).items, dir = Number(el.dataset.dir);
      const id = el.closest('[data-ol-id]').dataset.olId, i = items.findIndex((it) => String(it.id) === id), j = i + dir;
      if (i < 0 || j < 0 || j >= items.length) return;
      const x = items[i]; items[i] = items[j]; items[j] = x;
      this._olRedraw(entry, id, '[data-act=ol-move][data-dir="' + dir + '"]', key);
    },
    'form-submit'(el) {
      const entry = this._modalOf(el);
      if (!entry) return;
      const vals = this._readForm(entry);
      entry.modal.querySelectorAll('.inp.err').forEach((x) => x.classList.remove('err'));
      const missing = (entry.fields || []).filter((f) => f.required && !vals[f.key]);
      missing.forEach((f) => { const x = entry.modal.querySelector('[data-k="' + f.key + '"]'); if (x) x.classList.add('err'); });
      if (missing.length) { this._toast('Preencha os campos obrigatórios.', 'error'); return; }
      const msg = entry.validate ? entry.validate(vals) : null;
      if (msg) { this._toast(msg, 'error'); return; }
      this._closeModal(vals, entry);
    },
    'period-open'(el) {
      const scope = el.dataset.scope, p = this._period(scope), r = this._range(scope);
      const items = this._periodList(scope).map((x) => '<button type="button" class="pop-item' + (p.preset === x[0] ? ' on' : '') + '" data-act="period-pick" data-scope="' + scope + '" data-preset="' + x[0] + '"><span class="ck">' + (p.preset === x[0] ? ICON.check : '') + '</span>' + esc(x[1]) + '</button>').join('');
      const foot = '<div class="pop-foot"><span class="small strong">Personalizado</span><div class="row"><input class="inp sm" type="date" placeholder="dd/mm/aaaa" data-k="from" value="' + r.from + '" aria-label="De"><input class="inp sm" type="date" placeholder="dd/mm/aaaa" data-k="to" value="' + r.to + '" aria-label="Até"></div><button type="button" class="btn btn-sm btn-primary" data-act="period-custom" data-scope="' + scope + '">Aplicar período</button></div>';
      this._openPopover(el, '<div role="listbox" aria-label="Período">' + items + '</div>' + foot);
    },
    'period-pick'(el) {
      this.periods[el.dataset.scope] = { preset: el.dataset.preset };
      this._closePopover();
      this._onPeriodChange(el.dataset.scope);
    },
    'period-custom'(el) {
      const pop = el.closest('.popover');
      const from = parseDate(pop.querySelector('[data-k=from]').value), to = parseDate(pop.querySelector('[data-k=to]').value);
      if (!from || !to) { this._toast('Informe as duas datas.', 'error'); return; }
      this.periods[el.dataset.scope] = { preset: 'custom', from: from <= to ? from : to, to: from <= to ? to : from };
      this._closePopover();
      this._onPeriodChange(el.dataset.scope);
    },
  });
  Object.assign(CHG, {
    'ol-state'(el) {
      const entry = this._modalOf(el), id = el.closest('[data-ol-id]').dataset.olId, key = el.closest('[data-ol]').dataset.ol, ol = key ? entry.ctx.ols[key] : entry.ctx.ol;
      const it = ol.items.find((x) => String(x.id) === id);
      if (!it) return;
      it.state = el.type === 'checkbox' ? el.checked : el.value;
      if (ol.onState) ol.onState(it, ol.items);
      this._olRedraw(entry, id, '[data-chg=ol-state]', key);
    },
  });
  RelatorioComercialElement.prototype._onPeriodChange = function (scope) {
    if (scope === 'renda' && this.ui.diario) this.ui.diario.incKeep = true; // Renda dos Leads: só filtra o histórico já lido
    this._busy();
    return this.render();
  };

  // ==========================================================================
  // 6. ABA PAINEL
  // ==========================================================================
  function niceScale(max, ticks) {
    ticks = ticks || 4;
    if (!(max > 0)) return { max: 1, step: 0.25, empty: true };
    const raw = max / ticks, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
    return { max: Math.ceil(max / step - 1e-9) * step, step };
  }
  function tipHTML(head, rows) {
    return '<div class="t-head">' + esc(head) + '</div>' + rows.map((r) => '<div class="t-row">' +
      (r.color ? '<span class="' + (r.rect ? 'key-rect' : 'key-line') + '" style="background:' + r.color + '"></span>' : '') +
      '<b>' + esc(r.value) + '</b>' + (r.label ? '<span class="muted">' + esc(r.label) + '</span>' : '') + '</div>').join('');
  }
  /** Cor do texto sobre um fundo #rrggbb (preto ou branco, o de maior contraste). */
  function inkOn(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return 'var(--ink)';
    const n = parseInt(m[1], 16);
    const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2] > 0.179 ? '#0b0b0b' : '#ffffff';
  }
  const barPath = (x, y, w, h, r) => {
    if (h <= 0) return '';
    r = Math.min(r, w / 2, h);
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
  };
  const f1 = (n) => Math.round(n * 10) / 10;

  /** Tooltip com a conta da meta do período (ex.: "R$ 120.000 por mês ÷ 31 dias × 7 dias"). */
  function goalTip(store, type, id, r, only) {
    const segs = store.goalBreakdown(type, id, r.from, r.to, only);
    if (!segs.length) return '';
    const rows = segs.map((x) => ({
      value: F.money(x.value),
      label: F.money0(x.amount) + (x.period === 'monthly' ? ' por mês ÷ ' + x.div + ' dias' : ' por semana ÷ 7') + ' × ' + x.days + (x.days === 1 ? ' dia' : ' dias') +
        (segs.length > 1 || x.from !== r.from || x.to !== r.to ? ' (' + D.fmtShort(x.from) + (x.from !== x.to ? '–' + D.fmtShort(x.to) : '') + ')' : ''),
    }));
    const days = sum(segs, (x) => x.days), span = D.span(r.from, r.to);
    if (segs.length > 1) rows.push({ value: F.money(sum(segs, (x) => x.value)), label: 'total' });
    if (days < span) rows.push({ value: String(span - days), label: (span - days === 1 ? 'dia' : 'dias') + (only ? ' com meta por produto ou sem meta geral (não contam aqui)' : ' sem meta no período (não contam)') });
    return ' data-tip="' + esc(tipHTML('Como a meta foi calculada', rows)) + '"';
  }

  const PainelView = {
    async _renderPainel(tok) {
      const r = this._range('painel');
      if (!this._view.querySelector('.painel')) this._view.innerHTML = '<div class="loading-bar"></div>';
      else this._busy();
      const res = await Promise.all([this.store.fetchRange('sales', r.prevFrom, r.to), this.store.fetchRange('daily_entries', r.prevFrom, r.to)]);
      if (this._stale(tok)) return;
      const m = computeDashboard(this.store, res[0], res[1], r);
      this._dash = m;
      this._view.innerHTML = this._painelHTML(m);
      this._lastW = this._view.clientWidth;
      this._drawCharts();
    },

    _painelHTML(m) {
      const k = m.k, r = m.range;
      const prevTxt = D.fmt(r.prevFrom) + (r.prevFrom !== r.prevTo ? ' – ' + D.fmt(r.prevTo) : '');
      let h = '<div class="painel">';
      h += '<div class="toolbar">' + this._periodChip('painel') +
        '<span class="range-note">' + r.days + (r.days === 1 ? ' dia' : ' dias') + ' · comparado com ' + prevTxt + '</span><span class="spacer"></span>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="painel-refresh">' + ICON.refresh + 'Atualizar</button></div>';

      // ---------- KPIs ----------
      // v1.11: cada indicador tem um ⓘ com a definição (passar o mouse ou tocar). O ⓘ não sai no PDF; por isso
      // o rodapé de cada cartão também se explica sozinho. O valor em % leva a unidade ("41% atingido").
      const S = this.store.settings;
      const tile = (key, label, value, foot, info, cls) => '<div class="kpi' + (cls ? ' ' + cls : '') + '" data-kpi="' + key + '"><div class="kpi-label"><span>' + label + '</span>' +
        (info ? '<button type="button" class="kpi-info" data-act="kpi-info" aria-expanded="false" aria-label="' + esc('O que é "' + label + '": ' + info) + '" data-tip="' + esc('<div class="t-head">' + esc(label) + '</div><div class="t-text">' + esc(info) + '</div>') + '">' + ICON.info + '</button>' : '') +
        '</div><div class="kpi-value">' + value + '</div>' + (foot ? '<div class="kpi-foot">' + foot + '</div>' : '') + '</div>';
      const pctV = (pct, unit) => esc(F.pct(pct)) + (pct != null ? ' <span class="kpi-unit">' + unit + '</span>' : '');
      const meterBar = (pct, st) => '<div class="meter" style="margin:2px 0 6px"><div class="meter-fill ' + (st || '') + '" style="width:' + (clamp(pct || 0, 0, 1) * 100).toFixed(1) + '%"></div></div>';
      const row = (x) => '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' + x + '</div>';
      const line = (x, ref) => '<div' + (ref ? ' data-ref="' + ref + '"' : '') + ' style="margin-top:4px">' + x + '</div>';
      const vsPrev = (cur, prev, money) => { const d = deltaHTML(cur, prev, { money }); return d ? d + '<span>vs. período anterior</span>' : '<span>sem dados no período anterior</span>'; };
      const ranges = 'Selo: Crítico com ' + statusRange('critical', S) + '; Atenção ' + statusRange('warning', S) + '; Na meta com ' + statusRange('good', S) + ' (limites em Cadastros → Configurações).';
      const gen = k.general, onlyGen = !!gen && gen.days === r.days; // período inteiro na meta geral: ela já compara com todas as vendas
      const hasProdGoal = m.products.some((p) => p.goal != null);
      const hidN = m.hiddenProducts.length;
      // v1.11: duas linhas de 4 — faturamento (Faturamento, Vendas, Ticket, Funis) e metas (as duas metas, Falta, Ritmo)
      let g = '';
      h += '<section class="kpis kpis-row" aria-label="Indicadores de faturamento">';
      h += tile('revenue', 'Faturamento no período', esc(F.money(k.revenue)), vsPrev(k.revenue, k.prevRevenue, true),
        'Soma de todas as vendas do período: todos os produtos e todas as origens, com ou sem meta. A seta compara com o período anterior de mesmo tamanho (' + prevTxt + ').', 'kpi-hero');
      if (k.goal != null) {
        const goalLabel = onlyGen ? 'Meta do período' : 'Meta · produtos com meta';
        g += tile('goal', goalLabel, pctV(k.goalPct, 'atingido'),
          '<div style="width:100%">' + meterBar(k.goalPct, k.goalStatus) +
          row(badge(k.goalStatus, S) + ' <span>' + esc(F.money0(k.goalRevenue)) + ' faturados de ' + esc(F.money0(k.goal)) + '</span>') +
          (onlyGen ? line('meta geral, comparada com todas as vendas', 'kpi-general')
            : line('Produtos sem meta' + (hidN ? ' e ocultos' : '') + ' não entram nesta conta', 'kpi-scope') +
              (gen ? line('inclui a meta geral de ' + D.fmtShort(gen.from) + (gen.from !== gen.to ? ' a ' + D.fmtShort(gen.to) : '') + ' (todas as vendas desses dias)', 'kpi-general') : '')) + '</div>',
          (onlyGen
            ? 'Quanto da meta geral do período foi atingido, comparando com todas as vendas (inclusive produtos ocultos). A meta é proporcional aos dias do período.'
            : 'Quanto da meta foi atingido contando só as vendas que entram na meta de um produto: a venda de uma lead de funil conta para o funil de origem; a de outra origem (ex.: Cliente Antigo) conta para o produto vendido. Vendas de produtos sem meta' + (hidN ? ' e de produtos ocultos' : '') + ' ficam fora. A meta é a soma das metas dos produtos, proporcional aos dias do período.' +
              (gen ? ' Nos dias sem meta por produto vale a meta geral, comparada com todas as vendas desses dias.' : '')) + ' ' + ranges);
        if (!onlyGen) {
          g += tile('goal-total', 'Meta × faturamento total', pctV(k.totalPct, 'atingido'),
            '<div style="width:100%">' + meterBar(k.totalPct, k.totalStatus) +
            row(badge(k.totalStatus, S) + ' <span>' + esc(F.money0(k.revenue)) + ' (todas as vendas) de ' + esc(F.money0(k.goal)) + '</span>') +
            line('Inclui produtos sem meta, como os high ticket · ' + (k.totalMissing > 0 ? 'faltam ' + esc(F.money0(k.totalMissing)) : 'meta coberta'), 'kpi-total-note') +
            (k.inProgress && k.goalToDate ? line('ritmo: <b class="ink">' + esc(F.pct(k.totalPacePct)) + '</b> do esperado até hoje', 'kpi-total-pace') : '') + '</div>',
            'A mesma meta do cartão "' + goalLabel + '", comparada com TODO o faturamento do período, inclusive produtos sem meta (como os high ticket)' + (hidN ? ' e produtos ocultos' : '') + '. Mostra se o faturamento da empresa cobre a soma das metas.' +
              (k.inProgress && k.goalToDate ? ' Ritmo: o faturamento até agora ÷ a parte da meta esperada até hoje.' : '') + ' ' + ranges);
        }
        const missLabel = onlyGen ? 'Falta para a meta' : 'Falta · produtos com meta';
        g += tile('missing', missLabel, esc(F.money(k.missing)), k.missing === 0 ? badge('good', S) : '<span>' + (gen ? (hasProdGoal ? 'soma do que falta em cada produto com meta e na meta geral' : 'o que falta na meta geral') : 'soma do que falta em cada produto com meta') + '</span>',
          onlyGen ? 'Quanto ainda falta para a meta geral do período.'
            : 'Soma do que ainda falta em cada produto com meta' + (gen ? ' (e na meta geral)' : '') + '. Um produto que passou da própria meta conta zero: o que ele vendeu a mais não cobre a falta de outro.');
      } else {
        g += tile('goal', 'Meta · produtos com meta', '—', m.hiddenProducts.some((p) => p.hasGoal)
          ? '<span>Os produtos com meta estão ocultos (Cadastros → Produtos → Nas metas).</span>'
          : '<span>Nenhum produto com meta neste período. Defina em Cadastros → Produtos.</span>',
        'Quanto da meta foi atingido, contando só as vendas que entram na meta de um produto. Aparece quando algum produto exibido tem meta no período.');
      }
      if (k.inProgress && k.goalToDate) {
        // De onde vem o "esperado até hoje" (v1.11): a meta do período é dividida pelos dias. Quando todos os dias valem o
        // mesmo, a conta cabe numa linha ("= 5 de 7 dias da meta de R$ 90.000"); senão (meta que começa no meio, meses
        // com rateios diferentes), a linha diz só que é a parte da meta até hoje. A conta por produto fica no valor.
        const pd = k.paceDays, even = pd && Math.abs(k.goal * pd / r.days - k.goalToDate) < 0.5;
        const parts = m.products.filter((p) => p.goal != null && p.goalToDate > 0).map((p) => ({ value: F.money0(p.goalToDate), label: p.name, n: p.goalToDate }))
          .concat(gen && gen.goalToDate > 0 ? [{ value: F.money0(gen.goalToDate), label: 'Meta geral (todos os produtos)', n: gen.goalToDate }] : []).sort((a, b) => b.n - a.n);
        const partRows = parts.slice(0, 12).concat(parts.length > 12 ? [{ value: F.money0(sum(parts.slice(12), (x) => x.n)), label: 'outros ' + (parts.length - 12) }] : [])
          .concat(parts.length > 1 ? [{ value: F.money0(k.goalToDate), label: 'total esperado até hoje' }] : []);
        const paceTip = ' class="has-tip" data-ref="pace-expected" data-tip="' + esc(tipHTML('Esperado até hoje (' + D.fmtShort(r.from) + ' a ' + D.fmtShort(k.paceTo) + ')', partRows)) + '"';
        g += tile('pace', onlyGen ? 'Ritmo até hoje' : 'Ritmo · produtos com meta', pctV(k.pacePct, 'do esperado'),
          '<div style="width:100%">' + row(badge(k.paceStatus, S) + ' <span>' + esc(F.money0(k.goalRevenue)) + ' de <span' + paceTip + '>' + esc(F.money0(k.goalToDate)) + '</span> esperados até hoje</span>') +
          line(even ? '= ' + pd + ' de ' + r.days + ' dias da meta de ' + esc(F.money0(k.goal))
            : 'parte da meta de ' + esc(F.money0(k.goal)) + ' que vale de ' + D.fmtShort(r.from) + ' a ' + D.fmtShort(k.paceTo), 'pace-days') + '</div>',
          'O período ainda não terminou. Compara o que já foi faturado' + (onlyGen ? '' : ' nos produtos com meta') + ' com a parte da meta esperada até hoje: a meta é dividida pelos dias do período, e conta cada dia de ' + D.fmtShort(r.from) + ' até hoje (' + D.fmtShort(k.paceTo) + '), inclusive hoje.' +
            (even ? ' Neste período: ' + pd + ' de ' + r.days + ' dias × a meta de ' + F.money0(k.goal) + ' = ' + F.money0(k.goalToDate) + ' esperados.' : ' Passe o mouse no valor esperado para ver a parte de cada produto.') +
            ' Por isso a meta do cartão "' + (onlyGen ? 'Meta do período' : 'Meta · produtos com meta') + '" (o período inteiro) é maior que o esperado até hoje. 100% = no ritmo para bater a meta no fim do período. ' + ranges);
      }
      h += tile('count', 'Vendas', esc(F.int(k.count)), vsPrev(k.count, k.prevCount), 'Número de vendas no período, de todos os produtos e origens, comparado com o período anterior de mesmo tamanho.');
      h += tile('avg', 'Ticket médio', esc(F.money(k.avg)), vsPrev(k.avg, k.prevAvg, true), 'Faturamento do período ÷ número de vendas.');
      const others = m.origins.filter((o) => !o.isProduct && o.value > 0);
      const otherNames = others.map((o) => o.name).filter((x) => x && x !== '—');
      const otherRev = k.revenue - k.funnelRevenue;
      h += tile('funnel', 'Faturado via funis (tráfego)', esc(F.money(k.funnelRevenue)),
        '<div style="width:100%"><div>' + esc(F.pct(k.revenue ? k.funnelRevenue / k.revenue : null)) + ' do faturamento · leads que chegaram por um funil</div>' +
        (otherRev > 0.005 ? line('Fora daqui: ' + esc(otherNames.length ? otherNames.slice(0, 2).join(', ') + (otherNames.length > 2 ? ' e outras origens' : '') : 'outras origens') + ' (' + esc(F.money0(otherRev)) + ')', 'kpi-funnel-other') : k.count ? line('Todas as vendas vieram de funis', 'kpi-funnel-other') : '') +
        line(k.cross + (k.cross === 1 ? ' venda cruzada' : ' vendas cruzadas') + ' (lead comprou produto diferente do funil)', 'kpi-funnel-cross') + '</div>',
        'Vendas em que a Origem da Lead é um funil (um produto cadastrado), ou seja, leads que chegaram pelo tráfego. Ficam fora as outras origens, cadastradas em Cadastros → Origens de lead (ex.: Cliente Antigo, Indicação). Venda cruzada: a lead veio pelo funil de um produto e comprou outro.');
      h += '</section><section class="kpis kpis-row kpis-goals" aria-label="Indicadores de meta">' + g + '</section>';

      // ---------- produtos e vendedores ----------
      h += this._prodCard(m) + this._sellerCard(m);
      // ---------- evolução ----------
      h += this._evolCard(m);
      // ---------- vendido / origens ----------
      // (o Funil saiu do Painel na v1.5 — está na Visão por Agente; a Auditoria foi para o Diário → Histórico)
      h += '<div class="grid-2">' + this._soldCard(m) + this._originCard(m) + '</div>';
      return h + '</div>';
    },

    _prodCard(m) {
      const rows = m.products, hid = m.hiddenProducts;
      // Aviso dos produtos ocultos (Cadastros → Produtos → ícone de olho).
      const hidNames = hid.slice(0, 5).map((p) => p.name).join(', ') + (hid.length > 5 ? ' e mais ' + (hid.length - 5) : '');
      const hidNote = hid.length ? '<p class="small muted" data-ref="hidden-products" style="margin-top:8px" title="' + esc(hid.map((p) => p.name).join(', ')) + '">' + ICON.eyeOff.replace('width="16" height="16"', 'width="12" height="12"') + ' ' +
        (hid.length === 1 ? '1 produto oculto' : hid.length + ' produtos ocultos') + ' (' + esc(hidNames) + '): fora desta tabela e dos indicadores de meta. ' +
        (this.readonly ? '' : '<button type="button" class="link" data-act="goto-products">Gerenciar em Cadastros → Produtos</button>') + '</p>' : '';
      if (!rows.length) return '<div class="card"><h3>Metas por produto</h3><div class="empty">' + (hid.length ? 'Todos os produtos estão ocultos nesta seção.' : 'Nenhum produto cadastrado.') + '</div>' + hidNote + '</div>';
      let b = '';
      const gen = m.k.general;
      if (gen) { // meta geral (v1.6): período antes das metas por produto
        b += '<tr data-ref="general-row"><td><span class="strong">Meta geral</span> <span class="pill info">todos os produtos</span><div class="small muted">' + D.fmtShort(gen.from) + (gen.from !== gen.to ? ' a ' + D.fmtShort(gen.to) : '') + ' · dias sem meta por produto</div></td><td><span class="muted">—</span></td>' +
          '<td class="num has-tip"' + goalTip(this.store, GENERAL_GOAL.type, GENERAL_GOAL.id, m.range, this.store.generalGoalDays(m.range.from, m.range.to)) + '>' + esc(F.money0(gen.goal)) + '</td>' +
          '<td class="num">' + esc(F.money(gen.revenue)) + '</td><td>' + meterCell(gen.pct, gen.status, this.store.settings) + '</td><td class="num">' + esc(F.money0(gen.missing)) + '</td><td class="num">' + gen.count + '</td></tr>';
      }
      rows.forEach((p) => {
        b += '<tr' + (p.active ? '' : ' class="archived"') + '><td><span class="strong">' + esc(p.name) + '</span>' + (p.active ? '' : ' <span class="pill">arquivado</span>') + '</td>' +
          '<td class="ink2">' + (p.owner ? esc(p.owner) : '<span class="muted">—</span>') + '</td>' +
          '<td class="num' + (p.goal != null ? ' has-tip' : '') + '"' + (p.goal != null ? goalTip(this.store, 'product', p.id, m.range) : '') + '>' + (p.goal != null ? esc(F.money0(p.goal)) : '<span class="muted">—</span>') + '</td>' +
          '<td class="num">' + esc(F.money(p.revenue)) + (p.revenueOther ? '<div class="small muted" title="Vendas de origens fora de funil (ex.: Cliente Antigo) contam na meta do produto vendido">' + esc(F.money0(p.revenueOther)) + ' de outras origens</div>' : '') +
            (p.goal != null && p.revenueGoal !== p.revenue ? '<div class="small muted" data-ref="rev-goal-days" title="Só o faturado nos dias em que a meta do produto valia entra no % atingido e no que falta">' + esc(F.money0(p.revenueGoal)) + ' nos dias com meta</div>' : '') + '</td><td>' + meterCell(p.pct, p.status, this.store.settings) + '</td>' +
          '<td class="num">' + (p.missing != null ? esc(F.money0(p.missing)) : '<span class="muted">—</span>') + '</td><td class="num">' + p.count + '</td></tr>';
      });
      const k = m.k;
      const foot = (k.goal != null ? '<tr><td colspan="2">' + (gen ? 'Total com meta' : 'Produtos com meta') + '</td><td class="num">' + esc(F.money0(k.goal)) + '</td><td class="num">' + esc(F.money(k.goalRevenue)) + '</td><td>' + meterCell(k.goalPct, k.goalStatus, this.store.settings) + '</td><td class="num">' + esc(F.money0(k.missing)) + '</td><td></td></tr>' : '') +
        '<tr><td colspan="3">' + (hid.length ? 'Todos os produtos exibidos' : 'Todos os produtos') + '</td><td class="num">' + esc(F.money(k.shownRevenue)) + '</td><td colspan="2"></td><td class="num">' + k.shownCount + '</td></tr>';
      return '<div class="card"><div class="card-head"><div><h3>Metas por produto</h3><p class="sub">Vendas de um funil contam para o funil de origem da lead; de outras origens (ex.: Cliente Antigo), para o produto vendido · meta proporcional ao período (passe o mouse na meta para ver a conta)</p></div></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Produto</th><th>Responsável</th><th class="num">Meta</th><th class="num">Faturado</th><th>Atingido</th><th class="num">Falta</th><th class="num">Vendas</th></tr></thead><tbody>' + b + '</tbody><tfoot>' + foot + '</tfoot></table></div>' + hidNote + '</div>';
    },

    _sellerCard(m) {
      const rows = m.sellers;
      if (!rows.length) return '<div class="card"><h3>Vendedores</h3><div class="empty">Nenhum vendedor cadastrado.</div></div>';
      let b = '';
      rows.forEach((v, i) => {
        b += '<tr' + (v.active ? '' : ' class="archived"') + '><td class="rank">' + (i + 1) + '</td><td><span class="strong">' + esc(v.name) + '</span>' + (v.active ? '' : ' <span class="pill">arquivado</span>') + '</td>' +
          '<td class="num">' + esc(F.money(v.revenue)) + '</td><td class="num">' + v.count + '</td><td class="num">' + esc(F.money0(v.avg)) + '</td>' +
          '<td class="num' + (v.goal != null ? ' has-tip' : '') + '"' + (v.goal != null ? goalTip(this.store, 'seller', v.id, m.range) : '') + '>' + (v.goal != null ? esc(F.money0(v.goal)) : '<span class="muted">—</span>') + '</td><td>' + meterCell(v.pct, v.status, this.store.settings) + '</td>' +
          '<td class="num">' + (deltaHTML(v.revenue, v.prevRevenue, { money: true }) || '<span class="muted">—</span>') + '</td></tr>';
      });
      return '<div class="card"><div class="card-head"><div><h3>Vendedores</h3><p class="sub">Tudo o que cada um vendeu, de qualquer produto · meta só para quem tem meta individual</p></div></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Vendedor</th><th class="num">Faturado</th><th class="num">Vendas</th><th class="num">Ticket</th><th class="num">Meta</th><th>Atingido</th><th class="num">Δ</th></tr></thead><tbody>' + b + '</tbody></table></div></div>';
    },

    _evolCard(m) {
      const k = m.k;
      const legend = m.hasGoals
        ? '<div class="legend"><span><i class="key-line" style="background:var(--s1)"></i>Realizado (' + (k.general ? 'faturado com meta' : 'produtos com meta') + ')</span><span><i class="key-line" style="background:var(--ref)"></i>Meta acumulada</span></div>' +
          (k.general ? '<div class="chart-sub" data-ref="evol-general">De ' + D.fmtShort(k.general.from) + ' a ' + D.fmtShort(k.general.to) + ': meta geral × todas as vendas</div>' : '')
        : '<div class="chart-sub">Faturamento total acumulado (nenhum produto com meta)</div>';
      let rows = '';
      m.days.forEach((d) => {
        rows += '<tr><td class="nowrap">' + D.dow(d.date) + ' ' + D.fmt(d.date) + (d.general ? ' <span class="pill" title="Meta geral: todas as vendas do dia">geral</span>' : '') + '</td>' +
          '<td class="num">' + d.count + '</td><td class="num">' + esc(F.money(d.revenue)) + '</td>' +
          (m.hasGoals ? '<td class="num">' + esc(F.money(d.cumGoalRevenue)) + '</td><td class="num">' + esc(F.money0(d.cumGoal)) + '</td>' : '<td class="num">' + esc(F.money(d.cumRevenue)) + '</td>') + '</tr>';
      });
      const head = '<tr><th>Dia</th><th class="num">Vendas</th><th class="num">Faturado</th>' +
        (m.hasGoals ? '<th class="num">Acum. (' + (k.general ? 'c/ meta' : 'produtos c/ meta') + ')</th><th class="num">Meta acumulada</th>' : '<th class="num">Acumulado</th>') + '</tr>';
      return '<div class="card"><div class="card-head"><div><h3>Evolução no período</h3><p class="sub">' +
        (k.inProgress ? 'Período em andamento: a linha de meta mostra o ritmo esperado até o fim.' : 'Faturamento dia a dia e ritmo em relação à meta.') + '</p></div></div>' +
        '<div class="charts-2"><div><div class="chart-title">Faturamento acumulado' + (m.hasGoals ? ' × meta' : '') + '</div>' + legend + '<div class="chart" data-chart="cum"></div></div>' +
        '<div><div class="chart-title">Faturamento por ' + (m.days.length > 62 ? 'semana' : 'dia') + '</div><div class="chart-sub">Todas as vendas registradas</div><div class="chart" data-chart="daily"></div></div></div>' +
        '<details class="more"><summary>Ver tabela por dia ' + ICON.chevron + '</summary><div class="tbl-wrap scroll-y"><table class="tbl"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div></details></div>';
    },

    _soldCard(m) {
      let b = '';
      m.sold.forEach((p) => {
        b += '<tr><td class="strong">' + esc(p.name) + '</td><td class="num">' + p.count + '</td><td class="num">' + esc(F.money(p.value)) + '</td><td><div class="share"><span class="bar" style="width:' + (p.share * 100).toFixed(1) + '%"></span><span class="small ink2">' + F.pct(p.share) + '</span></div></td><td class="num">' + (p.cross ? '<span class="pill info" title="Vendas deste produto vindas de outro funil">' + p.cross + '</span>' : '<span class="muted">—</span>') + '</td></tr>';
      });
      return '<div class="card"><div class="card-head"><div><h3>O que foi vendido</h3><p class="sub">Pelo produto realmente comprado</p></div></div>' +
        (m.sold.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Produto</th><th class="num">Qtd.</th><th class="num">Valor</th><th>% da receita</th><th class="num" title="Vendas cruzadas: produto comprado ≠ funil de origem">Cruzadas</th></tr></thead><tbody>' + b +
          '</tbody><tfoot><tr><td>Total</td><td class="num">' + m.k.count + '</td><td class="num">' + esc(F.money(m.k.revenue)) + '</td><td></td><td class="num">' + m.k.cross + '</td></tr></tfoot></table></div>' : '<div class="empty">Nenhuma venda no período.</div>') + '</div>';
    },

    _originCard(m) {
      let b = '';
      m.origins.forEach((o) => {
        b += '<tr><td class="strong">' + esc(o.name) + ' ' + (o.isProduct ? '<span class="pill">funil</span>' : '<span class="pill warn">fora de funil</span>') + '</td><td class="num">' + o.count + '</td><td class="num">' + esc(F.money(o.value)) + '</td><td><div class="share"><span class="bar" style="width:' + (o.share * 100).toFixed(1) + '%"></span><span class="small ink2">' + F.pct(o.share) + '</span></div></td></tr>';
      });
      return '<div class="card"><div class="card-head"><div><h3>Origem das vendas</h3><p class="sub">De onde vieram as leads · vendas "fora de funil" contam na meta do produto vendido</p></div></div>' +
        (m.origins.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Origem da lead</th><th class="num">Qtd.</th><th class="num">Valor</th><th>% da receita</th></tr></thead><tbody>' + b + '</tbody></table></div>' : '<div class="empty">Nenhuma venda no período.</div>') + '</div>';
    },

    /** Auditoria Diário × Vendas (a = computeAudit). Mostrada no Diário → Histórico. */
    _auditCard(a) {
      let h = '<div class="card" data-card="auditoria"><div class="card-head"><div><h3>Auditoria: Diário × Vendas</h3><p class="sub">Compara o que os agentes informaram no Diário com as vendas registradas no mesmo período (pela origem da lead)</p></div></div>';
      if (!a.length) return h + '<div class="empty">Nada para comparar neste período.</div></div>';
      let b = '';
      a.forEach((x) => {
        b += '<tr><td class="strong">' + esc(x.name) + '</td>' +
          (a.hasSold ? '<td class="num">' + F.num(x.dSold) + '</td><td class="num">' + x.sCount + '</td>' : '') +
          (a.hasRev ? '<td class="num">' + esc(F.money(x.dRev)) + '</td><td class="num">' + esc(F.money(x.sRev)) + '</td><td class="num">' + esc(F.money(Math.round(x.diff * 100) / 100 || 0)) + '</td>' : '') +
          '<td>' + (x.ok ? '<span class="pill ok">OK</span>' : '<span class="pill bad">Verificar</span>') + '</td></tr>';
      });
      const bad = a.filter((x) => !x.ok).length;
      return h + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Produto (funil)</th>' +
        (a.hasSold ? '<th class="num">Vendidos (Diário)</th><th class="num">Vendas registradas</th>' : '') +
        (a.hasRev ? '<th class="num">Faturado (Diário)</th><th class="num">Faturado (Vendas)</th><th class="num">Diferença</th>' : '') +
        '<th>Situação</th></tr></thead><tbody>' + b + '</tbody></table></div>' +
        '<p class="small ' + (bad ? '' : 'muted') + '" style="margin-top:8px">' + (bad ? bad + (bad === 1 ? ' funil com divergência.' : ' funis com divergência.') + ' Confira se alguma venda ficou sem registro na aba Vendas, ou se o Diário foi preenchido com valor diferente.' : 'Tudo bate. As métricas de auditoria são definidas em Cadastros → Métricas.') + '</p></div>';
    },

    // ---------------- gráficos SVG ----------------
    _drawCharts() {
      const m = this._dash;
      if (!m || this.tab !== 'painel') return;
      this._charts = {};
      const cum = this._view.querySelector('[data-chart=cum]');
      if (cum) {
        const today = D.today();
        const series = m.hasGoals
          ? [{ name: 'Realizado', color: 'var(--s1)', area: true, end: true, values: m.days.map((d) => (d.date > today ? null : d.cumGoalRevenue)) },
            { name: 'Meta acumulada', color: 'var(--ref)', values: m.days.map((d) => d.cumGoal) }]
          : [{ name: 'Realizado', color: 'var(--s1)', area: true, end: true, values: m.days.map((d) => (d.date > today ? null : d.cumRevenue)) }];
        this._lineChart(cum, 'cum', { labels: m.days.map((d) => d.date), series });
      }
      const daily = this._view.querySelector('[data-chart=daily]');
      if (daily) {
        let pts = m.days.map((d) => ({ label: D.fmtShort(d.date), head: D.dowLong(d.date) + ', ' + D.fmt(d.date), value: d.revenue, count: d.count }));
        if (m.days.length > 62) {
          const wk = new Map();
          m.days.forEach((d) => {
            const ws = D.weekStart(d.date, this.store.settings.week_start);
            if (!wk.has(ws)) wk.set(ws, { label: D.fmtShort(ws), head: 'Semana de ' + D.fmt(ws), value: 0, count: 0 });
            const w = wk.get(ws); w.value += d.revenue; w.count += d.count;
          });
          pts = Array.from(wk.values());
        }
        this._columnChart(daily, pts);
      }
    },

    /**
     * Linhas com crosshair. cfg: { labels (datas), series: [{ name, color, values, area?, end?, dates?, notes? }], aria, ratioLabel (false = sem
     * a linha de razão no tooltip), e opcionais (v1.7): fmt (eixo e rótulo final; padrão R$ curto), tipFmt (tooltip; padrão R$),
     * heads (título do tooltip por ponto), xLabels (rótulos do eixo x), few (texto quando há menos de 2 pontos) }.
     */
    _lineChart(el, id, cfg) {
      const n = cfg.labels.length;
      if (n < 2) { el.innerHTML = '<div class="empty small">' + esc(cfg.few || 'Escolha um período de 2 dias ou mais para ver a evolução.') + '</div>'; return; }
      const fa = cfg.fmt || F.moneyShort, xl = (i) => (cfg.xLabels ? cfg.xLabels[i] : D.fmtShort(cfg.labels[i]));
      const W = Math.max(260, Math.floor(el.clientWidth)), H = 240, M = { l: 62, r: 14, t: 16, b: 28 };
      const iw = W - M.l - M.r, ih = H - M.t - M.b;
      const vals = [];
      cfg.series.forEach((s) => s.values.forEach((v) => { if (v != null) vals.push(v); }));
      const sc = niceScale(Math.max.apply(null, vals.concat([0])));
      const x = (i) => f1(M.l + i * iw / (n - 1));
      const y = (v) => f1(M.t + ih - (v / sc.max) * ih);
      let g = '';
      for (let v = 0; v <= sc.max + sc.step / 1e6; v += sc.step) {
        g += '<line class="' + (v === 0 ? 'baseline' : 'gridline') + '" x1="' + M.l + '" x2="' + (W - M.r) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
          (sc.empty && v > 0 ? '' : '<text class="ax" x="' + (M.l - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + esc(fa(v)) + '</text>');
      }
      const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
      for (let i = 0; i < n; i += every) {
        if (n - 1 - i < every / 2 && i !== 0) continue;
        g += '<text class="ax" x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? 'start' : 'middle') + '">' + esc(xl(i)) + '</text>';
      }
      g += '<text class="ax" x="' + x(n - 1) + '" y="' + (H - 8) + '" text-anchor="end">' + esc(xl(n - 1)) + '</text>';
      // séries: desenha a referência primeiro e a principal por cima
      cfg.series.slice().reverse().forEach((s) => {
        let d = '', last = -1, first = -1;
        s.values.forEach((v, i) => { if (v == null) return; d += (last === i - 1 && last > -1 ? 'L' : 'M') + x(i) + ',' + y(v); if (first < 0) first = i; last = i; });
        if (!d) return;
        if (s.area && last > first) g += '<path d="' + d + 'L' + x(last) + ',' + y(0) + 'L' + x(first) + ',' + y(0) + 'Z" style="fill:var(--s1-wash)"/>';
        g += '<path d="' + d + '" fill="none" style="stroke:' + s.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
        // ponto sem vizinhos (dias sem lançamento dos dois lados) não forma linha: desenha um ponto
        s.values.forEach((v, i) => {
          if (v == null || (i > 0 && s.values[i - 1] != null) || (i < n - 1 && s.values[i + 1] != null) || (s.end && i === last)) return;
          g += '<circle class="lone" cx="' + x(i) + '" cy="' + y(v) + '" r="3" style="fill:' + s.color + '"/>';
        });
        if (s.end && last > -1) {
          const v = s.values[last];
          g += '<circle cx="' + x(last) + '" cy="' + y(v) + '" r="4" style="fill:' + s.color + ';stroke:var(--surface)" stroke-width="2"/>';
          const anchor = x(last) > M.l + iw * 0.75 ? 'end' : 'start';
          g += '<text class="ax-end" x="' + (x(last) + (anchor === 'end' ? -8 : 8)) + '" y="' + (y(v) - 10) + '" text-anchor="' + anchor + '">' + esc(fa(v)) + '</text>';
        }
      });
      g += '<g class="hover" pointer-events="none"></g><rect data-xchart="' + id + '" x="' + M.l + '" y="' + M.t + '" width="' + iw + '" height="' + ih + '" fill="transparent"/>';
      el.innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(cfg.aria || 'Gráfico de linha: faturamento acumulado no período') + '">' + g + '</svg>';
      this._charts[id] = { x, y, n, cfg, M, H, iw };
    },

    _chartHover(rect, e) {
      const ch = this._charts && this._charts[rect.dataset.xchart];
      if (!ch) return;
      const svg = rect.ownerSVGElement, box = svg.getBoundingClientRect();
      const i = clamp(Math.round((e.clientX - box.left - ch.M.l) / (ch.iw / (ch.n - 1))), 0, ch.n - 1);
      const hg = svg.querySelector('.hover');
      let g = '<line x1="' + ch.x(i) + '" x2="' + ch.x(i) + '" y1="' + ch.M.t + '" y2="' + (ch.H - ch.M.b) + '" style="stroke:var(--axis)" stroke-width="1"/>';
      const rows = [];
      ch.cfg.series.forEach((s) => {
        const v = s.values[i];
        rows.push({ color: s.color, value: v == null ? '—' : (ch.cfg.tipFmt || F.money)(v), label: s.name + (s.dates && s.dates[i] ? ' (até ' + D.fmtShort(s.dates[i]) + ')' : '') + (s.notes && s.notes[i] ? ' (' + s.notes[i] + ')' : '') });
        if (v != null) g += '<circle cx="' + ch.x(i) + '" cy="' + ch.y(v) + '" r="4" style="fill:' + s.color + ';stroke:var(--surface)" stroke-width="2"/>';
      });
      const a = ch.cfg.series[0].values[i], b = ch.cfg.series[1] && ch.cfg.series[1].values[i];
      if (a != null && b && ch.cfg.ratioLabel !== false) rows.push({ value: F.pct(a / b), label: ch.cfg.ratioLabel || 'da meta acumulada' });
      hg.innerHTML = g;
      this._hoverChart = hg;
      const dt = ch.cfg.labels[i];
      this._showTip(tipHTML(ch.cfg.heads ? ch.cfg.heads[i] : D.dowLong(dt) + ', ' + D.fmt(dt), rows), e.clientX, e.clientY);
    },
    _chartLeave() { if (this._hoverChart) this._hoverChart.innerHTML = ''; this._hoverChart = null; },

    _columnChart(el, pts) {
      const n = pts.length;
      if (!n) { el.innerHTML = ''; return; }
      const W = Math.max(260, Math.floor(el.clientWidth)), H = 240, M = { l: 62, r: 8, t: 20, b: 28 };
      const iw = W - M.l - M.r, ih = H - M.t - M.b;
      const maxV = Math.max.apply(null, pts.map((p) => p.value).concat([0]));
      const sc = niceScale(maxV);
      const y = (v) => f1(M.t + ih - (v / sc.max) * ih);
      const band = iw / n, bw = Math.max(2, Math.min(24, band * 0.62));
      let g = '';
      for (let v = 0; v <= sc.max + sc.step / 1e6; v += sc.step) {
        g += '<line class="' + (v === 0 ? 'baseline' : 'gridline') + '" x1="' + M.l + '" x2="' + (W - M.r) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
          (sc.empty && v > 0 ? '' : '<text class="ax" x="' + (M.l - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + esc(F.moneyShort(v)) + '</text>');
      }
      const iMax = maxV > 0 ? pts.findIndex((p) => p.value === maxV) : -1;
      pts.forEach((p, i) => {
        const x0 = f1(M.l + i * band + (band - bw) / 2), h = (p.value / sc.max) * ih;
        const tip = tipHTML(p.head, [{ color: 'var(--s1)', rect: true, value: F.money(p.value), label: 'faturado' }, { value: String(p.count), label: p.count === 1 ? 'venda' : 'vendas' }]);
        g += '<g class="mark" data-tip="' + esc(tip) + '"><rect class="mark-hit" x="' + f1(M.l + i * band) + '" y="' + M.t + '" width="' + f1(band) + '" height="' + ih + '"/>' +
          (h > 0 ? '<path class="bar" d="' + barPath(x0, y(p.value), f1(bw), f1(h), 4) + '" style="fill:var(--s1)"/>' : '') + '</g>';
        if (i === iMax) {
          const cx = x0 + bw / 2, anchor = cx < M.l + 30 ? 'start' : cx > W - M.r - 30 ? 'end' : 'middle';
          g += '<text class="ax-end" x="' + f1(anchor === 'start' ? x0 : anchor === 'end' ? x0 + bw : cx) + '" y="' + (y(p.value) - 6) + '" text-anchor="' + anchor + '" pointer-events="none">' + esc(F.moneyShort(p.value)) + '</text>';
        }
      });
      const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 52))));
      for (let i = 0; i < n; i += every) g += '<text class="ax" x="' + f1(M.l + i * band + band / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(pts[i].label) + '</text>';
      el.innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Gráfico de colunas: faturamento por período">' + g + '</svg>';
    },
  };

  Object.assign(ACT, {
    'painel-refresh'() { return this.refresh(); },
    /** ⓘ dos indicadores (v1.11): no toque/Enter mostra a definição junto do botão; outro clique ou Esc fecha. */
    'kpi-info'(el) {
      const open = el.getAttribute('aria-expanded') === 'true';
      this._shell.querySelectorAll('.kpi-info[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
      if (open) { this._hideTip(); return; }
      const b = el.getBoundingClientRect();
      el.setAttribute('aria-expanded', 'true');
      this._showTip(el.getAttribute('data-tip'), b.left, b.bottom - 6);
    },
    'goto-products'() { this._cs().sub = 'products'; return this.go('cadastros'); },
  });

  // ---------------- Aba Tendências (v1.5): o mesmo dinheiro do Painel, ao longo do tempo ----------------
  const UNIT_NAME = { day: ['dia', 'dias'], week: ['semana', 'semanas'], month: ['mês', 'meses'] };
  const TendenciasView = {
    _ts() { if (!this.ui.tendencias) this.ui.tendencias = { unit: null }; return this.ui.tendencias; },
    async _renderTendencias(tok) {
      if (!this._view.querySelector('[data-ref=trends]')) this._view.innerHTML = '<div class="loading-bar"></div>'; else this._busy();
      const st = this._ts();
      // Primeira venda da base: lida uma vez (GET /sales sem período) e guardada até alguma venda mudar.
      const firstOf = (all) => { st.first = all.reduce((m, x) => (!m || x.date < m ? x.date : m), null); st.firstFor = this.store; };
      let need = st.firstFor !== this.store;
      if (need && this._period('tendencias').preset === 'all') { // "Desde a primeira venda" precisa dela antes do período
        const all = await this.store.fetchAll('sales');
        if (this._stale(tok)) return;
        firstOf(all); need = false;
      }
      const r = this._range('tendencias');
      // Diário do período: só faz diferença para produto arquivado, exibido nas metas e com meta (mesma lista do Painel)
      const needDaily = this.store.list('products', { all: true }).some((p) => p.active === false && p.show_in_goals !== false && this.store.goalRecords('product', p.id).length);
      const res = await Promise.all([this.store.fetchRange('sales', r.prevFrom, r.to), need ? this.store.fetchAll('sales') : null, needDaily ? this.store.fetchRange('daily_entries', r.from, r.to) : null]);
      if (this._stale(tok)) return;
      const sales = res[0];
      if (need) firstOf(res[1]);
      const unit = st.unit === 'day' && D.span(r.from, r.to) > 62 ? null : st.unit; // por dia só até 62 dias
      this._trend = computeTrends(this.store, sales, r, { unit, weekStart: this.store.settings.week_start, firstSale: st.first, daily: res[2] || [] });
      this._view.innerHTML = this._trendsHTML(this._trend);
      this._lastW = this._view.clientWidth;
      this._drawTrends();
    },

    _trendsHTML(t) {
      const r = t.range, c = t.compare, st = this._ts(), un = UNIT_NAME[t.unit];
      const longo = D.span(r.from, r.to) > 62;
      const ub = (u, l) => '<button type="button" class="' + (t.unit === u ? 'on' : '') + '" data-act="tr-unit" data-unit="' + u + '" aria-pressed="' + (t.unit === u) + '"' +
        (u === 'day' && longo ? ' disabled title="Por dia só em períodos de até 62 dias"' : '') + '>' + l + '</button>';
      const nb = t.buckets.length;
      let h = '<div data-ref="trends"><div class="toolbar">' + this._periodChip('tendencias') +
        '<div class="subnav" role="group" aria-label="Agrupar por" style="margin:0">' + ub('day', 'Dia') + ub('week', 'Semana') + ub('month', 'Mês') + '</div>' +
        '<span class="range-note">' + nb + ' ' + (nb === 1 ? un[0] : un[1]) + (st.unit && st.unit === t.unit ? '' : ' (automático)') + '</span><span class="spacer"></span>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="painel-refresh">' + ICON.refresh + 'Atualizar</button></div>';
      if (t.status === 'nosales') return h + '<div class="card"><div class="empty"><strong>Nenhuma venda registrada ainda.</strong>Os gráficos aparecem assim que houver vendas na aba Vendas.</div></div></div>';
      if (t.status === 'before') {
        return h + '<div class="card"><div class="empty"><strong>Ainda não havia vendas registradas neste período.</strong>A primeira venda registrada no painel é de ' + D.fmt(t.firstSale) + '.<br><br>' +
          '<button type="button" class="btn btn-primary btn-sm" data-act="tr-since" data-from="' + t.firstSale + '">Ver desde a primeira venda</button></div></div></div>';
      }
      if (t.trimmed) h += '<div class="note" data-ref="tr-note" style="margin-bottom:16px">' + ICON.info + '<span>A primeira venda registrada no painel é de <b>' + D.fmt(t.firstSale) + '</b>: ' + (t.trimmed === 1 ? un[0] === 'mês' ? 'o mês' : 'a ' + un[0] : (un[0] === 'mês' ? 'os ' : 'as ') + t.trimmed + ' ' + un[1]) + ' antes disso não ' + (t.trimmed === 1 ? 'aparece' : 'aparecem') + ' (o painel ainda não era usado, então não é "0% da meta").</span></div>';
      const per = (b) => (t.unit === 'month' ? b.head : D.fmt(b.from) + (b.from !== b.to ? ' – ' + D.fmt(b.to) : ''));
      const andamento = t.buckets.some((b) => b.partial);

      // ---------- A) faturamento × meta ----------
      const legA = t.hasGoals
        ? '<div class="legend"><span><i class="key-rect" style="background:var(--s1)"></i>' + (t.hasGeneral ? 'Faturado com meta' : 'Faturado nos produtos com meta') + '</span><span><i class="key-line" style="background:var(--ink-2)"></i>Meta ' + (t.unit === 'month' ? 'do mês' : t.unit === 'week' ? 'da semana' : 'do dia') + '</span></div>' +
          (t.hasGeneral ? '<div class="chart-sub" data-ref="tr-general">Antes das metas por produto vale a meta geral, comparada com todas as vendas (marcado como "meta geral" na tabela)</div>' : '')
        : '';
      const genPill = (b) => (b.general ? ' <span class="pill info" title="' + (b.general.only ? 'Meta geral: todas as vendas' : 'Parte do período na meta geral (' + b.general.days + (b.general.days === 1 ? ' dia' : ' dias') + ')') + '">' + (b.general.only ? 'meta geral' : 'parte meta geral') + '</span>' : '');
      const rowsA = t.buckets.map((b) => '<tr' + (b.future ? ' class="archived"' : '') + '><td class="nowrap">' + esc(per(b)) + (b.partial ? ' <span class="pill">em andamento</span>' : '') + genPill(b) + '</td><td class="num">' + (b.future ? '—' : b.count) + '</td>' +
        '<td class="num">' + (b.future ? '—' : esc(F.money(b.revenue))) + '</td><td class="num">' + (b.future ? '—' : esc(F.money0(b.avg))) + '</td>' +
        (t.hasGoals ? '<td class="num">' + (b.future ? '—' : esc(F.money(b.goalRevenue))) + '</td><td class="num">' + (b.goal != null ? esc(F.money0(b.goal)) : '<span class="muted">—</span>') + '</td><td>' + (b.future ? '<span class="muted">—</span>' : meterCell(b.pct, b.status, this.store.settings)) + '</td>' : '') + '</tr>').join('');
      h += '<div class="card" data-card="tr-goal"><div class="card-head"><div><h3>' + (t.hasGoals ? 'Faturamento × meta por ' : 'Faturamento por ') + un[0] + '</h3><p class="sub">' +
        (t.hasGoals ? 'Mesma regra do Painel: vendas de funil contam para o funil de origem; de outras origens, para o produto vendido · meta proporcional aos dias' + (andamento ? ' · o período em andamento é comparado com a meta até hoje' : '')
          : 'Nenhum produto com meta neste período: todas as vendas registradas') + '</p></div></div>' + legA +
        '<div class="chart" data-chart="tr-goal"></div>' +
        '<details class="more"><summary>Ver números por ' + un[0] + ' ' + ICON.chevron + '</summary><div class="tbl-wrap scroll-y"><table class="tbl"><thead><tr><th>' + (t.unit === 'month' ? 'Mês' : t.unit === 'week' ? 'Semana' : 'Dia') + '</th><th class="num">Vendas</th><th class="num">Faturado</th><th class="num">Ticket</th>' +
        (t.hasGoals ? '<th class="num">Faturado (c/ meta)</th><th class="num">Meta</th><th>Atingido</th>' : '') + '</tr></thead><tbody>' + rowsA + '</tbody></table></div></details></div>';

      // ---------- B/C) vendas e ticket ----------
      h += '<div class="card" data-card="tr-sales"><div class="card-head"><div><h3>Vendas e ticket médio por ' + un[0] + '</h3><p class="sub">Todas as vendas registradas</p></div></div>' +
        '<div class="charts-2"><div><div class="chart-title">Nº de vendas</div><div class="chart" data-chart="tr-count"></div></div><div><div class="chart-title">Ticket médio</div><div class="chart" data-chart="tr-avg"></div></div></div></div>';

      // ---------- D) por produto ----------
      const ps = t.products;
      h += '<div class="card" data-card="tr-prod"><div class="card-head"><div><h3>Por produto</h3><p class="sub">Faturamento por ' + un[0] + ' em cada produto, todos na mesma escala · traço = meta · mesma regra de atribuição do Painel' + (t.hasGeneral ? ' · a meta geral não é dividida por produto' : '') + '</p></div></div>';
      if (!ps.length) h += '<div class="empty">Nenhum produto com vendas ou meta neste período.</div>';
      else {
        h += '<div class="mini-grid">' + ps.map((p) => '<div class="mini" data-product="' + esc(p.id) + '"><div class="mini-head"><span class="strong" title="' + esc(p.name) + '">' + esc(p.name) + '</span>' + (p.active ? '' : '<span class="pill">arquivado</span>') +
          '<span class="spacer"></span><span class="small ink2">' + esc(F.money0(p.total)) + (p.pct != null ? ' · ' + esc(F.pct(p.pct)) + ' da meta' : p.hasGoal ? '' : ' · sem meta') + '</span></div><div class="chart" data-mini="' + esc(p.id) + '"></div></div>').join('') + '</div>';
        h += '<details class="more"><summary>Ver números por produto ' + ICON.chevron + '</summary><div class="tbl-wrap scroll-y"><table class="tbl"><thead><tr><th>Produto</th>' + t.buckets.map((b) => '<th class="num" title="' + esc(b.head) + '">' + esc(b.label) + '</th>').join('') + '<th class="num">Total</th><th class="num">Meta até hoje</th></tr></thead><tbody>' +
          ps.map((p) => '<tr><td class="strong">' + esc(p.name) + '</td>' + p.values.map((v, i) => '<td class="num">' + (t.buckets[i].future ? '—' : esc(F.money0(v))) + '</td>').join('') + '<td class="num strong">' + esc(F.money0(p.total)) + '</td><td class="num">' + (p.goalSoFar != null ? esc(F.money0(p.goalSoFar)) : '<span class="muted">—</span>') + '</td></tr>').join('') +
          '</tbody></table></div></details>';
      }
      if (t.hiddenProducts.length) h += '<p class="small muted" style="margin-top:8px">' + ICON.eyeOff.replace('width="16" height="16"', 'width="12" height="12"') + ' Ocultos nas metas (fora deste cartão): ' + esc(t.hiddenProducts.join(', ')) + '.</p>';
      h += '</div>';

      // ---------- F) este período × anterior ----------
      h += '<div class="card" data-card="tr-cmp"><div class="card-head"><div><h3>Este período × anterior</h3><p class="sub">Faturamento acumulado dia a dia, comparado com ' + D.fmt(r.prevFrom) + ' – ' + D.fmt(r.prevTo) + ' (dia 1 com dia 1) · todas as vendas</p></div></div>';
      if (c.now == null) h += '<div class="empty">Este período ainda não começou.</div></div>';
      else if (c.noPrev) {
        h += '<p class="trend-head" data-ref="tr-cmp-head"><span><b>' + esc(F.money(c.now)) + '</b> até ' + D.fmt(c.nowDate) + '</span></p>' +
          '<div class="note" style="margin-bottom:10px" data-ref="tr-noprev">' + ICON.info + '<span>Sem comparação: o período anterior (' + D.fmt(r.prevFrom) + ' – ' + D.fmt(r.prevTo) + ') começa antes da primeira venda registrada (' + D.fmt(t.firstSale) + '), então não há um período anterior completo para comparar.</span></div>' +
          '<div class="legend"><span><i class="key-line" style="background:var(--s1)"></i>Este período</span></div><div class="chart" data-chart="tr-cmp"></div></div>';
      } else {
        const dl = deltaHTML(c.now, c.prevSame, { money: true });
        h += '<p class="trend-head" data-ref="tr-cmp-head"><span><b>' + esc(F.money(c.now)) + '</b> até ' + D.fmt(c.nowDate) + '</span><span>· no mesmo ponto do anterior (até ' + D.fmt(c.prevSameDate) + '): <b>' + esc(F.money(c.prevSame)) + '</b></span>' + (dl || '') +
          '<span class="small">· período anterior inteiro: ' + esc(F.money(c.prevTotal)) + '</span></p>' +
          '<div class="legend"><span><i class="key-line" style="background:var(--s1)"></i>Este período</span><span><i class="key-line" style="background:var(--ref)"></i>Período anterior</span></div><div class="chart" data-chart="tr-cmp"></div></div>';
      }
      return h + '</div>';
    },

    _drawTrends() {
      const t = this._trend;
      if (!t || this.tab !== 'tendencias') return;
      this._charts = {};
      const q = (sel) => this._view.querySelector(sel);
      const B = t.buckets;
      const st = (b) => (b.status && STATUS[b.status] ? STATUS[b.status][0] : '');
      let el = q('[data-chart=tr-goal]');
      if (el) {
        this._barsChart(el, {
          money: true, pctLabels: t.hasGoals, aria: t.hasGoals ? 'Gráfico de colunas: faturamento e meta por período' : 'Gráfico de colunas: faturamento por período',
          pts: B.map((b) => ({
            label: b.label, future: b.future, partial: b.partial, pct: b.pct,
            value: b.future ? null : t.hasGoals ? b.goalRevenue : b.revenue, goal: t.hasGoals ? b.goal : null,
            tip: tipHTML(b.head + (b.partial ? ' (em andamento)' : b.future ? ' (ainda não aconteceu)' : ''), (t.hasGoals
              ? [{ color: 'var(--s1)', rect: true, value: b.future ? '—' : F.money(b.goalRevenue), label: b.general ? (b.general.only ? 'faturado (todas as vendas)' : 'faturado com meta') : 'faturado nos produtos com meta' },
                { color: 'var(--ink-2)', value: b.goal != null ? F.money(b.goal) : '—', label: b.general ? (b.general.only ? 'meta geral' : 'meta (' + F.money0(b.general.goal) + ' da meta geral)') : 'meta' }]
                .concat(b.partial && b.goal != null ? [{ value: F.money(b.goalToDate), label: 'meta até hoje' }] : [])
                .concat(b.pct != null ? [{ value: F.pct(b.pct), label: 'atingido · ' + st(b) }] : [])
              : [{ color: 'var(--s1)', rect: true, value: b.future ? '—' : F.money(b.revenue), label: 'faturado' }])
              .concat(b.future ? [] : [{ value: String(b.count), label: (b.count === 1 ? 'venda' : 'vendas') + ' · total ' + F.money(b.revenue) }])),
          })),
        });
      }
      el = q('[data-chart=tr-count]');
      if (el) this._barsChart(el, { money: false, aria: 'Gráfico de colunas: número de vendas por período', pts: B.map((b) => ({ label: b.label, partial: b.partial, value: b.future ? null : b.count, tip: tipHTML(b.head, [{ color: 'var(--s1)', rect: true, value: b.future ? '—' : String(b.count), label: b.count === 1 ? 'venda' : 'vendas' }]) })) });
      el = q('[data-chart=tr-avg]');
      if (el) this._barsChart(el, { money: true, aria: 'Gráfico de colunas: ticket médio por período', pts: B.map((b) => ({ label: b.label, partial: b.partial, value: b.future ? null : b.avg, tip: tipHTML(b.head, [{ color: 'var(--s1)', rect: true, value: b.avg == null ? '—' : F.money(b.avg), label: 'ticket médio' }, { value: b.future ? '—' : String(b.count), label: b.count === 1 ? 'venda' : 'vendas' }]) })) });
      // mini-gráficos por produto, todos na mesma escala
      const max = Math.max.apply(null, t.products.map((p) => Math.max.apply(null, p.values.concat(p.goals.map((g) => g || 0)))).concat([0]));
      t.products.forEach((p) => {
        const m = Array.from(this._view.querySelectorAll('[data-mini]')).find((x) => x.dataset.mini === p.id);
        if (!m) return;
        this._barsChart(m, {
          money: true, compact: true, height: 120, max, aria: 'Faturamento por período: ' + p.name,
          pts: B.map((b, i) => ({
            label: b.label, future: b.future, partial: b.partial, value: b.future ? null : p.values[i], goal: p.goals[i],
            tip: tipHTML(p.name + ' · ' + b.head, [{ color: 'var(--s1)', rect: true, value: b.future ? '—' : F.money(p.values[i]), label: 'faturado' }, { color: 'var(--ink-2)', value: p.goals[i] != null ? F.money(p.goals[i]) : 'sem meta', label: p.goals[i] != null ? 'meta' : '' }]
              .concat(!b.future && p.goals[i] ? [{ value: F.pct(p.goalValues[i] / (b.partial ? p.goalsToDate[i] || p.goals[i] : p.goals[i])), label: (b.partial ? 'da meta até hoje' : 'da meta') + (p.goalValues[i] !== p.values[i] ? ' (dias com meta: ' + F.money0(p.goalValues[i]) + ')' : '') }] : [])),
          })),
        });
      });
      el = q('[data-chart=tr-cmp]');
      const c = t.compare;
      if (el && c) {
        this._lineChart(el, 'tr-cmp', {
          labels: c.dates, ratioLabel: 'do período anterior no mesmo ponto', aria: 'Gráfico de linha: faturamento acumulado deste período e do anterior',
          series: [{ name: 'Este período', color: 'var(--s1)', area: true, end: true, values: c.cur }].concat(c.noPrev ? [] : [{ name: 'Período anterior', color: 'var(--ref)', values: c.prev, dates: c.prevDates }]),
        });
      }
    },

    /**
     * Colunas com meta opcional (traço sobre a coluna). cfg: { pts: [{ label, value, goal?, pct?, future?, partial?, tip }],
     * money, max (escala compartilhada), height, compact, pctLabels (rótulo de % acima, se couber), aria }.
     */
    _barsChart(el, cfg) {
      const pts = cfg.pts, n = pts.length;
      if (!n) { el.innerHTML = ''; return; }
      const compact = !!cfg.compact;
      const W = Math.max(compact ? 200 : 260, Math.floor(el.clientWidth)), H = cfg.height || 220;
      const M = { l: compact ? 46 : 62, r: 8, t: cfg.pctLabels ? 22 : 14, b: 24 };
      const iw = W - M.l - M.r, ih = H - M.t - M.b;
      const fmt = cfg.money ? F.moneyShort : (v) => F.int(v);
      const maxV = cfg.max != null ? cfg.max : Math.max.apply(null, pts.map((p) => Math.max(p.value || 0, p.goal || 0)).concat([0]));
      let sc = niceScale(maxV, compact ? 2 : 4);
      // contagens (nº de vendas): só marcas inteiras no eixo (senão 0,25 vira "0" e 0,75 vira "1")
      if (!cfg.money && !sc.empty) {
        const step = Math.max(1, Math.ceil(sc.step));
        sc = { max: Math.max(step, Math.ceil(maxV / step) * step), step };
      }
      const y = (v) => f1(M.t + ih - (v / sc.max) * ih);
      const band = iw / n, bw = Math.max(2, Math.min(compact ? 18 : 28, band * 0.62));
      let g = '';
      for (let v = 0; v <= sc.max + sc.step / 1e6; v += sc.step) {
        g += '<line class="' + (v === 0 ? 'baseline' : 'gridline') + '" x1="' + M.l + '" x2="' + (W - M.r) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
          (sc.empty && v > 0 ? '' : '<text class="ax" x="' + (M.l - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + esc(fmt(v)) + '</text>');
      }
      const showPct = cfg.pctLabels && n <= 16 && band >= 34;
      pts.forEach((p, i) => {
        const x0 = f1(M.l + i * band + (band - bw) / 2), h = p.value > 0 ? (p.value / sc.max) * ih : 0;
        let mk = '<g class="mark" data-tip="' + esc(p.tip || '') + '"><rect class="mark-hit" x="' + f1(M.l + i * band) + '" y="' + M.t + '" width="' + f1(band) + '" height="' + ih + '"/>';
        if (h > 0) mk += '<path class="bar" d="' + barPath(x0, y(p.value), f1(bw), f1(h), compact ? 3 : 4) + '" style="fill:var(--s1)' + (p.partial ? ';opacity:.55' : '') + '"/>';
        if (p.goal > 0) {
          const gy = y(p.goal), x1 = f1(x0 - 4), x2 = f1(x0 + bw + 4);
          mk += '<line x1="' + x1 + '" x2="' + x2 + '" y1="' + gy + '" y2="' + gy + '" style="stroke:var(--surface)" stroke-width="5" stroke-linecap="round"/>' +
            '<line class="goal-tick" x1="' + x1 + '" x2="' + x2 + '" y1="' + gy + '" y2="' + gy + '" style="stroke:var(--ink-2)" stroke-width="2" stroke-linecap="round"' + (p.future ? ' stroke-dasharray="3 3"' : '') + '/>';
        }
        g += mk + '</g>';
        if (showPct && p.pct != null) {
          const top = Math.min(p.value > 0 ? y(p.value) : M.t + ih, p.goal > 0 ? y(p.goal) : M.t + ih);
          g += '<text class="ax-end" x="' + f1(x0 + bw / 2) + '" y="' + f1(top - 6) + '" text-anchor="middle" pointer-events="none">' + esc(F.pct(p.pct)) + '</text>';
        }
      });
      const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / (compact ? 44 : 52)))));
      for (let i = 0; i < n; i += every) g += '<text class="ax" x="' + f1(M.l + i * band + band / 2) + '" y="' + (H - 7) + '" text-anchor="middle">' + esc(pts[i].label) + '</text>';
      el.innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(cfg.aria || 'Gráfico de colunas') + '">' + g + '</svg>';
    },
  };

  Object.assign(ACT, {
    'tr-unit'(el) { this._ts().unit = el.dataset.unit; this._busy(); return this.render(); },
    'tr-since'() { this.periods.tendencias = { preset: 'all' }; return this._onPeriodChange('tendencias'); }, // "Desde a primeira venda" (v1.6)
  });

  // ==========================================================================
  // 7. ABA VENDAS (lançamento manual, histórico)
  // ==========================================================================
  const SALE_FIELDS = ['date', 'lead_name', 'product_id', 'amount', 'seller_id', 'origin_id'];

  const VendasView = {
    _vs() {
      if (!this.ui.vendas) this.ui.vendas = { sub: 'lancar', rows: [this._newSaleRow()], hist: { q: '', product_id: '', seller_id: '', origin_id: '', limit: 200 }, histRows: [] };
      return this.ui.vendas;
    },
    _newSaleRow(base) {
      return { k: uid(), date: (base && base.date) || D.today(), lead_name: '', product_id: '', amount: '', seller_id: (base && base.seller_id) || '', origin_id: '', err: {} };
    },
    _subnav(items, cur, act) {
      return '<div class="subnav" role="tablist">' + items.map((x) => '<button type="button" role="tab" aria-selected="' + (x[0] === cur) + '" class="' + (x[0] === cur ? 'on' : '') + '" data-act="' + act + '" data-sub="' + x[0] + '">' + esc(x[1]) + '</button>').join('') + '</div>';
    },

    async _renderVendas(tok) {
      const st = this._vs();
      const nav = this._subnav([['lancar', 'Lançar vendas'], ['importar', 'Importar arquivo'], ['historico', 'Histórico']], st.sub, 'vendas-sub');
      if (st.sub === 'lancar') { this._view.innerHTML = nav + this._salesGridCard(); return; }
      if (st.sub === 'importar') { this._view.innerHTML = nav + this._importHTML('sales'); return; }
      const r = this._range('vendas');
      if (!this._view.querySelector('[data-ref=hist-body]')) this._view.innerHTML = nav + '<div class="loading-bar"></div>';
      else this._busy();
      const rows = await this.store.fetchRange('sales', r.from, r.to);
      if (this._stale(tok)) return;
      st.histRows = rows.sort((a, b) => b.date.localeCompare(a.date) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
      this._view.innerHTML = nav + this._salesHistHTML();
    },

    // ---------------- grade de lançamento ----------------
    _salesGridCard() {
      return '<div class="card"><div class="card-head"><div><h3>Lançar vendas</h3><p class="sub">Uma linha por venda. Os seletores podem ganhar itens novos na hora ("+ Adicionar novo…") e a engrenagem abre a lista para editar.</p></div></div>' +
        '<div class="sales-grid">' + this._salesGridHTML() + '</div>' +
        '<div class="note" style="margin-top:14px">' + ICON.info + '<span>Atalho: copie linhas do Excel nas colunas <b>Data, Nome da Lead, Produto, Valor, Vendedor, Origem da Lead</b> e cole em qualquer campo da grade — elas abrem no importador para conferência. <b>Ctrl+Enter</b> salva.</span></div></div>';
    },
    _salesGridHTML() {
      const st = this._vs();
      const th = (label, c) => '<th>' + label + (c ? ' <span class="th-tools"><button type="button" class="icon-btn" data-act="manage" data-c="' + c + '" title="Gerenciar lista" aria-label="Gerenciar lista: ' + label + '">' + ICON.gear + '</button></span>' : '') + '</th>';
      const cls = (r, f) => 'inp' + (r.err[f] ? ' err' : '');
      let rows = '';
      st.rows.forEach((r, i) => {
        rows += '<tr data-k="' + r.k + '"><td class="idx">' + (i + 1) + '</td>' +
          '<td style="min-width:140px"><input class="' + cls(r, 'date') + '" type="date" placeholder="dd/mm/aaaa" value="' + esc(r.date) + '" data-inp="sale-cell" data-f="date" aria-label="Data"></td>' +
          '<td style="min-width:200px"><input class="' + cls(r, 'lead_name') + '" value="' + esc(r.lead_name) + '" data-inp="sale-cell" data-f="lead_name" placeholder="Nome da lead" autocomplete="off" aria-label="Nome da lead"></td>' +
          '<td style="min-width:170px"><select class="' + cls(r, 'product_id') + '" data-chg="sale-cell" data-f="product_id" aria-label="Produto">' + this._options('products', r.product_id, { allowNew: true }) + '</select></td>' +
          '<td style="min-width:120px"><input class="' + cls(r, 'amount') + ' inp-money" inputmode="decimal" value="' + esc(r.amount) + '" data-inp="sale-cell" data-f="amount" placeholder="0,00" autocomplete="off" aria-label="Valor"></td>' +
          '<td style="min-width:150px"><select class="' + cls(r, 'seller_id') + '" data-chg="sale-cell" data-f="seller_id" aria-label="Vendedor">' + this._options('sellers', r.seller_id, { allowNew: true }) + '</select></td>' +
          '<td style="min-width:170px"><select class="' + cls(r, 'origin_id') + '" data-chg="sale-cell" data-f="origin_id" aria-label="Origem da lead">' + this._options('origins', r.origin_id, { allowNew: true }) + '</select></td>' +
          '<td class="actions"><button type="button" class="icon-btn" data-act="sale-dup" title="Duplicar linha" aria-label="Duplicar linha">' + ICON.copy + '</button><button type="button" class="icon-btn danger" data-act="sale-del" title="Remover linha" aria-label="Remover linha">' + ICON.trash + '</button></td></tr>';
      });
      return '<div class="tbl-wrap"><table class="tbl grid-edit" data-grid="sales"><thead><tr><th></th>' + th('Data') + th('Nome da Lead') + th('Produto', 'products') + th('Valor (R$)') + th('Vendedor', 'sellers') + th('Origem da Lead', 'origins') + '<th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<div class="grid-foot"><button type="button" class="btn btn-sm" data-act="sale-add">' + ICON.plus + 'Linha</button><button type="button" class="btn btn-sm btn-ghost" data-act="sale-add" data-n="5">+5 linhas</button><span class="spacer"></span>' +
        '<span class="small ink2" data-ref="sale-summary">' + this._saleSummary() + '</span><button type="button" class="btn btn-ghost" data-act="sale-clear">Limpar</button><button type="button" class="btn btn-primary" data-act="sale-save">' + ICON.save + 'Salvar vendas</button></div>';
    },
    _saleBlank(r) { return !r.lead_name.trim() && !r.product_id && !String(r.amount).trim() && !r.origin_id; },
    _saleSummary() {
      const rows = this._vs().rows.filter((r) => !this._saleBlank(r));
      const total = sum(rows, (r) => parseMoney(r.amount) || 0);
      return rows.length ? rows.length + (rows.length === 1 ? ' venda' : ' vendas') + ' · ' + F.money(total) : 'Nenhuma venda preenchida';
    },
    _redrawSalesGrid(focusK, focusF) {
      const box = this._view.querySelector('.sales-grid');
      if (!box) return;
      box.innerHTML = this._salesGridHTML();
      if (focusK) { const el = box.querySelector('tr[data-k="' + focusK + '"] [data-f="' + (focusF || 'lead_name') + '"]'); if (el) el.focus(); }
    },
    _saleRowOf(el) { const tr = el.closest('tr[data-k]'); return tr ? this._vs().rows.find((r) => r.k === tr.dataset.k) : null; },

    async _saveSales() {
      const st = this._vs(), s = this.store;
      const rows = st.rows.filter((r) => !this._saleBlank(r));
      if (!rows.length) { this._toast('Nada para salvar: preencha ao menos uma linha.', 'info'); return; }
      let bad = 0;
      const recs = [];
      rows.forEach((r) => {
        r.err = {};
        const a = parseMoney(r.amount);
        const iso = parseDate(r.date);
        if (!iso) r.err.date = 1;
        if (!r.lead_name.trim()) r.err.lead_name = 1;
        if (!s.get('products', r.product_id)) r.err.product_id = 1;
        if (!(a > 0)) r.err.amount = 1;
        if (!s.get('sellers', r.seller_id)) r.err.seller_id = 1;
        if (!s.get('origins', r.origin_id)) r.err.origin_id = 1;
        if (Object.keys(r.err).length) { bad++; return; }
        recs.push({
          date: iso, lead_name: r.lead_name.trim().replace(/\s+/g, ' '), product_id: s.get('products', r.product_id).id,
          amount: Math.round(a * 100) / 100, seller_id: s.get('sellers', r.seller_id).id, origin_id: s.get('origins', r.origin_id).id, notes: null,
        });
      });
      if (bad) { this._redrawSalesGrid(); this._toast(bad + (bad === 1 ? ' linha com campo' : ' linhas com campos') + ' faltando ou inválido (destacados em vermelho).', 'error'); return; }
      const dates = recs.map((r) => r.date).sort();
      const existing = await s.fetchRange('sales', dates[0], dates[dates.length - 1]);
      const key = (r) => r.date + '|' + norm(r.lead_name) + '|' + Math.round(r.amount * 100);
      const ex = new Set(existing.map(key));
      const dups = recs.filter((r) => ex.has(key(r))).length;
      if (dups && !(await this._confirm(dups + (dups === 1 ? ' venda parece' : ' vendas parecem') + ' já estar registrada(s) (mesma data, lead e valor).\nSalvar mesmo assim?', { ok: 'Salvar mesmo assim' }))) return;
      await s.bulkCreate('sales', recs);
      this._toast(recs.length + (recs.length === 1 ? ' venda salva.' : ' vendas salvas.'));
      const last = st.rows[st.rows.length - 1];
      st.rows = [this._newSaleRow({ date: last.date })];
      this._redrawSalesGrid(st.rows[0].k);
    },

    // ---------------- histórico ----------------
    _salesFiltered() {
      const st = this._vs(), f = st.hist, q = norm(f.q);
      return st.histRows.filter((r) =>
        (!f.product_id || sid(r.product_id) === f.product_id) && (!f.seller_id || sid(r.seller_id) === f.seller_id) && (!f.origin_id || sid(r.origin_id) === f.origin_id) &&
        (!q || norm(r.lead_name).indexOf(q) > -1 || norm(r.notes).indexOf(q) > -1));
    },
    _salesHistHTML() {
      const f = this._vs().hist;
      const sel = (c, field, ph, lbl) => '<select class="inp" style="width:auto;max-width:200px" data-chg="hist-filter" data-f="' + field + '" aria-label="' + ph + '" data-pdf-label="' + lbl + '">' + this._options(c, f[field], { placeholder: ph }).replace(' (arquivado)', '') + '</select>';
      return '<div class="card"><div class="toolbar" style="margin-bottom:12px">' + this._periodChip('vendas') +
        '<input class="inp" style="width:220px" type="search" placeholder="Buscar lead ou observação…" value="' + esc(f.q) + '" data-inp="hist-q" aria-label="Buscar">' +
        sel('products', 'product_id', 'Todos os produtos', 'Produto') + sel('sellers', 'seller_id', 'Todos os vendedores', 'Vendedor') + sel('origins', 'origin_id', 'Todas as origens', 'Origem') +
        '<span class="spacer"></span><button type="button" class="btn btn-sm" data-act="hist-export">' + ICON.download + 'Exportar CSV</button></div>' +
        '<div data-ref="hist-body">' + this._salesHistBody() + '</div></div>';
    },
    _salesHistBody() {
      const st = this._vs(), s = this.store;
      const rows = this._salesFiltered();
      if (!rows.length) return '<div class="empty"><strong>Nenhuma venda encontrada.</strong>Ajuste o período ou os filtros.</div>';
      let b = '';
      rows.slice(0, st.hist.limit).forEach((r) => {
        const op = s.originProductId(r.origin_id);
        const cross = op && op !== sid(r.product_id);
        b += '<tr data-id="' + esc(r.id) + '"><td class="nowrap">' + D.fmt(r.date) + '</td><td>' + esc(r.lead_name) + (r.notes ? ' <span class="muted" title="' + esc(r.notes) + '">' + ICON.info + '</span>' : '') + '</td>' +
          '<td>' + esc(s.name('products', r.product_id)) + '</td><td class="num">' + esc(F.money(r.amount)) + '</td><td>' + esc(s.name('sellers', r.seller_id)) + '</td>' +
          '<td>' + esc(s.name('origins', r.origin_id)) + (cross ? ' <span class="pill info" title="Venda cruzada: produto comprado diferente do funil de origem">cruzada</span>' : '') + (op ? '' : ' <span class="pill warn">fora de funil</span>') + '</td>' +
          '<td class="actions"><button type="button" class="icon-btn" data-act="sale-edit" title="Editar" aria-label="Editar venda">' + ICON.edit + '</button><button type="button" class="icon-btn danger" data-act="sale-remove" title="Excluir" aria-label="Excluir venda">' + ICON.trash + '</button></td></tr>';
      });
      const more = rows.length > st.hist.limit ? '<div style="text-align:center;margin-top:12px"><button type="button" class="btn btn-sm" data-act="hist-more">Mostrar mais (' + (rows.length - st.hist.limit) + ' restantes)</button></div>' : '';
      return '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Data</th><th>Lead</th><th>Produto</th><th class="num">Valor</th><th>Vendedor</th><th>Origem</th><th></th></tr></thead><tbody>' + b +
        '</tbody><tfoot><tr><td colspan="3">' + rows.length + (rows.length === 1 ? ' venda' : ' vendas') + '</td><td class="num">' + esc(F.money(sum(rows, (r) => r.amount))) + '</td><td colspan="3"></td></tr></tfoot></table></div>' + more;
    },
    async _editSale(row) {
      const s = this.store;
      const v = await this._form({
        title: 'Editar venda', ok: 'Salvar alterações',
        fields: [
          { key: 'date', label: 'Data', type: 'date', value: row.date, required: true, placeholder: 'dd/mm/aaaa' },
          { key: 'lead_name', label: 'Nome da lead', value: row.lead_name, required: true },
          { key: 'product_id', label: 'Produto', type: 'select', value: row.product_id, options: this._pairsWithCurrent('products', row.product_id), required: true },
          { key: 'amount', label: 'Valor (R$)', type: 'money', value: F.num(row.amount), required: true },
          { key: 'seller_id', label: 'Vendedor', type: 'select', value: row.seller_id, options: this._pairsWithCurrent('sellers', row.seller_id), required: true },
          { key: 'origin_id', label: 'Origem da lead', type: 'select', value: row.origin_id, options: this._pairsWithCurrent('origins', row.origin_id), required: true },
          { key: 'notes', label: 'Observação', type: 'textarea', value: row.notes || '' },
        ],
        validate: (x) => (!parseDate(x.date) ? 'Data inválida.' : !(parseMoney(x.amount) > 0) ? 'Valor inválido.' : null),
      });
      if (!v) return;
      await s.update('sales', row.id, {
        date: parseDate(v.date), lead_name: v.lead_name, product_id: s.get('products', v.product_id).id, amount: Math.round(parseMoney(v.amount) * 100) / 100,
        seller_id: s.get('sellers', v.seller_id).id, origin_id: s.get('origins', v.origin_id).id, notes: v.notes || null,
      });
      this._toast('Venda atualizada.');
      await this.render();
    },
    _pairsWithCurrent(c, cur) {
      const pairs = [['', 'Selecione…']].concat(this._optionPairs(c));
      if (cur && !pairs.some((p) => sid(p[0]) === sid(cur))) pairs.push([cur, this.store.name(c, cur) + ' (arquivado)']);
      return pairs;
    },
  };

  Object.assign(ACT, {
    'vendas-sub'(el) { this._vs().sub = el.dataset.sub; return this.render(); },
    'sale-add'(el) {
      const st = this._vs(), n = Number(el.dataset.n) || 1, last = st.rows[st.rows.length - 1];
      for (let i = 0; i < n; i++) st.rows.push(this._newSaleRow(last));
      this._redrawSalesGrid(st.rows[st.rows.length - n].k);
    },
    'sale-dup'(el) {
      const st = this._vs(), r = this._saleRowOf(el);
      const copy = Object.assign({}, r, { k: uid(), err: {} });
      st.rows.splice(st.rows.indexOf(r) + 1, 0, copy);
      this._redrawSalesGrid(copy.k);
    },
    'sale-del'(el) {
      const st = this._vs(), r = this._saleRowOf(el);
      st.rows.splice(st.rows.indexOf(r), 1);
      if (!st.rows.length) st.rows.push(this._newSaleRow(r));
      this._redrawSalesGrid();
    },
    async 'sale-clear'() {
      const st = this._vs();
      if (st.rows.some((r) => !this._saleBlank(r)) && !(await this._confirm('Descartar as linhas preenchidas e ainda não salvas?', { ok: 'Descartar', danger: true }))) return;
      st.rows = [this._newSaleRow()];
      this._redrawSalesGrid();
    },
    'sale-save'() { return this._saveSales(); },
    'hist-more'() { this._vs().hist.limit += 200; this._view.querySelector('[data-ref=hist-body]').innerHTML = this._salesHistBody(); },
    'hist-export'() {
      const s = this.store, r = this._range('vendas');
      const rows = [['Data', 'Nome da Lead', 'Produto', 'Valor', 'Vendedor', 'Origem da Lead', 'Observação']].concat(
        this._salesFiltered().map((x) => [D.fmt(x.date), x.lead_name, s.name('products', x.product_id), csvMoney(x.amount), s.name('sellers', x.seller_id), s.name('origins', x.origin_id), x.notes || '']));
      this._download('vendas_' + r.from + '_a_' + r.to + '.csv', toCSV(rows), 'text/csv;charset=utf-8');
    },
    'sale-edit'(el) { const row = this._vs().histRows.find((r) => sid(r.id) === el.closest('tr').dataset.id); if (row) return this._editSale(row); },
    async 'sale-remove'(el) {
      const row = this._vs().histRows.find((r) => sid(r.id) === el.closest('tr').dataset.id);
      if (!row) return;
      if (!(await this._confirm('Excluir a venda de "' + row.lead_name + '" (' + F.money(row.amount) + ', ' + D.fmt(row.date) + ')?\nEssa ação não pode ser desfeita.', { ok: 'Excluir', danger: true }))) return;
      await this.store.remove('sales', row.id);
      this._toast('Venda excluída.');
      await this.render();
    },
    async manage(el) { await this._openManager(el.dataset.c); },
  });
  Object.assign(INP, {
    'sale-cell'(el) {
      const r = this._saleRowOf(el);
      if (!r) return;
      r[el.dataset.f] = el.value;
      if (r.err[el.dataset.f]) { delete r.err[el.dataset.f]; el.classList.remove('err'); }
      const sm = this._view.querySelector('[data-ref=sale-summary]');
      if (sm) sm.textContent = this._saleSummary();
    },
    'hist-q': debounce(function (el) { this._vs().hist.q = el.value; const b = this._view.querySelector('[data-ref=hist-body]'); if (b) b.innerHTML = this._salesHistBody(); }, 200),
  });
  Object.assign(CHG, {
    async 'sale-cell'(el) {
      const r = this._saleRowOf(el);
      if (!r) return;
      const f = el.dataset.f, c = { product_id: 'products', seller_id: 'sellers', origin_id: 'origins' }[f];
      if (!c) return;
      if (el.value === '__new') {
        const item = await this._quickAdd(c);
        r[f] = item ? sid(item.id) : r[f];
      } else r[f] = el.value;
      delete r.err[f];
      if (f === 'origin_id') r.originAuto = false; // escolhida à mão: não muda mais sozinha
      // Origem costuma ser o próprio produto: preenche quando vazia ou quando foi preenchida
      // automaticamente (trocar o produto troca junto; antes ela ficava no funil do primeiro produto).
      if (f === 'product_id' && r.product_id && (!r.origin_id || r.originAuto)) {
        const o = this.store.originByProduct.get(sid(r.product_id));
        if (o) { r.origin_id = sid(o.id); r.originAuto = true; delete r.err.origin_id; }
      }
      this._redrawSalesGrid(r.k, f);
    },
    'hist-filter'(el) {
      this._vs().hist[el.dataset.f] = el.value;
      this._vs().hist.limit = 200;
      this._view.querySelector('[data-ref=hist-body]').innerHTML = this._salesHistBody();
    },
  });

  // ==========================================================================
  // 8. ABA DIÁRIO (o que os agentes fizeram no dia)
  // ==========================================================================
  const DiarioView = {
    _ds() {
      if (!this.ui.diario) this.ui.diario = { sub: 'dia', date: D.today(), rows: [], loadedFor: null, orig: new Map(), dirty: false, histRows: [] };
      return this.ui.diario;
    },
    _newDayRow(o) {
      o = o || {};
      return { k: uid(), id: o.id != null ? o.id : null, product_id: sid(o.product_id), seller_id: sid(o.seller_id), metric_id: sid(o.metric_id), quantity: o.quantity != null ? String(o.quantity).replace('.', ',') : '', err: {} };
    },
    _sortEntries(arr) {
      const s = this.store;
      const ord = (c) => new Map(s.list(c, { all: true }).map((r, i) => [sid(r.id), i]));
      const op = ord('products'), os = ord('sellers'), om = ord('metrics');
      const g = (m, id) => (m.has(sid(id)) ? m.get(sid(id)) : 1e6);
      return arr.slice().sort((a, b) => (g(op, a.product_id) - g(op, b.product_id)) || (g(os, a.seller_id) - g(os, b.seller_id)) || (g(om, a.metric_id) - g(om, b.metric_id)));
    },

    async _renderDiario(tok) {
      const st = this._ds();
      const nav = this._subnav([['dia', 'Preencher dia'], ['agentes', 'Visão por Agente'], ['agdash', 'Dashboard Agentes'], ['renda', 'Renda dos Leads'], ['importar', 'Importar arquivo'], ['historico', 'Histórico']], st.sub, 'diario-sub');
      if (st.sub === 'importar') { this._view.innerHTML = nav + this._importHTML('daily'); return; }
      if (st.sub === 'renda') {
        const r = this._range('renda');
        if (!this._view.querySelector('[data-ref=renda]')) this._view.innerHTML = nav + '<div class="loading-bar"></div>'; else this._busy();
        // Lê o histórico das métricas de renda uma vez ao abrir a sub-aba (o início do acompanhamento depende dele);
        // trocar período ou produto reaproveita o que já foi lido (incKeep).
        const keep = st.incKeep && st.inc;
        st.incKeep = false;
        if (!keep) {
          const cfg = leadIncomeConfig(this.store);
          const ids = new Set(cfg.bands.map((b) => b.id).concat(cfg.unqualified ? [cfg.unqualified.id] : []));
          const rows = ids.size ? await this.store.fetchAll('daily_entries') : [];
          if (this._stale(tok)) return;
          st.inc = rows.filter((x) => ids.has(sid(x.metric_id)));
        }
        const v = computeLeadIncome(this.store, st.inc, r, { product: st.incProduct || '', weekStart: this.store.settings.week_start });
        st.incProduct = v.product;
        this._incView = v;
        this._view.innerHTML = nav + this._rendaHTML(v);
        return;
      }
      if (st.sub === 'agdash') return this._renderAgentDash(tok, nav);
      if (st.sub === 'agentes') {
        const r = this._range('agentes');
        if (!this._view.querySelector('[data-ref=agview]')) this._view.innerHTML = nav + '<div class="loading-bar"></div>'; else this._busy();
        const rows = await this.store.fetchRange('daily_entries', r.from, r.to);
        if (this._stale(tok)) return;
        this._agView = computeAgentView(this.store, rows, r);
        this._view.innerHTML = nav + this._agentViewHTML(this._agView);
        return;
      }
      if (st.sub === 'dia') {
        if (st.loadedFor !== st.date) {
          if (!this._view.querySelector('.day-grid')) this._view.innerHTML = nav + '<div class="loading-bar"></div>'; else this._busy();
          const date = st.date;
          const rows = await this.store.fetchRange('daily_entries', date, date);
          if (this._stale(tok) || st.date !== date) return;
          st.rows = this._sortEntries(rows).map((r) => this._newDayRow(r));
          st.orig = new Map(rows.map((r) => [sid(r.id), r]));
          st.loadedFor = date;
          st.dirty = false;
        }
        this._view.innerHTML = nav + this._dayCard();
        return;
      }
      const r = this._range('diario');
      if (!this._view.querySelector('[data-ref=dhist]')) this._view.innerHTML = nav + '<div class="loading-bar"></div>'; else this._busy();
      const [rows, sales] = await Promise.all([this.store.fetchRange('daily_entries', r.from, r.to), this.store.fetchRange('sales', r.from, r.to)]);
      if (this._stale(tok)) return;
      st.histRows = rows;
      st.histAudit = computeAudit(this.store, sales, rows, r); // null se nenhuma métrica tem "Auditoria" (Cadastros → Métricas)
      this._view.innerHTML = nav + this._dayHistHTML();
    },

    _dayCard() {
      const st = this._ds();
      const presets = this.store.list('presets');
      return '<div class="card"><div class="card-head" style="align-items:center"><div class="day-nav">' +
        '<button type="button" class="icon-btn" data-act="day-shift" data-n="-1" title="Dia anterior" aria-label="Dia anterior">' + ICON.left + '</button>' +
        '<input class="inp" type="date" placeholder="dd/mm/aaaa" value="' + st.date + '" data-chg="day-date" aria-label="Data do lançamento">' +
        '<button type="button" class="icon-btn" data-act="day-shift" data-n="1" title="Próximo dia" aria-label="Próximo dia">' + ICON.right + '</button>' +
        '<span class="ink2" style="margin-left:4px">' + D.dowLong(st.date) + '</span>' +
        (st.date !== D.today() ? '<button type="button" class="btn btn-ghost btn-sm" data-act="day-today">Ir para hoje</button>' : '') +
        '</div><span class="spacer"></span><span class="small ink2" data-ref="day-status">' + this._dayStatus() + '</span></div>' +
        '<div class="toolbar" style="margin-bottom:10px">' +
        '<select class="inp" style="width:auto;max-width:240px" data-chg="day-preset" aria-label="Aplicar preset"><option value="">' + (presets.length ? 'Aplicar preset…' : 'Nenhum preset salvo') + '</option>' + presets.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.name) + ' (' + p.items.length + ')</option>').join('') + '</select>' +
        '<button type="button" class="btn btn-sm" data-act="day-block">' + ICON.layers + 'Bloco produto + agente</button>' +
        '<button type="button" class="btn btn-sm" data-act="day-repeat">' + ICON.repeat + 'Repetir estrutura do último dia</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-act="day-add">' + ICON.plus + 'Linha</button>' +
        '<span class="spacer"></span><button type="button" class="btn btn-sm btn-ghost" data-act="day-save-preset">' + ICON.save + 'Salvar estrutura como preset</button></div>' +
        '<div class="day-grid">' + this._dayGridHTML() + '</div>' +
        '<div class="grid-foot"><span class="small ink2">Quantidade vazia = 0. <b>Enter</b> pula para a próxima quantidade · <b>Ctrl+Enter</b> salva.</span><span class="spacer"></span>' +
        '<button type="button" class="btn btn-ghost" data-act="day-discard">Descartar alterações</button><button type="button" class="btn btn-primary" data-act="day-save">' + ICON.save + 'Salvar dia</button></div></div>';
    },
    _dayStatus() {
      const st = this._ds();
      const saved = st.orig.size;
      return (st.dirty ? '<span class="dirty-dot"></span>Alterações não salvas · ' : '') + (saved ? saved + (saved === 1 ? ' lançamento salvo' : ' lançamentos salvos') + ' neste dia' : 'Nenhum lançamento salvo neste dia');
    },
    _markDirty() {
      const st = this._ds();
      st.dirty = true;
      const el = this._view.querySelector('[data-ref=day-status]');
      if (el) el.innerHTML = this._dayStatus();
    },
    _dayGridHTML() {
      const st = this._ds(), s = this.store;
      if (!st.rows.length) return '<div class="empty"><strong>Nenhum lançamento neste dia.</strong>Aplique um preset, monte um bloco (produto + agente com todas as métricas) ou repita a estrutura do último dia preenchido.</div>';
      const th = (label, c) => '<th>' + label + (c ? ' <span class="th-tools"><button type="button" class="icon-btn" data-act="manage" data-c="' + c + '" title="Gerenciar lista" aria-label="Gerenciar lista: ' + label + '">' + ICON.gear + '</button></span>' : '') + '</th>';
      const cls = (r, f) => 'inp' + (r.err[f] ? ' err' : '');
      let prevKey = null, alt = false, b = '';
      st.rows.forEach((r, i) => {
        const key = r.product_id + '|' + r.seller_id;
        if (key !== prevKey && i > 0) alt = !alt;
        prevKey = key;
        const m = s.get('metrics', r.metric_id);
        const money = m && m.kind === 'money';
        b += '<tr data-k="' + r.k + '"' + (alt ? ' class="g-alt"' : '') + '><td class="idx">' + (i + 1) + '</td>' +
          '<td style="min-width:170px"><select class="' + cls(r, 'product_id') + '" data-chg="day-cell" data-f="product_id" aria-label="Produto">' + this._options('products', r.product_id, { allowNew: true }) + '</select></td>' +
          '<td style="min-width:150px"><select class="' + cls(r, 'seller_id') + '" data-chg="day-cell" data-f="seller_id" aria-label="Agente">' + this._options('sellers', r.seller_id, { allowNew: true }) + '</select></td>' +
          '<td style="min-width:190px"><select class="' + cls(r, 'metric_id') + '" data-chg="day-cell" data-f="metric_id" aria-label="Métrica"' + (r.err.dup ? ' title="Combinação repetida"' : '') + '>' + this._options('metrics', r.metric_id, { allowNew: true }) + '</select></td>' +
          '<td style="min-width:120px;width:150px">' + (money ? '<div class="unit" data-unit="R$">' : '') + '<input class="' + cls(r, 'quantity') + ' inp-money" inputmode="decimal" value="' + esc(r.quantity) + '" placeholder="0" data-inp="day-cell" data-f="quantity" autocomplete="off" aria-label="Quantidade">' + (money ? '</div>' : '') + '</td>' +
          '<td class="actions"><button type="button" class="icon-btn danger" data-act="day-del" title="Remover linha" aria-label="Remover linha">' + ICON.trash + '</button></td></tr>';
      });
      return '<div class="tbl-wrap"><table class="tbl grid-edit" data-grid="daily"><thead><tr><th></th>' + th('Produto', 'products') + th('Agente', 'sellers') + th('Métrica', 'metrics') + th('Quantidade') + '<th></th></tr></thead><tbody>' + b + '</tbody></table></div>';
    },
    _redrawDayGrid(focusK, focusF) {
      const box = this._view.querySelector('.day-grid');
      if (!box) return;
      box.innerHTML = this._dayGridHTML();
      const stEl = this._view.querySelector('[data-ref=day-status]');
      if (stEl) stEl.innerHTML = this._dayStatus();
      if (focusK) { const el = box.querySelector('tr[data-k="' + focusK + '"] [data-f="' + (focusF || 'quantity') + '"]'); if (el) el.focus(); }
    },
    _dayRowOf(el) { const tr = el.closest('tr[data-k]'); return tr ? this._ds().rows.find((r) => r.k === tr.dataset.k) : null; },
    /** Adiciona combinações produto/agente/métrica que ainda não estão na grade. */
    _addCombos(items) {
      const st = this._ds(), s = this.store;
      const exists = new Set(st.rows.map((r) => r.product_id + '|' + r.seller_id + '|' + r.metric_id));
      const added = [];
      items.forEach((it) => {
        const key = sid(it.product_id) + '|' + sid(it.seller_id) + '|' + sid(it.metric_id);
        const ok = ['products', 'sellers', 'metrics'].every((c, i) => { const r = s.get(c, [it.product_id, it.seller_id, it.metric_id][i]); return r && r.active !== false; });
        if (exists.has(key) || !ok) return;
        exists.add(key);
        const row = this._newDayRow({ product_id: it.product_id, seller_id: it.seller_id, metric_id: it.metric_id });
        st.rows.push(row);
        added.push(row);
      });
      if (added.length) { this._markDirty(); this._redrawDayGrid(added[0].k); }
      return added.length;
    },
    async _blockForm(title) {
      const metrics = this.store.list('metrics');
      return this._form({
        title: title || 'Bloco produto + agente', ok: 'Adicionar linhas',
        intro: 'Cria uma linha para cada métrica marcada, já com o produto e o agente preenchidos.',
        fields: [
          { key: 'product_id', label: 'Produto', type: 'select', options: [['', 'Selecione…']].concat(this._optionPairs('products')), required: true },
          { key: 'seller_id', label: 'Agente', type: 'select', options: [['', 'Selecione…']].concat(this._optionPairs('sellers')), required: true },
          { key: 'metrics', label: 'Métricas', type: 'checks', options: metrics.map((m) => [m.id, m.name + (m.kind === 'money' ? ' (R$)' : '')]), value: metrics.map((m) => m.id) },
        ],
        validate: (v) => (!v.metrics.length ? 'Marque ao menos uma métrica.' : null),
      }).then((v) => (v ? v.metrics.map((mid) => ({ product_id: v.product_id, seller_id: v.seller_id, metric_id: mid })) : null));
    },
    async _changeDay(date) {
      const st = this._ds();
      if (!D.isISO(date)) {
        const inp = this._view.querySelector('[data-chg=day-date]');
        if (inp) inp.value = st.date;
        this._toast('Data inválida. Use o formato dd/mm/aaaa.', 'error');
        return;
      }
      if (date === st.date) return;
      if (st.dirty && !(await this._confirm('Há alterações não salvas neste dia. Trocar de dia e descartá-las?', { ok: 'Descartar e trocar', danger: true }))) {
        const inp = this._view.querySelector('[data-chg=day-date]');
        if (inp) inp.value = st.date;
        return;
      }
      st.date = date;
      st.loadedFor = null;
      await this.render();
    },
    async _saveDay() {
      const st = this._ds(), s = this.store;
      let bad = 0;
      const seen = new Set();
      st.rows.forEach((r) => {
        r.err = {};
        if (!s.get('products', r.product_id)) r.err.product_id = 1;
        if (!s.get('sellers', r.seller_id)) r.err.seller_id = 1;
        if (!s.get('metrics', r.metric_id)) r.err.metric_id = 1;
        const q = String(r.quantity).trim() === '' ? 0 : parseMoney(r.quantity);
        if (q == null || q < 0) r.err.quantity = 1;
        r._q = q;
        const key = r.product_id + '|' + r.seller_id + '|' + r.metric_id;
        if (!Object.keys(r.err).length) { if (seen.has(key)) { r.err.metric_id = 1; r.err.dup = 1; } else seen.add(key); }
        if (Object.keys(r.err).length) bad++;
      });
      if (bad) { this._redrawDayGrid(); this._toast(bad + (bad === 1 ? ' linha com problema' : ' linhas com problema') + ': campo vazio, quantidade inválida ou combinação repetida (mesmo produto + agente + métrica).', 'error'); return; }
      const creates = [], updates = [], keep = new Set();
      st.rows.forEach((r) => {
        const rec = { date: st.date, product_id: s.get('products', r.product_id).id, seller_id: s.get('sellers', r.seller_id).id, metric_id: s.get('metrics', r.metric_id).id, quantity: r._q };
        if (r.id != null) {
          keep.add(sid(r.id));
          const o = st.orig.get(sid(r.id));
          if (!o || sid(o.product_id) !== sid(rec.product_id) || sid(o.seller_id) !== sid(rec.seller_id) || sid(o.metric_id) !== sid(rec.metric_id) || Number(o.quantity) !== rec.quantity) updates.push([r.id, rec]);
        } else creates.push(rec);
      });
      const deletes = Array.from(st.orig.keys()).filter((id) => !keep.has(id));
      if (!creates.length && !updates.length && !deletes.length) { this._toast('Nenhuma alteração para salvar.', 'info'); st.dirty = false; this._redrawDayGrid(); return; }
      if (deletes.length && !(await this._confirm(deletes.length + (deletes.length === 1 ? ' lançamento removido da grade será excluído' : ' lançamentos removidos da grade serão excluídos') + ' do banco. Continuar?', { ok: 'Salvar e excluir', danger: true }))) return;
      // Ordem importa por causa da restrição UNIQUE (dia, produto, agente, métrica): exclui, altera, cria.
      for (const id of deletes) await s.remove('daily_entries', id);
      for (const u of updates) await s.update('daily_entries', u[0], u[1]);
      if (creates.length) await s.bulkCreate('daily_entries', creates);
      this._toast('Dia ' + D.fmt(st.date) + ' salvo: ' + creates.length + ' novo(s), ' + updates.length + ' alterado(s), ' + deletes.length + ' excluído(s).');
      st.loadedFor = null;
      await this.render();
    },

    // ---------------- histórico ----------------
    // ---------------- Visão por Agente ----------------
    _agentViewHTML(av) {
      const r = av.range;
      let h = '<div data-ref="agview"><div class="toolbar">' + this._periodChip('agentes') +
        '<span class="range-note">' + av.agents.length + (av.agents.length === 1 ? ' agente com lançamentos' : ' agentes com lançamentos') + '</span><span class="spacer"></span>' +
        '<button type="button" class="btn btn-sm" data-act="ag-agents">' + ICON.gear + 'Agentes e ordem</button></div>';
      if (!av.agents.length) {
        h += '<div class="card"><div class="empty"><strong>Nenhum lançamento no Diário de ' + D.fmt(r.from) + (r.from !== r.to ? ' a ' + D.fmt(r.to) : '') + '.</strong>Escolha outro período.</div></div>';
      } else {
        h += '<div class="ag-grid">' + av.agents.map((a) => this._agentCardHTML(a)).join('') + '</div>';
      }
      const notes = [];
      if (av.idle.length) notes.push('Sem lançamentos no período: ' + esc(av.idle.map((x) => x.name).join(', ')) + '.');
      if (av.hidden.length) notes.push('Ocultos nesta visão: ' + esc(av.hidden.map((x) => x.name).join(', ')) + ' (botão "Agentes e ordem").');
      h += '<p class="small muted" style="margin-top:12px">Sem personalizar, cada cartão mostra só as métricas que o agente preencheu no período. ' +
        'Em <b>Personalizar</b> você escolhe as métricas e a ordem de cada agente. Percentual abaixo de um número = em relação à linha anterior.' + (notes.length ? '<br>' + notes.join(' ') : '') + '</p>';
      return h + '</div>';
    },
    _agentCardHTML(a) {
      const one = a.products.length === 1;
      const pcols = one ? [] : a.products;
      const fmt = (m, v) => esc(m.kind === 'money' ? F.money(v) : F.num(v));
      // conversão em relação à linha anterior (só entre métricas de quantidade)
      const conv = (rows, i, get) => {
        if (i === 0 || rows[i].kind !== 'count' || rows[i - 1].kind !== 'count') return '';
        const prev = get(rows[i - 1]);
        return prev ? '<div class="small muted">' + F.pct(get(rows[i]) / prev) + '</div>' : '';
      };
      let b = '';
      a.metrics.forEach((m, i, rows) => {
        b += '<tr><td' + (m.filled ? '' : ' class="muted" title="Sem lançamentos desta métrica no período"') + '>' + esc(m.name) + '</td>' +
          pcols.map((p, j) => '<td class="num">' + fmt(m, m.values[j]) + conv(rows, i, (x) => x.values[j]) + '</td>').join('') +
          '<td class="num strong">' + fmt(m, m.total) + conv(rows, i, (x) => x.total) + '</td></tr>';
      });
      const sub = [a.metrics.length + (a.metrics.length === 1 ? ' métrica' : ' métricas'),
        one ? esc(a.products[0].name) : a.products.length + ' produtos',
        a.days + (a.days === 1 ? ' dia com lançamento' : ' dias com lançamento')].join(' · ');
      const table = a.metrics.length
        ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Métrica</th>' + pcols.map((p) => '<th class="num">' + esc(p.name) + '</th>').join('') + '<th class="num">Total</th></tr></thead><tbody>' + b + '</tbody></table></div>'
        : '<div class="empty small">Nenhuma métrica escolhida. Use Personalizar.</div>';
      return '<div class="card' + (pcols.length > 2 ? ' span' : '') + '" data-agent="' + esc(a.id) + '"><div class="card-head"><div><h3>' + esc(a.name) +
        (a.active ? '' : ' <span class="pill">arquivado</span>') + ' <span class="pill' + (a.custom ? ' info' : '') + '" title="' + (a.custom ? 'Métricas escolhidas em Personalizar' : 'Mostra as métricas que o agente preencheu no período') + '">' + (a.custom ? 'personalizado' : 'automático') + '</span></h3><p class="sub">' + sub + '</p></div><span class="spacer"></span>' +
        '<button type="button" class="btn btn-sm" data-act="ag-custom" data-id="' + esc(a.id) + '">' + ICON.gear + 'Personalizar</button></div>' + table +
        (a.unshown.length ? '<p class="small muted" style="margin-top:8px">Também preencheu, mas não está exibido: ' + esc(a.unshown.join(', ')) + '.</p>' : '') + '</div>';
    },
    /** Modal "Personalizar" de um agente: quais métricas e em que ordem; pode copiar para outros agentes. */
    _agentEditor(id) {
      const s = this.store, cfg = s.settings.agent_views, a = this._agView && this._agView.agents.find((x) => x.id === sid(id));
      const conf = cfg.agents[sid(id)];
      const used = new Set(a ? a.used : []);
      const chosen = conf ? conf.metrics.filter((m) => s.get('metrics', m)) : (a ? a.used : []);
      const rest = s.list('metrics').map((m) => sid(m.id)).filter((m) => chosen.indexOf(m) < 0);
      const items = chosen.concat(rest).map((m) => ({ id: m, name: s.name('metrics', m), state: chosen.indexOf(m) > -1, hint: used.has(m) ? 'preencheu no período' : '' }));
      const ol = { items, check: 'Exibir', off: (it) => !it.state };
      const others = s.list('sellers').filter((v) => sid(v.id) !== sid(id));
      const entry = this._openModal({
        title: 'Personalizar — ' + s.name('sellers', id), size: 'wide', autofocus: false, ctx: { ol, agent: sid(id) },
        body: '<p class="ink2" style="margin-bottom:12px">Marque as métricas que aparecem no cartão de <b>' + esc(s.name('sellers', id)) + '</b> e use as setas para definir a ordem. ' +
          (conf ? 'Hoje o cartão usa esta escolha.' : 'Hoje o cartão está no <b>automático</b> (mostra o que o agente preencheu); salvar fixa a escolha abaixo.') + '</p><div data-ol></div>' +
          (others.length ? '<details class="more" style="margin-top:12px"><summary>Aplicar a mesma escolha a outros agentes ' + ICON.chevron + '</summary><div style="display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));margin-top:10px">' +
            others.map((v) => '<label class="check"><input type="checkbox" data-ref="ag-copy" value="' + esc(v.id) + '"> ' + esc(v.name) + '</label>').join('') + '</div></details>' : ''),
        footer: (conf ? '<button type="button" class="btn btn-ghost" data-act="ag-auto">Voltar ao automático</button><span class="spacer"></span>' : '') +
          '<button type="button" class="btn" data-act="modal-close">Cancelar</button><button type="button" class="btn btn-primary" data-act="ag-save">' + ICON.save + 'Salvar</button>',
      });
      this._olRedraw(entry);
      const first = entry.body.querySelector('[data-chg=ol-state]');
      if (first) setTimeout(() => first.focus(), 20);
      return entry;
    },
    // ---------------- Renda dos Leads ----------------
    /** Cor de cada faixa em hex: a personalizada ou a padrão do tema atual (lida das variáveis CSS). */
    _incColors(bands) {
      const cs = getComputedStyle(this._shell);
      return bands.map((b) => {
        if (b.color) return b.color;
        const m = /^var\((--[\w-]+)\)$/.exec(b.def || '');
        return (m && cs.getPropertyValue(m[1]).trim()) || '#8f8d86';
      });
    },
    _rendaHTML(v) {
      const s = this.store, cfg = v.cfg, r = v.range;
      const colors = this._incColors(cfg.bands), inks = colors.map(inkOn);
      // seletor sempre visível (mesmo com um só produto acompanhado): é o filtro da sub-aba
      const prodSel = v.tracked.length
        ? '<select class="inp" style="width:auto;max-width:260px" data-chg="renda-product" aria-label="Produto"><option value="">Todos com renda (' + v.tracked.length + ')</option>' +
          v.tracked.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === v.product ? ' selected' : '') + '>' + esc(p.name) + (p.active ? '' : ' (arquivado)') + '</option>').join('') + '</select>'
        : '';
      let h = '<div data-ref="renda"><div class="toolbar">' + this._periodChip('renda') + prodSel + '<span class="spacer"></span>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="renda-refresh">' + ICON.refresh + 'Atualizar</button>' +
        '<button type="button" class="btn btn-sm" data-act="renda-custom">' + ICON.gear + 'Personalizar</button></div>';
      const card = (inner) => '<div class="card"><div class="empty">' + inner + '</div></div>';
      const startsTxt = (list) => list.map((p) => '<b>' + esc(p.name) + '</b> desde ' + D.fmt(p.start)).join(', ');
      const bandNames = esc(cfg.bands.map((b) => b.name).join(', '));
      const foot = '<p class="small muted" style="margin-top:12px">% de cada faixa = leads da faixa ÷ leads qualificadas (a soma das faixas)' +
        (cfg.unqualified ? '; "' + esc(cfg.unqualified.name) + '" fica fora do gráfico' : '') + '. Dias sem lançamento não entram na conta. ' +
        (cfg.auto ? 'Faixas reconhecidas automaticamente pelo nome das métricas; ' : '') + 'faixas, ordem e cores em <b>Personalizar</b> (valem para todos).</p>';

      if (v.status === 'nocfg') return h + card('<strong>Nenhuma faixa de renda configurada.</strong>Use <b>Personalizar</b> para escolher quais métricas do Diário são as faixas de renda (ex.: Baixa Renda, Média Renda, Alta Renda).') + '</div>';
      if (v.status === 'notracked') return h + card('<strong>Ainda não há lançamentos das faixas de renda no Diário.</strong>Faixas em uso: ' + bandNames + (cfg.unqualified ? ' e ' + esc(cfg.unqualified.name) : '') + '. Elas aparecem aqui assim que forem preenchidas em "Preencher dia".') + foot + '</div>';
      if (v.status === 'future') return h + card('<strong>Este período ainda não começou.</strong>Escolha outro período.') + '</div>';
      const sel = v.tracked.filter((p) => !v.product || p.id === v.product);
      if (v.status === 'before') {
        return h + card('<strong>Ainda não acompanhávamos a renda das leads neste período.</strong>' + startsTxt(sel) + '.<br><br>' +
          '<button type="button" class="btn btn-primary btn-sm" data-act="renda-since" data-from="' + v.start + '">Ver desde o início (' + D.fmt(v.start) + ')</button>') + foot + '</div>';
      }
      if (v.status === 'empty') {
        const last = sel.map((p) => p.last).filter((d) => d < r.from).sort().pop();
        return h + card('<strong>Nenhum registro de renda neste período.</strong>' + (last ? 'Último registro antes dele: ' + D.fmt(last) + '.' : 'Escolha outro período.')) + foot + '</div>';
      }

      // ---------- avisos sobre o acompanhamento ----------
      const notes = [];
      if (v.lateStarts.length) notes.push((v.product || v.tracked.length === 1 ? 'Renda acompanhada desde <b>' + D.fmt(v.lateStarts[0].start) + '</b>.' : 'Início do acompanhamento: ' + startsTxt(v.lateStarts) + '.'));
      if (v.covered < v.periodDays) notes.push(v.covered + ' de ' + v.periodDays + ' dias deste período têm registro; os percentuais usam só o que foi registrado (nada é projetado).');
      if (v.silent.length) notes.push('Sem registro neste período: ' + esc(v.silent.join(', ')) + '.');
      if (notes.length) h += '<div class="note" data-ref="renda-note" style="margin-bottom:16px">' + ICON.info + '<span>' + notes.join(' ') + '</span></div>';

      // ---------- indicadores ----------
      const tile = (label, value, ft) => '<div class="kpi"><div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div>' + (ft ? '<div class="kpi-foot">' + ft + '</div>' : '') + '</div>';
      const unqN = cfg.unqualified ? esc(cfg.unqualified.name) : '';
      h += '<section class="kpis" aria-label="Indicadores de renda">';
      if (cfg.unqualified) h += tile('Leads registradas', esc(F.int(v.registered)), '<span>nas faixas + ' + unqN + '</span>');
      h += tile('Qualificadas', esc(F.int(v.qualified)), cfg.unqualified ? '<span>' + esc(F.pct(v.registered ? v.qualified / v.registered : null)) + ' das registradas</span>' : '<span>soma das faixas de renda</span>');
      if (cfg.unqualified) h += tile(unqN, esc(F.int(v.unqualified)), '<span>' + esc(F.pct(v.registered ? v.unqualified / v.registered : null)) + ' das registradas · fora do gráfico</span>');
      h += '</section>';

      // ---------- distribuição (rosca) ----------
      const legendRows = v.bands.map((b, i) => '<tr><td><span style="display:inline-flex;align-items:center;gap:8px"><i class="key-rect" style="background:' + colors[i] + '"></i>' + esc(b.name) + '</span></td>' +
        '<td class="num strong">' + esc(F.pct(b.share, 1)) + '</td><td class="num ink2">' + esc(F.int(b.qty)) + '</td></tr>').join('') +
        (cfg.unqualified ? '<tr data-ref="renda-unq"><td><span style="display:inline-flex;align-items:center;gap:8px"><i class="key-rect hollow"></i>' + unqN + '</span> <span class="small muted">fora do gráfico</span></td><td class="num muted">—</td><td class="num ink2">' + esc(F.int(v.unqualified)) + '</td></tr>' : '');
      const dist = '<div class="card" data-card="renda-dist"><div class="card-head"><div><h3>Distribuição da renda</h3><p class="sub">% sobre ' + (v.qualified === 1 ? 'a 1 lead qualificada' : 'as ' + esc(F.int(v.qualified)) + ' leads qualificadas') + '</p></div></div>' +
        '<div class="inc-dist">' + this._donutSVG(v, colors) + '<table class="tbl"><thead><tr><th>Faixa</th><th class="num">%</th><th class="num">Leads</th></tr></thead><tbody>' + legendRows + '</tbody></table></div></div>';

      // ---------- barras 100% (por produto e por semana/mês) ----------
      const legend = '<div class="legend" style="margin-bottom:10px">' + v.bands.map((b, i) => '<span><i class="key-rect" style="background:' + colors[i] + '"></i>' + esc(b.name) + '</span>').join('') + '</div>';
      const tipOf = (head, x) => esc(tipHTML(head, v.bands.map((b, i) => ({ color: colors[i], rect: true, value: F.pct(x.qualified ? x.values[i] / x.qualified : null, 1), label: b.name + ' · ' + F.int(x.values[i]) })).concat(
        [{ value: F.int(x.qualified), label: 'qualificadas' }], cfg.unqualified ? [{ value: F.int(x.unqualified), label: cfg.unqualified.name }] : [])));
      const stack = (x, labels) => (x.qualified
        ? '<div class="stack">' + x.values.map((val, i) => (val > 0 ? '<span class="seg" style="flex:' + val + ' 1 0;background:' + colors[i] + ';color:' + inks[i] + '">' + (labels && val / x.qualified >= 0.12 ? esc(F.pct(val / x.qualified)) : '') + '</span>' : '')).join('') + '</div>'
        : '<div class="stack none">' + (labels ? 'sem leads nas faixas' : '') + '</div>');
      const cellsOf = (x) => x.values.map((val) => '<td class="num">' + esc(F.int(val)) + '<div class="small muted">' + esc(F.pct(x.qualified ? val / x.qualified : null)) + '</div></td>').join('') +
        '<td class="num strong">' + esc(F.int(x.qualified)) + '</td>' + (cfg.unqualified ? '<td class="num">' + esc(F.int(x.unqualified)) + '</td>' : '');
      const headCells = v.bands.map((b) => '<th class="num">' + esc(b.name) + '</th>').join('') + '<th class="num">Qualificadas</th>' + (cfg.unqualified ? '<th class="num">' + unqN + '</th>' : '');
      const total = { values: v.bands.map((b) => b.qty), qualified: v.qualified, unqualified: v.unqualified };

      let prod = '';
      if (!v.product && v.tracked.length > 1) {
        prod = '<div class="card" data-card="renda-prod"><div class="card-head"><div><h3>Por produto</h3><p class="sub">Cada barra = 100% das leads qualificadas do produto no período</p></div></div>' + legend +
          '<div class="inc-rows">' + v.products.map((p) => '<div class="inc-row mark" data-product="' + esc(p.id) + '" data-tip="' + tipOf(p.name, p) + '"><span class="lbl" title="' + esc(p.name) + '">' + esc(p.name) + '</span>' + stack(p, true) +
            '<span class="val"><b>' + esc(F.int(p.qualified)) + '</b>' + (cfg.unqualified ? ' <span class="small muted">· ' + esc(F.int(p.unqualified)) + ' sem qualif.</span>' : '') + '</span></div>').join('') + '</div>' +
          '<details class="more"><summary>Ver números por produto ' + ICON.chevron + '</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Produto</th>' + headCells + '<th>Desde</th></tr></thead><tbody>' +
          v.products.map((p) => '<tr><td class="strong">' + esc(p.name) + '</td>' + cellsOf(p) + '<td class="nowrap ink2">' + D.fmt(p.start) + '</td></tr>').join('') +
          '</tbody><tfoot><tr><td>Total</td>' + cellsOf(total) + '<td></td></tr></tfoot></table></div></details></div>';
      }

      const bk = v.buckets, unit = bk.unit === 'month' ? 'mês' : 'semana';
      let evol = '<div class="card" data-card="renda-evol"><div class="card-head"><div><h3>Por ' + unit + '</h3><p class="sub">Cada coluna = 100% das leads qualificadas ' + (bk.unit === 'month' ? 'do mês' : 'da semana') + ' · passe o mouse para ver os números</p></div></div>';
      if (bk.items.length < 2) evol += '<div class="empty small">' + (bk.items.length ? 'Só há uma ' + unit + ' com registro neste período: a evolução aparece a partir da segunda.' : 'Nenhuma ' + unit + ' com registro neste período.') + '</div></div>';
      else {
        evol += legend + '<div class="inc-cols">' + bk.items.map((x) => {
          const why = 'Sem registro de renda'; // semanas antes do início ou no futuro já foram retiradas
          const tip = x.covered ? tipOf(x.head, x) : esc(tipHTML(x.head, [{ value: why, label: '' }]));
          return '<div class="inc-col mark" data-tip="' + tip + '">' + stack(x, false) + '<span>' + esc(x.label) + '</span><span class="n">' + (x.covered ? esc(F.int(x.qualified)) : '—') + '</span></div>';
        }).join('') + '</div><p class="small muted" style="margin-top:6px">Número abaixo da data = leads qualificadas no ' + (bk.unit === 'month' ? 'mês' : 'período da semana') + '.</p>' +
          '<details class="more"><summary>Ver números por ' + unit + ' ' + ICON.chevron + '</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>' + (bk.unit === 'month' ? 'Mês' : 'Semana') + '</th>' + headCells + '<th class="num">Dias com registro</th></tr></thead><tbody>' +
          bk.items.filter((x) => x.covered).map((x) => '<tr><td class="nowrap">' + esc(bk.unit === 'month' ? x.label : D.fmt(x.from) + (x.from !== x.to ? ' – ' + D.fmt(x.to) : '')) + '</td>' + cellsOf(x) + '<td class="num">' + x.covered + '</td></tr>').join('') +
          '</tbody></table></div></details></div>';
      }
      h += prod ? '<div class="grid-2">' + dist + prod + '</div>' + evol : '<div class="grid-2">' + dist + evol + '</div>';
      return h + foot + '</div>';
    },
    /** Rosca SVG das faixas (fatias com 2px de respiro; o número central é o total de qualificadas). */
    _donutSVG(v, colors) {
      const C = 84, R = 80, r = 54;
      const pt = (rad, a) => f1(C + rad * Math.cos(a)) + ',' + f1(C + rad * Math.sin(a));
      const segs = v.bands.map((b, i) => ({ b, i })).filter((x) => x.b.qty > 0);
      let g = segs.length ? '' : '<circle class="donut-empty" cx="' + C + '" cy="' + C + '" r="' + (R + r) / 2 + '" stroke-width="' + (R - r) + '"/>';
      let a0 = -Math.PI / 2;
      segs.forEach((x) => {
        const a1 = a0 + x.b.share * 2 * Math.PI, mid = (a0 + a1) / 2, full = segs.length === 1;
        const d = 'M' + pt(R, a0) + 'A' + R + ',' + R + ' 0 0 1 ' + pt(R, mid) + 'A' + R + ',' + R + ' 0 0 1 ' + pt(R, a1) +
          (full ? 'ZM' + pt(r, a1) : 'L' + pt(r, a1)) + 'A' + r + ',' + r + ' 0 0 0 ' + pt(r, mid) + 'A' + r + ',' + r + ' 0 0 0 ' + pt(r, a0) + 'Z';
        const tip = tipHTML(x.b.name, [{ color: colors[x.i], rect: true, value: F.pct(x.b.share, 1), label: F.int(x.b.qty) + (x.b.qty === 1 ? ' lead' : ' leads') }]);
        g += '<g class="mark" data-band="' + esc(x.b.id) + '" data-tip="' + esc(tip) + '"><path class="bar" d="' + d + '" fill-rule="evenodd" style="fill:' + colors[x.i] + ';stroke:var(--surface)" stroke-width="2"/></g>';
        a0 = a1;
      });
      g += '<text class="donut-num" x="' + C + '" y="' + (C + 4) + '" text-anchor="middle">' + esc(F.int(v.qualified)) + '</text><text class="donut-lbl" x="' + C + '" y="' + (C + 21) + '" text-anchor="middle">' + (v.qualified === 1 ? 'qualificada' : 'qualificadas') + '</text>';
      const label = 'Distribuição da renda: ' + v.bands.map((b) => b.name + ' ' + F.pct(b.share, 1)).join(', ');
      return '<svg width="168" height="168" viewBox="0 0 168 168" role="img" aria-label="' + esc(label) + '">' + g + '</svg>';
    },
    /**
     * "Personalizar" da Renda dos Leads: quais métricas são faixas (e a ordem, da menor para a maior renda),
     * a cor de cada faixa e qual métrica é "Sem qualificação". Grava settings.lead_income.
     */
    _incomeEditor() {
      const s = this.store, cfg = leadIncomeConfig(s);
      const bandIds = cfg.bands.map((b) => b.id), unq = cfg.unqualified ? cfg.unqualified.id : null;
      const custom = new Map(cfg.bands.map((b) => [b.id, b.color]));
      const metrics = s.list('metrics', { all: true }).filter((m) => m.active !== false || bandIds.indexOf(sid(m.id)) > -1 || sid(m.id) === unq);
      const rank = (m) => { const i = bandIds.indexOf(sid(m.id)); return i > -1 ? i : sid(m.id) === unq ? 1e3 : 2e3; };
      const items = metrics.map((m, i) => ({ m, i })).sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i).map(({ m }) => ({
        id: sid(m.id), name: m.name, color: custom.get(sid(m.id)) || null,
        state: bandIds.indexOf(sid(m.id)) > -1 ? 'band' : sid(m.id) === unq ? 'unq' : 'off',
        deny: m.kind === 'money' ? ['band', 'unq'] : [],
        hint: [m.kind === 'money' ? 'valor em R$' : '', m.active === false ? 'arquivada' : ''].filter(Boolean).join(' · '),
      }));
      const bandsOf = (all) => all.filter((x) => x.state === 'band');
      const ol = {
        items, empty: 'Nenhuma métrica cadastrada. Crie em Cadastros → Métricas.',
        states: [['band', 'Faixa de renda'], ['unq', 'Sem qualificação'], ['off', 'Não usar']],
        off: (it) => it.state === 'off',
        badge: (it, i, all) => (it.state === 'band' ? '<span class="pill info">Faixa ' + (bandsOf(all.slice(0, i + 1)).length) + '</span>' : ''),
        extra: (it, i, all) => {
          if (it.state !== 'band') return '';
          const bands = bandsOf(all), k = bands.indexOf(it);
          const hex = it.color || this._incColors([{ def: incomeDefaults(bands.map((x) => x.name))[k] }])[0];
          return (it.color ? '<button type="button" class="link small" data-act="inc-color-reset" title="Voltar à cor padrão">padrão</button>' : '') +
            '<input type="color" data-chg="inc-color" value="' + esc(hex) + '" aria-label="' + esc('Cor de ' + it.name) + '" title="Cor da faixa">';
        },
        // só uma métrica pode ser "Sem qualificação"
        onState: (it, all) => { if (it.state === 'unq') all.forEach((x) => { if (x !== it && x.state === 'unq') x.state = 'off'; }); },
      };
      const summary = (entry) => {
        const n = bandsOf(ol.items).length, u = ol.items.find((x) => x.state === 'unq');
        entry.body.querySelector('[data-ref=ol-summary]').textContent = (n === 0 ? 'Nenhuma faixa: escolha ao menos uma.' : n + (n === 1 ? ' faixa' : ' faixas')) + ' · Sem qualificação: ' + (u ? u.name : 'nenhuma') + '.';
      };
      const entry = this._openModal({
        title: 'Personalizar Renda dos Leads', size: 'wide', autofocus: false, ctx: { ol, olChange: summary },
        body: '<p class="ink2" style="margin-bottom:12px">Escolha quais métricas do Diário são <b>faixas de renda</b> e use as setas para colocá-las em ordem, <b>da menor para a maior renda</b> (é a ordem do gráfico e das tabelas). ' +
          '<b>Sem qualificação</b> fica fora do gráfico, num indicador próprio. ' + (cfg.auto ? 'Hoje a escolha é <b>automática</b> (pelos nomes das métricas); salvar fixa a escolha abaixo.' : '') + '</p>' +
          '<div data-ol></div><p class="small muted" style="margin-top:10px"><span data-ref="ol-summary"></span> Métricas em R$ não podem ser faixas. Cor padrão: faixas "Sem…" em cinza e as demais num só tom, do claro ao escuro (legível para daltônicos). Vale para todos que usam o painel.</p>',
        footer: (cfg.auto ? '' : '<button type="button" class="btn btn-ghost" data-act="renda-auto">Voltar ao automático</button>') +
          '<button type="button" class="btn btn-ghost" data-act="renda-colors-reset">Cores padrão</button><span class="spacer"></span>' +
          '<button type="button" class="btn" data-act="modal-close">Cancelar</button><button type="button" class="btn btn-primary" data-act="renda-save">' + ICON.save + 'Salvar</button>',
      });
      this._olRedraw(entry);
      const first = entry.body.querySelector('[data-chg=ol-state]');
      if (first) setTimeout(() => first.focus(), 20);
      return entry;
    },

    /** Grava settings.agent_views (cópia nova do objeto; nunca altera o que está em memória antes de salvar). */
    async _saveAgentViews(fn) {
      const cfg = JSON.parse(JSON.stringify(this.store.settings.agent_views));
      fn(cfg);
      await this.store.setSetting('agent_views', cfg);
    },

    _dayHistHTML() {
      const st = this._ds(), s = this.store;
      const stages = s.funnelMetrics();
      const byDay = new Map();
      st.histRows.forEach((r) => { if (!byDay.has(r.date)) byDay.set(r.date, []); byDay.get(r.date).push(r); });
      const days = Array.from(byDay.keys()).sort().reverse();
      let b = '';
      days.forEach((d) => {
        const arr = byDay.get(d);
        const prods = new Set(arr.map((x) => sid(x.product_id))), agents = new Set(arr.map((x) => sid(x.seller_id)));
        b += '<tr><td class="nowrap">' + D.dow(d) + ' ' + D.fmt(d) + '</td><td class="num">' + arr.length + '</td><td class="num">' + prods.size + '</td><td class="num">' + agents.size + '</td>' +
          stages.map((m) => '<td class="num">' + F.num(sum(arr.filter((x) => sid(x.metric_id) === sid(m.id)), (x) => x.quantity)) + '</td>').join('') +
          '<td class="actions"><button type="button" class="btn btn-sm" data-act="dhist-open" data-date="' + d + '">Abrir dia</button></td></tr>';
      });
      return '<div class="card" data-ref="dhist"><div class="toolbar" style="margin-bottom:12px">' + this._periodChip('diario') + '<span class="range-note">' + days.length + (days.length === 1 ? ' dia preenchido' : ' dias preenchidos') + '</span><span class="spacer"></span>' +
        '<button type="button" class="btn btn-sm" data-act="dhist-export">' + ICON.download + 'Exportar CSV</button></div>' +
        (days.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Dia</th><th class="num">Lançamentos</th><th class="num">Produtos</th><th class="num">Agentes</th>' + stages.map((m) => '<th class="num">' + esc(m.name) + '</th>').join('') + '<th></th></tr></thead><tbody>' + b + '</tbody></table></div>'
          : '<div class="empty"><strong>Nenhum lançamento no período.</strong>Escolha outro período ou preencha um dia.</div>') + '</div>' +
        (st.histAudit ? this._auditCard(st.histAudit) : '');
    },
  };

  // ---------------- Dashboard Agentes (aba Diário, v1.7) ----------------
  /** Variação em pontos percentuais (taxas): "▲ 0,4 p.p.". */
  function ppDelta(cur, prev) {
    if (cur == null || prev == null) return '';
    const d = (cur - prev) * 100;
    if (Math.abs(d) < 0.05) return '<span class="delta flat">= 0 p.p.</span>';
    return '<span class="delta ' + (d > 0 ? 'up' : 'down') + '" title="Anterior: ' + esc(F.pct(prev, 1)) + '">' + (d > 0 ? ICON.up : ICON.down) + NF.dec1.format(Math.abs(d)) + ' p.p.</span>';
  }
  /** Mini-linha (sem eixos) para os KPIs; null = sem valor (a linha é interrompida). */
  function sparkSVG(values) {
    const ok = values.filter((v) => v != null);
    if (values.length < 2 || !ok.length) return '';
    const max = Math.max.apply(null, ok.concat([0])) || 1, n = values.length;
    let d = '', prev = false;
    values.forEach((v, i) => {
      if (v == null) { prev = false; return; }
      d += (prev ? 'L' : 'M') + f1(i * 100 / (n - 1)) + ',' + f1(22 - (v / max) * 20);
      prev = true;
    });
    return '<svg class="spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + '" vector-effect="non-scaling-stroke"/></svg>';
  }
  /** Métricas do Diário do agente no período (gráfico "Evolução", CSV): funil, R$, outras atividades e as da reativação. */
  function agdMetricIds(d) {
    const ids = d.cols.concat(d.others).map((c) => c.id);
    const has = (id) => d.buckets.length > 0 && Object.prototype.hasOwnProperty.call(d.buckets[0].m, id);
    if (d.react) [d.react.fromId, d.react.toId].forEach((id) => { if (ids.indexOf(id) < 0 && has(id)) ids.push(id); });
    return ids;
  }
  /** Agentes na ordem da Visão por Agente (a mesma do seletor). */
  function sellersInAgentOrder(store) {
    const pos = new Map(store.settings.agent_views.order.map((id, i) => [id, i]));
    const at = (v) => (pos.has(sid(v.id)) ? pos.get(sid(v.id)) : 1e6);
    return store.list('sellers', { all: true }).map((v, i) => ({ v, i })).sort((a, b) => at(a.v) - at(b.v) || a.i - b.i).map((x) => x.v);
  }

  const AgentDashView = {
    async _renderAgentDash(tok, nav) {
      const st = this._ds();
      if (!this._view.querySelector('[data-ref=agdash]')) this._view.innerHTML = nav + '<div class="loading-bar"></div>'; else this._busy();
      // Diário e vendas da base inteira, lidos uma vez e guardados até algo mudar (o início de cada agente depende do histórico;
      // trocar agente, período ou produto não volta ao banco)
      if (!st.agdData || st.agdData.store !== this.store) {
        const res = await Promise.all([this.store.fetchAll('daily_entries'), this.store.fetchAll('sales')]);
        if (this._stale(tok)) return;
        st.agdData = { store: this.store, entries: res[0], sales: res[1] };
      }
      const r = this._range('agdash');
      const unit = st.agdUnit === 'day' && D.span(r.from, r.to) > 62 ? null : st.agdUnit; // por dia só até 62 dias
      if (st.agdMode === 'team') { // Equipe (v1.8): todos os agentes lado a lado
        const t = computeTeamDashboard(this.store, st.agdData.entries, st.agdData.sales, r, { product: st.agdTeamProduct, metric: st.agdTeamMetric, unit, weekStart: this.store.settings.week_start });
        st.agdTeamProduct = t.product;
        this._agd = null;
        this._team = t;
        this._view.innerHTML = nav + this._teamHTML(t);
        return;
      }
      this._team = null;
      const v = computeAgentDashboard(this.store, st.agdData.entries, st.agdData.sales, r, { agent: st.agdAgent, product: st.agdProduct, unit, weekStart: this.store.settings.week_start });
      if (v.agent) st.agdAgent = v.agent.id;
      st.agdProduct = v.product;
      this._agd = v;
      this._view.innerHTML = nav + this._agdHTML(v);
      this._lastW = this._view.clientWidth;
      this._drawAgd();
    },
    /** Início do preset "Desde o primeiro registro": primeiro lançamento ou venda do agente escolhido (na Equipe, de qualquer agente). */
    _agdFirst() {
      const st = this._ds(), data = st.agdData;
      if (!data) return null;
      const first = new Map();
      const early = (x) => { const k = sid(x.seller_id); if (!first.has(k) || x.date < first.get(k)) first.set(k, x.date); };
      data.entries.forEach(early); data.sales.forEach(early);
      if (st.agdMode === 'team') return Array.from(first.values()).sort()[0] || null;
      const id = st.agdAgent && first.has(st.agdAgent) ? st.agdAgent : (sellersInAgentOrder(this.store).map((x) => sid(x.id)).find((k) => first.has(k)) || '');
      if (!st.agdAgent && id) st.agdAgent = id;
      return first.get(id) || null;
    },

    _agdHTML(v) {
      const r = v.range, st = this._ds();
      const longo = D.span(r.from, r.to) > 62;
      const ub = (u, l) => '<button type="button" class="' + (v.unit === u ? 'on' : '') + '" data-act="agd-unit" data-unit="' + u + '" aria-pressed="' + (v.unit === u) + '"' +
        (u === 'day' && longo ? ' disabled title="Por dia só em períodos de até 62 dias"' : '') + '>' + l + '</button>';
      const mode = '<div class="subnav" role="group" aria-label="Visão" style="margin:0">' + [['agent', 'Agente'], ['team', 'Equipe']].map((m) => '<button type="button" class="' + ((st.agdMode || 'agent') === m[0] ? 'on' : '') + '" data-act="agd-mode" data-mode="' + m[0] + '" aria-pressed="' + ((st.agdMode || 'agent') === m[0]) + '">' + m[1] + '</button>').join('') + '</div>';
      const agSel = v.agents.length ? '<select class="inp" style="width:auto;max-width:240px" data-chg="agd-agent" aria-label="Agente">' + v.agents.map((a) => '<option value="' + esc(a.id) + '"' + (v.agent && a.id === v.agent.id ? ' selected' : '') + '>' + esc(a.name) + (a.active ? '' : ' (arquivado)') + (a.entries || a.sales ? '' : ' — sem registros no período') + '</option>').join('') + '</select>' : '';
      const prodSel = v.products.length > 1 || v.product ? '<select class="inp" style="width:auto;max-width:240px" data-chg="agd-product" aria-label="Produto"><option value="">Todos os produtos (' + v.products.length + ')</option>' +
        v.products.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === v.product ? ' selected' : '') + '>' + esc(p.name) + (p.active ? '' : ' (arquivado)') + '</option>').join('') + '</select>' : '';
      let h = '<div data-ref="agdash"><div class="toolbar">' + mode + agSel + this._periodChip('agdash') + prodSel +
        '<div class="subnav" role="group" aria-label="Agrupar por" style="margin:0">' + ub('day', 'Dia') + ub('week', 'Semana') + ub('month', 'Mês') + '</div>' +
        '<span class="range-note">' + (st.agdUnit && st.agdUnit === v.unit ? '' : 'automático') + '</span></div>';
      // ações ficam na linha do agente (a barra de filtros já é cheia)
      const refresh = '<button type="button" class="icon-btn" data-act="painel-refresh" title="Atualizar (reler o banco)" aria-label="Atualizar">' + ICON.refresh + '</button>';
      const card = (inner) => '<div class="card"><div class="empty">' + inner + '</div></div>';
      if (v.status === 'noagents') return h + '<div class="toolbar">' + refresh + '</div>' + card('<strong>Nenhum agente cadastrado.</strong>Cadastre em Cadastros → Vendedores / Agentes.') + '</div>';
      const a = v.agent, d = v.daily;
      const prevTxt = D.fmt(v.prev.from) + (v.prev.from !== v.prev.to ? ' – ' + D.fmt(v.prev.to) : '');
      h += '<p class="agd-head" data-ref="agd-head"><b>' + esc(a.name) + '</b>' + (a.active ? '' : ' <span class="pill">arquivado</span>') +
        (d.start ? '<span>· lançou no Diário em ' + d.days + ' de ' + d.periodDays + (d.periodDays === 1 ? ' dia' : ' dias') + '</span>' : '') +
        (v.products.length ? '<span>· ' + (v.product ? esc(v.products.find((p) => p.id === v.product).name) : v.products.length + (v.products.length === 1 ? ' produto' : ' produtos')) + '</span>' : '') +
        (d.noPrev && v.sales.noPrev ? '' : '<span>· comparado com ' + prevTxt + (v.prev.same ? ' (até o mesmo ponto)' : '') + '</span>') +
        '<span class="spacer"></span><span class="agd-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="agd-csv">' + ICON.download + 'CSV</button><button type="button" class="btn btn-sm" data-act="agd-custom">' + ICON.gear + 'Personalizar</button>' + refresh + '</span></p>';
      if (v.status === 'future') return h + card('<strong>Este período ainda não começou.</strong>Escolha outro período.') + '</div>';
      h += this._agdBodyHTML(v);
      h += '<p class="small muted" style="margin-top:12px">Taxas (ex.: Responderam ÷ Contatadas) contam só os dias e produtos em que o agente lançou as duas métricas. Média por dia = total ÷ dias com lançamento. ' +
        'Vendas = as registradas com ' + esc(a.name) + ' na coluna Vendedor. ' + (d.custom ? 'Indicadores escolhidos em <b>Personalizar</b>.' : 'Indicadores automáticos (início e fim do funil, conversão e valores em R$); escolha outros em <b>Personalizar</b>.') +
        (v.layout.hidden.length ? ' Seções ocultas para ' + esc(a.name) + ': ' + esc(v.layout.hidden.map((id) => AGD_SECTIONS.find((x) => x[0] === id)[1]).join(', ')) + '.' : '') +
        ' A conversão' + (d.conv ? ' (' + esc(d.conv.to) + ' ÷ ' + esc(d.conv.from) + ')' : '') + ' vale para todos os agentes e é escolhida no botão <b>Taxas</b>.' + '</p>';
      return h + '</div>';
    },

    /**
     * Diário do agente em seções (v1.9): { lead: avisos do topo, secs: { id da seção: HTML } }.
     * Quem monta a página na ordem do agente é _agdBodyHTML.
     */
    _agdDailyHTML(v) {
      const a = v.agent, d = v.daily, r = v.range, st = this._ds();
      const card = (inner) => '<div class="card" data-card="agd-daily-empty"><div class="empty">' + inner + '</div></div>';
      const secs = {};
      if (d.status === 'none') return { lead: '<div class="note" data-ref="agd-nodaily" style="margin-bottom:16px">' + ICON.info + '<span><b>' + esc(a.name) + '</b> não tem lançamentos no Diário. Abaixo, só as vendas em que aparece como vendedor.</span></div>', secs };
      if (d.status === 'before') {
        return { lead: card('<strong>' + esc(a.name) + ' ainda não lançava no Diário neste período.</strong>O primeiro lançamento é de ' + D.fmt(d.start) + '.<br><br>' +
          '<button type="button" class="btn btn-primary btn-sm" data-act="agd-since" data-from="' + d.start + '">Ver desde o primeiro lançamento</button>'), secs };
      }
      if (d.status === 'empty') return { lead: card('<strong>Nenhum lançamento de ' + esc(a.name) + ' no Diário neste período' + (v.product ? ' (neste produto)' : '') + '.</strong>Escolha outro período' + (v.product ? ' ou produto' : '') + '.'), secs };
      let lead = '';
      const notes = [];
      if (d.trimmed) notes.push('O primeiro lançamento de ' + esc(a.name) + ' no Diário é de <b>' + D.fmt(d.start) + '</b>: o que vem antes não aparece (não é "zero").');
      if (d.noPrev && d.start) notes.push('Sem comparação no Diário: o período anterior (' + D.fmt(r.prevFrom) + ' – ' + D.fmt(r.prevTo) + ') começa antes do primeiro lançamento.');
      if (notes.length) lead += '<div class="note" data-ref="agd-note" style="margin-bottom:16px">' + ICON.info + '<span>' + notes.join(' ') + '</span></div>';
      const taxas = '<button type="button" class="btn btn-ghost btn-sm" data-act="agd-conv-edit" title="Quais métricas formam a conversão, a taxa de resposta e a resposta da reativação (vale para todos os agentes)">' + ICON.gear + 'Taxas</button>';
      const per = UNIT_NAME[v.unit][0];
      const legendPrev = (noPrev) => '<div class="legend"><span><i class="key-line" style="background:var(--s1)"></i>Este período</span>' + (noPrev ? '' : '<span><i class="key-line" style="background:var(--ref)"></i>Período anterior</span>') + '</div>';
      const bucketName = (b) => esc(v.unit === 'month' ? b.label : D.fmt(b.from) + (b.from !== b.to ? ' – ' + D.fmt(b.to) : '')) + (b.partial ? ' <span class="pill">em andamento</span>' : '');
      const firstCol = v.unit === 'month' ? 'Mês' : v.unit === 'week' ? 'Semana' : 'Dia';
      const dash = '<span class="muted" title="Sem lançamento">—</span>';

      // ---------- KPIs ----------
      const fmtV = (kind, x) => (kind === 'money' ? F.money(x) : F.num(x));
      const vs = (dl) => (d.noPrev ? '<span>sem comparação</span>' : dl ? dl + '<span>vs. anterior</span>' : '<span>sem lançamentos no anterior</span>');
      const tile = (k) => {
        if (k.conv) { // taxa (conversão ou resposta da reativação)
          const cmp = k.noPrev ? '<span>sem comparação</span>' : ppDelta(k.value, k.prev) ? ppDelta(k.value, k.prev) + '<span>vs. anterior</span>' : '<span>sem lançamentos no anterior</span>';
          return '<div class="kpi" data-kpi="' + esc(k.id) + '"><div class="kpi-label" title="' + esc(k.sub) + '">' + esc(k.name) + '</div><div class="kpi-value">' + esc(F.pct(k.value, 1)) + '</div>' +
            '<div class="kpi-foot">' + (k.missing.length ? '<span>sem lançamentos de ' + esc(k.missing.join(' e ')) + ' no período</span>' : cmp) + '</div><div class="kpi-foot small">' + esc(k.sub) + (k.missing.length ? '' : ' · base: ' + k.days + (k.days === 1 ? ' dia' : ' dias')) + '</div>' + sparkSVG(k.spark) + '</div>';
        }
        return '<div class="kpi" data-kpi="' + esc(k.id) + '"><div class="kpi-label">' + esc(k.name) + '</div><div class="kpi-value">' + esc(fmtV(k.kind, k.total)) + '</div>' +
          '<div class="kpi-foot">' + vs(deltaHTML(k.total, k.prev, { money: k.kind === 'money' })) + '</div>' +
          '<div class="kpi-foot small">' + (k.avg != null ? '≈ ' + esc(k.kind === 'money' ? F.money0(k.avg) : F.num(Math.round(k.avg * 10) / 10)) + ' por dia com lançamento' : '') + '</div>' +
          (k.resp ? '<div class="kpi-foot small" data-ref="agd-resp" title="Taxa de resposta: ' + esc(k.resp.to + ' ÷ ' + k.resp.from) + ', só nos dias e produtos com as duas lançadas">' +
            (k.resp.missing.length ? '<span>taxa de resposta: sem lançamentos de ' + esc(k.resp.missing.join(' e ')) + '</span>'
              : '<span><b class="ink">' + esc(F.pct(k.resp.value, 1)) + '</b> das ' + esc(k.resp.from) + '</span>' + (d.noPrev ? '' : ppDelta(k.resp.value, k.resp.prev))) + '</div>' : '') +
          sparkSVG(k.spark) + '</div>';
      };
      if (d.kpis.length) secs.kpis = '<section class="kpis" aria-label="Indicadores do agente" data-ref="agd-kpis">' + d.kpis.map(tile).join('') + '</section>';

      // ---------- funil + evolução ----------
      let fun = '<div class="card" data-card="agd-funnel"><div class="card-head"><div><h3>Funil do período</h3><p class="sub">Etapas do funil que ' + esc(a.name) + ' lançou (ordem em Cadastros → Métricas) · % = em relação à etapa anterior' + (d.social ? ' · sem as mídias sociais' : '') + '</p></div><span class="spacer"></span>' + taxas + '</div>';
      const convLine = !d.conv ? '' : '<p class="trend-head" style="margin:12px 0 0" data-ref="agd-conv"><span>Conversão: <b>' + esc(F.pct(d.conv.value, 1)) + '</b></span>' +
        (d.conv.missing.length ? '<span class="small">sem lançamentos de ' + esc(d.conv.missing.join(' e ')) + ' no período</span>'
          : (d.conv.prev != null ? '<span class="small">anterior ' + esc(F.pct(d.conv.prev, 1)) + '</span>' + ppDelta(d.conv.value, d.conv.prev) : '') + '<span class="small">base ' + d.conv.days + (d.conv.days === 1 ? ' dia' : ' dias') + '</span>') +
        '<span class="small">' + esc(d.conv.to) + ' ÷ ' + esc(d.conv.from) + (d.conv.custom ? '' : ' (automático: última etapa ÷ primeira)') + '</span></p>';
      if (!d.stages.length) fun += '<div class="empty small">Nenhuma etapa do funil lançada neste período.</div>' + convLine + '</div>';
      else {
        const max = Math.max.apply(null, d.stages.map((x) => x.total).concat([0])) || 1;
        fun += '<div class="funnel">' + d.stages.map((x, i) => (i ? '<div class="funnel-conv"><span></span><span>' + (x.step.value != null ? '↳ ' + esc(F.pct(x.step.value, 1)) +
          (x.prevStep && x.prevStep.value != null ? ' (anterior ' + esc(F.pct(x.prevStep.value, 1)) + ')' : '') + ' · base ' + x.step.days + (x.step.days === 1 ? ' dia' : ' dias') : '↳ sem dias com as duas etapas') + '</span><span></span></div>' : '') +
          '<div class="funnel-row" data-stage="' + esc(x.id) + '"><span class="lbl" title="' + esc(x.name) + '">' + esc(x.name) + '</span><span class="track"><span class="fill" style="width:' + (x.total / max * 100).toFixed(1) + '%"></span></span><span class="val">' + esc(F.num(x.total)) + '</span></div>').join('') + '</div>';
        fun += convLine + '</div>';
      }
      secs.funnel = fun;
      const used = agdMetricIds(d);
      const mList = this.store.list('metrics', { all: true }).filter((m) => used.indexOf(sid(m.id)) > -1);
      if (mList.length) {
        const metric = this._agdMetric(v);
        secs.evol = '<div class="card" data-card="agd-evol"><div class="card-head"><div><h3>Evolução por ' + per + '</h3><p class="sub">Linha cinza = período anterior, ' + per + ' a ' + per + '</p></div><span class="spacer"></span>' +
          '<select class="inp sm" style="width:auto;max-width:220px" data-chg="agd-metric" aria-label="Métrica do gráfico">' + mList.map((m) => '<option value="' + esc(m.id) + '"' + (sid(m.id) === metric ? ' selected' : '') + '>' + esc(m.name) + '</option>').join('') + '</select></div>' +
          legendPrev(d.noPrev) + '<div class="chart" data-chart="agd-evol"></div>' +
          '<details class="more"><summary>Ver números por ' + per + ' ' + ICON.chevron + '</summary><div class="tbl-wrap scroll-y"><table class="tbl"><thead><tr><th>' + firstCol + '</th>' +
          mList.map((m) => '<th class="num">' + esc(m.name) + '</th>').join('') + '<th class="num">Dias com lançamento</th></tr></thead><tbody>' +
          d.buckets.map((b) => '<tr><td class="nowrap">' + bucketName(b) + '</td>' +
            mList.map((m) => '<td class="num">' + (b.m[sid(m.id)] == null ? dash : esc(m.kind === 'money' ? F.money0(b.m[sid(m.id)]) : F.num(b.m[sid(m.id)]))) + '</td>').join('') + '<td class="num">' + b.days + '</td></tr>').join('') +
          '</tbody></table></div></details></div>';
      }

      // ---------- taxas + renda ----------
      if (d.rates.length) {
        const rate = this._agdRate(v);
        secs.rates = '<div class="card" data-card="agd-rates"><div class="card-head"><div><h3>Taxas por ' + per + '</h3><p class="sub">Cada ponto conta só os dias e produtos com as duas métricas lançadas</p></div><span class="spacer"></span>' +
          '<select class="inp sm" style="width:auto;max-width:260px" data-chg="agd-rate" aria-label="Taxa do gráfico">' + d.rates.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === rate ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></div>' +
          legendPrev(d.noPrev) + '<div class="chart" data-chart="agd-rate"></div></div>';
      }
      if (d.income) {
        const inc = d.income, colors = this._incColors(inc.bands), inks = colors.map(inkOn);
        secs.income = '<div class="card" data-card="agd-income"><div class="card-head"><div><h3>Renda dos leads</h3><p class="sub">Faixas lançadas por ' + esc(a.name) + ' · % sobre as qualificadas (mesmas faixas e cores da Renda dos Leads)</p></div></div>' +
          (inc.qualified ? '<div class="stack" style="height:26px;margin-bottom:12px">' + inc.bands.map((b, i) => (b.qty > 0 ? '<span class="seg" style="flex:' + b.qty + ' 1 0;background:' + colors[i] + ';color:' + inks[i] + '" data-tip="' + esc(tipHTML(b.name, [{ color: colors[i], rect: true, value: F.pct(b.share, 1), label: F.int(b.qty) + (b.qty === 1 ? ' lead' : ' leads') }])) + '">' + (b.share >= 0.12 ? esc(F.pct(b.share)) : '') + '</span>' : '')).join('') + '</div>' : '<div class="stack none" style="margin-bottom:12px">sem leads nas faixas</div>') +
          '<table class="tbl"><thead><tr><th>Faixa</th><th class="num">%</th><th class="num">Leads</th></tr></thead><tbody>' +
          inc.bands.map((b, i) => '<tr><td><span style="display:inline-flex;align-items:center;gap:8px"><i class="key-rect" style="background:' + colors[i] + '"></i>' + esc(b.name) + '</span></td><td class="num strong">' + esc(F.pct(b.share, 1)) + '</td><td class="num ink2">' + esc(F.int(b.qty)) + '</td></tr>').join('') +
          (inc.unqName ? '<tr><td><span style="display:inline-flex;align-items:center;gap:8px"><i class="key-rect hollow"></i>' + esc(inc.unqName) + '</span> <span class="small muted">fora do %</span></td><td class="num muted">—</td><td class="num ink2">' + esc(F.int(inc.unqualified)) + '</td></tr>' : '') +
          '</tbody></table></div>';
      }

      // ---------- reativação (v1.9) ----------
      if (d.react) {
        const x = d.react;
        const cmp = (cur, prev) => (x.noPrev ? '<span>sem comparação</span>' : deltaHTML(cur, prev) ? deltaHTML(cur, prev) + '<span>vs. anterior</span>' : '<span>sem lançamentos no anterior</span>');
        const kp = (key, label, value, foot, small) => '<div class="kpi" data-kpi="' + key + '"><div class="kpi-label">' + esc(label) + '</div><div class="kpi-value">' + esc(value) + '</div><div class="kpi-foot">' + foot + '</div>' + (small ? '<div class="kpi-foot small">' + small + '</div>' : '') + '</div>';
        let body;
        if (x.status === 'before') body = '<div class="empty small">' + esc(a.name) + ' começou a lançar reativação em ' + D.fmt(x.start) + '.</div>';
        else if (x.status === 'empty') body = '<div class="empty small">Nenhuma reativação lançada neste período' + (v.product ? ' (neste produto)' : '') + '.</div>';
        else {
          const rateFoot = x.missing.length ? '<span>sem lançamentos de ' + esc(x.missing.join(' e ')) + ' no período</span>'
            : x.noPrev ? '<span>sem comparação</span>' : ppDelta(x.value, x.prev) ? ppDelta(x.value, x.prev) + '<span>vs. anterior</span>' : '<span>sem lançamentos no anterior</span>';
          body = '<section class="kpis" aria-label="Reativação" data-ref="agd-react-kpis">' +
            kp('react-from', x.from, F.num(x.total), cmp(x.total, x.prevTotal)) + kp('react-to', x.to, F.num(x.answered), cmp(x.answered, x.prevAnswered)) +
            kp('react-rate', 'Taxa de resposta da reativação', F.pct(x.value, 1), rateFoot, esc(x.to + ' ÷ ' + x.from) + (x.missing.length ? '' : ' · base: ' + x.days + (x.days === 1 ? ' dia' : ' dias'))) + '</section>' +
            '<div class="chart-title" style="margin-top:16px">Taxa de resposta da reativação por ' + per + '</div>' + legendPrev(x.noPrev) + '<div class="chart" data-chart="agd-react"></div>' +
            '<details class="more"><summary>Ver números por ' + per + ' ' + ICON.chevron + '</summary><div class="tbl-wrap scroll-y"><table class="tbl"><thead><tr><th>' + firstCol + '</th><th class="num">' + esc(x.from) + '</th><th class="num">' + esc(x.to) + '</th><th class="num">Taxa</th></tr></thead><tbody>' +
            d.buckets.map((b) => '<tr><td class="nowrap">' + bucketName(b) + '</td>' + [x.fromId, x.toId].map((id) => '<td class="num">' + (b.m[id] == null ? dash : esc(F.num(b.m[id]))) + '</td>').join('') +
              '<td class="num">' + (b.react && b.react.value != null ? esc(F.pct(b.react.value, 1)) : dash) + '</td></tr>').join('') + '</tbody></table></div></details>';
        }
        secs.react = '<div class="card" data-card="agd-react"><div class="card-head"><div><h3>Reativação</h3><p class="sub">Contada à parte das ' + (d.response ? esc(d.response.from) : 'leads contatadas') + ' · taxa = ' + esc(x.to) + ' ÷ ' + esc(x.from) + ', só nos dias e produtos com as duas lançadas' +
          (x.start > r.from ? ' · ' + esc(a.name) + ' lança reativação desde ' + D.fmt(x.start) : '') + '</p></div><span class="spacer"></span>' + taxas + '</div>' + body + '</div>';
      }

      // ---------- mídias sociais (v1.9) ----------
      if (d.social) {
        const so = d.social, nets = so.networks;
        let body;
        if (so.status === 'before') body = '<div class="empty small">' + esc(a.name) + ' começou a lançar nas mídias sociais em ' + D.fmt(so.start) + '.</div>';
        else if (so.status === 'empty') body = '<div class="empty small">Nenhum lançamento nas mídias sociais neste período.</div>';
        else if (!so.metrics.length) body = '<div class="empty small">Nenhuma métrica escolhida. Use o botão <b>Métricas</b>.</div>';
        else {
          const cell = (val, step, kind) => (val == null ? dash : esc(kind === 'money' ? F.money0(val) : F.num(val))) + (step != null ? '<div class="small ink2">↳ ' + esc(F.pct(step, 1)) + '</div>' : '');
          const sm = so.metrics.some((m) => m.id === st.agdSocMetric) ? st.agdSocMetric : so.metrics[0].id;
          const sn = nets.some((n) => n.id === st.agdSocNet) ? st.agdSocNet : '';
          body = '<div class="tbl-wrap"><table class="tbl" data-ref="agd-social-tbl"><thead><tr><th>Métrica</th>' + nets.map((n) => '<th class="num">' + esc(n.name) + (n.active ? '' : ' <span class="pill">arquivado</span>') + '</th>').join('') +
            (nets.length > 1 ? '<th class="num">Total</th>' : '') + '<th class="num">Δ</th></tr></thead><tbody>' +
            so.metrics.map((m) => '<tr data-metric="' + esc(m.id) + '"><td class="strong">' + esc(m.name) + '</td>' + m.nets.map((x) => '<td class="num">' + cell(x.total, x.step, m.kind) + '</td>').join('') +
              (nets.length > 1 ? '<td class="num strong">' + cell(m.total, m.step ? m.step.value : null, m.kind) + '</td>' : '') +
              '<td class="num">' + (so.noPrev || m.total == null ? '<span class="muted">—</span>' : deltaHTML(m.total, m.prev, { neutral: true, money: m.kind === 'money' }) || '<span class="muted">—</span>') + '</td></tr>').join('') +
            '</tbody></table></div>' +
            '<div class="toolbar" style="margin:16px 0 0"><span class="chart-title" style="margin:0">Evolução por ' + per + '</span><span class="spacer"></span>' +
            '<select class="inp sm" style="width:auto;max-width:220px" data-chg="agd-soc-metric" aria-label="Métrica do gráfico das mídias sociais">' + so.metrics.map((m) => '<option value="' + esc(m.id) + '"' + (m.id === sm ? ' selected' : '') + '>' + esc(m.name) + '</option>').join('') + '</select>' +
            (nets.length > 1 ? '<select class="inp sm" style="width:auto;max-width:200px" data-chg="agd-soc-net" aria-label="Rede do gráfico"><option value="">Todas as redes</option>' + nets.map((n) => '<option value="' + esc(n.id) + '"' + (n.id === sn ? ' selected' : '') + '>' + esc(n.name) + '</option>').join('') + '</select>' : '') + '</div>' +
            legendPrev(so.noPrev) + '<div class="chart" data-chart="agd-social"></div>';
        }
        secs.social = '<div class="card" data-card="agd-social"><div class="card-head"><div><h3>Mídias sociais</h3><p class="sub">' + (nets.length ? esc(nets.map((n) => n.name).join(', ')) + ' · ' : '') + 'fora do funil, das taxas e do "Por produto" · ↳ % = sobre a métrica de cima, só nos dias com as duas lançadas' +
          (so.custom ? '' : ' · métricas automáticas (as que ' + esc(a.name) + ' lançou)') + '</p></div><span class="spacer"></span>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-act="agd-social-edit" title="Quais produtos são mídias sociais e quais métricas aparecem (vale para todos os agentes)">' + ICON.gear + 'Métricas</button></div>' + body + '</div>';
      }

      // ---------- por produto ----------
      if (d.byProduct.length > 1) {
        const conv = !!d.conv;
        secs.prod = '<div class="card" data-card="agd-prod"><div class="card-head"><div><h3>Por produto</h3><p class="sub">O que ' + esc(a.name) + ' lançou em cada produto no período' + (conv ? ' · conversão = ' + esc(d.conv.to) + ' ÷ ' + esc(d.conv.from) + ', só com as duas lançadas no mesmo dia' : '') + '</p></div></div>' +
          '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Produto</th>' + d.cols.map((c) => '<th class="num">' + esc(c.name) + '</th>').join('') + (conv ? '<th class="num">Conversão</th>' : '') + '</tr></thead><tbody>' +
          d.byProduct.map((p) => '<tr' + (p.active ? '' : ' class="archived"') + ' data-product="' + esc(p.id) + '"><td class="strong">' + esc(p.name) + (p.active ? '' : ' <span class="pill">arquivado</span>') + '</td>' +
            p.values.map((x, i) => '<td class="num">' + esc(d.cols[i].kind === 'money' ? F.money0(x) : F.num(x)) + '</td>').join('') + (conv ? '<td class="num">' + esc(F.pct(p.conv, 1)) + '</td>' : '') + '</tr>').join('') +
          '</tbody><tfoot><tr><td>Total</td>' + d.cols.map((c) => { const t = (d.stages.find((x) => x.id === c.id) || d.money.find((x) => x.id === c.id)).total; return '<td class="num">' + esc(c.kind === 'money' ? F.money0(t) : F.num(t)) + '</td>'; }).join('') + (conv ? '<td class="num">' + esc(F.pct(d.conv.value, 1)) + '</td>' : '') + '</tr></tfoot></table></div></div>';
      }

      // ---------- outras atividades + constância ----------
      secs.others = '<div class="card" data-card="agd-others"><div class="card-head"><div><h3>Outras atividades</h3><p class="sub">Métricas fora do funil (sem as faixas de renda' + (d.react ? ' e a reativação' : '') + ')</p></div></div>' +
        (d.others.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Métrica</th><th class="num">Total</th><th class="num">Δ</th><th class="num">Por dia</th></tr></thead><tbody>' +
          d.others.map((m) => '<tr data-metric="' + esc(m.id) + '"><td class="strong">' + esc(m.name) + '</td><td class="num">' + esc(F.num(m.total)) + '</td><td class="num">' + (d.noPrev ? '<span class="muted">—</span>' : deltaHTML(m.total, m.prev, { neutral: true }) || '<span class="muted">—</span>') + '</td><td class="num">' + esc(F.num(m.avg == null ? null : Math.round(m.avg * 10) / 10)) + '</td></tr>').join('') +
          '</tbody></table></div>' : '<div class="empty small">Nenhuma outra métrica lançada no período.</div>') + '</div>';
      secs.cal = this._agdCalendarHTML(v);
      return { lead, secs };
    },

    /** Monta o dashboard do agente na ordem das seções dele; duas seções "half" seguidas ficam lado a lado. */
    _agdBodyHTML(v) {
      const parts = this._agdDailyHTML(v), size = new Map(AGD_SECTIONS.map((x) => [x[0], x[2]]));
      parts.secs.sales = this._agdSalesHTML(v);
      let h = parts.lead, half = [];
      const flush = () => { if (half.length) h += '<div class="grid-2">' + half.join('') + '</div>'; half = []; };
      v.layout.visible.forEach((id) => {
        const s = parts.secs[id];
        if (!s) return;
        if (size.get(id) === 'half') { half.push(s); if (half.length === 2) flush(); } else { flush(); h += s; }
      });
      flush();
      return h;
    },

    _agdCalendarHTML(v) {
      const d = v.daily, cal = d.calendar, ws = this.store.settings.week_start, today = D.today();
      const filled = cal.filter((x) => x.n).length;
      let cells = '';
      if (cal.length) {
        const pad = (D.fromISO(cal[0].date).getDay() - ws + 7) % 7;
        for (let i = 0; i < pad; i++) cells += '<span class="c pad"></span>';
        cal.forEach((x) => {
          const tip = tipHTML(D.dowLong(x.date) + ', ' + D.fmt(x.date), [{ value: x.n ? F.int(x.n) : 'sem lançamento', label: x.n ? (x.n === 1 ? 'lançamento' : 'lançamentos') : '' }]);
          cells += '<span class="c' + (x.n ? ' on' : '') + (x.date === today ? ' today' : '') + '" data-date="' + x.date + '" data-tip="' + esc(tip) + '"></span>';
        });
      }
      const days = [0, 1, 2, 3, 4, 5, 6].map((i) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][(ws + i) % 7]);
      return '<div class="card" data-card="agd-cal"><div class="card-head"><div><h3>Constância de preenchimento</h3><p class="sub">Cada quadrado é um dia' + (d.start && d.start > v.range.from ? ', desde o primeiro lançamento' : '') + ' · ' + filled + ' de ' + cal.length + (cal.length === 1 ? ' dia' : ' dias') + ' com lançamento' + (cal.length ? ' (' + esc(F.pct(filled / cal.length)) + ')' : '') + '</p></div></div>' +
        (cal.length ? '<div class="agd-cal-wrap"><div class="agd-cal-days" aria-hidden="true">' + days.map((x, i) => '<span>' + (i % 2 ? '' : x) + '</span>').join('') + '</div>' +
          '<div class="agd-cal" role="img" aria-label="' + esc('Lançou em ' + filled + ' de ' + cal.length + ' dias') + '">' + cells + '</div></div>' +
          '<div class="legend" style="margin-top:8px"><span><i class="key-rect" style="background:var(--s1)"></i>com lançamento</span><span><i class="key-rect hollow"></i>sem lançamento</span></div>'
          : '<div class="empty small">Nenhum dia do período passou ainda.</div>') + '</div>';
    },

    _agdSalesHTML(v) {
      const a = v.agent, x = v.sales;
      const prevOk = !x.noPrev;
      const vs = (cur, prev, money) => (!prevOk ? '<span>sem comparação</span>' : deltaHTML(cur, prev, { money }) ? deltaHTML(cur, prev, { money }) + '<span>vs. anterior</span>' : '<span>sem vendas no anterior</span>');
      if (!x.first && !x.hasGoal) return '<div class="note" data-ref="agd-nosales" style="margin-top:16px">' + ICON.info + '<span>' + esc(a.name) + ' não aparece como vendedor (coluna Vendedor) em nenhuma venda registrada.</span></div>';
      let h = '<div class="card" data-card="agd-sales"><div class="card-head"><div><h3>Vendas como vendedor</h3><p class="sub">Vendas registradas com ' + esc(a.name) + ' na coluna Vendedor, de qualquer produto' + (v.product ? ' · filtrado pelo produto vendido (a meta individual não é dividida por produto)' : '') + '</p></div></div>';
      if (!x.count && !x.goal) {
        return h + '<div class="empty small" data-ref="agd-nosales">Nenhuma venda com ' + esc(a.name) + ' como vendedor neste período' + (v.product ? ' (neste produto)' : '') + '.</div></div>';
      }
      const tile = (label, value, foot) => '<div class="kpi"><div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div>' + (foot ? '<div class="kpi-foot">' + foot + '</div>' : '') + '</div>';
      h += '<section class="kpis" aria-label="Vendas do agente" data-ref="agd-sales-kpis">' + tile('Faturado', esc(F.money(x.revenue)), vs(x.revenue, x.prevRevenue, true)) + tile('Vendas', esc(F.int(x.count)), vs(x.count, x.prevCount)) + tile('Ticket médio', esc(F.money(x.avg)), vs(x.avg, x.prevAvg, true));
      if (x.goal != null) {
        h += '<div class="kpi" data-ref="agd-goal"><div class="kpi-label">Meta individual</div><div class="kpi-value">' + esc(F.pct(x.pct)) + '</div><div class="kpi-foot" style="display:block">' +
          '<div class="meter" style="margin:2px 0 6px"><div class="meter-fill ' + (x.status || '') + '" style="width:' + (clamp(x.pct || 0, 0, 1) * 100).toFixed(1) + '%"></div></div>' +
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' + badge(x.status, this.store.settings) + '<span class="has-tip"' + goalTip(this.store, 'seller', a.id, v.range) + '>' + esc(F.money0(x.revenue)) + ' de ' + esc(F.money0(x.goal)) + '</span></div>' +
          (x.goalToDate != null ? '<div style="margin-top:4px">esperado até hoje: ' + esc(F.money0(x.goalToDate)) + '</div>' : '') + '</div></div>';
      }
      h += '</section>';
      h += '<div class="chart-title" style="margin-top:16px">Faturado por ' + UNIT_NAME[v.unit][0] + '</div>' + (x.goal != null ? '<div class="legend"><span><i class="key-rect" style="background:var(--s1)"></i>Faturado</span><span><i class="key-line" style="background:var(--ink-2)"></i>Meta individual</span></div>' : '') +
        '<div class="chart" data-chart="agd-sales"></div>';
      if (x.byProduct.length) {
        h += '<details class="more"><summary>Ver por produto vendido ' + ICON.chevron + '</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Produto</th><th class="num">Vendas</th><th class="num">Valor</th><th>% do faturado</th></tr></thead><tbody>' +
          x.byProduct.map((p) => '<tr><td class="strong">' + esc(p.name) + '</td><td class="num">' + p.count + '</td><td class="num">' + esc(F.money(p.value)) + '</td><td><div class="share"><span class="bar" style="width:' + (p.share * 100).toFixed(1) + '%"></span><span class="small ink2">' + F.pct(p.share) + '</span></div></td></tr>').join('') +
          '</tbody></table></div></details>';
      }
      return h + '</div>';
    },

    // ---------------- Equipe (v1.8) ----------------
    /** Valor usado para ordenar uma linha da Equipe pela coluna `key` (null = vai para o fim). */
    _teamSortVal(w, key) {
      if (key === 'name') return w.name;
      if (key === 'const') return w.constancy;
      if (key === 'conv') return w.conv && !w.conv.missing.length ? w.conv.value : null;
      if (key === 'react') return w.react && !w.react.missing.length ? w.react.value : null;
      // sem venda no período aparece como — e vai para o fim, como os outros vazios
      if (key === 'sales') return w.sales.count || null;
      if (key === 'revenue') return w.sales.count ? w.sales.revenue : null;
      if (key === 'goal') return w.sales.pct;
      const i = /^stage:(\d+)$/.exec(key);
      return i && w.stages[+i[1]] ? w.stages[+i[1]].total : null;
    },
    /** Linhas da Equipe na ordem escolhida (padrão: maior conversão primeiro). */
    _teamRows(t) {
      const so = this._ds().agdTeamSort || { key: 'conv', dir: -1 };
      return t.rows.map((w, i) => ({ w, i })).sort((a, b) => {
        const x = this._teamSortVal(a.w, so.key), y = this._teamSortVal(b.w, so.key);
        if (x == null || y == null) return (x == null) - (y == null) || a.i - b.i;
        return (typeof x === 'string' ? x.localeCompare(y, 'pt-BR') : x - y) * so.dir || a.i - b.i;
      }).map((x) => x.w);
    },
    _teamHTML(t) {
      const st = this._ds(), r = t.range;
      const longo = D.span(r.from, r.to) > 62;
      const ub = (u, l) => '<button type="button" class="' + (t.unit === u ? 'on' : '') + '" data-act="agd-unit" data-unit="' + u + '" aria-pressed="' + (t.unit === u) + '"' +
        (u === 'day' && longo ? ' disabled title="Por dia só em períodos de até 62 dias"' : '') + '>' + l + '</button>';
      const mode = '<div class="subnav" role="group" aria-label="Visão" style="margin:0"><button type="button" data-act="agd-mode" data-mode="agent" aria-pressed="false">Agente</button><button type="button" class="on" data-act="agd-mode" data-mode="team" aria-pressed="true">Equipe</button></div>';
      const prodSel = t.products.length > 1 || t.product ? '<select class="inp" style="width:auto;max-width:240px" data-chg="agd-team-product" aria-label="Produto"><option value="">Todos os produtos (' + t.products.length + ')</option>' +
        t.products.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === t.product ? ' selected' : '') + '>' + esc(x.name) + (x.active ? '' : ' (arquivado)') + '</option>').join('') + '</select>' : '';
      let h = '<div data-ref="agdash"><div class="toolbar">' + mode + this._periodChip('agdash') + prodSel +
        '<div class="subnav" role="group" aria-label="Agrupar por" style="margin:0">' + ub('day', 'Dia') + ub('week', 'Semana') + ub('month', 'Mês') + '</div>' +
        '<span class="range-note">' + (st.agdUnit && st.agdUnit === t.unit ? '' : 'automático') + '</span></div>';
      const refresh = '<button type="button" class="icon-btn" data-act="painel-refresh" title="Atualizar (reler o banco)" aria-label="Atualizar">' + ICON.refresh + '</button>';
      const card = (inner) => '<div class="card"><div class="empty">' + inner + '</div></div>';
      if (t.status === 'noagents') return h + '<div class="toolbar">' + refresh + '</div>' + card('<strong>Nenhum agente cadastrado.</strong>Cadastre em Cadastros → Vendedores / Agentes.') + '</div>';
      if (t.status === 'future') return h + '<div class="toolbar">' + refresh + '</div>' + card('<strong>Este período ainda não começou.</strong>Escolha outro período.') + '</div>';
      const prevTxt = D.fmt(t.prev.from) + (t.prev.from !== t.prev.to ? ' – ' + D.fmt(t.prev.to) : '');
      const n = t.rows.length;
      h += '<p class="agd-head" data-ref="agd-team-head"><b>Equipe</b><span>· ' + n + (n === 1 ? ' agente com registros' : ' agentes com registros') + ' no período' + (t.product ? ' em ' + esc(t.products.find((x) => x.id === t.product).name) : '') + '</span>' +
        '<span>· comparado com ' + prevTxt + (t.prev.same ? ' (até o mesmo ponto)' : '') + '</span><span class="spacer"></span>' +
        '<span class="agd-actions"><button type="button" class="btn btn-ghost btn-sm" data-act="agd-team-csv">' + ICON.download + 'CSV</button><button type="button" class="btn btn-sm" data-act="agd-conv-edit" title="Quais métricas formam a conversão, a taxa de resposta e a resposta da reativação (vale para todos os agentes)">' + ICON.gear + 'Taxas</button>' + refresh + '</span></p>';
      if (!n) return h + card('<strong>Nenhum agente com lançamento no Diário ou venda neste período' + (t.product ? ' neste produto' : '') + '.</strong>Escolha outro período.') + this._teamNotes(t) + '</div>';

      // ---------- ranking ----------
      const so = st.agdTeamSort || { key: 'conv', dir: -1 };
      const th = (key, label, num, title) => '<th' + (num ? ' class="num"' : '') + ' aria-sort="' + (so.key === key ? (so.dir > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button" class="th-sort' + (so.key === key ? ' on' : '') + '" data-act="agd-sort" data-key="' + key + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(label) + (so.key === key ? (so.dir > 0 ? ' ▲' : ' ▼') : '') + '</button></th>';
      const rows = this._teamRows(t);
      const conv = t.conv, resp = t.response;
      const respIdx = resp ? t.stages.findIndex((x) => x.id === resp.toId) : -1;
      const respTip = resp ? 'Taxa de resposta: ' + resp.to + ' ÷ ' + resp.from + ', só nos dias e produtos com as duas lançadas' : '';
      const respLine = (rr) => (!rr ? '' : rr.missing.length ? '<div class="small muted" title="' + esc('Sem lançamentos de ' + rr.missing.join(' e ')) + '">— de resposta</div>'
        : '<div class="small ink2" data-ref="team-resp" title="' + esc(respTip) + '">' + esc(F.pct(rr.value, 1)) + ' de resposta</div>');
      const convMax = Math.max.apply(null, rows.map((w) => (w.conv && w.conv.value) || 0).concat([0])) || 1;
      // reativação (v1.9): coluna só quando alguém lança
      const rx = t.react && rows.some((w) => w.react) ? t.react : null;
      const reactCell = (x) => (!x ? '<span class="muted">—</span>'
        : x.missing.length || x.value == null ? '<span class="muted" title="' + esc(x.status === 'ok' && x.missing.length ? 'Sem lançamentos de ' + x.missing.join(' e ') + ' no período' : 'Sem reativação no período') + '">—</span>'
          : '<span class="strong">' + esc(F.pct(x.value, 1)) + '</span><div class="small muted">' + esc(F.num(x.num) + ' de ' + F.num(x.den)) + '</div>' + (x.noPrev ? '' : '<div class="small">' + (ppDelta(x.value, x.prev) || '') + '</div>'));
      const mSel = t.metrics.length ? '<select class="inp sm" style="width:auto;max-width:200px" data-chg="agd-team-metric" aria-label="Métrica da tendência">' + t.metrics.map((m) => '<option value="' + esc(m.id) + '"' + (m.id === t.metric ? ' selected' : '') + '>' + esc(m.name) + '</option>').join('') + '</select>' : '';
      let b = '';
      rows.forEach((w, i) => {
        const cv = w.conv;
        const convCell = !cv ? '<span class="muted">—</span>'
          : cv.missing.length ? '<span class="muted" title="' + esc('Sem lançamentos de ' + cv.missing.join(' e ') + ' no período') + '">—</span>'
            : '<div class="share"><span class="bar" style="width:' + ((cv.value || 0) / convMax * 60).toFixed(1) + 'px"></span><span class="strong">' + esc(F.pct(cv.value, 1)) + '</span></div>' +
              (w.noPrev ? '' : '<div class="small">' + (ppDelta(cv.value, cv.prev) || '') + '</div>');
        b += '<tr data-agent="' + esc(w.id) + '"' + (w.active ? '' : ' class="archived"') + '><td class="rank">' + (i + 1) + '</td>' +
          '<td><button type="button" class="link strong" data-act="agd-open" data-id="' + esc(w.id) + '" title="Abrir o dashboard deste agente">' + esc(w.name) + '</button>' + (w.active ? '' : ' <span class="pill">arquivado</span>') + '</td>' +
          '<td class="num">' + (w.constancy == null ? '<span class="muted">—</span>' : esc(F.pct(w.constancy)) + '<div class="small muted">' + w.days + ' de ' + w.periodDays + '</div>') + '</td>' +
          w.stages.map((x, j) => '<td class="num">' + (x ? esc(F.num(x.total)) + (j === respIdx ? respLine(w.response) : '') + (w.noPrev || x.prev == null ? '' : '<div class="small">' + (deltaHTML(x.total, x.prev) || '') + '</div>') : '<span class="muted">—</span>') + '</td>').join('') +
          '<td class="num">' + convCell + '</td>' + (rx ? '<td class="num" data-ref="team-react">' + reactCell(w.react) + '</td>' : '') +
          '<td class="num">' + (w.sales.count || w.sales.revenue ? w.sales.count : '<span class="muted">—</span>') + '</td>' +
          '<td class="num">' + (w.sales.count ? esc(F.money0(w.sales.revenue)) + (w.sales.noPrev ? '' : '<div class="small">' + (deltaHTML(w.sales.revenue, w.sales.prevRevenue, { money: true }) || '') + '</div>') : '<span class="muted">—</span>') + '</td>' +
          '<td>' + (w.sales.goal != null ? meterCell(w.sales.pct, w.sales.status, this.store.settings) : '<span class="muted">—</span>') + '</td>' +
          '<td class="spark-cell">' + sparkSVG(w.spark) + '</td></tr>';
      });
      const T = t.total;
      const foot = '<tr><td></td><td>Equipe</td><td></td>' + T.stages.map((v, j) => '<td class="num">' + esc(F.num(v)) + (j === respIdx && T.response != null ? '<div class="small" data-ref="team-resp-total" title="' + esc(respTip) + '">' + esc(F.pct(T.response, 1)) + ' de resposta</div>' : '') + '</td>').join('') +
        '<td class="num"' + (conv && conv.mixed ? ' title="Cada agente usa a própria conversão automática (última etapa ÷ primeira): escolha a conversão no botão Conversão para somar a equipe"' : '') + '>' + (T.conv == null ? '<span class="muted">—</span>' : esc(F.pct(T.conv, 1))) + '</td>' +
        (rx ? '<td class="num" data-ref="team-react-total">' + (T.react == null ? '<span class="muted">—</span>' : esc(F.pct(T.react, 1))) + '</td>' : '') +
        '<td class="num">' + T.count + '</td><td class="num">' + esc(F.money0(T.revenue)) + '</td><td></td><td></td></tr>';
      h += '<div class="card" data-card="agd-team"><div class="card-head"><div><h3>Ranking da equipe</h3><p class="sub">Clique no título de uma coluna para ordenar e no nome para abrir o dashboard do agente · conversão = ' +
        (conv ? esc(conv.to) + ' ÷ ' + esc(conv.from) + (conv.custom ? '' : ' (automático)') : 'última etapa ÷ primeira') + '</p></div><span class="spacer"></span>' +
        (mSel ? '<label class="small ink2" style="display:inline-flex;gap:6px;align-items:center">Tendência de ' + mSel + '</label>' : '') + '</div>' +
        '<div class="tbl-wrap"><table class="tbl team-tbl"><thead><tr><th>#</th>' + th('name', 'Agente') + th('const', 'Constância', true, 'Dias com lançamento ÷ dias desde o início do agente no período') +
        t.stages.map((x, i) => th('stage:' + i, x.name, true, i === respIdx ? 'Abaixo do número: a taxa de resposta (' + resp.to + ' ÷ ' + resp.from + ')' : '')).join('') + th('conv', 'Conversão', true) + (rx ? th('react', 'Resposta da reativação', true, rx.to + ' ÷ ' + rx.from + ', só nos dias e produtos com as duas lançadas') : '') + th('sales', 'Vendas', true, 'Vendas com o agente na coluna Vendedor') + th('revenue', 'Faturado', true) + th('goal', 'Meta individual') +
        '<th>Tendência</th></tr></thead><tbody>' + b + '</tbody><tfoot>' + foot + '</tfoot></table></div></div>';

      // ---------- constância por dia ----------
      if (t.days) {
        const today = D.today(), ws = this.store.settings.week_start;
        const head = t.days.map((dt) => '<span class="d">' + (D.fromISO(dt).getDay() === ws || dt === t.days[0] ? D.fmtShort(dt) : '') + '</span>').join('');
        h += '<div class="card" data-card="agd-team-cal"><div class="card-head"><div><h3>Constância de preenchimento</h3><p class="sub">Um quadrado por dia: com lançamento, sem lançamento ou antes do primeiro lançamento do agente (vazio)</p></div></div>' +
          '<div class="team-cal"><div class="team-cal-row head" aria-hidden="true"><span class="lbl"></span><span class="cells">' + head + '</span><span class="val"></span></div>' +
          rows.filter((w) => w.calendar).map((w) => '<div class="team-cal-row" data-agent="' + esc(w.id) + '"><span class="lbl" title="' + esc(w.name) + '">' + esc(w.name) + '</span><span class="cells" role="img" aria-label="' + esc(w.name + ': lançou em ' + w.days + ' de ' + w.periodDays + ' dias') + '">' +
            w.calendar.map((c, j) => { const dt = t.days[j]; return c == null ? '<span class="c pad"></span>' : '<span class="c' + (c ? ' on' : '') + (dt === today ? ' today' : '') + '" data-tip="' + esc(tipHTML(w.name + ' · ' + D.dowLong(dt) + ', ' + D.fmt(dt), [{ value: c ? F.int(c) : 'sem lançamento', label: c ? (c === 1 ? 'lançamento' : 'lançamentos') : '' }])) + '"></span>'; }).join('') +
            '</span><span class="val">' + (w.periodDays ? w.days + '/' + w.periodDays : '—') + '</span></div>').join('') + '</div>' +
          '<div class="legend" style="margin-top:8px"><span><i class="key-rect" style="background:var(--s1)"></i>com lançamento</span><span><i class="key-rect hollow"></i>sem lançamento</span></div></div>';
      }
      return h + this._teamNotes(t) + '</div>';
    },
    _teamNotes(t) {
      return '<p class="small muted" style="margin-top:12px">As contas de cada linha são as mesmas do dashboard do agente (taxas só com as duas métricas no mesmo dia e produto; vendas pela coluna Vendedor). ' +
        'Conversão da equipe = soma dos numeradores ÷ soma dos denominadores dos agentes (a resposta da reativação também). Mídias sociais ficam fora (estão no dashboard de quem lança nelas). Tendência = a métrica escolhida por ' + UNIT_NAME[t.unit][0] + ', na mesma escala de cada agente (mostra a forma, não compara tamanhos).' +
        (t.hidden.length ? ' Ocultos (Visão por Agente → Agentes e ordem): ' + esc(t.hidden.join(', ')) + '.' : '') + '</p>';
    },

    /** Métrica do gráfico "Evolução": a escolhida (se ainda existir no período) ou o primeiro indicador. */
    _agdMetric(v) {
      const d = v.daily, st = this._ds(), ok = (id) => d.buckets.length > 0 && Object.prototype.hasOwnProperty.call(d.buckets[0].m, id);
      if (st.agdMetric && ok(st.agdMetric)) return st.agdMetric;
      const k = d.kpis.find((x) => !x.conv && ok(x.id));
      return k ? k.id : (d.cols.concat(d.others)[0] || {}).id || '';
    },
    _agdRate(v) {
      const st = this._ds(), rates = v.daily.rates;
      return st.agdRate && rates.some((x) => x.id === st.agdRate) ? st.agdRate : rates.length ? rates[0].id : '';
    },

    _drawAgd() {
      const v = this._agd;
      if (!v || this.tab !== 'diario' || this._ds().sub !== 'agdash' || !v.agent) return;
      this._charts = {};
      const q = (sel) => this._view.querySelector(sel), d = v.daily, B = d.buckets, P = d.prevBuckets;
      const few = 'Só há ' + (v.unit === 'week' ? 'uma semana' : v.unit === 'month' ? 'um mês' : 'um dia') + ' com lançamento neste período: escolha um período maior' + (v.unit === 'day' ? '' : ' ou agrupe por dia') + ' para ver a evolução.';
      const heads = B.map((b) => b.head + (b.partial ? ' (em andamento)' : ''));
      const xLabels = B.map((b) => b.label);
      const prevNotes = B.map((b, i) => (P[i] ? D.fmtShort(P[i].from) + (P[i].from !== P[i].to ? '–' + D.fmtShort(P[i].to) : '') : null));
      let el = q('[data-chart=agd-evol]');
      if (el) {
        const id = this._agdMetric(v), m = this.store.get('metrics', id), money = m && m.kind === 'money';
        const fmt = money ? F.moneyShort : (x) => F.num(x);
        this._lineChart(el, 'agd-evol', {
          labels: B.map((b) => b.from), heads, xLabels, few, fmt, tipFmt: money ? F.money : (x) => F.num(x), ratioLabel: 'do período anterior', aria: 'Gráfico de linha: ' + (m ? m.name : '') + ' por ' + UNIT_NAME[v.unit][0],
          // sem área: grupos sem lançamento interrompem a linha
          series: [{ name: 'Este período', color: 'var(--s1)', end: true, values: B.map((b) => (b.m[id] === undefined ? null : b.m[id])) }]
            .concat(d.noPrev ? [] : [{ name: 'Período anterior', color: 'var(--ref)', values: B.map((b, i) => (P[i] && P[i].m[id] != null ? P[i].m[id] : null)), notes: prevNotes }]),
        });
      }
      el = q('[data-chart=agd-rate]');
      if (el) {
        const id = this._agdRate(v), rt = d.rates.find((x) => x.id === id);
        const val = (b) => (b && b.rates[id] ? b.rates[id].value : null);
        this._lineChart(el, 'agd-rate', {
          labels: B.map((b) => b.from), heads, xLabels, few, fmt: (x) => F.pct(x, 1), tipFmt: (x) => F.pct(x, 1), ratioLabel: false, aria: 'Gráfico de linha: ' + (rt ? rt.name : '') + ' por ' + UNIT_NAME[v.unit][0],
          series: [{ name: 'Este período', color: 'var(--s1)', end: true, values: B.map(val), notes: B.map((b) => (b.rates[id] && b.rates[id].days ? 'base ' + b.rates[id].days + (b.rates[id].days === 1 ? ' dia' : ' dias') : 'sem dias com as duas métricas')) }]
            .concat(d.noPrev ? [] : [{ name: 'Período anterior', color: 'var(--ref)', values: B.map((b, i) => val(P[i])), notes: prevNotes }]),
        });
      }
      el = q('[data-chart=agd-react]');
      if (el && d.react) {
        const x = d.react, val = (b) => (b && b.react ? b.react.value : null);
        this._lineChart(el, 'agd-react', {
          labels: B.map((b) => b.from), heads, xLabels, few, fmt: (n) => F.pct(n, 1), tipFmt: (n) => F.pct(n, 1), ratioLabel: false, aria: 'Gráfico de linha: taxa de resposta da reativação por ' + UNIT_NAME[v.unit][0],
          series: [{ name: 'Este período', color: 'var(--s1)', end: true, values: B.map(val), notes: B.map((b) => (b.react && b.react.days ? F.num(b.react.num) + ' de ' + F.num(b.react.den) + ' · base ' + b.react.days + (b.react.days === 1 ? ' dia' : ' dias') : 'sem dias com as duas métricas')) }]
            .concat(x.noPrev ? [] : [{ name: 'Período anterior', color: 'var(--ref)', values: B.map((b, i) => val(P[i])), notes: prevNotes }]),
        });
      }
      el = q('[data-chart=agd-social]');
      if (el && d.social && d.social.metrics.length) {
        const so = d.social, st = this._ds();
        const mid = so.metrics.some((m) => m.id === st.agdSocMetric) ? st.agdSocMetric : so.metrics[0].id;
        const net = so.networks.some((n) => n.id === st.agdSocNet) ? st.agdSocNet : '';
        const m = so.metrics.find((x) => x.id === mid), money = m.kind === 'money';
        const val = (b) => (!b ? null : net ? b.net[net][mid] : b.m[mid]);
        const netName = net ? so.networks.find((n) => n.id === net).name : 'todas as redes';
        this._lineChart(el, 'agd-social', {
          labels: so.buckets.map((b) => b.from), heads, xLabels, few, fmt: money ? F.moneyShort : (n) => F.num(n), tipFmt: money ? F.money : (n) => F.num(n), ratioLabel: 'do período anterior',
          aria: 'Gráfico de linha: ' + m.name + ' (' + netName + ') por ' + UNIT_NAME[v.unit][0],
          series: [{ name: 'Este período', color: 'var(--s1)', end: true, values: so.buckets.map(val) }]
            .concat(so.noPrev ? [] : [{ name: 'Período anterior', color: 'var(--ref)', values: so.buckets.map((b, i) => val(so.prevBuckets[i])), notes: prevNotes }]),
        });
      }
      el = q('[data-chart=agd-sales]');
      if (el) {
        const x = v.sales, goal = x.goal != null;
        this._barsChart(el, {
          money: true, aria: 'Gráfico de colunas: faturado por ' + UNIT_NAME[v.unit][0] + (goal ? ' e meta individual' : ''),
          pts: x.buckets.map((b) => ({
            label: b.label, partial: b.partial, value: b.revenue, goal: goal ? b.goal : null, pct: goal && b.goal ? b.revenue / b.goal : null,
            tip: tipHTML(b.head + (b.partial ? ' (em andamento)' : ''), [{ color: 'var(--s1)', rect: true, value: F.money(b.revenue), label: 'faturado' }, { value: String(b.count), label: b.count === 1 ? 'venda' : 'vendas' }]
              .concat(goal ? [{ color: 'var(--ink-2)', value: b.goal != null ? F.money(b.goal) : '—', label: 'meta individual' }] : [])
              .concat(goal && b.goal ? [{ value: F.pct(b.revenue / b.goal), label: 'da meta' + (b.partial ? ' (do ' + UNIT_NAME[v.unit][0] + ' inteiro)' : '') }] : [])),
          })),
        });
      }
    },

    /**
     * Modal "Personalizar" (v1.9): seções do dashboard (ordem e quais aparecem) e indicadores do topo, só deste agente.
     * Os outros agentes não mudam, a não ser os marcados em "Aplicar a mesma escolha a outros agentes".
     */
    _agdEditor() {
      const s = this.store, v = this._agd;
      if (!v || !v.agent) return;
      const id = v.agent.id, conf = s.settings.agent_dashboard.agents[id], d = v.daily;
      const chosen = d.kpis.map((k) => k.id);
      const used = new Set(agdMetricIds(d));
      const rp = reactivationPair(s);
      const all = [AGD_CONV, AGD_REACT].concat(s.list('metrics').map((m) => sid(m.id)));
      const items = chosen.concat(all.filter((x) => chosen.indexOf(x) < 0)).map((x) => ({
        id: x, name: x === AGD_CONV ? 'Conversão' : x === AGD_REACT ? 'Resposta da reativação' : s.name('metrics', x), state: chosen.indexOf(x) > -1,
        hint: x === AGD_CONV ? (d.conv ? d.conv.to + ' ÷ ' + d.conv.from : 'última etapa ÷ primeira etapa')
          : x === AGD_REACT ? (rp ? s.name('metrics', rp.to) + ' ÷ ' + s.name('metrics', rp.from) : 'sem métricas de reativação') : used.has(x) ? 'lançou no período' : '',
      }));
      const hint = {
        react: d.react ? '' : 'só para quem lança reativação', social: d.social ? '' : 'só para quem lança nas mídias sociais (sem filtro de produto)',
        income: d.income ? '' : 'sem faixas de renda no período', prod: d.byProduct.length > 1 ? '' : 'com 2 produtos ou mais', rates: d.rates.length ? '' : 'sem taxas no período',
      };
      const L = v.layout;
      const secItems = L.order.map((x) => ({ id: x, name: AGD_SECTIONS.find((y) => y[0] === x)[1], state: L.hidden.indexOf(x) < 0, hint: hint[x] || '' }));
      const others = s.list('sellers').filter((x) => sid(x.id) !== id);
      const off = (it) => !it.state;
      const entry = this._openModal({
        title: 'Personalizar — ' + v.agent.name, size: 'wide', autofocus: false,
        ctx: { ol: { items, check: 'Exibir', off }, ols: { sec: { items: secItems, check: 'Exibir', off } }, agent: id, autoKpis: d.autoKpis.slice(), hadKpis: !!(conf && conf.kpis) },
        body: '<p class="ink2" style="margin-bottom:12px">Escolha o que aparece no dashboard de <b>' + esc(v.agent.name) + '</b> e em que ordem (setas). Vale só para ' + esc(v.agent.name) + ': os outros agentes não mudam.</p>' +
          '<div class="agd-layout"><div><h4>Seções</h4><div data-ol="sec"></div><p class="small muted" style="margin-top:8px">Duas seções menores seguidas ficam lado a lado.</p>' +
          '<button type="button" class="btn btn-ghost btn-sm" style="margin-top:8px" data-act="agd-social-edit">' + ICON.gear + 'Mídias sociais (todos os agentes)</button></div>' +
          '<div><h4>Indicadores do topo</h4><div data-ol></div><p class="small muted" style="margin-top:8px">' +
          (conf && conf.kpis ? 'Hoje usa esta escolha.' : 'Hoje está no <b>automático</b> (início e fim do funil, conversão e valores em R$); mudar a lista fixa a escolha.') + '</p></div></div>' +
          (others.length ? '<details class="more" style="margin-top:12px"><summary>Aplicar a mesma escolha a outros agentes ' + ICON.chevron + '</summary>' +
            '<label class="check" style="margin-top:10px"><input type="checkbox" data-chg="agd-copy-all"> <b>Todos os agentes</b></label>' +
            '<div style="display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));margin-top:10px">' +
            others.map((x) => '<label class="check"><input type="checkbox" data-ref="agd-copy" value="' + esc(x.id) + '"> ' + esc(x.name) + '</label>').join('') + '</div></details>' : ''),
        footer: (conf ? '<button type="button" class="btn btn-ghost" data-act="agd-auto">Voltar ao padrão</button><span class="spacer"></span>' : '') +
          '<button type="button" class="btn" data-act="modal-close">Cancelar</button><button type="button" class="btn btn-primary" data-act="agd-save">' + ICON.save + 'Salvar</button>',
      });
      this._olRedraw(entry);
      this._olRedraw(entry, null, null, 'sec');
      const first = entry.body.querySelector('[data-chg=ol-state]');
      if (first) setTimeout(() => first.focus(), 20);
      return entry;
    },
    /** Modal "Mídias sociais" (v1.9): quais produtos são mídias sociais e quais métricas aparecem — para todos os agentes. */
    _agdSocialEditor() {
      const s = this.store, v = this._agd, cfg = socialConfig(s);
      const autoP = s.list('products', { all: true }).filter((p) => SOCIAL_RE.test(norm(p.name))).map((p) => sid(p.id));
      const prods = s.list('products', { all: true }).filter((p) => p.active !== false || cfg.products.indexOf(sid(p.id)) > -1);
      const shown = v && v.daily && v.daily.social ? v.daily.social.metrics.map((m) => m.id) : (cfg.metrics || []);
      const all = s.list('metrics').map((m) => sid(m.id));
      const items = shown.concat(all.filter((x) => shown.indexOf(x) < 0)).map((x) => ({ id: x, name: s.name('metrics', x), state: shown.indexOf(x) > -1 }));
      const entry = this._openModal({
        title: 'Mídias sociais', size: 'wide', autofocus: false,
        ctx: { ol: { items, check: 'Exibir', off: (it) => !it.state }, autoProducts: autoP, shown: shown.slice(), hadProducts: cfg.customProducts, hadMetrics: cfg.customMetrics },
        body: '<p class="ink2" style="margin-bottom:12px">Produtos com fluxo próprio (ex.: TikTok e Instagram) saem do funil, das taxas e do "Por produto" e ganham a seção <b>Mídias sociais</b>, que só aparece para quem lança neles. Vale para <b>todos os agentes</b>.</p>' +
          '<div class="agd-layout"><div><h4>Produtos que são mídias sociais</h4><div style="display:grid;gap:8px">' +
          prods.map((p) => '<label class="check"><input type="checkbox" data-ref="soc-prod" value="' + esc(p.id) + '"' + (cfg.products.indexOf(sid(p.id)) > -1 ? ' checked' : '') + '> ' + esc(p.name) + (p.active === false ? ' <span class="pill">arquivado</span>' : '') + '</label>').join('') + '</div>' +
          '<p class="small muted" style="margin-top:8px">' + (cfg.customProducts ? 'Hoje usa esta escolha.' : 'Hoje está no <b>automático</b>: reconhecidos pelo nome (TikTok, Instagram, Facebook, YouTube, Kwai…).') + '</p></div>' +
          '<div><h4>Métricas da seção</h4><div data-ol></div><p class="small muted" style="margin-top:8px">A ordem é a da tabela; o % de cada métrica é sobre a de cima. ' +
          (cfg.customMetrics ? 'Hoje usa esta escolha.' : 'Hoje está no <b>automático</b> (as que o agente lançou, na ordem do funil); mudar a lista fixa a escolha.') + '</p></div></div>',
        footer: (cfg.customProducts || cfg.customMetrics ? '<button type="button" class="btn btn-ghost" data-act="agd-social-auto">Voltar ao automático</button><span class="spacer"></span>' : '') +
          '<button type="button" class="btn" data-act="modal-close">Cancelar</button><button type="button" class="btn btn-primary" data-act="agd-social-save">' + ICON.save + 'Salvar</button>',
      });
      this._olRedraw(entry);
      return entry;
    },
    async _saveAgentDashboard(fn) {
      const cfg = JSON.parse(JSON.stringify(this.store.settings.agent_dashboard));
      fn(cfg);
      await this.store.setSetting('agent_dashboard', cfg);
    },
  };

  Object.assign(ACT, {
    'agd-unit'(el) { this._ds().agdUnit = el.dataset.unit; return this.render(); },
    'agd-mode'(el) { this._ds().agdMode = el.dataset.mode; this._busy(); return this.render(); },
    'agd-open'(el) { const st = this._ds(); st.agdMode = 'agent'; st.agdAgent = el.dataset.id; st.agdProduct = st.agdTeamProduct || ''; this._busy(); return this.render(); },
    'agd-sort'(el) {
      const st = this._ds(), so = st.agdTeamSort || { key: 'conv', dir: -1 }, key = el.dataset.key;
      // mesma coluna inverte; coluna nova começa do maior (nome: de A a Z)
      st.agdTeamSort = { key, dir: so.key === key ? -so.dir : key === 'name' ? 1 : -1 };
      if (this._team) { this._view.querySelector('[data-ref=agdash]').outerHTML = this._teamHTML(this._team); const b = this._view.querySelector('[data-act=agd-sort][data-key="' + key + '"]'); if (b) b.focus(); }
    },
    'agd-team-csv'() {
      const t = this._team;
      if (!t) return;
      const r = t.range, num = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
      const head = ['Agente', 'Dias com lançamento', 'Dias desde o início'].concat(t.stages.map((x) => x.name), ['Taxa de resposta (%)', 'Conversão (%)', 'Reativação', 'Resposta da reativação (%)', 'Vendas (como vendedor)', 'Faturado (como vendedor)', 'Meta individual (%)']);
      const rate = (x) => (x && x.value != null && !x.missing.length ? num(x.value * 100) : '');
      const rows = [head].concat(this._teamRows(t).map((w) => [w.name, w.days, w.periodDays].concat(
        w.stages.map((x) => (x ? num(x.total) : '')),
        [rate(w.response), rate(w.conv), w.react ? num(w.react.total) : '', rate(w.react), w.sales.count, csvMoney(w.sales.revenue), w.sales.pct != null ? num(w.sales.pct * 100) : ''])));
      rows.push(['Equipe', '', ''].concat(t.total.stages.map(num), [t.total.response != null ? num(t.total.response * 100) : '', t.total.conv != null ? num(t.total.conv * 100) : '',
        t.react ? num(t.total.reactTotal) : '', t.total.react != null ? num(t.total.react * 100) : '', t.total.count, csvMoney(t.total.revenue), '']));
      this._download('equipe_' + r.from + '_a_' + r.to + '.csv', toCSV(rows), 'text/csv;charset=utf-8');
    },
    'agd-since'(el) {
      this.periods.agdash = { preset: 'custom', from: el.dataset.from, to: D.today() };
      return this._onPeriodChange('agdash');
    },
    'agd-custom'() { this._agdEditor(); },
    /** Conversão, taxa de resposta e resposta da reativação de todos os agentes: numerador ÷ denominador (ex.: Vendidos ÷ Leads que Responderam). */
    async 'agd-conv-edit'() {
      const s = this.store, cur = s.settings.agent_dashboard.conversion, rc = s.settings.agent_dashboard.response, xc = s.settings.agent_dashboard.reactivation;
      const keep = [cur, rc, xc].filter(Boolean).reduce((a, c) => a.concat([c.from, c.to]), []);
      const ms = s.list('metrics', { all: true }).filter((m) => m.kind === 'count' && (m.active !== false || keep.indexOf(sid(m.id)) > -1))
        .map((m) => [sid(m.id), m.name + (m.active === false ? ' (arquivada)' : '')]);
      const auto = responsePair(s, true), xauto = reactivationPair(s, true);
      const opts = [['', 'Automático (última etapa ÷ primeira)']].concat(ms);
      const ropts = [['', 'Automático' + (auto ? ' (' + s.name('metrics', auto.to) + ' ÷ ' + s.name('metrics', auto.from) + ')' : ' (pelo nome: Respond… ÷ Contatad…)')]].concat(ms);
      const xopts = [['', 'Automático' + (xauto ? ' (' + s.name('metrics', xauto.to) + ' ÷ ' + s.name('metrics', xauto.from) + ')' : ' (pelo nome: Respond… Reativ… ÷ Reativ…)')]].concat(ms);
      const v = await this._form({
        title: 'Taxas do Dashboard Agentes', ok: 'Salvar',
        intro: 'Cada taxa = <b>numerador ÷ denominador</b>, contando só os dias e produtos em que o agente lançou as duas métricas. Vale para <b>todos os agentes</b>. Ex.: conversão = Vendidos ÷ Leads que Responderam; taxa de resposta = Leads que Responderam ÷ Leads Contatadas; resposta da reativação = Leads que Responderam - Reativação ÷ Reativação.',
        fields: [
          { key: 'to', label: 'Conversão: numerador', type: 'select', options: opts, value: cur ? cur.to : '' },
          { key: 'from', label: 'Conversão: dividido por', type: 'select', options: opts, value: cur ? cur.from : '' },
          { key: 'rto', label: 'Taxa de resposta: numerador', type: 'select', options: ropts, value: rc ? rc.to : '' },
          { key: 'rfrom', label: 'Taxa de resposta: dividido por', type: 'select', options: ropts, value: rc ? rc.from : '' },
          { key: 'xto', label: 'Resposta da reativação: numerador', type: 'select', options: xopts, value: xc ? xc.to : '' },
          { key: 'xfrom', label: 'Resposta da reativação: dividido por', type: 'select', options: xopts, value: xc ? xc.from : '' },
        ],
        validate: (x) => (!x.to !== !x.from || !x.rto !== !x.rfrom || !x.xto !== !x.xfrom ? 'Escolha as duas métricas de cada taxa (ou deixe as duas no automático).'
          : (x.to && x.to === x.from) || (x.rto && x.rto === x.rfrom) || (x.xto && x.xto === x.xfrom) ? 'Escolha métricas diferentes.' : null),
      });
      if (!v) return;
      await this._saveAgentDashboard((cfg) => { cfg.conversion = v.to ? { from: v.from, to: v.to } : null; cfg.response = v.rto ? { from: v.rfrom, to: v.rto } : null; cfg.reactivation = v.xto ? { from: v.xfrom, to: v.xto } : null; });
      this._toast(v.to ? 'Conversão: ' + s.name('metrics', v.to) + ' ÷ ' + s.name('metrics', v.from) + '.' : 'Conversão no automático.');
      await this.render();
    },
    async 'agd-save'(el) {
      const entry = this._modalOf(el), c = entry.ctx, ids = c.ol.items.filter((it) => it.state).map((it) => String(it.id));
      const order = c.ols.sec.items.map((it) => it.id), hidden = c.ols.sec.items.filter((it) => !it.state).map((it) => it.id);
      if (hidden.length === order.length) { this._toast('Deixe ao menos uma seção visível.', 'error'); return; }
      if (!ids.length && hidden.indexOf('kpis') < 0) { this._toast('Marque ao menos um indicador (ou esconda a seção "Indicadores do topo").', 'error'); return; }
      // o que não mudou continua no automático / na ordem padrão (seções e indicadores novos entram sozinhos)
      const autoK = !c.hadKpis && ids.join() === c.autoKpis.join();
      const defLayout = !hidden.length && order.join() === AGD_SECTIONS.map((x) => x[0]).join();
      const targets = [c.agent].concat(Array.from(entry.body.querySelectorAll('[data-ref=agd-copy]:checked')).map((x) => sid(x.value)));
      await this._saveAgentDashboard((cfg) => {
        targets.forEach((id) => {
          const o = {};
          if (!autoK) o.kpis = ids.slice();
          if (!defLayout) { o.order = order.slice(); o.hidden = hidden.slice(); }
          if (Object.keys(o).length) cfg.agents[id] = o; else delete cfg.agents[id];
        });
      });
      this._closeModal(true, entry);
      this._toast(targets.length > 1 ? 'Dashboard personalizado para ' + targets.length + ' agentes.' : 'Dashboard personalizado.');
      await this.render();
    },
    async 'agd-auto'(el) {
      const entry = this._modalOf(el), id = entry.ctx.agent;
      await this._saveAgentDashboard((cfg) => { delete cfg.agents[id]; });
      this._closeModal(true, entry);
      this._toast('Dashboard voltou ao padrão.');
      await this.render();
    },
    'agd-social-edit'(el) {
      const m = this._modalOf(el);
      if (m) this._closeModal(false, m); // vindo do Personalizar: um modal por vez
      this._agdSocialEditor();
    },
    async 'agd-social-save'(el) {
      const entry = this._modalOf(el), c = entry.ctx;
      const prods = Array.from(entry.body.querySelectorAll('[data-ref=soc-prod]:checked')).map((x) => sid(x.value));
      const mets = c.ol.items.filter((it) => it.state).map((it) => String(it.id));
      if (!mets.length) { this._toast('Marque ao menos uma métrica (ou use "Voltar ao automático").', 'error'); return; }
      const sameP = !c.hadProducts && prods.slice().sort().join() === c.autoProducts.slice().sort().join();
      const sameM = !c.hadMetrics && mets.join() === c.shown.join();
      await this._saveAgentDashboard((cfg) => { cfg.social = { products: sameP ? null : prods, metrics: sameM ? null : mets }; });
      this._closeModal(true, entry);
      this._toast('Mídias sociais salvas (valem para todos os agentes).');
      await this.render();
    },
    async 'agd-social-auto'(el) {
      const entry = this._modalOf(el);
      await this._saveAgentDashboard((cfg) => { cfg.social = { products: null, metrics: null }; });
      this._closeModal(true, entry);
      this._toast('Mídias sociais no automático.');
      await this.render();
    },
    'agd-csv'() {
      const v = this._agd;
      if (!v || !v.agent) return;
      const d = v.daily, x = v.sales, r = v.range, so = d.social && d.social.status === 'ok' ? d.social : null;
      const ids = agdMetricIds(d);
      const kinds = ids.map((id) => (this.store.get('metrics', id) || {}).kind);
      // mídias sociais: uma coluna por rede + métrica (ex.: "TikTok · Leads Contatadas")
      const socCols = so ? so.networks.reduce((a, n) => a.concat(so.metrics.map((m) => ({ net: n.id, id: m.id, kind: m.kind, name: n.name + ' · ' + m.name }))), []) : [];
      const socB = new Map(so ? so.buckets.map((b) => [b.to, b]) : []);
      const head = ['Período', 'De', 'Até'].concat(ids.map((id) => this.store.name('metrics', id)), socCols.map((c) => c.name), ['Dias com lançamento', 'Vendas (como vendedor)', 'Faturado (como vendedor)']);
      const sb = new Map(x.buckets.map((b) => [b.to, b]));
      const num = (val) => String(Math.round(val * 100) / 100).replace('.', ',');
      // grupos do Diário e das vendas podem começar em datas diferentes (cada um no seu início): une pelo fim do grupo
      const ends = Array.from(new Set(d.buckets.map((b) => b.to).concat(x.buckets.map((b) => b.to)))).sort();
      const db = new Map(d.buckets.map((b) => [b.to, b]));
      const rows = [head].concat(ends.map((end) => {
        const b = db.get(end), s = sb.get(end), any = b || s;
        const sb2 = socB.get(end);
        return [any.label, D.fmt(any.from), D.fmt(end)].concat(ids.map((id, i) => (b && b.m[id] != null ? (kinds[i] === 'money' ? csvMoney(b.m[id]) : num(b.m[id])) : '')),
          socCols.map((c) => { const val = sb2 && sb2.net[c.net][c.id]; return val == null ? '' : c.kind === 'money' ? csvMoney(val) : num(val); }),
          [b ? b.days : '', s ? s.count : '', s ? csvMoney(s.revenue) : '']);
      }));
      const slug = norm(v.agent.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agente';
      this._download('dashboard_' + slug + '_' + r.from + '_a_' + r.to + '.csv', toCSV(rows), 'text/csv;charset=utf-8');
    },
  });
  Object.assign(CHG, {
    'agd-agent'(el) { const st = this._ds(); st.agdAgent = el.value; st.agdProduct = ''; this._busy(); return this.render(); },
    'agd-product'(el) { this._ds().agdProduct = el.value; this._busy(); return this.render(); },
    'agd-metric'(el) { this._ds().agdMetric = el.value; this._drawAgd(); },
    'agd-rate'(el) { this._ds().agdRate = el.value; this._drawAgd(); },
    'agd-soc-metric'(el) { this._ds().agdSocMetric = el.value; this._drawAgd(); },
    'agd-soc-net'(el) { this._ds().agdSocNet = el.value; this._drawAgd(); },
    'agd-copy-all'(el) { this._modalOf(el).body.querySelectorAll('[data-ref=agd-copy]').forEach((x) => { x.checked = el.checked; }); },
    'agd-team-product'(el) { this._ds().agdTeamProduct = el.value; this._busy(); return this.render(); },
    'agd-team-metric'(el) { this._ds().agdTeamMetric = el.value; this._busy(); return this.render(); },
  });

  Object.assign(ACT, {
    'diario-sub'(el) { this._ds().sub = el.dataset.sub; return this.render(); },
    'ag-custom'(el) { this._agentEditor(el.dataset.id); },
    'renda-custom'() { this._incomeEditor(); },
    'renda-refresh'() { this._ds().inc = null; return this.render(); },
    'renda-since'(el) {
      this.periods.renda = { preset: 'custom', from: el.dataset.from, to: D.today() };
      return this._onPeriodChange('renda');
    },
    'renda-colors-reset'(el) {
      const entry = this._modalOf(el);
      entry.ctx.ol.items.forEach((it) => { it.color = null; });
      this._olRedraw(entry);
    },
    'inc-color-reset'(el) {
      const entry = this._modalOf(el), id = el.closest('[data-ol-id]').dataset.olId;
      const it = entry.ctx.ol.items.find((x) => String(x.id) === id);
      if (it) it.color = null;
      this._olRedraw(entry, id, '[data-chg=inc-color]');
    },
    async 'renda-save'(el) {
      const entry = this._modalOf(el), items = entry.ctx.ol.items;
      const bands = items.filter((it) => it.state === 'band').map((it) => ({ metric_id: String(it.id), color: it.color || null }));
      if (!bands.length) { this._toast('Escolha ao menos uma métrica como faixa de renda (ou use "Voltar ao automático").', 'error'); return; }
      const u = items.find((it) => it.state === 'unq');
      await this.store.setSetting('lead_income', { bands, unqualified: u ? String(u.id) : null });
      this._closeModal(true, entry);
      this._ds().inc = null;
      this._toast('Renda dos Leads atualizada.');
      if (this.tab === 'diario') await this.render();
    },
    async 'renda-auto'(el) {
      const entry = this._modalOf(el);
      await this.store.setSetting('lead_income', null);
      this._closeModal(true, entry);
      this._ds().inc = null;
      this._toast('Renda dos Leads voltou ao automático.');
      if (this.tab === 'diario') await this.render();
    },
    async 'ag-save'(el) {
      const entry = this._modalOf(el), ids = entry.ctx.ol.items.filter((it) => it.state).map((it) => String(it.id));
      if (!ids.length) { this._toast('Marque ao menos uma métrica (ou use "Voltar ao automático").', 'error'); return; }
      const targets = [entry.ctx.agent].concat(Array.from(entry.body.querySelectorAll('[data-ref=ag-copy]:checked')).map((x) => sid(x.value)));
      await this._saveAgentViews((cfg) => { targets.forEach((id) => { cfg.agents[id] = { metrics: ids.slice() }; }); });
      this._closeModal(true, entry);
      this._toast(targets.length > 1 ? 'Personalização salva para ' + targets.length + ' agentes.' : 'Personalização salva.');
      await this.render();
    },
    async 'ag-auto'(el) {
      const entry = this._modalOf(el), id = entry.ctx.agent;
      await this._saveAgentViews((cfg) => { delete cfg.agents[id]; });
      this._closeModal(true, entry);
      this._toast('Cartão voltou ao automático.');
      await this.render();
    },
    'ag-agents'() {
      const s = this.store, cfg = s.settings.agent_views, hidden = new Set(cfg.hidden_agents), pos = new Map(cfg.order.map((id, i) => [id, i]));
      // Ativos + arquivados que têm cartão (ou estão ocultos) no período atual — senão não daria para ocultá-los/reordená-los.
      const av = this._agView || { agents: [], hidden: [] };
      const inView = new Set(av.agents.map((a) => a.id).concat(av.hidden.filter((h) => h.entries).map((h) => h.id)));
      const list = s.list('sellers', { all: true }).filter((v) => v.active !== false || inView.has(sid(v.id))).map((v, i) => ({ v, i })).sort((a, b) => ((pos.has(sid(a.v.id)) ? pos.get(sid(a.v.id)) : 1e6) - (pos.has(sid(b.v.id)) ? pos.get(sid(b.v.id)) : 1e6)) || a.i - b.i);
      const ol = { items: list.map((x) => ({ id: sid(x.v.id), name: x.v.name, hint: x.v.active === false ? 'arquivado' : '', state: !hidden.has(sid(x.v.id)) })), check: 'Exibir', off: (it) => !it.state, empty: 'Nenhum agente cadastrado.' };
      const entry = this._openModal({
        title: 'Agentes na Visão por Agente', autofocus: false, ctx: { ol },
        body: '<p class="ink2" style="margin-bottom:12px">Escolha a ordem dos cartões e quais agentes aparecem. Agentes sem lançamentos no período não ganham cartão, mesmo marcados. Cartões com muitos produtos ocupam a largura toda e podem descer uma posição para não deixar espaço vazio ao lado de um cartão menor.</p><div data-ol></div>',
        footer: '<button type="button" class="btn" data-act="modal-close">Cancelar</button><button type="button" class="btn btn-primary" data-act="ag-agents-save">' + ICON.save + 'Salvar</button>',
      });
      this._olRedraw(entry);
    },
    async 'ag-agents-save'(el) {
      const entry = this._modalOf(el), items = entry.ctx.ol.items;
      await this._saveAgentViews((cfg) => {
        const listed = new Set(items.map((it) => String(it.id)));
        cfg.order = items.map((it) => String(it.id));
        // agentes arquivados não aparecem na lista: mantém o que já estava gravado para eles
        cfg.hidden_agents = cfg.hidden_agents.filter((id) => !listed.has(id)).concat(items.filter((it) => !it.state).map((it) => String(it.id)));
      });
      this._closeModal(true, entry);
      this._toast('Agentes atualizados.');
      await this.render();
    },
    'day-shift'(el) { return this._changeDay(D.add(this._ds().date, Number(el.dataset.n))); },
    'day-today'() { return this._changeDay(D.today()); },
    'day-add'() {
      const st = this._ds(), last = st.rows[st.rows.length - 1];
      const row = this._newDayRow(last ? { product_id: last.product_id, seller_id: last.seller_id } : {});
      st.rows.push(row);
      this._markDirty();
      this._redrawDayGrid(row.k, 'metric_id');
    },
    'day-del'(el) {
      const st = this._ds(), r = this._dayRowOf(el);
      st.rows.splice(st.rows.indexOf(r), 1);
      this._markDirty();
      this._redrawDayGrid();
    },
    async 'day-block'() {
      const items = await this._blockForm();
      if (!items) return;
      const n = this._addCombos(items);
      this._toast(n ? n + (n === 1 ? ' linha adicionada.' : ' linhas adicionadas.') : 'Essas linhas já estão na grade.', n ? 'ok' : 'info');
    },
    async 'day-repeat'() {
      const st = this._ds(), s = this.store;
      const prev = await s.fetchRange('daily_entries', D.add(st.date, -60), D.add(st.date, -1));
      if (!prev.length) { this._toast('Nenhum dia preenchido nos 60 dias anteriores.', 'info'); return; }
      const last = prev.reduce((m, x) => (x.date > m ? x.date : m), '');
      const n = this._addCombos(this._sortEntries(prev.filter((x) => x.date === last)));
      this._toast(n ? 'Estrutura de ' + D.fmt(last) + ' aplicada: ' + n + (n === 1 ? ' linha.' : ' linhas.') + ' Agora é só digitar as quantidades.' : 'A grade já tem a estrutura de ' + D.fmt(last) + '.', n ? 'ok' : 'info');
    },
    async 'day-save-preset'() {
      const st = this._ds(), s = this.store;
      const items = st.rows.filter((r) => s.get('products', r.product_id) && s.get('sellers', r.seller_id) && s.get('metrics', r.metric_id))
        .map((r) => ({ product_id: s.get('products', r.product_id).id, seller_id: s.get('sellers', r.seller_id).id, metric_id: s.get('metrics', r.metric_id).id }));
      if (!items.length) { this._toast('Monte a grade (produto, agente e métrica) antes de salvar como preset.', 'info'); return; }
      const v = await this._form({
        title: 'Salvar estrutura como preset', ok: 'Salvar preset',
        intro: 'O preset guarda só a estrutura (' + items.length + ' linhas de produto + agente + métrica), não as quantidades.',
        fields: [{ key: 'name', label: 'Nome do preset', required: true, placeholder: 'Ex.: Equipe completa — dia útil' }],
        validate: (x) => (s.c.presets.some((p) => norm(p.name) === norm(x.name)) ? 'Já existe um preset com esse nome.' : null),
      });
      if (!v) return;
      await s.create('presets', { name: v.name, items });
      this._toast('Preset "' + v.name + '" salvo.');
      this._view.innerHTML = this._view.querySelector('.subnav').outerHTML + this._dayCard();
    },
    async 'day-discard'() {
      const st = this._ds();
      if (st.dirty && !(await this._confirm('Descartar as alterações não salvas deste dia?', { ok: 'Descartar', danger: true }))) return;
      st.loadedFor = null;
      await this.render();
    },
    'day-save'() { return this._saveDay(); },
    'dhist-open'(el) { const st = this._ds(); st.sub = 'dia'; st.date = el.dataset.date; st.loadedFor = null; return this.render(); },
    'dhist-export'() {
      const s = this.store, r = this._range('diario');
      const rows = [['Data', 'Produto', 'Métrica', 'Quantidade', 'Agente']].concat(
        this._sortEntries(this._ds().histRows).sort((a, b) => a.date.localeCompare(b.date))
          .map((x) => [D.fmt(x.date), s.name('products', x.product_id), s.name('metrics', x.metric_id), String(x.quantity).replace('.', ','), s.name('sellers', x.seller_id)]));
      this._download('diario_' + r.from + '_a_' + r.to + '.csv', toCSV(rows), 'text/csv;charset=utf-8');
    },
  });
  Object.assign(INP, {
    'day-cell'(el) {
      const r = this._dayRowOf(el);
      if (!r) return;
      r.quantity = el.value;
      if (r.err.quantity) { delete r.err.quantity; el.classList.remove('err'); }
      if (!this._ds().dirty) this._markDirty();
    },
  });
  Object.assign(CHG, {
    'renda-product'(el) { const st = this._ds(); st.incProduct = el.value; st.incKeep = true; this._busy(); return this.render(); },
    'inc-color'(el) {
      const entry = this._modalOf(el), id = el.closest('[data-ol-id]').dataset.olId;
      const it = entry.ctx.ol.items.find((x) => String(x.id) === id);
      if (!it || !/^#[0-9a-f]{6}$/i.test(el.value)) return;
      it.color = el.value.toLowerCase();
      this._olRedraw(entry, id, '[data-chg=inc-color]');
    },
    'day-date'(el) { return this._changeDay(parseDate(el.value) || el.value); },
    async 'day-preset'(el) {
      const p = this.store.get('presets', el.value);
      el.value = '';
      if (!p) return;
      const n = this._addCombos(p.items);
      this._toast(n ? 'Preset "' + p.name + '": ' + n + (n === 1 ? ' linha adicionada.' : ' linhas adicionadas.') : 'As linhas do preset já estão na grade.', n ? 'ok' : 'info');
    },
    async 'day-cell'(el) {
      const r = this._dayRowOf(el);
      if (!r) return;
      const f = el.dataset.f, c = { product_id: 'products', seller_id: 'sellers', metric_id: 'metrics' }[f];
      if (el.value === '__new') { const item = await this._quickAdd(c); if (item) r[f] = sid(item.id); }
      else r[f] = el.value;
      delete r.err[f]; delete r.err.dup;
      this._markDirty();
      this._redrawDayGrid(r.k, f);
    },
  });

  /** Atalhos de teclado das grades: Enter = próxima quantidade (Diário); Ctrl+Enter = salvar. */
  RelatorioComercialElement.prototype._onGridKey = function (e) {
    const t = e.target, grid = t.closest && t.closest('[data-grid]');
    if (!grid || e.key !== 'Enter') return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const act = grid.dataset.grid === 'sales' ? 'sale-save' : 'day-save';
      this._guarded(act, () => ACT[act].call(this, t, e));
      return;
    }
    if (grid.dataset.grid === 'daily' && t.dataset.f === 'quantity') {
      e.preventDefault();
      const all = Array.from(grid.querySelectorAll('[data-f=quantity]'));
      const next = all[all.indexOf(t) + 1];
      if (next) { next.focus(); next.select(); }
    }
  };

  // ==========================================================================
  // 9. IMPORTAÇÃO (.xlsx / .csv / texto colado do Excel)
  // ==========================================================================
  const IMPORT_DEFS = {
    sales: {
      title: 'Importar vendas', noun: 'vendas', collection: 'sales', sheetHint: ['vendas'],
      fields: [
        { key: 'date', label: 'Data', type: 'date', required: true, aliases: ['data', 'dia', 'date', 'data da venda'] },
        { key: 'lead_name', label: 'Nome da Lead', type: 'text', required: true, aliases: ['nome da lead', 'lead', 'nome', 'cliente', 'nome do cliente'] },
        { key: 'product_id', label: 'Produto', type: 'ref', ref: 'products', required: true, aliases: ['produto', 'product', 'produto vendido'] },
        { key: 'amount', label: 'Valor', type: 'money', required: true, aliases: ['valor', 'valor (r$)', 'valor r$', 'value', 'preco', 'valor da venda'] },
        { key: 'seller_id', label: 'Vendedor', type: 'ref', ref: 'sellers', required: true, aliases: ['vendedor', 'agente', 'seller', 'responsavel'] },
        { key: 'origin_id', label: 'Origem da Lead', type: 'ref', ref: 'origins', required: true, aliases: ['origem da lead', 'origem', 'funil', 'funil de origem', 'source'] },
        { key: 'notes', label: 'Observação', type: 'text', aliases: ['observacao', 'obs', 'notas', 'nota'] },
      ],
      example: [['28/09/2026', 'Lívia Tavares', 'Formação SQL para Negócios', '1497,00', 'Helena Duarte', 'Formação SQL para Negócios', '']],
    },
    daily: {
      title: 'Importar lançamentos do Diário', noun: 'lançamentos', collection: 'daily_entries', sheetHint: ['diario'],
      fields: [
        { key: 'date', label: 'Data', type: 'date', required: true, aliases: ['data', 'dia', 'date'] },
        { key: 'product_id', label: 'Produto', type: 'ref', ref: 'products', required: true, aliases: ['produto', 'funil', 'product'] },
        { key: 'metric_id', label: 'Métrica', type: 'ref', ref: 'metrics', required: true, aliases: ['metrica', 'metric', 'indicador'] },
        { key: 'quantity', label: 'Quantidade', type: 'number', required: true, aliases: ['quantidade', 'qtd', 'qtde', 'quantity', 'valor'] },
        { key: 'seller_id', label: 'Agente', type: 'ref', ref: 'sellers', required: true, aliases: ['agente', 'vendedor', 'responsavel', 'seller'] },
      ],
      example: [['28/09/2026', 'Formação SQL para Negócios', 'Contatos Criados', '24', 'Helena Duarte']],
    },
  };
  const REF_ORDER = ['products', 'sellers', 'metrics', 'origins'];
  const REF_NOUN = { products: 'produto', sellers: 'vendedor/agente', metrics: 'métrica', origins: 'origem' };

  function detectHeader(rows, def) {
    let best = { row: -1, score: 0, mapping: {} };
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const cells = (rows[i] || []).map(norm);
      const mapping = {}, used = new Set();
      let score = 0;
      def.fields.forEach((f) => {
        const ci = cells.findIndex((c, j) => !used.has(j) && c && f.aliases.indexOf(c) > -1);
        if (ci > -1) { mapping[f.key] = ci; used.add(ci); score++; }
      });
      if (score > best.score) best = { row: i, score, mapping };
    }
    if (best.score >= 2) return best;
    // Sem cabeçalho reconhecível: assume a ordem padrão das colunas.
    const mapping = {};
    def.fields.filter((f) => f.required).forEach((f, i) => { mapping[f.key] = i; });
    return { row: -1, score: 0, mapping };
  }

  const ImportView = {
    _imp(kind) {
      this.ui.imp = this.ui.imp || {};
      if (!this.ui.imp[kind]) this.ui.imp[kind] = { step: 'source' };
      return this.ui.imp[kind];
    },
    _impReset(kind) { this.ui.imp = this.ui.imp || {}; this.ui.imp[kind] = { step: 'source' }; },
    _impTab(kind) { return kind === 'sales' ? 'vendas' : 'diario'; },
    async _impRerender(kind) {
      if (this.tab !== this._impTab(kind)) return;
      await this.render();
    },

    async _importFile(kind, file) {
      const st = this._imp(kind);
      this._toast('Lendo "' + file.name + '"…', 'info');
      const sheets = await readTabularFile(file);
      this._impLoad(kind, sheets, file.name);
      await this._impAfterLoad(kind);
    },
    async _importText(kind, text) {
      if (this.tab !== this._impTab(kind)) { this.tab = this._impTab(kind); this._renderHeader(); }
      (kind === 'sales' ? this._vs() : this._ds()).sub = 'importar';
      this._impLoad(kind, [{ name: 'Texto colado', rows: parseCSV(text) }], 'texto colado');
      await this._impAfterLoad(kind);
    },
    _impLoad(kind, sheets, fileName) {
      const def = IMPORT_DEFS[kind];
      sheets = sheets.filter((s) => s.rows.some((r) => r && r.some((c) => String(c).trim() !== '')));
      if (!sheets.length) throw userErr('O arquivo está vazio.');
      let idx = sheets.findIndex((s) => def.sheetHint.indexOf(norm(s.name)) > -1);
      if (idx < 0) {
        // escolhe a aba cujo cabeçalho mais se parece com o esperado
        let best = -1, bestScore = -1;
        sheets.forEach((s, i) => { const h = detectHeader(s.rows, def); if (h.score > bestScore) { bestScore = h.score; best = i; } });
        idx = best;
      }
      this._imp(kind);
      const st = { step: 'map', fileName, sheets, sheetIdx: idx, res: {}, includeDups: false, dailyMode: 'replace', onlyIssues: false };
      Object.assign(st, this._impHeader(def, sheets[idx]));
      this.ui.imp[kind] = st;
    },
    _impHeader(def, sheet) { const h = detectHeader(sheet.rows, def); return { headerRow: h.row, mapping: h.mapping }; },
    async _impAfterLoad(kind) {
      const st = this._imp(kind), def = IMPORT_DEFS[kind];
      const allMapped = def.fields.every((f) => !f.required || st.mapping[f.key] != null);
      if (allMapped && st.headerRow > -1) await this._impAnalyze(kind);
      else st.step = 'map';
      await this._impRerender(kind);
    },

    /** Lê as linhas mapeadas, resolve nomes, valida e marca duplicatas. */
    async _impAnalyze(kind) {
      const st = this._imp(kind), def = IMPORT_DEFS[kind], s = this.store;
      const sheet = st.sheets[st.sheetIdx];
      const body = sheet.rows.slice(st.headerRow + 1);
      const recs = [];
      body.forEach((row, i) => {
        row = row || [];
        const raw = {};
        def.fields.forEach((f) => { const ci = st.mapping[f.key]; raw[f.key] = ci == null || ci === '' ? '' : (row[ci] == null ? '' : row[ci]); });
        if (def.fields.every((f) => String(raw[f.key]).trim() === '')) return;
        recs.push({ line: st.headerRow + 2 + i, raw });
      });
      if (!recs.length) throw userErr('Nenhuma linha com dados foi encontrada com esse mapeamento de colunas.');

      // ---- resolução de nomes (seletores) ----
      const refFields = def.fields.filter((f) => f.type === 'ref' && st.mapping[f.key] != null).sort((a, b) => REF_ORDER.indexOf(a.ref) - REF_ORDER.indexOf(b.ref));
      refFields.forEach((f) => {
        const map = st.res[f.key] = st.res[f.key] || {};
        Object.keys(map).forEach((key) => { map[key].count = 0; });
        const pf = def.fields.find((x) => x.ref === 'products');
        recs.forEach((r) => {
          const label = String(r.raw[f.key]).trim().replace(/\s+/g, ' ');
          const key = norm(label);
          if (!key) return;
          if (!map[key]) {
            const exact = s.c[f.ref].find((x) => norm(s.label(f.ref, x)) === key);
            if (exact) map[key] = { label, action: 'map', id: sid(exact.id), auto: true, count: 0 };
            else if (f.ref === 'origins' && pf && st.res[pf.key] && st.res[pf.key][key] && st.res[pf.key][key].action === 'create') map[key] = { label, action: 'porigin', count: 0 };
            else {
              let best = null, bestSim = 0;
              s.list(f.ref).forEach((x) => { const sm = similarity(label, s.label(f.ref, x)); if (sm > bestSim) { bestSim = sm; best = x; } });
              map[key] = bestSim >= 0.75 ? { label, action: 'map', id: sid(best.id), suggested: true, count: 0 } : { label, action: 'create', count: 0 };
            }
          }
          map[key].count++;
        });
      });

      // ---- dados existentes no intervalo (para duplicatas) ----
      const dates = recs.map((r) => parseDate(r.raw.date)).filter(Boolean).sort();
      let existing = [];
      if (dates.length) existing = await s.fetchRange(def.collection, dates[0], dates[dates.length - 1]);

      // ---- validação linha a linha ----
      const exKeys = new Map();
      const keyOf = (o) => (kind === 'sales'
        ? o.date + '|' + norm(o.lead_name) + '|' + Math.round(o.amount * 100) + '|' + sid(o.product_id)
        : o.date + '|' + sid(o.product_id) + '|' + sid(o.seller_id) + '|' + sid(o.metric_id));
      existing.forEach((e) => exKeys.set(keyOf(e), e));
      const seen = new Set();
      recs.forEach((r) => {
        r.errors = []; r.val = {}; r.status = 'ok';
        def.fields.forEach((f) => {
          const v = r.raw[f.key], txt = String(v).trim();
          if (f.type === 'date') { const d = parseDate(v); if (!d) r.errors.push(txt ? 'data inválida ("' + txt + '")' : 'data vazia'); r.val.date = d; }
          else if (f.type === 'money' || f.type === 'number') {
            const n = txt === '' && f.type === 'number' ? 0 : parseMoney(v);
            if (n == null) r.errors.push(f.label.toLowerCase() + ' inválido ("' + txt + '")');
            else if (f.type === 'money' && !(n > 0)) r.errors.push('valor precisa ser maior que zero');
            else if (n < 0) r.errors.push(f.label.toLowerCase() + ' negativa');
            r.val[f.key] = n;
          } else if (f.type === 'ref') {
            if (!txt) { if (f.required) r.errors.push(f.label.toLowerCase() + ' vazio'); r.val[f.key] = null; return; }
            const res = st.res[f.key][norm(txt)];
            if (res.action === 'skip') r.status = 'skip';
            r.val[f.key] = res.action === 'map' ? res.id : null;
          } else {
            if (f.required && !txt) r.errors.push(f.label.toLowerCase() + ' vazio');
            r.val[f.key] = txt.replace(/\s+/g, ' ');
          }
        });
        if (r.errors.length) { r.status = 'error'; return; }
        if (r.status === 'skip') return;
        const resolved = def.fields.every((f) => f.type !== 'ref' || r.val[f.key] != null || !String(r.raw[f.key]).trim());
        const k = keyOf(r.val);
        if (seen.has(k) && resolved) { r.status = 'dup'; r.dupWhy = 'repetida no próprio arquivo'; return; }
        seen.add(k);
        if (resolved && exKeys.has(k)) {
          if (kind === 'daily') { r.existing = exKeys.get(k); r.status = st.dailyMode === 'replace' ? 'replace' : 'dup'; r.dupWhy = 'já existe (' + F.num(r.existing.quantity) + ')'; }
          else { r.status = 'dup'; r.dupWhy = 'já registrada'; }
        }
      });
      st.recs = recs;
      st.step = 'review';
    },

    _importHTML(kind) {
      const st = this._imp(kind), def = IMPORT_DEFS[kind];
      const steps = [['source', 'Arquivo'], ['map', 'Colunas'], ['review', 'Revisão'], ['done', 'Concluído']];
      const si = steps.findIndex((x) => x[0] === st.step);
      const stepper = '<div class="steps">' + steps.map((x, i) => '<span class="' + (i === si ? 'on' : i < si ? 'done' : '') + '">' + (i + 1) + '. ' + x[1] + '</span>').join('') + '</div>';
      const cols = def.fields.map((f) => f.label + (f.required ? '' : ' (opcional)')).join(' · ');
      let h = '<div class="card"><div class="card-head"><div><h3>' + def.title + '</h3><p class="sub">Colunas esperadas: ' + esc(cols) + '</p></div><span class="spacer"></span>' +
        '<button type="button" class="btn btn-sm" data-act="imp-template" data-kind="' + kind + '">' + ICON.download + 'Baixar modelo (.csv)</button></div>' + stepper;
      if (st.step === 'source') {
        h += '<label class="drop" data-kind="' + kind + '"><input type="file" accept=".xlsx,.xlsm,.csv,.txt,.tsv" data-chg="imp-file" data-kind="' + kind + '">' + ICON.upload +
          '<strong>Clique para escolher o arquivo ou arraste-o aqui</strong><span class="small ink2">.xlsx ou .csv · pode ser a planilha antiga inteira: a aba "' + esc(def.sheetHint[0] === 'diario' ? 'Diário' : 'Vendas') + '" é escolhida automaticamente</span></label>' +
          '<div style="margin-top:16px" class="field"><span>…ou cole aqui linhas copiadas do Excel (com ou sem a linha de cabeçalho)</span><textarea class="inp" rows="5" data-ref="imp-paste" placeholder="' + esc(def.fields.filter((f) => f.required).map((f) => f.label).join('\t')) + '"></textarea></div>' +
          '<div style="margin-top:8px"><button type="button" class="btn" data-act="imp-paste" data-kind="' + kind + '">Usar texto colado</button></div>';
      } else if (st.step === 'map') h += this._impMapHTML(kind);
      else if (st.step === 'review') h += this._impReviewHTML(kind);
      else if (st.step === 'done') {
        const r = st.result;
        h += '<div class="empty"><strong>' + ICON.check + ' Importação concluída</strong>' + r.created + ' ' + def.noun + ' criado(s)' + (r.replaced ? ', ' + r.replaced + ' substituído(s)' : '') + '.' +
          (r.catalog.length ? '<br>Novos itens cadastrados: ' + esc(r.catalog.join(', ')) + '.' : '') + '<br><br>' +
          '<button type="button" class="btn" data-act="imp-reset" data-kind="' + kind + '">Importar outro arquivo</button> <button type="button" class="btn btn-primary" data-act="tab" data-tab="painel">Ver no painel</button></div>';
      }
      return h + '</div>';
    },

    _impMapHTML(kind) {
      const st = this._imp(kind), def = IMPORT_DEFS[kind];
      const sheet = st.sheets[st.sheetIdx];
      const header = st.headerRow > -1 ? (sheet.rows[st.headerRow] || []) : [];
      const width = Math.max.apply(null, sheet.rows.slice(0, 50).map((r) => (r ? r.length : 0)).concat([1]));
      const colOpts = (cur) => '<option value="">— não importar —</option>' + Array.from({ length: width }, (_, i) => '<option value="' + i + '"' + (cur === i ? ' selected' : '') + '>Coluna ' + colLetter(i) + (header[i] !== undefined && String(header[i]).trim() ? ' — "' + esc(String(header[i]).slice(0, 30)) + '"' : '') + '</option>').join('');
      let h = '<div class="form-row" style="margin-bottom:14px">';
      if (st.sheets.length > 1) h += '<label class="field"><span>Aba da planilha</span><select class="inp" data-chg="imp-sheet" data-kind="' + kind + '">' + st.sheets.map((s, i) => '<option value="' + i + '"' + (i === st.sheetIdx ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select></label>';
      h += '<label class="field"><span>Linha do cabeçalho</span><select class="inp" data-chg="imp-header" data-kind="' + kind + '"><option value="-1"' + (st.headerRow === -1 ? ' selected' : '') + '>Sem cabeçalho (dados desde a linha 1)</option>' +
        Array.from({ length: Math.min(sheet.rows.length, 25) }, (_, i) => '<option value="' + i + '"' + (st.headerRow === i ? ' selected' : '') + '>Linha ' + (i + 1) + '</option>').join('') + '</select></label></div>';
      h += '<div class="map-grid">' + def.fields.map((f) => '<label class="field"><span>' + esc(f.label) + (f.required ? ' <span class="muted">*</span>' : '') + '</span><select class="inp' + (f.required && st.mapping[f.key] == null ? ' err' : '') + '" data-chg="imp-map" data-kind="' + kind + '" data-f="' + f.key + '">' + colOpts(st.mapping[f.key]) + '</select></label>').join('') + '</div>';
      const first = sheet.rows.slice(st.headerRow + 1, st.headerRow + 6);
      h += '<div class="chart-title" style="margin:18px 0 6px">Prévia (primeiras linhas de "' + esc(sheet.name) + '")</div><div class="tbl-wrap"><table class="tbl raw"><thead><tr>' + def.fields.map((f) => '<th>' + esc(f.label) + '</th>').join('') + '</tr></thead><tbody>' +
        first.map((r) => '<tr>' + def.fields.map((f) => { const ci = st.mapping[f.key]; return '<td>' + esc(ci == null || !r ? '' : this._rawDisplay(r[ci], f)) + '</td>'; }).join('') + '</tr>').join('') + '</tbody></table></div>';
      h += '<div class="grid-foot"><button type="button" class="btn btn-ghost" data-act="imp-reset" data-kind="' + kind + '">Cancelar</button><span class="spacer"></span><button type="button" class="btn btn-primary" data-act="imp-review" data-kind="' + kind + '">Continuar</button></div>';
      return h;
    },
    _rawDisplay(v, f) {
      if (v == null) return '';
      if (f && f.type === 'date' && typeof v === 'number') { const d = parseDate(v); return d ? D.fmt(d) : String(v); }
      return String(v);
    },

    _impReviewHTML(kind) {
      const st = this._imp(kind), def = IMPORT_DEFS[kind], s = this.store;
      const recs = st.recs;
      const cnt = (x) => recs.filter((r) => r.status === x).length;
      const ok = cnt('ok'), err = cnt('error'), dup = cnt('dup'), skip = cnt('skip'), rep = cnt('replace');
      const willImport = ok + rep + (st.includeDups && kind === 'sales' ? dup : 0);
      let h = '<div class="stat-row"><span class="pill ok">' + ok + ' prontas</span>' + (rep ? '<span class="pill info">' + rep + ' substituem valor existente</span>' : '') +
        (dup ? '<span class="pill warn">' + dup + ' possíveis duplicadas</span>' : '') + (err ? '<span class="pill bad">' + err + ' com erro (ignoradas)</span>' : '') +
        (skip ? '<span class="pill">' + skip + ' ignoradas por escolha</span>' : '') + '<span class="pill">arquivo: ' + esc(st.fileName) + (st.sheets.length > 1 ? ' › ' + esc(st.sheets[st.sheetIdx].name) : '') + '</span></div>';

      // valores desconhecidos
      const pending = [];
      def.fields.filter((f) => f.type === 'ref' && st.res[f.key]).forEach((f) => {
        Object.keys(st.res[f.key]).forEach((k) => { const r = st.res[f.key][k]; if (!r.auto) pending.push({ f, k, r }); });
      });
      if (pending.length) {
        h += '<div class="note warn" style="margin:12px 0 8px">' + ICON.alert + '<span>Alguns nomes do arquivo não existem nos cadastros. Escolha, para cada um, se deve ser <b>criado</b>, <b>associado</b> a um item existente (ex.: grafia diferente) ou se as linhas devem ser <b>ignoradas</b>.</span></div>' +
          '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Coluna</th><th>Valor no arquivo</th><th class="num">Linhas</th><th>O que fazer</th></tr></thead><tbody>';
        pending.forEach((p) => {
          const items = s.list(p.f.ref);
          let opts = '<option value="create"' + (p.r.action === 'create' ? ' selected' : '') + '>Criar ' + esc(REF_NOUN[p.f.ref]) + ' "' + esc(p.r.label) + '"</option>';
          if (p.f.ref === 'origins') {
            const pf = def.fields.find((x) => x.ref === 'products');
            if (pf && st.res[pf.key] && st.res[pf.key][p.k] && st.res[pf.key][p.k].action === 'create') opts += '<option value="porigin"' + (p.r.action === 'porigin' ? ' selected' : '') + '>Usar o funil do novo produto "' + esc(p.r.label) + '"</option>';
          }
          opts += items.map((x) => '<option value="map:' + esc(x.id) + '"' + (p.r.action === 'map' && sid(p.r.id) === sid(x.id) ? ' selected' : '') + '>Associar a: ' + esc(s.label(p.f.ref, x)) + '</option>').join('');
          opts += '<option value="skip"' + (p.r.action === 'skip' ? ' selected' : '') + '>Ignorar essas linhas</option>';
          h += '<tr><td class="ink2">' + esc(p.f.label) + '</td><td class="strong">' + esc(p.r.label) + (p.r.suggested ? ' <span class="pill info">sugestão automática</span>' : '') + '</td><td class="num">' + p.r.count + '</td>' +
            '<td><select class="inp sm" data-chg="imp-res" data-kind="' + kind + '" data-f="' + p.f.key + '" data-key="' + esc(p.k) + '">' + opts + '</select></td></tr>';
        });
        h += '</tbody></table></div>';
      }
      if (dup && kind === 'sales') h += '<label class="check" style="margin:12px 0 4px"><input type="checkbox" data-chg="imp-incdup" data-kind="' + kind + '"' + (st.includeDups ? ' checked' : '') + '> Importar também as ' + dup + ' possíveis duplicadas</label>';
      if (kind === 'daily' && (rep || st.dailyMode === 'skip')) h += '<label class="field" style="margin:12px 0 4px;max-width:420px"><span>Quando o lançamento já existir (mesmo dia, produto, agente e métrica)</span><select class="inp" data-chg="imp-dmode" data-kind="' + kind + '"><option value="replace"' + (st.dailyMode === 'replace' ? ' selected' : '') + '>Substituir a quantidade existente</option><option value="skip"' + (st.dailyMode === 'skip' ? ' selected' : '') + '>Manter o existente e ignorar a linha</option></select></label>';

      // prévia das linhas
      const show = st.onlyIssues ? recs.filter((r) => r.status !== 'ok') : recs;
      const LBL = { ok: '<span class="pill ok">ok</span>', error: '<span class="pill bad">erro</span>', dup: '<span class="pill warn">duplicada</span>', skip: '<span class="pill">ignorada</span>', replace: '<span class="pill info">substitui</span>' };
      h += '<div class="toolbar" style="margin:16px 0 8px"><span class="chart-title" style="margin:0">Linhas do arquivo</span><label class="check small"><input type="checkbox" data-chg="imp-issues" data-kind="' + kind + '"' + (st.onlyIssues ? ' checked' : '') + '> Mostrar só linhas com problema</label></div>';
      h += '<div class="tbl-wrap scroll-y"><table class="tbl"><thead><tr><th>Linha</th><th>Situação</th>' + def.fields.filter((f) => st.mapping[f.key] != null).map((f) => '<th>' + esc(f.label) + '</th>').join('') + '<th>Observação</th></tr></thead><tbody>' +
        show.slice(0, 400).map((r) => '<tr class="' + (r.status === 'error' ? 'row-err' : r.status === 'dup' ? 'row-dup' : '') + '"><td class="num muted">' + r.line + '</td><td>' + LBL[r.status] + '</td>' +
          def.fields.filter((f) => st.mapping[f.key] != null).map((f) => '<td class="' + (f.type === 'money' || f.type === 'number' ? 'num' : '') + '">' + esc(f.type === 'date' ? (r.val.date ? D.fmt(r.val.date) : this._rawDisplay(r.raw.date, f)) : f.type === 'money' ? (r.val[f.key] != null ? F.money(r.val[f.key]) : r.raw[f.key]) : this._rawDisplay(r.raw[f.key], f)) + '</td>').join('') +
          '<td class="small">' + (r.errors.length ? '<span class="err-txt">' + esc(r.errors.join('; ')) + '</span>' : esc(r.dupWhy || '')) + '</td></tr>').join('') +
        '</tbody></table></div>' + (show.length > 400 ? '<p class="small muted" style="margin-top:6px">Mostrando 400 de ' + show.length + ' linhas.</p>' : '');
      h += '<div class="grid-foot"><button type="button" class="btn btn-ghost" data-act="imp-reset" data-kind="' + kind + '">Cancelar</button><button type="button" class="btn btn-ghost" data-act="imp-back" data-kind="' + kind + '">Ajustar colunas</button><span class="spacer"></span>' +
        '<span class="small ink2" data-ref="imp-progress"></span><button type="button" class="btn btn-primary" data-act="imp-run" data-kind="' + kind + '"' + (willImport ? '' : ' disabled') + '>' + ICON.upload.replace('width="22" height="22"', 'width="16" height="16"') + 'Importar ' + willImport + ' ' + def.noun + '</button></div>';
      return h;
    },

    async _impRun(kind) {
      const st = this._imp(kind), def = IMPORT_DEFS[kind], s = this.store;
      if (st.stale) { // uma tentativa anterior caiu no meio: atualiza a revisão antes de enviar de novo
        await this._impAnalyze(kind);
        st.stale = false;
        await this._impRerender(kind);
        this._toast('A revisão foi atualizada com o que já está gravado. Confira e clique em "Importar" para continuar.', 'info');
        return;
      }
      const take = st.recs.filter((r) => r.status === 'ok' || r.status === 'replace' || (r.status === 'dup' && st.includeDups && kind === 'sales'));
      if (!take.length) return;
      const prog = (t) => { const el = this._view.querySelector('[data-ref=imp-progress]'); if (el) el.textContent = t; };
      this._view.querySelectorAll('[data-act=imp-run]').forEach((b) => { b.disabled = true; });
      // 1) cria itens novos de cadastro (produtos primeiro: origens podem depender deles)
      const catalog = [];
      const refFields = def.fields.filter((f) => f.type === 'ref' && st.res[f.key]).sort((a, b) => REF_ORDER.indexOf(a.ref) - REF_ORDER.indexOf(b.ref));
      const needed = (f, k) => take.some((r) => norm(String(r.raw[f.key]).trim()) === k);
      for (const f of refFields) {
        for (const k of Object.keys(st.res[f.key])) {
          const res = st.res[f.key][k];
          if (!needed(f, k)) continue;
          if (res.action === 'create') {
            prog('Cadastrando "' + res.label + '"…');
            const existing = s.findByName(f.ref, res.label);
            const item = existing || (await s.addItem(f.ref, { name: res.label, kind: 'count' }));
            res.action = 'map'; res.id = sid(item.id); res.auto = true;
            if (!existing) catalog.push(res.label);
          } else if (res.action === 'porigin') {
            const pf = def.fields.find((x) => x.ref === 'products');
            const pr = st.res[pf.key][k];
            const o = pr && pr.id ? s.originByProduct.get(sid(pr.id)) : null;
            if (o) { res.action = 'map'; res.id = sid(o.id); res.auto = true; }
          }
        }
      }
      // 2) monta os registros
      const creates = [], replaces = [];
      take.forEach((r) => {
        const rec = { date: r.val.date };
        let ok = true;
        def.fields.forEach((f) => {
          if (f.type === 'date') return;
          if (f.type === 'ref') {
            const txt = String(r.raw[f.key]).trim();
            const res = txt ? st.res[f.key][norm(txt)] : null;
            const item = res && res.action === 'map' ? s.get(f.ref, res.id) : null;
            if (!item && f.required) ok = false;
            rec[f.key] = item ? item.id : null;
          } else if (f.type === 'money') rec[f.key] = Math.round(r.val[f.key] * 100) / 100;
          else if (f.type === 'number') rec[f.key] = r.val[f.key];
          else rec[f.key] = r.val[f.key] || null;
        });
        if (!ok) return;
        if (r.status === 'replace' && r.existing) replaces.push([r.existing.id, rec]); else creates.push(rec);
      });
      // 3) grava. Se cair no meio (rede/servidor), reanalisa: o que já foi gravado passa a aparecer
      //    como duplicado/existente e "Importar" de novo continua de onde parou, sem duplicar.
      let saved = 0, i = 0;
      try {
        if (creates.length) await s.bulkCreate(def.collection, creates, (n, t) => { saved = n; prog('Gravando ' + n + ' de ' + t + '…'); });
        for (const u of replaces) { await s.update(def.collection, u[0], { quantity: u[1].quantity }); prog('Atualizando ' + (++i) + ' de ' + replaces.length + '…'); }
      } catch (e) {
        if (kind === 'daily') this._ds().loadedFor = null;
        try { await this._impAnalyze(kind); st.stale = false; } catch (e2) { st.stale = true; /* sem conexão: reanalisa antes do próximo envio */ }
        await this._impRerender(kind);
        const why = e.userMessage || e.message || String(e);
        const err = userErr('A importação foi interrompida: ' + why + (saved || i ? ' ' + (saved + i) + ' registro(s) já tinham sido gravados e agora aparecem como já existentes — clique em "Importar" de novo para continuar de onde parou.' : ''), e.code);
        err.status = e.status;
        throw err;
      }
      st.result = { created: creates.length, replaced: replaces.length, catalog };
      st.step = 'done';
      if (kind === 'daily') this._ds().loadedFor = null;
      this._toast('Importação concluída: ' + creates.length + ' ' + def.noun + (replaces.length ? ', ' + replaces.length + ' substituído(s)' : '') + '.');
      await this._impRerender(kind);
    },
  };

  Object.assign(ACT, {
    'imp-template'(el) {
      const def = IMPORT_DEFS[el.dataset.kind];
      this._download('modelo_' + (el.dataset.kind === 'sales' ? 'vendas' : 'diario') + '.csv', toCSV([def.fields.map((f) => f.label)].concat(def.example)), 'text/csv;charset=utf-8');
    },
    async 'imp-paste'(el) {
      const ta = this._view.querySelector('[data-ref=imp-paste]');
      if (!ta || !ta.value.trim()) { this._toast('Cole as linhas no campo de texto primeiro.', 'info'); return; }
      await this._importText(el.dataset.kind, ta.value);
    },
    'imp-reset'(el) { this._impReset(el.dataset.kind); return this._impRerender(el.dataset.kind); },
    'imp-back'(el) { this._imp(el.dataset.kind).step = 'map'; return this._impRerender(el.dataset.kind); },
    async 'imp-review'(el) {
      const kind = el.dataset.kind, st = this._imp(kind), def = IMPORT_DEFS[kind];
      const miss = def.fields.filter((f) => f.required && st.mapping[f.key] == null);
      if (miss.length) { this._toast('Indique a coluna de: ' + miss.map((f) => f.label).join(', ') + '.', 'error'); return; }
      st.res = {};
      await this._impAnalyze(kind);
      await this._impRerender(kind);
    },
    'imp-run'(el) { return this._impRun(el.dataset.kind); },
  });
  Object.assign(CHG, {
    'imp-file'(el) { const f = el.files && el.files[0]; el.value = ''; if (f) return this._importFile(el.dataset.kind, f); },
    'imp-sheet'(el) {
      const kind = el.dataset.kind, st = this._imp(kind);
      st.sheetIdx = Number(el.value);
      Object.assign(st, this._impHeader(IMPORT_DEFS[kind], st.sheets[st.sheetIdx]));
      return this._impRerender(kind);
    },
    'imp-header'(el) {
      const kind = el.dataset.kind, st = this._imp(kind), def = IMPORT_DEFS[kind];
      st.headerRow = Number(el.value);
      if (st.headerRow > -1) {
        const cells = (st.sheets[st.sheetIdx].rows[st.headerRow] || []).map(norm), used = new Set();
        const mapping = {};
        def.fields.forEach((f) => { const ci = cells.findIndex((c, j) => !used.has(j) && c && f.aliases.indexOf(c) > -1); if (ci > -1) { mapping[f.key] = ci; used.add(ci); } });
        if (Object.keys(mapping).length >= 2) st.mapping = mapping;
      }
      return this._impRerender(kind);
    },
    'imp-map'(el) {
      const st = this._imp(el.dataset.kind);
      st.mapping[el.dataset.f] = el.value === '' ? null : Number(el.value);
      return this._impRerender(el.dataset.kind);
    },
    async 'imp-res'(el) {
      const kind = el.dataset.kind, st = this._imp(kind);
      const res = st.res[el.dataset.f][el.dataset.key];
      const v = el.value;
      if (v.indexOf('map:') === 0) { res.action = 'map'; res.id = v.slice(4); } else { res.action = v; res.id = null; }
      // Mudou o destino de um produto novo? Reavalia a opção "funil do novo produto" das origens.
      const def = IMPORT_DEFS[kind];
      const of = def.fields.find((f) => f.ref === 'origins');
      if (el.dataset.f === 'product_id' && of && st.res[of.key] && st.res[of.key][el.dataset.key]) {
        const o = st.res[of.key][el.dataset.key];
        if (res.action === 'map' && o.action === 'porigin') { const oo = this.store.originByProduct.get(sid(res.id)); o.action = oo ? 'map' : 'create'; o.id = oo ? sid(oo.id) : null; }
        if (res.action === 'create' && o.action === 'create') o.action = 'porigin';
      }
      await this._impAnalyze(kind);
      await this._impRerender(kind);
    },
    async 'imp-incdup'(el) { this._imp(el.dataset.kind).includeDups = el.checked; await this._impRerender(el.dataset.kind); },
    async 'imp-dmode'(el) { const st = this._imp(el.dataset.kind); st.dailyMode = el.value; await this._impAnalyze(el.dataset.kind); await this._impRerender(el.dataset.kind); },
    async 'imp-issues'(el) { this._imp(el.dataset.kind).onlyIssues = el.checked; await this._impRerender(el.dataset.kind); },
  });

  /** Colar várias linhas (do Excel) numa grade de digitação abre o importador com esse conteúdo. */
  RelatorioComercialElement.prototype._onPaste = function (e) {
    const t = e.target, grid = t.closest && t.closest('[data-grid]');
    if (!grid) return;
    const cd = e.clipboardData || global.clipboardData;
    const text = cd && cd.getData ? cd.getData('text') : '';
    if (!text || !(/\t/.test(text) || /\n\s*\S/.test(text.trim()))) return;
    e.preventDefault();
    this._run(() => this._importText(grid.dataset.grid === 'sales' ? 'sales' : 'daily', text));
  };

  // ==========================================================================
  // 10. ABA CADASTROS (listas, metas, métricas, presets, configurações)
  // ==========================================================================
  const CAT_META = {
    products: { title: 'Produtos', noun: 'produto', intro: 'Cada produto é um funil: ele aparece automaticamente como "Origem da Lead". Metas são opcionais e podem mudar a qualquer momento sem alterar o passado. A coluna "Nas metas" oculta o produto em "Metas por produto" no Painel e nos indicadores de meta.' },
    sellers: { title: 'Vendedores / Agentes', noun: 'vendedor ou agente', intro: 'A mesma lista serve para "Vendedor" (aba Vendas) e "Agente" (aba Diário). Meta individual é opcional — vendedores ocasionais podem ficar sem meta.' },
    origins: { title: 'Origens de lead', noun: 'origem', fem: true, intro: 'Os produtos já são origens automáticas (funis). Aqui ficam as outras origens, como "Cliente Antigo" ou "Indicação" — vendas com essas origens contam na meta do produto vendido (e não em "Faturado em funis").' },
    metrics: { title: 'Métricas do Diário', noun: 'métrica', fem: true, intro: '"Posição no funil" define a ordem das etapas (1 = topo). Métricas sem posição aparecem como "outras métricas". A coluna "Auditoria" liga a métrica à conferência com a aba Vendas (Diário → Histórico).' },
  };

  /** Concordância de gênero nas mensagens ("origem adicionada", "produto adicionado"). */
  const isFem = (c) => !!(CAT_META[c] && CAT_META[c].fem);
  const gen = (c, word) => (isFem(c) ? word.replace(/o$/, 'a') : word);

  const CadastrosView = {
    _cs() { if (!this.ui.cad) this.ui.cad = { sub: 'products', showArchived: false }; return this.ui.cad; },
    _renderCadastros() {
      const st = this._cs();
      const nav = this._subnav([['products', 'Produtos'], ['sellers', 'Vendedores / Agentes'], ['origins', 'Origens de lead'], ['metrics', 'Métricas do Diário'], ['presets', 'Presets do Diário'], ['config', 'Configurações']], st.sub, 'cad-sub');
      let body;
      if (CAT_META[st.sub]) body = '<div class="card">' + this._catalogCard(st.sub) + '</div>';
      else if (st.sub === 'presets') body = this._presetsCard();
      else body = this._configCard();
      this._view.innerHTML = nav + body;
    },
    _refreshCatalog() {
      this._modals.forEach((m) => { if (m.ctx && m.ctx.manager) m.body.innerHTML = this._catalogCard(m.ctx.manager); });
      if (this.tab === 'cadastros') this._renderCadastros();
    },

    _goalSummary(type, id) {
      const s = this.store, t = D.today();
      const g = s.goalAt(type, id, t);
      const future = s.goalRecords(type, id).filter((x) => (x.valid_from || '') > t);
      const txt = g ? '<span class="strong">' + esc(F.money0(g.amount)) + '</span> <span class="ink2">/ ' + (g.period === 'monthly' ? 'mês' : 'semana') + '</span>' : '<span class="muted">sem meta</span>';
      return txt + (future.length ? ' <span class="pill info" title="Há mudança de meta agendada">agendada</span>' : '');
    },

    _catalogCard(c) {
      const s = this.store, st = this._cs(), meta = CAT_META[c];
      const all = s.list(c, { all: true });
      const rows = st.showArchived ? all : all.filter((r) => r.active !== false);
      const nArch = all.filter((r) => r.active === false).length;
      let add = '<div class="toolbar" data-cat="' + c + '" style="margin-bottom:10px"><input class="inp" style="max-width:260px" placeholder="Nome d' + (meta.fem ? 'a nova ' : 'o novo ') + esc(meta.noun) + '" data-ref="cat-new-name" data-enter="cat-add" aria-label="Nome do novo item">';
      if (c === 'products') add += '<select class="inp" style="max-width:220px" data-ref="cat-new-owner" aria-label="Agente responsável">' + this._options('sellers', '', { placeholder: 'Responsável (opcional)' }) + '</select>';
      if (c === 'metrics') add += '<select class="inp" style="max-width:170px" data-ref="cat-new-kind" aria-label="Tipo"><option value="count">Quantidade</option><option value="money">Valor (R$)</option></select>';
      add += '<button type="button" class="btn btn-primary" data-act="cat-add">' + ICON.plus + 'Adicionar</button><span class="spacer"></span>' +
        (nArch ? '<label class="check small"><input type="checkbox" data-chg="cat-archived"' + (st.showArchived ? ' checked' : '') + '> Mostrar arquivados (' + nArch + ')</label>' : '') + '</div>';
      let head = '<th style="width:34%">Nome</th>';
      if (c === 'products') head += '<th>Responsável</th><th>Meta vigente</th><th title="Exibir em &quot;Metas por produto&quot; no Painel">Nas metas</th>';
      if (c === 'sellers') head += '<th>Meta individual vigente</th>';
      if (c === 'origins') head += '<th>Tipo</th>';
      if (c === 'metrics') head += '<th>Tipo</th><th title="1 = topo do funil; vazio = fora do funil">Posição no funil</th><th>Auditoria (vs. Vendas)</th>';
      head += '<th></th>';
      // Setas de ordem: só entre itens "móveis" (origens automáticas seguem a ordem dos produtos;
      // métricas seguem a "Posição no funil").
      const movable = c === 'metrics' ? [] : rows.filter((r) => !(c === 'origins' && s.isProductOrigin(r)));
      let b = '';
      rows.forEach((r) => {
        const arch = r.active === false, auto = c === 'origins' && s.isProductOrigin(r);
        const mi = movable.indexOf(r);
        b += '<tr' + (arch ? ' class="archived"' : '') + ' data-id="' + esc(r.id) + '">';
        b += '<td>' + (auto ? '<span class="strong">' + esc(s.label(c, r)) + '</span>' : '<input class="inp sm" value="' + esc(r.name) + '" data-chg="cat-rename" data-c="' + c + '" aria-label="Nome">') + (arch ? ' <span class="pill">arquivado</span>' : '') + '</td>';
        if (c === 'products') {
          b += '<td><select class="inp sm" data-chg="cat-owner" aria-label="Agente responsável">' + this._options('sellers', r.owner_seller_id, { placeholder: '— nenhum —' }) + '</select></td>' +
            '<td class="nowrap">' + this._goalSummary('product', r.id) + ' <button type="button" class="btn btn-sm btn-ghost" data-act="goal-edit" data-type="product">Editar meta</button></td>';
          // Exibir/ocultar em "Metas por produto" no Painel (coluna products.show_in_goals)
          const vis = r.show_in_goals !== false;
          b += '<td><button type="button" class="btn btn-sm btn-ghost vis-toggle' + (vis ? '' : ' off') + '" data-act="cat-goalvis" aria-pressed="' + !vis + '" title="' + (vis ? 'Clique para ocultar em &quot;Metas por produto&quot; no Painel' : 'Oculto em &quot;Metas por produto&quot; e nos indicadores de meta. Clique para exibir') + '">' + (vis ? ICON.eye + 'Exibido' : ICON.eyeOff + 'Oculto') + '</button></td>';
        }
        if (c === 'sellers') b += '<td class="nowrap">' + this._goalSummary('seller', r.id) + ' <button type="button" class="btn btn-sm btn-ghost" data-act="goal-edit" data-type="seller">Editar meta</button></td>';
        if (c === 'origins') b += '<td>' + (auto ? '<span class="pill">funil (automática)</span>' : '<span class="pill warn">fora de funil</span>') + '</td>';
        if (c === 'metrics') {
          b += '<td><select class="inp sm" data-chg="cat-metric" data-f="kind" aria-label="Tipo"><option value="count"' + (r.kind === 'count' ? ' selected' : '') + '>Quantidade</option><option value="money"' + (r.kind === 'money' ? ' selected' : '') + '>Valor (R$)</option></select></td>' +
            '<td><input class="inp sm" style="width:90px" type="number" min="1" step="1" value="' + (r.funnel_order == null ? '' : r.funnel_order) + '" placeholder="—" data-chg="cat-metric" data-f="funnel_order" aria-label="Posição no funil"' + (r.kind === 'money' ? ' disabled title="Métricas em R$ não entram no funil"' : '') + '></td>' +
            '<td><select class="inp sm" data-chg="cat-metric" data-f="audit_role" aria-label="Auditoria"><option value="">—</option><option value="sold_count"' + (r.audit_role === 'sold_count' ? ' selected' : '') + '>= nº de vendas</option><option value="revenue"' + (r.audit_role === 'revenue' ? ' selected' : '') + '>= valor faturado</option></select></td>';
        }
        b += '<td class="actions">';
        if (!auto) {
          if (mi > -1) {
            b += '<button type="button" class="icon-btn" data-act="cat-move" data-dir="-1" title="Mover para cima" aria-label="Mover para cima"' + (mi === 0 ? ' disabled' : '') + '>' + ICON.arrowUp + '</button>' +
              '<button type="button" class="icon-btn" data-act="cat-move" data-dir="1" title="Mover para baixo" aria-label="Mover para baixo"' + (mi === movable.length - 1 ? ' disabled' : '') + '>' + ICON.arrowDown + '</button>';
          }
          b += (arch ? '<button type="button" class="icon-btn" data-act="cat-archive" title="Restaurar" aria-label="Restaurar">' + ICON.restore + '</button>'
              : '<button type="button" class="icon-btn" data-act="cat-archive" title="Arquivar (some dos seletores, mantém o histórico)" aria-label="Arquivar">' + ICON.archive + '</button>') +
            '<button type="button" class="icon-btn danger" data-act="cat-delete" title="Excluir definitivamente" aria-label="Excluir">' + ICON.trash + '</button>';
        }
        b += '</td></tr>';
      });
      // meta geral (v1.6): meta da empresa para o período antes das metas por produto
      const genRecs = c === 'products' ? s.goalRecords(GENERAL_GOAL.type, GENERAL_GOAL.id) : [], nGen = genRecs.length, gl = genRecs[nGen - 1];
      const genBox = c !== 'products' ? '' : '<div class="general-goal" data-ref="general-goal"><div><span class="strong">Meta geral (todos os produtos)</span> · ' +
        (nGen ? (gl.amount > 0 ? 'última: <span class="strong">' + esc(F.money0(gl.amount)) + '</span> <span class="ink2">/ ' + (gl.period === 'monthly' ? 'mês' : 'semana') + (gl.valid_from ? ' desde ' + D.fmt(gl.valid_from) : '') + '</span>'
          : '<span class="ink2">encerrada' + (gl.valid_from ? ' em ' + D.fmt(gl.valid_from) : '') + '</span>') + ' <span class="small ink2">(' + nGen + (nGen === 1 ? ' registro' : ' registros') + ' no histórico)</span>' : '<span class="muted">não definida</span>') +
        '<div class="small muted" style="margin-top:2px">Para o período antes das metas por produto: vale só nos dias em que nenhum produto exibido nas metas tem meta própria, e é comparada com todas as vendas desses dias.</div></div>' +
        '<button type="button" class="btn btn-sm" data-act="goal-edit" data-type="total">' + (nGen ? 'Editar meta geral' : 'Definir meta geral') + '</button></div>';
      return '<div data-cat-card="' + c + '"><div class="card-head"><div><h3>' + meta.title + '</h3><p class="sub">' + meta.intro + '</p></div></div>' + genBox + add +
        (rows.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + head + '</tr></thead><tbody>' + b + '</tbody></table></div>' : '<div class="empty">Nenhum item cadastrado ainda.</div>') +
        '<p class="small muted" style="margin-top:10px">' + ICON.archive.replace('width="16" height="16"', 'width="12" height="12"') + ' Arquivar esconde o item dos seletores e preserva o histórico. Excluir só é possível para itens sem nenhum lançamento.</p></div>';
    },
    _catRow(el) {
      const box = el.closest('[data-cat-card]'), tr = el.closest('tr[data-id]');
      return { c: box.dataset.catCard, id: tr ? tr.dataset.id : null, item: tr ? this.store.get(box.dataset.catCard, tr.dataset.id) : null };
    },

    async _openManager(c) {
      await new Promise((resolve) => {
        this._openModal({ title: 'Gerenciar lista: ' + CAT_META[c].title, size: 'wide', body: this._catalogCard(c), ctx: { manager: c }, autofocus: false,
          footer: '<button type="button" class="btn btn-primary" data-act="modal-close">Concluir</button>', onClose: resolve });
      });
      if (this.tab === 'vendas' && this._vs().sub === 'lancar') this._redrawSalesGrid();
      else if (this.tab === 'diario' && this._ds().sub === 'dia') this._redrawDayGrid();
    },

    // ---------------- metas ----------------
    _goalEditor(type, id) {
      const s = this.store, c = type === 'product' ? 'products' : 'sellers';
      const title = type === GENERAL_GOAL.type ? 'Meta geral — todos os produtos' : 'Meta — ' + s.name(c, id);
      const entry = this._openModal({ title, body: '', ctx: { goal: { type, id } }, autofocus: false,
        footer: '<button type="button" class="btn" data-act="modal-close">Fechar</button><button type="button" class="btn btn-primary" data-act="goal-save">' + ICON.save + 'Salvar meta</button>' });
      this._goalBody(entry);
      const inp = entry.body.querySelector('[data-g=amount]');
      if (inp) setTimeout(() => inp.focus(), 20);
    },
    _goalBody(entry) {
      const s = this.store, g = entry.ctx.goal, t = D.today();
      const recs = s.goalRecords(g.type, g.id);
      const cur = s.goalAt(g.type, g.id, t);
      const last = recs[recs.length - 1];
      // meta geral: costuma ser mensal e lançada mês a mês — sugere o mês seguinte ao último registro
      const isGen = g.type === GENERAL_GOAL.type;
      const defDate = isGen ? (last && last.valid_from && last.period === 'monthly' ? D.add(D.monthEnd(last.valid_from), 1) : D.monthStart(t)) : D.weekStart(t, s.settings.week_start);
      const always = !isGen && !recs.length;
      let h = isGen ? '<p class="ink2" style="margin-bottom:10px">Meta da empresa, sem divisão por produto, para o período <b>antes das metas por produto</b>. Ela só vale nos dias em que nenhum produto exibido nas metas tem meta própria; nesses dias o Painel e as Tendências comparam com todas as vendas (inclusive as dos produtos ocultos nas metas). Para uma meta diferente a cada mês, salve um registro por mês ("Vale a partir de" = dia 1).</p>' : '';
      h += '<p class="ink2" style="margin-bottom:14px">' + (cur ? 'Vigente hoje: <b>' + esc(F.money(cur.amount)) + '</b> por ' + (cur.period === 'monthly' ? 'mês' : 'semana') + (cur.valid_from ? ' (desde ' + D.fmt(cur.valid_from) + ')' : ' (desde sempre)') + (isGen && s.generalGoalDays(t, t).size === 0 ? ' — hoje não conta, porque há metas por produto' : '') : 'Sem meta vigente hoje.') + '</p>';
      h += '<div class="form"><div class="form-row">' +
        '<label class="field"><span>Valor da meta (R$)</span><input class="inp inp-money" inputmode="decimal" data-g="amount" placeholder="vazio = sem meta" value="' + esc(last && last.amount ? F.num(last.amount) : '') + '" data-enter="goal-save"></label>' +
        '<label class="field"><span>Período da meta</span><select class="inp" data-g="period"><option value="weekly"' + ((last ? last.period === 'weekly' : !isGen) ? ' selected' : '') + '>Semanal</option><option value="monthly"' + ((last ? last.period === 'monthly' : isGen) ? ' selected' : '') + '>Mensal</option></select></label>' +
        '<label class="field"><span>Vale a partir de</span><input class="inp" type="date" placeholder="dd/mm/aaaa" data-g="valid_from" value="' + (always ? '' : defDate) + '"' + (always ? ' disabled' : '') + '></label></div>' +
        '<label class="check"><input type="checkbox" data-g="always" data-chg="goal-always"' + (always ? ' checked' : '') + '> Valer para todo o histórico (sem data de início)</label>' +
        '<p class="small muted">A meta é proporcional ao período filtrado no painel: semanal = valor ÷ 7 por dia; mensal = valor ÷ dias do mês. Mudar a meta a partir de uma data não altera os resultados anteriores a ela. Deixe o valor vazio para encerrar a meta a partir da data.</p></div>';
      if (recs.length) {
        h += '<div class="chart-title" style="margin:18px 0 6px">Histórico de metas</div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>A partir de</th><th class="num">Meta</th><th>Período</th><th></th></tr></thead><tbody>' +
          recs.slice().reverse().map((x) => '<tr><td>' + (x.valid_from ? D.fmt(x.valid_from) : 'sempre') + '</td><td class="num">' + (x.amount > 0 ? esc(F.money(x.amount)) : '<span class="muted">sem meta</span>') + '</td><td>' + (x.amount > 0 ? (x.period === 'monthly' ? 'Mensal' : 'Semanal') : '—') + '</td>' +
            '<td class="actions"><button type="button" class="icon-btn danger" data-act="goal-del" data-gid="' + esc(x.id) + '" title="Remover este registro" aria-label="Remover registro de meta">' + ICON.trash + '</button></td></tr>').join('') + '</tbody></table></div>';
      }
      entry.body.innerHTML = h;
    },

    // ---------------- presets ----------------
    _presetsCard() {
      const s = this.store, list = s.list('presets');
      let b = '';
      list.forEach((p) => {
        const groups = new Map();
        p.items.forEach((it) => { const k = s.name('products', it.product_id) + ' · ' + s.name('sellers', it.seller_id); groups.set(k, (groups.get(k) || 0) + 1); });
        const summary = Array.from(groups.entries()).map((g) => esc(g[0]) + ' <span class="muted">(' + g[1] + ')</span>').join('<br>');
        b += '<tr data-id="' + esc(p.id) + '"><td class="strong">' + esc(p.name) + '</td><td class="num">' + p.items.length + '</td><td class="small">' + (summary || '<span class="muted">vazio</span>') + '</td>' +
          '<td class="actions"><button type="button" class="btn btn-sm btn-ghost" data-act="preset-edit">' + ICON.edit + 'Editar</button><button type="button" class="icon-btn danger" data-act="preset-del" title="Excluir preset" aria-label="Excluir preset">' + ICON.trash + '</button></td></tr>';
      });
      return '<div class="card"><div class="card-head"><div><h3>Presets do Diário</h3><p class="sub">Um preset é uma estrutura pronta de linhas (produto + agente + métrica). No Diário, aplicar o preset cria as linhas e só falta digitar as quantidades. Uso opcional.</p></div><span class="spacer"></span><button type="button" class="btn btn-primary" data-act="preset-new">' + ICON.plus + 'Novo preset</button></div>' +
        (list.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Preset</th><th class="num">Linhas</th><th>Produto · Agente (nº de métricas)</th><th></th></tr></thead><tbody>' + b + '</tbody></table></div>'
          : '<div class="empty"><strong>Nenhum preset ainda.</strong>Crie aqui ou, no Diário, monte a grade e use "Salvar estrutura como preset".</div>') + '</div>';
    },
    _presetEditor(p) {
      const ctx = { pe: { id: p ? p.id : null, name: p ? p.name : '', items: (p ? p.items : []).map((it) => ({ k: uid(), product_id: sid(it.product_id), seller_id: sid(it.seller_id), metric_id: sid(it.metric_id) })) } };
      const entry = this._openModal({ title: p ? 'Editar preset' : 'Novo preset', size: 'wide', body: '', ctx, autofocus: false,
        footer: '<button type="button" class="btn" data-act="modal-close">Cancelar</button><button type="button" class="btn btn-primary" data-act="pe-save">' + ICON.save + 'Salvar preset</button>' });
      this._peRender(entry);
      const n = entry.body.querySelector('[data-inp=pe-name]');
      if (n) setTimeout(() => n.focus(), 20);
    },
    _peRender(entry) {
      const pe = entry.ctx.pe;
      let b = '';
      pe.items.forEach((it, i) => {
        b += '<tr data-k="' + it.k + '"><td class="idx">' + (i + 1) + '</td>' +
          '<td><select class="inp sm" data-chg="pe-cell" data-f="product_id" aria-label="Produto">' + this._options('products', it.product_id) + '</select></td>' +
          '<td><select class="inp sm" data-chg="pe-cell" data-f="seller_id" aria-label="Agente">' + this._options('sellers', it.seller_id) + '</select></td>' +
          '<td><select class="inp sm" data-chg="pe-cell" data-f="metric_id" aria-label="Métrica">' + this._options('metrics', it.metric_id) + '</select></td>' +
          '<td class="actions"><button type="button" class="icon-btn danger" data-act="pe-del" aria-label="Remover linha">' + ICON.trash + '</button></td></tr>';
      });
      entry.body.innerHTML = '<label class="field" style="max-width:420px;margin-bottom:14px"><span>Nome do preset <span class="muted">*</span></span><input class="inp" data-inp="pe-name" value="' + esc(pe.name) + '" placeholder="Ex.: Helena — Formação SQL"></label>' +
        '<div class="toolbar" style="margin-bottom:8px"><button type="button" class="btn btn-sm" data-act="pe-block">' + ICON.layers + 'Bloco produto + agente</button><button type="button" class="btn btn-sm btn-ghost" data-act="pe-add">' + ICON.plus + 'Linha</button><span class="spacer"></span><span class="small ink2">' + pe.items.length + ' linhas</span></div>' +
        (pe.items.length ? '<div class="tbl-wrap"><table class="tbl grid-edit"><thead><tr><th></th><th>Produto</th><th>Agente</th><th>Métrica</th><th></th></tr></thead><tbody>' + b + '</tbody></table></div>' : '<div class="empty">Adicione linhas com "Bloco produto + agente".</div>');
    },

    // ---------------- restaurar backup ----------------
    /** Prévia (store.restoreBackup com dryRun) e confirmação. Nada é gravado antes de "Restaurar". */
    async _restorePreview(data, fileName) {
      const plan = await this.store.restoreBackup(data, { dryRun: true });
      const entry = this._openModal({ title: 'Restaurar backup', size: 'wide', autofocus: false, ctx: { restore: { data, fileName } }, body: '',
        footer: '<button type="button" class="btn" data-act="modal-close">Cancelar</button><button type="button" class="btn btn-primary" data-act="restore-apply">' + ICON.upload + 'Restaurar</button>' });
      this._restoreBody(entry, plan);
      return entry;
    },
    _restoreBody(entry, plan, status) {
      const r = entry.ctx.restore, c = plan.counts;
      const LBL = [['products', 'Produtos'], ['sellers', 'Vendedores / agentes'], ['origins', 'Origens de lead'], ['metrics', 'Métricas'], ['goals', 'Metas'], ['presets', 'Presets'], ['sales', 'Vendas'], ['daily_entries', 'Lançamentos do Diário'], ['settings', 'Configurações e personalizações']];
      const novos = LBL.reduce((a, x) => a + c[x[0]].create, 0);
      const exp = r.data.exported_at ? new Date(r.data.exported_at) : null;
      const quando = exp && !isNaN(exp) ? D.fmt(D.toISO(exp)) + ' ' + String(exp.getHours()).padStart(2, '0') + ':' + String(exp.getMinutes()).padStart(2, '0') : 'data desconhecida';
      let h = '<p class="ink2" style="margin-bottom:12px"><b>' + esc(r.fileName || 'backup.json') + '</b> · exportado em ' + esc(quando) + (r.data.version ? ' · versão ' + esc(r.data.version) : '') + '</p>';
      h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th class="num" title="Serão criados">Novos</th><th class="num" title="Já estão na base e serão mantidos como estão">Já existem</th></tr></thead><tbody>' +
        LBL.map((x) => '<tr data-restore="' + x[0] + '"><td>' + x[1] + '</td><td class="num' + (c[x[0]].create ? ' strong' : '') + '">' + F.int(c[x[0]].create) + '</td><td class="num muted">' + F.int(c[x[0]].skip) + '</td></tr>').join('') + '</tbody></table></div>';
      if (c.settings.skip) {
        h += '<label class="check" style="margin-top:12px"><input type="checkbox" data-ref="restore-replace"' + (r.replace ? ' checked' : '') + ' data-chg="restore-replace"> Substituir minhas configurações e personalizações pelas do backup (' + c.settings.skip + (c.settings.skip === 1 ? ' item' : ' itens') + ')</label>';
      }
      if (plan.issues.length) {
        h += '<details class="more" style="margin-top:12px"><summary>' + plan.issues.length + (plan.issues.length === 1 ? ' aviso' : ' avisos') + ' (itens que não serão restaurados) ' + ICON.chevron + '</summary><ul class="small ink2" style="margin:8px 0 0 18px">' +
          plan.issues.slice(0, 50).map((t) => '<li>' + esc(t) + '</li>').join('') + (plan.issues.length > 50 ? '<li>e mais ' + (plan.issues.length - 50) + '…</li>' : '') + '</ul></details>';
      }
      h += '<p class="small muted" style="margin-top:12px">Nada é apagado ou alterado. Itens com o mesmo nome são reaproveitados; vendas e lançamentos que já existem são mantidos. Se a gravação parar no meio, restaure de novo: ela continua de onde parou, sem duplicar.</p>';
      if (status) h += '<div class="note" data-ref="restore-status" style="margin-top:12px">' + status + '</div>';
      entry.body.innerHTML = h;
      const btn = entry.modal.querySelector('[data-act=restore-apply]');
      if (btn) btn.disabled = novos === 0 && !(r.replace && c.settings.skip);
      if (btn && btn.disabled) btn.title = 'O backup não tem nada que a base ainda não tenha';
    },

    // ---------------- configurações ----------------
    _configCard() {
      const s = this.store.settings;
      const opt = (v, l, cur) => '<option value="' + v + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + l + '</option>';
      return '<div class="card" style="max-width:760px"><div class="card-head"><div><h3>Configurações</h3><p class="sub">Valem para todos que usam o painel.</p></div></div><div class="form">' +
        '<div class="form-row"><label class="field"><span>Alerta vermelho abaixo de (% da meta)</span><input class="inp" type="number" min="0" max="1000" data-cfg="red_below" value="' + Math.round(s.red_below * 100) + '"></label>' +
        '<label class="field"><span>Verde a partir de (% da meta)</span><input class="inp" type="number" min="1" max="1000" data-cfg="green_from" value="' + Math.round(s.green_from * 100) + '"></label></div>' +
        '<p class="small muted" style="margin-top:-6px">Abaixo do alerta vermelho o status é "Crítico"; entre os dois valores fica amarelo ("Atenção"); a partir do verde, "Na meta".</p>' +
        '<label class="field"><span>Filtros "Últimos 7 / 14 / 28 dias"</span><select class="inp" data-cfg="include_today">' + opt('false', 'Terminam ontem (como nas ferramentas de anúncios)', s.include_today) + opt('true', 'Incluem o dia de hoje', s.include_today) + '</select></label>' +
        '<label class="field"><span>A semana começa em</span><select class="inp" data-cfg="week_start">' + opt(1, 'Segunda-feira', s.week_start) + opt(0, 'Domingo', s.week_start) + '</select></label>' +
        '<label class="field"><span>Período padrão ao abrir o painel</span><select class="inp" data-cfg="default_period">' + PERIODS.map((p) => opt(p[0], p[1], s.default_period)).join('') + '</select></label>' +
        '<div><button type="button" class="btn btn-primary" data-act="cfg-save">' + ICON.save + 'Salvar configurações</button></div></div></div>' +
        '<div class="card" style="max-width:760px"><div class="card-head"><div><h3>Dados</h3><p class="sub">Cópia completa de cadastros, metas, vendas, diário e configurações em JSON. Restaurar um backup acrescenta o que falta, sem apagar nem duplicar nada (serve também para levar os dados para outro banco).</p></div></div>' +
        '<div class="toolbar" style="margin:0"><button type="button" class="btn" data-act="cfg-export">' + ICON.download + 'Exportar todos os dados (JSON)</button>' +
        '<button type="button" class="btn" data-act="cfg-restore">' + ICON.upload + 'Restaurar backup (JSON)</button>' +
        '<input type="file" accept=".json,application/json" data-chg="cfg-restore-file" data-ref="cfg-restore-file" hidden aria-label="Arquivo de backup">' +
        (this._adapter && this._adapter.kind === 'local' ? '<span class="spacer"></span><button type="button" class="btn btn-danger" data-act="cfg-reset" title="Apaga tudo o que está salvo neste navegador e volta aos dados de exemplo (pede senha)">Apagar dados do navegador…</button>' : '') + '</div></div>' +
        '<p class="small muted" style="margin-top:12px">Relatório Comercial v' + VERSION + '</p>';
    },
  };

  Object.assign(ACT, {
    'cad-sub'(el) { this._cs().sub = el.dataset.sub; this._renderCadastros(); },
    async 'cat-add'(el) {
      const box = el.closest('[data-cat]'), c = box.dataset.cat;
      const nameEl = box.querySelector('[data-ref=cat-new-name]');
      const data = { name: nameEl.value };
      const ow = box.querySelector('[data-ref=cat-new-owner]'), kd = box.querySelector('[data-ref=cat-new-kind]');
      if (ow) data.owner_seller_id = ow.value || null;
      if (kd) data.kind = kd.value;
      if (c === 'metrics' && data.kind !== 'money') data.funnel_order = this.store.funnelMetrics().reduce((m, x) => Math.max(m, x.funnel_order), 0) + 1;
      const r = await this.store.addItem(c, data);
      this._toast('"' + this.store.label(c, r) + '" ' + gen(c, 'adicionado') + '.');
      this._refreshCatalog();
      const again = this._shell.querySelector('[data-cat="' + c + '"] [data-ref=cat-new-name]');
      if (again) again.focus();
    },
    async 'cat-move'(el) {
      const x = this._catRow(el);
      const ids = Array.from(el.closest('[data-cat-card]').querySelectorAll('tr[data-id]')).filter((tr) => tr.querySelector('[data-act=cat-move]')).map((tr) => tr.dataset.id);
      await this.store.move(x.c, x.id, Number(el.dataset.dir), ids);
      this._refreshCatalog();
    },
    async 'cat-archive'(el) {
      const x = this._catRow(el), on = x.item.active === false;
      await this.store.setActive(x.c, x.id, on);
      this._toast('"' + this.store.label(x.c, x.item) + '" ' + (on ? gen(x.c, 'restaurado') + '.' : gen(x.c, 'arquivado') + '. ' + (isFem(x.c) ? 'Ela' : 'Ele') + ' não aparece mais nos seletores; o histórico continua nos relatórios.'));
      this._refreshCatalog();
    },
    async 'cat-delete'(el) {
      const x = this._catRow(el), nm = this.store.label(x.c, x.item);
      if (!(await this._confirm('Excluir "' + nm + '" definitivamente?\nSó é possível se não houver vendas ou lançamentos ligados a ' + (isFem(x.c) ? 'ela' : 'ele') + '. Metas e linhas de presets ligadas também serão removidas.', { ok: 'Excluir', danger: true }))) return;
      try {
        await this.store.deleteItem(x.c, x.id);
        this._toast('"' + nm + '" ' + gen(x.c, 'excluído') + '.');
      } catch (e) {
        if (e.code !== 'IN_USE') throw e;
        if (await this._confirm('"' + nm + '" tem lançamentos no histórico e não pode ser ' + gen(x.c, 'excluído') + '.\nDeseja ' + (isFem(x.c) ? 'arquivá-la? Ela' : 'arquivá-lo? Ele') + ' some dos seletores e os relatórios antigos continuam corretos.', { ok: 'Arquivar' })) {
          await this.store.setActive(x.c, x.id, false);
          this._toast('"' + nm + '" ' + gen(x.c, 'arquivado') + '.');
        }
      }
      this._refreshCatalog();
    },
    async 'cat-goalvis'(el) {
      const x = this._catRow(el), show = x.item.show_in_goals === false;
      await this.store.update('products', x.id, { show_in_goals: show });
      this._toast('"' + x.item.name + '" ' + (show ? 'volta a aparecer' : 'não aparece mais') + ' em "Metas por produto" no Painel' + (show ? '.' : ' nem nos indicadores de meta.'));
      this._refreshCatalog();
    },
    'goal-edit'(el) {
      if (el.dataset.type === GENERAL_GOAL.type) return this._goalEditor(GENERAL_GOAL.type, GENERAL_GOAL.id);
      const x = this._catRow(el); this._goalEditor(el.dataset.type, x.id);
    },
    async 'goal-save'(el) {
      const entry = this._modalOf(el);
      const g = entry.ctx.goal, q = (k) => entry.body.querySelector('[data-g=' + k + ']');
      const rawAmt = q('amount').value.trim();
      const amount = rawAmt === '' ? null : parseMoney(rawAmt);
      if (rawAmt !== '' && !(amount > 0)) { q('amount').classList.add('err'); this._toast('Valor de meta inválido.', 'error'); return; }
      const always = q('always').checked;
      const from = always ? null : parseDate(q('valid_from').value);
      if (!always && !from) { this._toast('Informe a data a partir da qual a meta vale.', 'error'); return; }
      if (amount == null && !this.store.goalRecords(g.type, g.id).length) { this._toast('Informe um valor de meta.', 'info'); return; }
      const target = g.type === GENERAL_GOAL.type ? GENERAL_GOAL.id : this.store.get(g.type === 'product' ? 'products' : 'sellers', g.id).id;
      await this.store.setGoal({ target_type: g.type, target_id: target, amount, period: q('period').value, valid_from: from });
      this._toast(amount == null ? 'Meta encerrada' + (from ? ' a partir de ' + D.fmt(from) : '') + '.' : 'Meta salva.');
      this._goalBody(entry);
      this._refreshCatalog();
    },
    async 'goal-del'(el) {
      const entry = this._modalOf(el);
      if (!(await this._confirm('Remover este registro do histórico de metas?', { ok: 'Remover', danger: true }))) return;
      await this.store.remove('goals', el.dataset.gid);
      this._goalBody(entry);
      this._refreshCatalog();
    },
    'preset-new'() { this._presetEditor(null); },
    'preset-edit'(el) { this._presetEditor(this.store.get('presets', el.closest('tr').dataset.id)); },
    async 'preset-del'(el) {
      const p = this.store.get('presets', el.closest('tr').dataset.id);
      if (!(await this._confirm('Excluir o preset "' + p.name + '"? Os lançamentos já feitos não são afetados.', { ok: 'Excluir', danger: true }))) return;
      await this.store.remove('presets', p.id);
      this._toast('Preset excluído.');
      this._renderCadastros();
    },
    async 'pe-block'(el) {
      const entry = this._modalOf(el), pe = entry.ctx.pe;
      const items = await this._blockForm();
      if (!items) return;
      const have = new Set(pe.items.map((it) => it.product_id + '|' + it.seller_id + '|' + it.metric_id));
      items.forEach((it) => { const k = sid(it.product_id) + '|' + sid(it.seller_id) + '|' + sid(it.metric_id); if (!have.has(k)) { have.add(k); pe.items.push({ k: uid(), product_id: sid(it.product_id), seller_id: sid(it.seller_id), metric_id: sid(it.metric_id) }); } });
      this._peRender(entry);
    },
    'pe-add'(el) {
      const entry = this._modalOf(el), pe = entry.ctx.pe, last = pe.items[pe.items.length - 1];
      pe.items.push({ k: uid(), product_id: last ? last.product_id : '', seller_id: last ? last.seller_id : '', metric_id: '' });
      this._peRender(entry);
    },
    'pe-del'(el) {
      const entry = this._modalOf(el), pe = entry.ctx.pe;
      pe.items = pe.items.filter((it) => it.k !== el.closest('tr').dataset.k);
      this._peRender(entry);
    },
    async 'pe-save'(el) {
      const entry = this._modalOf(el), pe = entry.ctx.pe, s = this.store;
      const name = pe.name.trim();
      if (!name) { this._toast('Dê um nome ao preset.', 'error'); return; }
      if (s.c.presets.some((p) => norm(p.name) === norm(name) && sid(p.id) !== sid(pe.id))) { this._toast('Já existe um preset com esse nome.', 'error'); return; }
      const seen = new Set();
      const items = [];
      pe.items.forEach((it) => {
        const p = s.get('products', it.product_id), v = s.get('sellers', it.seller_id), m = s.get('metrics', it.metric_id);
        const k = it.product_id + '|' + it.seller_id + '|' + it.metric_id;
        if (p && v && m && !seen.has(k)) { seen.add(k); items.push({ product_id: p.id, seller_id: v.id, metric_id: m.id }); }
      });
      if (!items.length) { this._toast('O preset precisa de ao menos uma linha completa (produto, agente e métrica).', 'error'); return; }
      if (pe.id) await s.update('presets', pe.id, { name, items }); else await s.create('presets', { name, items });
      this._closeModal(true, entry);
      this._toast('Preset "' + name + '" salvo' + (items.length < pe.items.length ? ' (linhas incompletas ou repetidas foram descartadas).' : '.'));
      if (this.tab === 'cadastros') this._renderCadastros();
    },
    async 'cfg-save'() {
      const v = (k) => this._view.querySelector('[data-cfg=' + k + ']').value;
      const red = Number(v('red_below')) / 100, green = Number(v('green_from')) / 100;
      if (!(red >= 0) || !(green > 0) || red > green) { this._toast('O limite vermelho precisa ser menor ou igual ao verde.', 'error'); return; }
      const s = this.store;
      await s.setSetting('red_below', red);
      await s.setSetting('green_from', green);
      await s.setSetting('include_today', v('include_today') === 'true');
      await s.setSetting('week_start', Number(v('week_start')));
      await s.setSetting('default_period', v('default_period'));
      this._toast('Configurações salvas.');
      this._renderCadastros();
    },
    'cfg-restore'() { const inp = this._view.querySelector('[data-ref=cfg-restore-file]'); inp.value = ''; inp.click(); },
    async 'restore-apply'(el) {
      const entry = this._modalOf(el), r = entry.ctx.restore;
      const btns = Array.from(entry.modal.querySelectorAll('.modal-foot button'));
      const status = (t) => { let n = entry.body.querySelector('[data-ref=restore-status]'); if (!n) { n = document.createElement('div'); n.className = 'note'; n.dataset.ref = 'restore-status'; n.style.marginTop = '12px'; entry.body.appendChild(n); } n.innerHTML = t; };
      entry.locked = true; btns.forEach((b) => { b.disabled = true; });
      try {
        const res = await this.store.restoreBackup(r.data, {
          replaceSettings: !!r.replace,
          onProgress: (etapa, feito, total) => status(ICON.refresh + '<span>Gravando ' + esc(etapa.toLowerCase()) + (total ? '… ' + F.int(feito) + ' de ' + F.int(total) : '…') + '</span>'),
        });
        entry.locked = false;
        this._closeModal(true, entry);
        const n = Object.keys(res.counts).reduce((a, k) => a + res.counts[k].create, 0);
        this._toast('Backup restaurado: ' + F.int(n) + (n === 1 ? ' item novo.' : ' itens novos.') + (res.issues.length ? ' ' + res.issues.length + ' aviso(s) na prévia não foram restaurados.' : ''));
        // recusas que a prévia não tinha como prever (ex.: banco sem suporte à meta geral)
        const geral = res.issues.filter((t) => t.indexOf('Meta geral') === 0);
        if (geral.length) this._toast(geral[0] + (geral.length > 1 ? ' (' + geral.length + ' metas gerais)' : ''), 'error');
        if (this.ui.diario) this.ui.diario.loadedFor = null; // o dia aberto no Diário pode ter ganhado lançamentos
        await this.render();
      } catch (err) {
        entry.locked = false; btns.forEach((b) => { b.disabled = false; });
        status(ICON.alert + '<span><b>A restauração parou no meio.</b> O que já foi gravado continua salvo. Clique em <b>Restaurar</b> de novo para continuar: nada será duplicado.</span>');
        throw err;
      }
    },
    async 'cfg-export'() {
      const out = { app: 'relatorio-comercial', version: VERSION, exported_at: new Date().toISOString() };
      const res = await Promise.all(COLLECTIONS.map((c) => this.store.fetchAll(c)));
      COLLECTIONS.forEach((c, i) => { out[c] = res[i]; });
      this._download('relatorio-comercial-backup-' + D.today() + '.json', JSON.stringify(out, null, 2), 'application/json');
    },
    /**
     * Apagar dados do navegador (só com o adaptador local): 1) explica o que acontece e pede a senha;
     * 2) com a senha certa, pede a confirmação final; 3) apaga tudo e volta aos dados de exemplo (seed).
     */
    async 'cfg-reset'() {
      if (!this._adapter || this._adapter.kind !== 'local' || !this._adapter.reset || !this.store) return;
      const [sales, daily] = await Promise.all([this.store.fetchAll('sales'), this.store.fetchAll('daily_entries')]);
      const n = (x, um, varios) => F.int(x) + ' ' + (x === 1 ? um : varios);
      const counts = n(sales.length, 'venda', 'vendas') + ' e ' + n(daily.length, 'lançamento do Diário', 'lançamentos do Diário');
      this._openModal({
        title: 'Apagar todos os dados deste navegador', size: 'small', ctx: { counts },
        body: '<p class="ink2">Isto apaga <b>tudo</b> o que está salvo neste navegador (cadastros, metas, <b>' + esc(counts) + '</b>, presets e personalizações) e coloca no lugar os <b>dados de exemplo</b> da demonstração. <b>Não dá para desfazer.</b></p>' +
          '<p class="small ink2" style="margin:10px 0 14px">Para guardar uma cópia antes: <button type="button" class="link" data-act="cfg-export">exportar backup (JSON)</button>.</p>' +
          '<label class="field"><span>Senha</span><input class="inp" type="password" inputmode="numeric" autocomplete="off" data-ref="reset-pin" data-enter="cfg-reset-go"></label>' +
          '<p class="err-txt" data-ref="reset-err" role="alert" hidden style="margin-top:6px">Senha incorreta.</p>',
        footer: '<button type="button" class="btn" data-act="modal-close">Cancelar</button><button type="button" class="btn btn-danger" data-act="cfg-reset-go">Continuar</button>',
      });
    },
    async 'cfg-reset-go'(el) {
      const entry = this._modalOf(el);
      if (!entry) return;
      const inp = entry.body.querySelector('[data-ref=reset-pin]'), err = entry.body.querySelector('[data-ref=reset-err]');
      if (inp.value.trim() !== this._resetPin) {
        inp.classList.add('err'); err.hidden = false; inp.select(); inp.focus();
        return;
      }
      const counts = entry.ctx.counts;
      this._closeModal(false, entry);
      if (!(await this._confirm('Última confirmação: apagar ' + counts + ' e todos os cadastros deste navegador, voltando aos dados de exemplo?\n\nIsso não pode ser desfeito.', { title: 'Apagar tudo?', ok: 'Apagar tudo', danger: true }))) return;
      this._adapter.reset();
      this.ui = {};
      this.periods = {};
      this.tab = 'painel';
      await this._boot();
    },
  });
  Object.assign(CHG, {
    'cat-archived'(el) { this._cs().showArchived = el.checked; this._refreshCatalog(); },
    async 'cfg-restore-file'(el) {
      const f = el.files && el.files[0];
      if (!f) return;
      let data;
      try { data = JSON.parse(await f.text()); } catch (e) { this._toast('Não foi possível ler "' + f.name + '": o arquivo não é um JSON válido.', 'error'); return; }
      await this._restorePreview(data, f.name);
    },
    async 'restore-replace'(el) {
      const entry = this._modalOf(el);
      entry.ctx.restore.replace = el.checked;
      this._restoreBody(entry, await this.store.restoreBackup(entry.ctx.restore.data, { dryRun: true, replaceSettings: el.checked }));
    },
    async 'cat-rename'(el) {
      const x = this._catRow(el);
      try { await this.store.rename(x.c, x.id, el.value); this._toast('Renomeado para "' + el.value.trim() + '". O histórico acompanha a mudança.'); }
      catch (e) { el.value = x.item.name; throw e; }
    },
    async 'cat-owner'(el) { const x = this._catRow(el); await this.store.update('products', x.id, { owner_seller_id: el.value ? this.store.get('sellers', el.value).id : null }); this._toast('Responsável atualizado.'); },
    async 'cat-metric'(el) {
      const x = this._catRow(el), f = el.dataset.f;
      const patch = {};
      if (f === 'kind') { patch.kind = el.value; if (el.value === 'money') patch.funnel_order = null; }
      else if (f === 'funnel_order') patch.funnel_order = el.value === '' ? null : Math.max(1, Math.round(Number(el.value)));
      else patch.audit_role = el.value || null;
      await this.store.update('metrics', x.id, patch);
      this._toast('Métrica atualizada.');
      this._refreshCatalog();
    },
    'goal-always'(el) { const entry = this._modalOf(el); const d = entry.body.querySelector('[data-g=valid_from]'); d.disabled = el.checked; if (!el.checked && !d.value) d.value = D.weekStart(D.today(), this.store.settings.week_start); },
    'pe-cell'(el) {
      const entry = this._modalOf(el), it = entry.ctx.pe.items.find((x) => x.k === el.closest('tr').dataset.k);
      if (it) it[el.dataset.f] = el.value;
    },
  });
  Object.assign(INP, {
    'pe-name'(el) { this._modalOf(el).ctx.pe.name = el.value; },
  });

  // ==========================================================================
  // 10b. EXPORTAR PDF (v1.10)
  // ==========================================================================
  // O PDF sai da impressão do navegador ("Salvar como PDF"): texto selecionável, gráficos em vetor, sem biblioteca.
  // Passos: a tela é refeita fora da vista, na largura da folha A4 e no tema escolhido; a cópia perde botões e
  // seletores (os filtros vão para o cabeçalho); um iframe recebe a cópia com o CSS do painel + PDF_CSS e é impresso.
  const PDF_W = { landscape: 1046, portrait: 718 }; // largura útil da A4 em px (297 ou 210 mm − 2 × 10 mm de margem)
  const PDF_H = { landscape: 718, portrait: 1046 }; // altura útil
  const PDF_CSS = `
  .amr.pdf{border-radius:0;padding:0;min-height:0}
  .amr.pdf[data-theme="light"]{--page:#ffffff}
  /* cores exatas também no próprio .rc: o :host{all:initial} zera o que viria da página, e sem isso a impressão com
     "Gráficos de plano de fundo" desligado (o padrão do Chrome e do Edge) tira o fundo escuro e some com os textos claros */
  :host,.amr.pdf,.pdf *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .pdf *{animation:none!important;transition:none!important}
  .pdf-head{margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--grid)}
  .pdf-head .brand{padding:0 0 10px}
  .pdf-head h1{font-size:21px;font-weight:700;margin:0 0 6px}
  .pdf-filters{display:flex;flex-wrap:wrap;gap:4px 18px;color:var(--ink-2);font-size:12.5px}
  .pdf-filters b{color:var(--ink);font-weight:600}
  .pdf-meta{color:var(--muted);font-size:12px;margin-top:6px}
  .pdf-part+.pdf-part{break-before:page}
  /* nada é partido entre páginas: cartões, indicadores, gráficos, avisos, linhas de tabela */
  .pdf .card,.pdf .kpi,.pdf .kpis,.pdf .note,.pdf .chart,.pdf svg,.pdf .funnel,.pdf .legend,.pdf .stack,.pdf .agd-cal-wrap,.pdf .team-cal-row,.pdf tr,.pdf .funnel-row,.pdf .pdf-head{break-inside:avoid}
  /* cartão maior que uma página (medido na hora): começa logo e continua na seguinte, entre linhas, com o cabeçalho
     repetido; se estava lado a lado com outro, os dois ficam um embaixo do outro (sem caixa vazia ao lado) */
  .pdf [data-pdf-long]{break-inside:auto}
  .pdf .grid-2[data-pdf-stack]{display:block}
  .pdf .grid-2[data-pdf-stack]>*+*{margin-top:16px}
  .pdf h3,.pdf .card-head,.pdf .chart-title,.pdf .agd-head,.pdf .pdf-sub,.pdf .legend{break-after:avoid}
  /* o cabeçalho da tabela (thead) já se repete em cada página; o total (tfoot) sai só no fim */
  .pdf tfoot{display:table-row-group}
  .pdf .tbl-wrap,.pdf .scroll-y,.pdf .agd-cal-wrap,.pdf .team-cal,.pdf .inc-cols{overflow:visible!important;max-height:none!important}
  .pdf .tbl th{position:static!important}
  .pdf .pdf-sub{font-size:13px;font-weight:600;color:var(--ink-2);margin:14px 0 6px}
  .pdf .pdf-pick{display:inline-block;padding:2px 9px;border:1px solid var(--border-2);border-radius:6px;font-size:12.5px;color:var(--ink-2);white-space:nowrap}
  .pdf .busy{opacity:1}
  `;

  const PdfView = {
    /** Tela atual pode virar PDF? { label, sub, agdash (dashboard de um agente) } ou null. */
    _pdfScope() {
      if (!this.store) return null;
      if (this.tab === 'painel') return { label: 'Painel' };
      if (this.tab === 'tendencias') return { label: 'Tendências' };
      if (this.tab === 'vendas') return this._vs().sub === 'historico' ? { label: 'Vendas', sub: 'Histórico' } : null;
      if (this.tab === 'diario') {
        const st = this._ds(), team = st.agdMode === 'team';
        const subs = { agentes: 'Visão por Agente', agdash: team ? 'Dashboard Agentes — Equipe' : 'Dashboard Agentes', renda: 'Renda dos Leads', historico: 'Histórico' };
        return subs[st.sub] ? { label: 'Diário', sub: subs[st.sub], agdash: st.sub === 'agdash' && !team } : null;
      }
      return null;
    },
    /** Agentes do "PDF de todos os agentes": os do seletor com registro no período, fora os ocultos (como a Equipe). */
    _pdfAgents() {
      const v = this._agd;
      if (!v || !v.agents) return [];
      const hidden = new Set(this.store.settings.agent_views.hidden_agents);
      return v.agents.filter((a) => (a.entries || a.sales) && !hidden.has(a.id));
    },
    async _pdfDialog() {
      const sc = this._pdfScope();
      if (!sc) { this._toast('Esta tela não tem PDF: abra um relatório (Painel, Tendências, Histórico de vendas ou um relatório do Diário).', 'info'); return; }
      const agents = sc.agdash ? this._pdfAgents() : [];
      const fields = [
        { key: 'theme', label: 'Tema do PDF', type: 'select', options: [['dark', 'Escuro (como a tela)'], ['light', 'Claro (melhor para imprimir em papel)']], value: this._themeNow() },
        { key: 'orientation', label: 'Folha', type: 'select', options: [['landscape', 'A4 deitada (paisagem)'], ['portrait', 'A4 em pé (retrato)']], value: 'landscape' },
      ];
      if (sc.agdash && this._agd && this._agd.agent) {
        fields.push({ key: 'scope', label: 'Conteúdo', type: 'select', value: 'one',
          options: [['one', 'Só ' + this._agd.agent.name]].concat(agents.length > 1 ? [['all', 'Todos os agentes com registros no período (' + agents.length + '), um por página']] : []) });
      }
      if (this._view.querySelector('details.more') || sc.agdash) fields.push({ key: 'tables', label: 'Incluir as tabelas de números (as de "Ver números…")', type: 'checkbox', value: false, hint: 'Tabelas muito largas diminuem para caber na folha (o PDF pode ser ampliado sem perder nitidez).' });
      const v = await this._form({
        title: 'Exportar PDF — ' + sc.label + (sc.sub ? ' › ' + sc.sub : ''), ok: 'Gerar PDF', fields,
        intro: 'O PDF sai com o que está na tela: período, filtros e agrupamento. Na janela que abrir, escolha <b>Salvar como PDF</b> como destino.',
      });
      if (!v) return;
      await this.exportPdf({ theme: v.theme, orientation: v.orientation, tables: !!v.tables, allAgents: v.scope === 'all' });
    },

    /**
     * Gera o PDF da tela atual (API pública). opts: { theme: 'dark' | 'light', orientation: 'landscape' | 'portrait',
     * tables (abre as tabelas "Ver números…"), allAgents (Dashboard Agentes: um agente por página), print (false = só
     * monta o documento, para testes) }. Devolve { frame, html, content }.
     */
    async exportPdf(opts) {
      const sc = this._pdfScope();
      if (!sc) throw userErr('Esta tela não tem PDF.', 'NO_PDF');
      if (this._pdfBusy) return null;
      const o = Object.assign({ theme: this._themeNow(), orientation: 'landscape', tables: false, allAgents: false, print: true }, opts);
      if (o.theme !== 'light') o.theme = 'dark';
      if (o.orientation !== 'portrait') o.orientation = 'landscape';
      const W = PDF_W[o.orientation], v = this._view, sh = this._shell;
      this._pdfBusy = true;
      const wait = document.createElement('div');
      wait.className = 'pdf-wait'; wait.setAttribute('role', 'status');
      wait.innerHTML = '<div><div class="loading-bar"></div>Preparando o PDF…</div>';
      sh.style.minHeight = sh.offsetHeight + 'px'; // a página não pula enquanto a tela é refeita fora da vista
      sh.appendChild(wait);
      let parts;
      try {
        this._themeForced = o.theme; this._applyTheme();
        v.classList.add('pdf-capture'); v.style.width = W + 'px';
        parts = await this._pdfCapture(sc, o);
      } finally {
        v.classList.remove('pdf-capture'); v.style.width = '';
        this._themeForced = null; this._applyTheme();
        await this.render();
        wait.remove(); sh.style.minHeight = '';
        this._pdfBusy = false;
      }
      return this._pdfPrint(sc, o, parts, W);
    },
    /** Refaz a tela (ou cada agente) na largura da folha e copia o resultado. */
    async _pdfCapture(sc, o) {
      const vs = this._vs(), lim = vs.hist.limit, st = this._ds(), keep = { agent: st.agdAgent, product: st.agdProduct };
      const parts = [];
      try {
        vs.hist.limit = Infinity; // Histórico de vendas: todas as linhas do filtro, não só as primeiras
        if (o.allAgents && sc.agdash) {
          for (const a of this._pdfAgents()) {
            st.agdAgent = a.id; st.agdProduct = '';
            await this.render();
            parts.push(this._pdfGrab(o));
          }
        } else {
          await this.render();
          parts.push(this._pdfGrab(o));
        }
      } finally { vs.hist.limit = lim; st.agdAgent = keep.agent; st.agdProduct = keep.product; }
      return parts;
    },
    /** Cópia da tela para o PDF: filtros da barra viram texto, botões e campos saem. { html, filters, scope }. */
    _pdfGrab(o) {
      // tabelas e grades mais largas que a folha: diminuem até caber (medido aqui, na largura da folha)
      this._view.querySelectorAll('.tbl-wrap, .agd-cal-wrap, .team-cal, .inc-cols').forEach((w) => {
        if (w.scrollWidth > w.clientWidth + 1 && w.clientWidth) w.setAttribute('data-pdf-zoom', (w.clientWidth / w.scrollWidth).toFixed(3));
      });
      // cartões maiores que uma folha: esses podem continuar na seguinte
      const H = PDF_H[o.orientation] - 8; // cabe numa folha: vai inteiro para a próxima se preciso
      this._view.querySelectorAll('.card').forEach((c) => {
        if (c.offsetHeight <= H) return;
        c.setAttribute('data-pdf-long', '');
        const g = c.parentElement && c.parentElement.classList.contains('grid-2') ? c.parentElement : null;
        if (g) g.setAttribute('data-pdf-stack', '');
      });
      const box = document.createElement('div');
      box.innerHTML = this._view.innerHTML;
      const filters = [];
      let scope = null;
      const txt = (el) => el.textContent.replace(/\s+/g, ' ').trim();
      const selected = (sel) => sel.querySelector('option[selected]') || sel.querySelector('option');
      // barras de filtro (a do topo e as que têm o período): viram o cabeçalho do PDF
      Array.from(box.querySelectorAll('.toolbar')).filter((t) => t.querySelector('[data-act=period-open]') || !t.closest('.card')).forEach((t) => {
        t.querySelectorAll('[data-act=period-open]').forEach((chip) => {
          const sp = chip.querySelectorAll('span');
          scope = scope || chip.dataset.scope;
          filters.push(['Período', txt(sp[0]) + (sp[1] ? ', ' + txt(sp[1]) : '')]);
        });
        t.querySelectorAll('.subnav[role=group]').forEach((g) => {
          const on = g.querySelector('button.on'), note = g.nextElementSibling;
          if (on) filters.push([g.getAttribute('aria-label') || '', txt(on) + (note && note.classList.contains('range-note') && txt(note) ? ' (' + txt(note) + ')' : '')]);
        });
        t.querySelectorAll('select').forEach((sel) => { const op = selected(sel); if (op) filters.push([sel.dataset.pdfLabel || sel.getAttribute('aria-label') || '', txt(op)]); });
        t.querySelectorAll('input[type=search]').forEach((i) => { if (i.getAttribute('value')) filters.push([i.getAttribute('aria-label') || 'Busca', i.getAttribute('value')]); });
        t.remove();
      });
      // navegação das sub-abas, carregamento e ações
      box.querySelectorAll('.subnav').forEach((n) => { if (n.querySelector('[data-act$="-sub"]')) n.remove(); });
      box.querySelectorAll('.loading-bar, .agd-actions, .chip, input, textarea').forEach((x) => x.remove());
      // "Ver números…": abertas (com um título no lugar do botão) ou fora do PDF
      // (vira um bloco comum: sem o resumo, o navegador escreveria "Details" no lugar)
      box.querySelectorAll('details.more').forEach((d) => {
        if (!o.tables) { d.remove(); return; }
        const div = document.createElement('div'), s = d.querySelector('summary');
        div.className = 'pdf-more';
        if (s) { const h = document.createElement('div'); h.className = 'pdf-sub'; h.textContent = txt(s).replace(/^Ver /, '').replace(/^./, (c) => c.toUpperCase()); div.appendChild(h); s.remove(); }
        while (d.firstChild) div.appendChild(d.firstChild);
        d.replaceWith(div);
      });
      // seletores dentro dos cartões (ex.: métrica do gráfico): o escolhido, como texto
      box.querySelectorAll('select').forEach((sel) => { const op = selected(sel), sp = document.createElement('span'); sp.className = 'pdf-pick'; sp.textContent = op ? txt(op) : ''; sel.replaceWith(sp); });
      // botões que carregam texto da tabela (título de coluna, nome do agente) viram texto; os demais saem
      box.querySelectorAll('button').forEach((b) => {
        if (b.classList.contains('th-sort') || b.classList.contains('link')) { const sp = document.createElement('span'); sp.className = b.classList.contains('link') ? 'strong' : ''; sp.innerHTML = b.innerHTML; b.replaceWith(sp); } else b.remove();
      });
      // coluna de ações (editar / excluir) das tabelas: sai com o título vazio dela
      box.querySelectorAll('table').forEach((tb) => {
        const row = tb.querySelector('tbody tr');
        const idx = row ? Array.from(row.children).findIndex((c) => c.classList.contains('actions')) : -1;
        if (idx < 0) return;
        tb.querySelectorAll('tbody tr').forEach((tr) => { const c = tr.children[idx]; if (c && c.classList.contains('actions')) c.remove(); });
        tb.querySelectorAll('thead tr').forEach((tr) => { const c = tr.children[idx]; if (c && !txt(c)) c.remove(); });
      });
      box.querySelectorAll('[data-pdf-zoom]').forEach((w) => { w.style.zoom = w.getAttribute('data-pdf-zoom'); });
      return { html: box.innerHTML, filters, scope };
    },
    /** Monta o documento de impressão num iframe (dentro do Shadow DOM) e abre a impressão. */
    _pdfPrint(sc, o, parts, W) {
      this._shadow.querySelectorAll('iframe.pdf-frame').forEach((f) => f.remove());
      const title = this.getAttribute('titulo') || 'Relatório Comercial';
      const name = sc.label + (sc.sub ? ' › ' + sc.sub : '');
      const filters = parts[0].filters.slice();
      if (parts.length > 1) { const i = filters.findIndex((x) => x[0] === 'Agente'); if (i > -1) filters[i] = ['Agentes', parts.length + ' (um por página)']; }
      const now = new Date(), hh = (n) => String(n).padStart(2, '0');
      const r = parts[0].scope ? this._range(parts[0].scope) : null;
      const head = '<header class="pdf-head"><div class="brand"><span class="brand-mark">' + ICON.chart + '</span><span class="brand-title">' + esc(title) + '</span></div>' +
        '<h1>' + esc(name) + '</h1>' + (filters.length ? '<p class="pdf-filters">' + filters.map((x) => '<span>' + (x[0] ? '<b>' + esc(x[0]) + ':</b> ' : '') + esc(x[1]) + '</span>').join('') + '</p>' : '') +
        '<p class="pdf-meta">Gerado em ' + D.fmt(D.today()) + ' às ' + hh(now.getHours()) + ':' + hh(now.getMinutes()) + '</p></header>';
      const content = '<div class="amr pdf" data-theme="' + o.theme + '" style="width:' + W + 'px">' + head + parts.map((p) => '<section class="pdf-part">' + p.html + '</section>').join('') + '</div>';
      // o título vira o nome sugerido do arquivo
      const file = [title, sc.label, sc.sub, r ? r.from + ' a ' + r.to : ''].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|›]+/g, '-');
      const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>' + esc(file) + '</title><style>@page{size:A4 ' + o.orientation + ';margin:10mm;background:' + (o.theme === 'dark' ? '#0d0d0d' : '#ffffff') + '}' +
        'html,body{margin:0;padding:0;background:' + (o.theme === 'dark' ? '#0d0d0d' : '#ffffff') + '}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body><div id="rc-pdf"></div></body></html>';
      const frame = document.createElement('iframe');
      frame.className = 'pdf-frame'; frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      this._shadow.appendChild(frame);
      const doc = frame.contentDocument;
      doc.open(); doc.write(html); doc.close();
      doc.getElementById('rc-pdf').attachShadow({ mode: 'open' }).innerHTML = '<style>' + CSS + PDF_CSS + '</style>' + content;
      const out = { frame, html, content: '<style>' + CSS + PDF_CSS + '</style>' + content };
      if (o.print === false) return out;
      const win = frame.contentWindow;
      win.addEventListener('afterprint', () => setTimeout(() => frame.remove(), 500));
      const go = () => { try { win.focus(); win.print(); } catch (e) { this._error(e); } };
      if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(() => setTimeout(go, 50)); else setTimeout(go, 100);
      return out;
    },
  };
  Object.assign(ACT, { 'pdf-open'() { return this._pdfDialog(); } });

  // ==========================================================================
  // 11. REGISTRO E API PÚBLICA
  // ==========================================================================
  Object.assign(RelatorioComercialElement.prototype, PainelView, TendenciasView, VendasView, DiarioView, AgentDashView, ImportView, CadastrosView, PdfView);
  if (!global.customElements.get(TAG)) global.customElements.define(TAG, RelatorioComercialElement);

  global.RelatorioComercial = {
    version: VERSION,
    tag: TAG,
    createLocalAdapter,
    createRestAdapter,
    /** Cria o painel dentro de um elemento (ou seletor CSS) e já o configura. */
    mount(target, opts) {
      const host = typeof target === 'string' ? document.querySelector(target) : target;
      if (!host) throw new Error('[relatorio-comercial] mount: alvo não encontrado');
      const el = document.createElement(TAG);
      el.configure(opts || {});
      host.appendChild(el);
      return el;
    },
    /** Utilitários expostos para testes e integrações. */
    utils: { parseMoney, parseDate, parseCSV, readXlsx, readTabularFile, computeRange, computeDashboard, computeAgentView, computeLeadIncome, leadIncomeConfig, computeTrends, computeAudit, computeAgentDashboard, computeTeamDashboard, socialConfig, reactivationPair, normalize, Store, dates: D },
  };
})(typeof window !== 'undefined' ? window : this);
