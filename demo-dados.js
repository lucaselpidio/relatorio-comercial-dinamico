/*
 * Gerador de dados 100% fictícios para a demonstração.
 *
 * Empresa, produtos, agentes, leads e valores são inventados. Qualquer semelhança com pessoas ou
 * empresas reais é coincidência.
 *
 * As datas são calculadas a partir de "hoje", para que filtros como "Últimos 7 dias" nunca fiquem vazios.
 * O resultado é determinístico: a mesma data de referência sempre gera exatamente os mesmos dados.
 *
 * Uso: RelatorioComercialDemo.gerar()              -> dados com a data de hoje
 *      RelatorioComercialDemo.gerar('2026-10-27')  -> dados com outra data de referência
 */
(function (global) {
  'use strict';

  // ------------------------------------------------------------------ datas
  var DIA_MS = 86400000;
  var pad2 = function (n) { return String(n).padStart(2, '0'); };
  var paraData = function (s) { var p = s.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); };
  var paraISO = function (d) { return d.toISOString().slice(0, 10); };
  var somarDias = function (s, n) { return paraISO(new Date(paraData(s).getTime() + n * DIA_MS)); };
  var diasEntre = function (a, b) { return Math.round((paraData(b) - paraData(a)) / DIA_MS); };
  var diaDaSemana = function (s) { return paraData(s).getUTCDay(); };
  var inicioDoMes = function (s, deslocamento) {
    var d = paraData(s);
    return paraISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + (deslocamento || 0), 1)));
  };
  function hojeLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // ------------------------------------------------------------------ aleatoriedade determinística
  function hash(texto) { // FNV-1a
    var h = 2166136261;
    for (var i = 0; i < texto.length; i++) { h ^= texto.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function criarSorteio(chave) { // mulberry32
    var a = hash(chave);
    var r = function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.item = function (lista) { return lista[Math.floor(r() * lista.length)]; };
    r.binomial = function (n, p) { var k = 0; for (var i = 0; i < n; i++) if (r() < p) k++; return k; };
    r.poisson = function (media) {
      var limite = Math.exp(-media), k = 0, produto = 1;
      do { k++; produto *= r(); } while (produto > limite);
      return k - 1;
    };
    return r;
  }

  // ------------------------------------------------------------------ cadastro fictício
  var AGENTES = [
    { id: 's1', name: 'Helena Duarte' },
    { id: 's2', name: 'Rafael Moura' },
    { id: 's3', name: 'Camila Nunes' },
    { id: 's4', name: 'Otávio Reis' },
    { id: 's5', name: 'Sofia Lima' }, // vendedora ocasional: fecha vendas, sem meta e sem lançamentos no Diário
  ];
  var PRODUTOS = [
    { id: 'p1', name: 'Formação SQL para Negócios', owner: 's1', ticket: 1497 },
    { id: 'p2', name: 'Trilha Python Aplicado', owner: 's2', ticket: 1997 },
    { id: 'p3', name: 'Mentoria Carreira em Dados', owner: 's3', ticket: 4800 },
    { id: 'p4', name: 'Workshop Data Storytelling', owner: 's1', ticket: 397 },
    { id: 'p5', name: 'Comunidade Insights', owner: 's4', ticket: 588 },
    { id: 'p6', name: 'Consultoria Sob Medida', owner: null, ticket: 18000 }, // high ticket, sem meta
    { id: 'p7', name: 'Diagnóstico Express', owner: 's2', ticket: 197, oculto: true }, // oculto nas metas
    { id: 'p8', name: 'Instagram', owner: 's3', ticket: 0, oculto: true }, // mídia social
    { id: 'p9', name: 'TikTok', owner: 's3', ticket: 0, oculto: true }, // mídia social
  ];
  var TICKET = {}; PRODUTOS.forEach(function (p) { TICKET[p.id] = p.ticket; });

  var M = {
    contatos: 'm1', contatadas: 'm2', responderam: 'm3', aprovados: 'm4', handoffs: 'm5', vendidos: 'm6', faturado: 'm7',
    semRenda: 'm8', baixa: 'm9', media: 'm10', alta: 'm11', semQualif: 'm12', reativacao: 'm13', respReativacao: 'm14', followUp: 'm15',
  };
  var METRICAS = [
    [M.contatos, 'Contatos Criados', 'count', 1, null],
    [M.contatadas, 'Leads Contatadas', 'count', 2, null],
    [M.responderam, 'Leads que Responderam', 'count', 3, null],
    [M.aprovados, 'Aprovados', 'count', 4, null],
    [M.handoffs, 'Handoffs', 'count', 5, null],
    [M.vendidos, 'Vendidos', 'count', 6, 'sold_count'],
    [M.faturado, 'Valor Faturado', 'money', null, 'revenue'],
    [M.semRenda, 'Sem Renda', 'count', null, null],
    [M.baixa, 'Baixa Renda', 'count', null, null],
    [M.media, 'Média Renda', 'count', null, null],
    [M.alta, 'Alta Renda', 'count', null, null],
    [M.semQualif, 'Sem Qualificação', 'count', null, null],
    [M.reativacao, 'Reativação', 'count', null, null],
    [M.respReativacao, 'Leads que Responderam - Reativação', 'count', null, null],
    [M.followUp, 'Follow Up', 'count', null, null],
  ];

  /*
   * Funis por agente e produto. "inicio" é quantos dias atrás o funil começou (o Diário de cada agente começa ali).
   * "fase" descreve a história que a demo conta nos últimos meses:
   *   p1 estável e na meta · p2 acelerando · p3 em queda recente · p4 estável · p5 novo, ainda abaixo da meta
   */
  var FUNIS = [
    { agente: 's1', produto: 'p1', contatos: 27, taxas: [0.86, 0.40, 0.56, 0.66, 0.46], inicio: 9999, renda: [0.12, 0.42, 0.34, 0.12] },
    { agente: 's1', produto: 'p4', contatos: 30, taxas: [0.88, 0.42, 0.62, 0.70, 0.60], inicio: 9999 },
    { agente: 's2', produto: 'p2', contatos: 24, taxas: [0.84, 0.37, 0.54, 0.64, 0.44], inicio: 9999, renda: [0.14, 0.46, 0.30, 0.10], fase: function (d) { return d < 100 ? 1.22 : 1; } },
    { agente: 's2', produto: 'p7', contatos: 16, taxas: [0.90, 0.48, 0.72, 0.80, 0.62], inicio: 9999 },
    { agente: 's3', produto: 'p3', contatos: 15, taxas: [0.82, 0.34, 0.50, 0.58, 0.38], inicio: 9999, renda: [0.05, 0.25, 0.42, 0.28], fase: function (d) { return d < 42 ? 0.62 : 1; } },
    { agente: 's4', produto: 'p5', contatos: 20, taxas: [0.85, 0.40, 0.60, 0.70, 0.52], inicio: 150 },
  ];
  var JANELA_DIARIO = 300; // o Diário cobre os últimos 300 dias; as vendas vão mais longe (Tendências e "Ano passado")

  var NOMES = ['Lívia', 'Mateus', 'Beatriz', 'Gustavo', 'Marina', 'Felipe', 'Larissa', 'Thiago', 'Vanessa', 'Eduardo', 'Patrícia', 'Leonardo', 'Renata', 'Vinícius', 'Aline', 'Rodrigo', 'Carolina', 'André', 'Juliana', 'Fábio', 'Isabela', 'Murilo', 'Tatiane', 'Henrique', 'Letícia', 'Paulo', 'Sabrina', 'Diego', 'Elisa', 'Caio', 'Natália', 'Igor', 'Cecília', 'Bernardo', 'Priscila', 'Tomás'];
  var SOBRENOMES = ['Tavares', 'Cardoso', 'Figueiredo', 'Monteiro', 'Barros', 'Pacheco', 'Vasconcelos', 'Antunes', 'Sampaio', 'Teixeira', 'Rezende', 'Fontes', 'Guimarães', 'Queiroz', 'Lacerda', 'Bittencourt', 'Coutinho', 'Prado', 'Xavier', 'Siqueira', 'Azevedo', 'Peixoto', 'Campos', 'Andrade'];
  var OBSERVACOES = ['Parcelado em 12x', 'Pagamento à vista', 'Renovação', 'Bolsa parcial', 'Turma corporativa', 'Fechou após follow-up'];

  // ------------------------------------------------------------------ valor de uma venda
  function valorDaVenda(produto, r) {
    var t = TICKET[produto], x = r();
    if (produto === 'p6') return Math.round((12000 + r() * 13000) / 500) * 500; // projetos de R$ 12 mil a R$ 25 mil
    var fator = x < 0.62 ? 1 : x < 0.84 ? 0.9 : x < 0.95 ? 0.85 : 0.75; // condições comerciais
    return Math.round(t * fator * 100) / 100;
  }

  // Sazonalidade por mês (jan..dez): fim de ano forte, início de ano fraco. Fictícia.
  var SAZONAL = [0.84, 0.92, 1.02, 1.0, 1.04, 0.96, 0.92, 1.02, 1.06, 1.08, 1.28, 0.86];

  // ------------------------------------------------------------------ geração
  function gerar(hojeISO) {
    var hoje = hojeISO || hojeLocal();
    var inicioVendas = (parseInt(hoje.slice(0, 4), 10) - 1) + '-01-01'; // 1º de janeiro do ano passado
    var inicioMetasProduto = inicioDoMes(hoje, -6);
    var sales = [], daily = [], nSale = 0, nDaily = 0;

    function lancar(data, produto, agente, metrica, quantidade) {
      daily.push({ id: 'd' + (++nDaily), date: data, product_id: produto, metric_id: metrica, quantity: quantidade, seller_id: agente });
    }
    function vender(data, lead, produto, valor, vendedor, origem, nota) {
      sales.push({ id: 'v' + (++nSale), date: data, lead_name: lead, product_id: produto, amount: valor, seller_id: vendedor, origin_id: origem, notes: nota || null });
    }
    function nomeDeLead(r) { return r.item(NOMES) + ' ' + r.item(SOBRENOMES); }
    function nota(r) { return r() < 0.08 ? r.item(OBSERVACOES) : null; }

    for (var data = inicioVendas; data <= hoje; data = somarDias(data, 1)) {
      var atras = diasEntre(data, hoje);
      var dow = diaDaSemana(data);
      var fatorDia = dow === 0 ? 0 : dow === 6 ? 0.3 : 1; // domingo sem operação; sábado em meio período
      var mes = parseInt(data.slice(5, 7), 10) - 1;
      var crescimento = 0.72 + 0.28 * Math.max(0, 1 - atras / 680);
      var semana = criarSorteio('semana|' + inicioDaSemanaISO(data))() * 0.2 + 0.9;

      FUNIS.forEach(function (f) { gerarFunil(f, data, atras, dow, fatorDia * SAZONAL[mes] * crescimento * semana); });
      gerarForaDoFunil(data, dow);
      if (atras <= JANELA_DIARIO) gerarAtividadesExtras(data, atras, dow);
    }

    function inicioDaSemanaISO(s) { return somarDias(s, -((diaDaSemana(s) + 6) % 7)); }

    function gerarFunil(f, d, atrasDias, dowDia, fator) {
      if (atrasDias > f.inicio || dowDia === 0) return;
      var r = criarSorteio('funil|' + f.agente + '|' + f.produto + '|' + d);
      var ferias = f.agente === 's2' && atrasDias >= 38 && atrasDias <= 49; // férias: buraco visível na constância
      if (ferias) return;
      var media = f.contatos * fator * (f.fase ? f.fase(atrasDias) : 1);
      var contatos = r.poisson(media);
      var t = f.taxas;
      var contatadas = r.binomial(contatos, t[0]);
      var responderam = r.binomial(contatadas, t[1]);
      var aprovados = r.binomial(responderam, t[2]);
      var handoffs = r.binomial(aprovados, t[3]);
      var vendidos = r.binomial(handoffs, t[4]);

      var faturado = 0;
      for (var i = 0; i < vendidos; i++) {
        var cruzada = r() < 0.07; // venda cruzada: a lead veio por este funil e comprou outro produto
        var produtoVendido = cruzada ? r.item(['p1', 'p2', 'p3', 'p4', 'p5'].filter(function (p) { return p !== f.produto; })) : f.produto;
        var valor = valorDaVenda(produtoVendido, r);
        var vendedor = r() < 0.05 ? 's5' : f.agente;
        vender(d, nomeDeLead(r), produtoVendido, valor, vendedor, 'o-' + f.produto, nota(r));
        faturado += valor;
      }

      var dentroDoDiario = atrasDias <= JANELA_DIARIO && contatos > 0;
      // Dia sem preenchimento: aparece na constância. Se houve venda nesse dia, aparece também na auditoria (mais raro).
      var esqueceu = r() < (vendidos > 0 ? 0.008 : 0.05);
      if (!dentroDoDiario || esqueceu) return;
      var divergiu = r() < 0.006; // erro de digitação proposital: a Auditoria Diário × Vendas precisa ter o que mostrar
      lancar(d, f.produto, f.agente, M.contatos, contatos);
      lancar(d, f.produto, f.agente, M.contatadas, contatadas);
      lancar(d, f.produto, f.agente, M.responderam, responderam);
      lancar(d, f.produto, f.agente, M.aprovados, aprovados);
      lancar(d, f.produto, f.agente, M.handoffs, handoffs);
      lancar(d, f.produto, f.agente, M.vendidos, vendidos + (divergiu ? 1 : 0));
      lancar(d, f.produto, f.agente, M.faturado, Math.round((faturado + (divergiu ? TICKET[f.produto] : 0)) * 100) / 100);

      if (f.renda && atrasDias <= 120) { // a qualificação por renda começou há 120 dias
        var semQualif = r.binomial(responderam, 0.3);
        var resto = responderam - semQualif, faixas = [M.semRenda, M.baixa, M.media, M.alta], cont = [0, 0, 0, 0];
        for (var k = 0; k < resto; k++) {
          var x = r(), acum = 0;
          for (var j = 0; j < 4; j++) { acum += f.renda[j]; if (x < acum || j === 3) { cont[j]++; break; } }
        }
        faixas.forEach(function (m, ix) { lancar(d, f.produto, f.agente, m, cont[ix]); });
        lancar(d, f.produto, f.agente, M.semQualif, semQualif);
      }
    }

    function gerarForaDoFunil(d, dowDia) {
      var r = criarSorteio('fora|' + d);
      if (dowDia === 0) return;
      var chance = dowDia === 6 ? 0.1 : 0.5;
      if (r() < chance) { // Cliente Antigo, Indicação e Evento Online contam na meta do produto vendido
        var x = r();
        var origem = x < 0.5 ? 'o10' : x < 0.85 ? 'o11' : 'o12';
        var produto = r.item(['p1', 'p1', 'p2', 'p2', 'p3', 'p4', 'p4', 'p5']);
        vender(d, nomeDeLead(r), produto, valorDaVenda(produto, r), r.item(['s1', 's2', 's3', 's5', 's5']), origem, nota(r));
      }
      if (dowDia !== 6 && r() < 0.1) { // consultoria: venda rara e de valor alto, sem meta
        vender(d, nomeDeLead(r) + ' (empresa)', 'p6', valorDaVenda('p6', r), r() < 0.7 ? 's5' : 's3', r() < 0.6 ? 'o11' : 'o10', 'Projeto fechado em contrato');
      }
    }

    function gerarAtividadesExtras(d, atrasDias, dowDia) {
      if (dowDia === 0 || dowDia === 6) return;
      var r = criarSorteio('extras|' + d);
      if (atrasDias <= 200) { // Follow Up: fora do funil, aparece em "Outras atividades"
        lancar(d, 'p1', 's1', M.followUp, r.poisson(11));
        if (!(atrasDias >= 38 && atrasDias <= 49)) lancar(d, 'p2', 's2', M.followUp, r.poisson(8));
      }
      if (atrasDias <= 70) { // Reativação de leads antigas, contada à parte
        [['p2', 's2', 14, 0.21], ['p3', 's3', 10, 0.27]].forEach(function (c) {
          if (c[1] === 's2' && atrasDias >= 38 && atrasDias <= 49) return;
          var feitas = r.poisson(c[2]);
          lancar(d, c[0], c[1], M.reativacao, feitas);
          lancar(d, c[0], c[1], M.respReativacao, r.binomial(feitas, c[3]));
        });
      }
      if (atrasDias <= 100) { // Mídias sociais têm fluxo próprio
        [['p8', 18, 0.48], ['p9', 26, 0.34]].forEach(function (c) {
          var contatos = r.poisson(c[1]), contatadas = r.binomial(contatos, 0.82), resp = r.binomial(contatadas, c[2]);
          var aprovadosSocial = r.binomial(resp, 0.55);
          lancar(d, c[0], 's3', M.contatos, contatos);
          lancar(d, c[0], 's3', M.contatadas, contatadas);
          lancar(d, c[0], 's3', M.responderam, resp);
          lancar(d, c[0], 's3', M.aprovados, aprovadosSocial);
          lancar(d, c[0], 's3', M.handoffs, r.binomial(aprovadosSocial, 0.6));
        });
      }
    }

    // ---------------------------------------------------------------- metas
    var goals = [];
    function meta(id, tipo, alvo, periodo, valor, desde) {
      goals.push({ id: id, target_type: tipo, target_id: alvo, period: periodo, amount: valor, valid_from: desde });
    }
    // Meta geral da empresa, mês a mês, para a época anterior às metas por produto.
    var m = 0;
    for (var mesRef = inicioDoMes(inicioVendas); mesRef < inicioMetasProduto; mesRef = inicioDoMes(mesRef, 1), m++) {
      meta('g-t' + m, 'total', 'all', 'monthly', 150000 + Math.min(m, 14) * 5000, mesRef);
    }
    // Metas por produto (mensais e semanal) e uma meta reajustada: mudar a meta não altera o passado.
    meta('g-p1a', 'product', 'p1', 'monthly', 52000, inicioMetasProduto);
    meta('g-p1b', 'product', 'p1', 'monthly', 56000, inicioDoMes(hoje, -2));
    meta('g-p2', 'product', 'p2', 'monthly', 78000, inicioMetasProduto);
    meta('g-p3', 'product', 'p3', 'monthly', 78000, inicioMetasProduto);
    meta('g-p4', 'product', 'p4', 'weekly', 8000, inicioMetasProduto);
    meta('g-p5', 'product', 'p5', 'monthly', 34000, inicioDoMes(somarDias(hoje, -150)));
    // Metas individuais; Sofia é ocasional e não tem meta.
    meta('g-s1', 'seller', 's1', 'monthly', 90000, null);
    meta('g-s2', 'seller', 's2', 'monthly', 90000, null);
    meta('g-s3', 'seller', 's3', 'monthly', 80000, null);
    meta('g-s4', 'seller', 's4', 'monthly', 30000, inicioDoMes(somarDias(hoje, -150)));

    // ---------------------------------------------------------------- cadastros, presets e configurações
    var products = PRODUTOS.map(function (p, i) {
      var r = { id: p.id, name: p.name, owner_seller_id: p.owner, active: true, sort_order: i + 1 };
      if (p.oculto) r.show_in_goals = false;
      return r;
    });
    var sellers = AGENTES.map(function (a, i) { return { id: a.id, name: a.name, active: true, sort_order: i + 1 }; });
    var origins = PRODUTOS.map(function (p) { return { id: 'o-' + p.id, name: null, product_id: p.id, active: true, sort_order: 0 }; })
      .concat([
        { id: 'o10', name: 'Cliente Antigo', product_id: null, active: true, sort_order: 10 },
        { id: 'o11', name: 'Indicação', product_id: null, active: true, sort_order: 11 },
        { id: 'o12', name: 'Evento Online', product_id: null, active: true, sort_order: 12 },
      ]);
    var metrics = METRICAS.map(function (x, i) {
      return { id: x[0], name: x[1], kind: x[2], funnel_order: x[3], audit_role: x[4], active: true, sort_order: i + 1 };
    });
    var etapas = [M.contatos, M.contatadas, M.responderam, M.aprovados, M.handoffs, M.vendidos, M.faturado];
    var itensDoPreset = function (lista) {
      var itens = [];
      lista.forEach(function (f) { etapas.forEach(function (metrica) { itens.push({ product_id: f.produto, seller_id: f.agente, metric_id: metrica }); }); });
      return itens;
    };
    var presets = [
      { id: 'pr1', name: 'Equipe completa', items: itensDoPreset(FUNIS) },
      { id: 'pr2', name: 'Somente Helena', items: itensDoPreset(FUNIS.filter(function (f) { return f.agente === 's1'; })) },
    ];
    var settings = [
      { id: 'default_period', value: JSON.stringify('last_28') },
      { id: 'agent_dashboard', value: JSON.stringify({ conversion: { from: M.responderam, to: M.vendidos } }) },
    ];

    return { products: products, sellers: sellers, origins: origins, metrics: metrics, goals: goals, sales: sales, daily_entries: daily, presets: presets, settings: settings };
  }

  global.RelatorioComercialDemo = { gerar: gerar, hoje: hojeLocal };
})(typeof window !== 'undefined' ? window : globalThis);
