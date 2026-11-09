/**
 * Exemplo de backend REST para o Relatório Comercial — Node.js + Express + Knex.
 *
 * Serve de REFERÊNCIA do contrato esperado pelo painel (veja INTEGRACAO.md).
 * Knex funciona com PostgreSQL, MySQL/MariaDB, SQL Server e SQLite: troque
 * DB_CLIENT e instale o driver correspondente (pg, mysql2, tedious, sqlite3).
 *
 *   npm install
 *   DB_CLIENT=pg DATABASE_URL=postgres://usuario:senha@host/banco node servidor.js
 *   -> abra http://localhost:3000/exemplo-backend/pagina-rest.html
 *
 * Variáveis de ambiente:
 *   DB_CLIENT     pg | mysql2 | mssql | sqlite3      (padrão: pg)
 *   DATABASE_URL  conexão do banco (no SQLite: caminho do arquivo)
 *   PORT          porta HTTP (padrão: 3000)
 *   API_TOKEN     opcional: exige "Authorization: Bearer <token>" nas rotas da API
 *   STATIC_DIR    opcional: pasta extra de páginas estáticas a servir
 *
 * Antes de rodar, crie as tabelas com ../schema.sql.
 */
'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const knexLib = require('knex');

const DB_CLIENT = process.env.DB_CLIENT || 'pg';
const db = knexLib({
  client: DB_CLIENT,
  connection: DB_CLIENT === 'sqlite3' ? { filename: process.env.DATABASE_URL || './relatorio-comercial.sqlite' } : process.env.DATABASE_URL,
  useNullAsDefault: DB_CLIENT === 'sqlite3',
  // SQLite vem com chaves estrangeiras DESLIGADAS em cada conexão: liga explicitamente.
  pool: DB_CLIENT === 'sqlite3' ? { afterCreate: (conn, done) => conn.run('PRAGMA foreign_keys = ON', done) } : undefined,
});

// =============================================================================
// Validação de entrada
// =============================================================================
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (msg, status) => { throw new HttpError(status || 422, msg); };

/**
 * Campos aceitos por coleção (qualquer outro campo do corpo é ignorado).
 * t: tipo · req: obrigatório na criação · nullable: aceita null · max: tamanho máximo
 */
const BOOL = { t: 'bool' }, ORDER = { t: 'int' };
const SCHEMA = {
  products: { name: { t: 'text', max: 120, req: true }, owner_seller_id: { t: 'id', nullable: true }, show_in_goals: BOOL, active: BOOL, sort_order: ORDER },
  sellers: { name: { t: 'text', max: 120, req: true }, active: BOOL, sort_order: ORDER },
  origins: { name: { t: 'text', max: 120, nullable: true }, product_id: { t: 'id', nullable: true }, active: BOOL, sort_order: ORDER },
  metrics: {
    name: { t: 'text', max: 120, req: true }, kind: { t: 'enum', values: ['count', 'money'] },
    funnel_order: { t: 'int', min: 1, nullable: true }, audit_role: { t: 'enum', values: ['sold_count', 'revenue'], nullable: true },
    active: BOOL, sort_order: ORDER,
  },
  goals: {
    target_type: { t: 'enum', values: ['product', 'seller', 'total'], req: true }, target_id: { t: 'id', req: true }, // 'total' = meta geral (v1.6)
    period: { t: 'enum', values: ['weekly', 'monthly'] }, amount: { t: 'num', min: 0, nullable: true }, valid_from: { t: 'date', nullable: true },
  },
  sales: {
    date: { t: 'date', req: true }, lead_name: { t: 'text', max: 200, req: true }, product_id: { t: 'id', req: true },
    amount: { t: 'num', gt: 0, req: true }, seller_id: { t: 'id', req: true }, origin_id: { t: 'id', req: true },
    notes: { t: 'text', max: 1000, nullable: true },
  },
  daily_entries: {
    date: { t: 'date', req: true }, product_id: { t: 'id', req: true }, seller_id: { t: 'id', req: true },
    metric_id: { t: 'id', req: true }, quantity: { t: 'num', min: 0, req: true },
  },
  presets: { name: { t: 'text', max: 120, req: true }, items: { t: 'items', req: true } },
  settings: { value: { t: 'text', max: 100000, req: true } }, // JSON; agent_views cresce ~40 bytes por métrica escolhida por agente
};
const LABEL = {
  name: 'nome', owner_seller_id: 'agente responsável', show_in_goals: 'exibir nas metas', active: 'ativo', sort_order: 'ordem', product_id: 'produto', kind: 'tipo',
  funnel_order: 'posição no funil', audit_role: 'auditoria', target_type: 'tipo de meta', target_id: 'alvo da meta', period: 'período',
  amount: 'valor', valid_from: 'início da vigência', date: 'data', lead_name: 'nome da lead', seller_id: 'vendedor/agente',
  origin_id: 'origem', notes: 'observação', metric_id: 'métrica', quantity: 'quantidade', items: 'itens', value: 'valor',
};
const DATED = new Set(['sales', 'daily_entries']);

function isDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === v;
}

/** Valida e normaliza o corpo. partial = true no PATCH (só os campos enviados). */
function clean(col, body, partial) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Corpo da requisição inválido.', 400);
  const out = {};
  for (const [k, r] of Object.entries(SCHEMA[col])) {
    const lbl = LABEL[k] || k;
    if (!Object.prototype.hasOwnProperty.call(body, k)) {
      if (r.req && !partial) fail('Campo obrigatório: ' + lbl + '.');
      continue;
    }
    let v = body[k];
    if (typeof v === 'string' && r.t !== 'items') v = v.trim();
    if (v === null || v === undefined || v === '') {
      if (r.req) fail('Campo obrigatório: ' + lbl + '.');
      if (r.nullable) out[k] = null;
      continue; // sem valor e não anulável: mantém o padrão do banco
    }
    switch (r.t) {
      case 'text':
        if (typeof v !== 'string' && typeof v !== 'number') fail('Valor inválido em ' + lbl + '.');
        v = String(v);
        if (v.length > r.max) fail(lbl + ': máximo de ' + r.max + ' caracteres.');
        break;
      case 'id':
        if ((typeof v !== 'string' && typeof v !== 'number') || String(v).length > 64) fail('Valor inválido em ' + lbl + '.');
        v = String(v);
        break;
      case 'num': case 'int': {
        const n = typeof v === 'number' ? v : (typeof v === 'string' && v !== '' ? Number(v) : NaN);
        if (!Number.isFinite(n)) fail(lbl + ' precisa ser um número.');
        if (r.t === 'int' && !Number.isInteger(n)) fail(lbl + ' precisa ser um número inteiro.');
        if (r.min != null && n < r.min) fail(lbl + ' não pode ser menor que ' + r.min + '.');
        if (r.gt != null && !(n > r.gt)) fail(lbl + ' precisa ser maior que ' + r.gt + '.');
        v = n;
        break;
      }
      case 'bool':
        if ([true, 1, '1', 'true'].includes(v)) v = true;
        else if ([false, 0, '0', 'false'].includes(v)) v = false;
        else fail(lbl + ' precisa ser verdadeiro ou falso.');
        break;
      case 'date':
        if (!isDate(v)) fail(lbl + ' precisa estar no formato AAAA-MM-DD.');
        break;
      case 'enum':
        if (!r.values.includes(v)) fail(lbl + ' inválido. Use: ' + r.values.join(', ') + '.');
        break;
      case 'items': {
        let arr = v;
        if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch (e) { fail('Itens do preset inválidos.'); } }
        if (!Array.isArray(arr) || arr.length > 2000) fail('Itens do preset precisam ser uma lista (até 2000).');
        v = JSON.stringify(arr.map((it) => {
          if (!it || typeof it !== 'object') fail('Item de preset inválido.');
          return { product_id: String(it.product_id), seller_id: String(it.seller_id), metric_id: String(it.metric_id) };
        }));
        break;
      }
    }
    out[k] = v;
  }
  if (col === 'origins' && !partial && !out.name && !out.product_id) fail('Origem precisa de um nome (ou de um produto).');
  return out;
}

