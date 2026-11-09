#!/usr/bin/env node
/**
 * Valida os dados fictícios do gerador (demo-dados.js) e os exporta em CSV, no formato aceito pela importação do painel.
 *
 *   node scripts/exportar-dados.mjs              usa a data de hoje como referência
 *   node scripts/exportar-dados.mjs 2026-11-09   usa a data informada
 *
 * Sem dependências. Sai com código 1 se alguma verificação falhar.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contexto = {};
contexto.globalThis = contexto;
vm.createContext(contexto);
vm.runInContext(fs.readFileSync(path.join(RAIZ, 'demo-dados.js'), 'utf8'), contexto);
const { gerar, hoje } = contexto.RelatorioComercialDemo;

const referencia = process.argv[2] || hoje();
const d = JSON.parse(JSON.stringify(gerar(referencia)));

// ------------------------------------------------------------------ verificações
const falhas = [];
const conferir = (ok, msg) => { if (!ok) falhas.push(msg); };
const ids = (lista) => new Set(lista.map((x) => x.id));
const produtos = ids(d.products), vendedores = ids(d.sellers), origens = ids(d.origins), metricas = ids(d.metrics);

conferir(JSON.stringify(gerar(referencia)) === JSON.stringify(gerar(referencia)), 'a mesma data precisa gerar os mesmos dados');
for (const c of ['sales', 'daily_entries']) conferir(ids(d[c]).size === d[c].length, c + ': IDs repetidos');
d.sales.forEach((v) => {
  conferir(produtos.has(v.product_id) && vendedores.has(v.seller_id) && origens.has(v.origin_id), 'venda ' + v.id + ': referência inexistente');
  conferir(v.amount > 0 && v.date <= referencia, 'venda ' + v.id + ': valor ou data inválidos');
});
const chaves = new Set();
const porPar = new Map();
d.daily_entries.forEach((x) => {
  conferir(produtos.has(x.product_id) && vendedores.has(x.seller_id) && metricas.has(x.metric_id), 'lançamento ' + x.id + ': referência inexistente');
  conferir(x.quantity >= 0 && x.date <= referencia, 'lançamento ' + x.id + ': quantidade ou data inválidas');
  const chave = [x.date, x.product_id, x.seller_id, x.metric_id].join('|');
  conferir(!chaves.has(chave), 'lançamento repetido: ' + chave);
  chaves.add(chave);
  const par = [x.date, x.product_id, x.seller_id].join('|');
  if (!porPar.has(par)) porPar.set(par, {});
  porPar.get(par)[x.metric_id] = x.quantity;
});
// O funil precisa afunilar: cada etapa não pode ser maior que a anterior (o Vendidos pode ter 1 a mais, de propósito, para a auditoria).
const etapas = d.metrics.filter((m) => m.funnel_order != null).sort((a, b) => a.funnel_order - b.funnel_order).map((m) => m.id);
porPar.forEach((v, par) => {
  for (let i = 1; i < etapas.length; i++) {
    if (v[etapas[i]] == null || v[etapas[i - 1]] == null) continue;
    const folga = d.metrics.find((m) => m.id === etapas[i]).audit_role === 'sold_count' ? 1 : 0;
    conferir(v[etapas[i]] <= v[etapas[i - 1]] + folga, 'funil invertido em ' + par);
  }
});

// ------------------------------------------------------------------ exportação
const nome = (lista) => new Map(lista.map((x) => [x.id, x.name]));
const nProduto = nome(d.products), nVendedor = nome(d.sellers), nMetrica = nome(d.metrics);
const nOrigem = new Map(d.origins.map((o) => [o.id, o.product_id ? nProduto.get(o.product_id) : o.name]));
const dataBR = (s) => s.split('-').reverse().join('/');
const num = (n) => String(n).replace('.', ',');
const celula = (v) => (/[;"\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
const csv = (cabecalho, linhas) => '﻿' + [cabecalho].concat(linhas).map((l) => l.map(celula).join(';')).join('\r\n') + '\r\n';

const pasta = path.join(RAIZ, 'dados-ficticios');
fs.mkdirSync(pasta, { recursive: true });
fs.writeFileSync(path.join(pasta, 'vendas-ficticias.csv'), csv(
  ['Data', 'Nome da Lead', 'Produto', 'Valor', 'Vendedor', 'Origem da Lead', 'Observação'],
  d.sales.map((v) => [dataBR(v.date), v.lead_name, nProduto.get(v.product_id), num(v.amount), nVendedor.get(v.seller_id), nOrigem.get(v.origin_id), v.notes || '']),
));
fs.writeFileSync(path.join(pasta, 'diario-ficticio.csv'), csv(
  ['Data', 'Produto', 'Métrica', 'Quantidade', 'Agente'],
  d.daily_entries.map((x) => [dataBR(x.date), nProduto.get(x.product_id), nMetrica.get(x.metric_id), num(x.quantity), nVendedor.get(x.seller_id)]),
));

const faturamento = d.sales.reduce((s, v) => s + v.amount, 0);
console.log('Referência: ' + referencia);
console.log(d.sales.length + ' vendas · ' + d.daily_entries.length + ' lançamentos · R$ ' + faturamento.toFixed(2) + ' de faturamento fictício');
if (falhas.length) {
  console.error(falhas.length + ' verificação(ões) falharam. Primeiras:\n  ' + falhas.slice(0, 10).join('\n  '));
  process.exit(1);
}
console.log('Todas as verificações passaram. CSVs gravados em dados-ficticios/.');