/**
 * Confere se as referências existem (produto, vendedor, origem, métrica, alvo da meta).
 * Feito aqui além das chaves estrangeiras, para bancos onde elas não são aplicadas.
 */
const REFS = {
  products: { owner_seller_id: 'sellers' },
  origins: { product_id: 'products' },
  sales: { product_id: 'products', seller_id: 'sellers', origin_id: 'origins' },
  daily_entries: { product_id: 'products', seller_id: 'sellers', metric_id: 'metrics' },
};
async function checkRefs(trx, col, recs) {
  const refs = Object.assign({}, REFS[col]);
  if (col === 'goals') {
    // meta geral (v1.6): o alvo é sempre 'all'
    if (recs.some((r) => r.target_type === 'total' && r.target_id != null && String(r.target_id) !== 'all')) fail('Meta geral: o alvo da meta precisa ser "all".');
    for (const t of ['product', 'seller']) {
      const ids = [...new Set(recs.filter((r) => r.target_type === t && r.target_id != null).map((r) => r.target_id))];
      await assertExist(trx, t === 'product' ? 'products' : 'sellers', ids, 'alvo da meta');
    }
    return;
  }
  for (const [field, table] of Object.entries(refs)) {
    const ids = [...new Set(recs.map((r) => r[field]).filter((v) => v != null))];
    await assertExist(trx, table, ids, LABEL[field]);
  }
}
async function assertExist(trx, table, ids, lbl) {
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    const found = new Set((await trx(table).whereIn('id', part).pluck('id')).map(String));
    const missing = part.find((id) => !found.has(String(id)));
    if (missing !== undefined) fail('Referência inválida: ' + lbl + ' "' + missing + '" não existe.');
  }
}

/** Lançamentos que impedem a exclusão de um item de cadastro (além das FKs do banco). */
async function isInUse(trx, col, id) {
  const any = async (table, where) => !!(await trx(table).where(where).first('id'));
  switch (col) {
    case 'products': {
      if (await any('sales', { product_id: id }) || await any('daily_entries', { product_id: id })) return true;
      const origin = await trx('origins').where({ product_id: id }).first('id');
      return !!origin && await any('sales', { origin_id: origin.id });
    }
    case 'sellers': return await any('sales', { seller_id: id }) || await any('daily_entries', { seller_id: id });
    case 'origins': return any('sales', { origin_id: id });
    case 'metrics': return any('daily_entries', { metric_id: id });
    default: return false;
  }
}

/**
 * Coluna DATE que o driver devolveu como Date -> 'AAAA-MM-DD'.
 * PostgreSQL e MySQL devolvem a meia-noite LOCAL do servidor; SQL Server (tedious, useUTC) devolve a meia-noite UTC.
 * Ler a meia-noite UTC com getDate() local num servidor em UTC-3 daria o dia anterior: por isso, um Date
 * exatamente à meia-noite UTC é lido em UTC, e os demais no horário local.
 */
function dateOnly(d) {
  const utc = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  const y = utc ? d.getUTCFullYear() : d.getFullYear(), m = utc ? d.getUTCMonth() : d.getMonth(), day = utc ? d.getUTCDate() : d.getDate();
  return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

/** Converte o registro do banco para o formato que o painel espera. */
function out(col, r) {
  if (!r) return r;
  for (const k of ['date', 'valid_from']) {
    if (r[k] instanceof Date) r[k] = dateOnly(r[k]);
  }
  if (col === 'presets' && typeof r.items === 'string') { try { r.items = JSON.parse(r.items); } catch (e) { r.items = []; } }
  return r;
}

// Classificação de erros do banco (PostgreSQL, MySQL, SQL Server, SQLite)
const isForeignKeyError = (e) => e && (e.code === '23503' || e.errno === 1451 || e.errno === 1452 || e.number === 547 ||
  e.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || /FOREIGN KEY/i.test(e.message || ''));
const isUniqueError = (e) => e && (e.code === '23505' || e.errno === 1062 || e.number === 2627 || e.number === 2601 ||
  e.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint/i.test(e.message || ''));
const isConstraintError = (e) => e && (/^23/.test(String(e.code || '')) || [1048, 1364, 3819].includes(e.errno) || [515, 547].includes(e.number) ||
  /^SQLITE_CONSTRAINT/.test(String(e.code || '')));

// Bancos limitam a quantidade de parâmetros por comando (SQL Server: 2100). Insere em blocos seguros.
async function insertChunked(trx, table, rows) {
  if (!rows.length) return;
  const cols = rows.reduce((m, r) => Math.max(m, Object.keys(r).length), 1);
  const per = Math.max(1, Math.floor(2000 / cols));
  for (let i = 0; i < rows.length; i += per) await trx(table).insert(rows.slice(i, i + per));
}

const h = (fn) => (req, res, next) => fn(req, res).catch(next);
const MAX_BULK = 10000;

// =============================================================================
// Rotas da API
// =============================================================================
const api = express.Router();

// >>> AUTENTICAÇÃO: substitua pelo middleware da sua plataforma. <<<
// Exemplo simples: com API_TOKEN definido, exige "Authorization: Bearer <token>".
const API_TOKEN = process.env.API_TOKEN || '';
api.use((req, res, next) => {
  if (!API_TOKEN) return next();
  const got = Buffer.from(String(req.get('authorization') || ''));
  const want = Buffer.from('Bearer ' + API_TOKEN);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return res.status(401).json({ message: 'Não autenticado ou sessão expirada.' });
  next();
});

api.param('col', (req, res, next, col) => (Object.prototype.hasOwnProperty.call(SCHEMA, col) ? next() : res.status(404).json({ message: 'Coleção desconhecida.' })));

// GET /:col?from=AAAA-MM-DD&to=AAAA-MM-DD  -> lista (vendas e diário filtrados por data)
api.get('/:col', h(async (req, res) => {
  const { col } = req.params;
  let q = db(col);
  if (DATED.has(col)) {
    for (const p of ['from', 'to']) {
      const v = req.query[p];
      if (v === undefined || v === '') continue;
      if (!isDate(v)) fail('Parâmetro "' + p + '" precisa estar no formato AAAA-MM-DD.', 400);
      q = q.where('date', p === 'from' ? '>=' : '<=', v);
    }
  }
  res.json((await q).map((r) => out(col, r)));
}));

// POST /:col/bulk  { items: [...] }  -> cria vários de uma vez (tudo ou nada)
api.post('/:col/bulk', h(async (req, res) => {
  const { col } = req.params;
  const list = req.body && req.body.items;
  if (!Array.isArray(list)) fail('Envie { "items": [ ... ] }.', 400);
  if (list.length > MAX_BULK) fail('Máximo de ' + MAX_BULK + ' itens por lote.', 413);
  const items = list.map((it, i) => {
    try { return Object.assign({ id: crypto.randomUUID() }, clean(col, it, false)); }
    catch (e) { if (e instanceof HttpError) e.message = 'Item ' + (i + 1) + ': ' + e.message; throw e; }
  });
  await db.transaction(async (trx) => {
    await checkRefs(trx, col, items);
    await insertChunked(trx, col, items);
  });
  const ids = items.map((i) => i.id);
  const rows = [];
  for (let i = 0; i < ids.length; i += 500) rows.push(...(await db(col).whereIn('id', ids.slice(i, i + 500))));
  res.status(201).json(rows.map((r) => out(col, r)));
}));

// POST /:col  -> cria um registro e devolve o registro completo (com id)
api.post('/:col', h(async (req, res) => {
  const { col } = req.params;
  const rec = clean(col, req.body, false);
  // Em "settings" o id é a chave da configuração, enviada pelo painel.
  let id = crypto.randomUUID();
  if (col === 'settings') {
    id = String((req.body && req.body.id) || '').trim();
    if (!id || id.length > 40) fail('Configuração sem chave (id).');
  }
  await db.transaction(async (trx) => {
    await checkRefs(trx, col, [rec]);
    await trx(col).insert(Object.assign({ id }, rec));
  });
  res.status(201).json(out(col, await db(col).where({ id }).first()));
}));

// PATCH /:col/:id  -> altera os campos enviados e devolve o registro completo
api.patch('/:col/:id', h(async (req, res) => {
  const { col, id } = req.params;
  const rec = clean(col, req.body, true);
  const n = await db.transaction(async (trx) => {
    await checkRefs(trx, col, [rec]);
    return trx(col).where({ id }).update(Object.assign(rec, { updated_at: db.fn.now() }));
  });
  if (!n) fail('Registro não encontrado.', 404);
  res.json(out(col, await db(col).where({ id }).first()));
}));

// DELETE /:col/:id  -> 204 (idempotente); 409 se houver lançamentos ligados (o painel sugere "Arquivar")
api.delete('/:col/:id', h(async (req, res) => {
  const { col, id } = req.params;
  const IN_USE = { message: 'Este item possui lançamentos ligados a ele. Use "Arquivar".' };
  try {
    const result = await db.transaction(async (trx) => {
      if (await isInUse(trx, col, id)) return 'in_use';
      if (col === 'products' || col === 'sellers') {
        await trx('goals').where({ target_type: col === 'products' ? 'product' : 'seller', target_id: id }).del();
      }
      if (col === 'products') await trx('origins').where({ product_id: id }).del(); // origem automática
      if (col === 'sellers') await trx('products').where({ owner_seller_id: id }).update({ owner_seller_id: null });
      await trx(col).where({ id }).del();
      return 'ok';
    });
    if (result === 'in_use') return res.status(409).json(IN_USE);
    res.status(204).end();
  } catch (e) {
    if (isForeignKeyError(e)) return res.status(409).json(IN_USE);
    throw e;
  }
}));

// =============================================================================
// Aplicação
// =============================================================================
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use('/api/relatorio-comercial', api);

// Arquivos públicos: SOMENTE o componente e a página de exemplo.
// (Não sirva a pasta inteira: ela pode conter o banco SQLite, node_modules, etc.)
app.get('/relatorio-comercial.js', (req, res) => res.sendFile(path.join(__dirname, '..', 'relatorio-comercial.js')));
app.get('/exemplo-backend/pagina-rest.html', (req, res) => res.sendFile(path.join(__dirname, 'pagina-rest.html')));
if (process.env.STATIC_DIR) app.use(express.static(path.resolve(process.env.STATIC_DIR), { dotfiles: 'deny' }));

// Erros: mensagens claras para o usuário, sem expor detalhes internos (SQL, tabelas).
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'JSON inválido no corpo da requisição.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ message: 'Requisição grande demais (limite de 10 MB).' });
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message });
  if (isUniqueError(err)) return res.status(422).json({ message: 'Registro duplicado: já existe um lançamento igual (no Diário: mesmo dia, produto, agente e métrica).' });
  if (isForeignKeyError(err)) return res.status(422).json({ message: 'Referência inválida: produto, vendedor, origem ou métrica inexistente.' });
  if (isConstraintError(err)) return res.status(422).json({ message: 'Dados inválidos.' });
  console.error(new Date().toISOString(), req.method, req.originalUrl, err);
  res.status(500).json({ message: 'Erro interno no servidor.' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) app.listen(PORT, () => console.log('Relatório Comercial (exemplo) em http://localhost:' + PORT + '/exemplo-backend/pagina-rest.html'));
module.exports = { app, dateOnly, out };
