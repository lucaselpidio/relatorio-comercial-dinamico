# Relatório Comercial — Guia de integração

Este guia é para quem vai implantar o painel na plataforma e ligá-lo ao banco de dados.
Para uma visão funcional do painel, veja o [README.md](README.md).

**Por onde começar** (instalação nova):
1. **Seção 2:** coloque o painel na página. São 3 passos; para ver funcionando sem backend, abra o `index.html`.
2. **Seção 5:** ligue ao banco. Crie as tabelas com o `schema.sql` e implemente o contrato REST, ou parta do backend de referência em `exemplo-backend/` (seção 5.3).
3. **Seção 8.1:** traga os dados já lançados no demo (backup + restaurar).
4. **Seção 10:** siga o checklist de implantação.

**Já usa o painel e vai atualizar?** Veja a seção 7.1. Ela diz, versão por versão, se algo muda no banco, e na maioria das versões nada muda.

---

## 1. O que foi entregue

| Arquivo | Para quê |
|---|---|
| `relatorio-comercial.js` | **O painel inteiro**: um único arquivo JS, sem dependências. Registra o Web Component `<relatorio-comercial>`. |
| `schema.sql` | Criação das tabelas (SQL genérico: PostgreSQL, MySQL, SQL Server, SQLite). |
| `exemplo-backend/` | Backend REST de **referência** (Node + Express + Knex) que implementa o contrato da seção 5. |
| `index.html` + `demo-dados.js` | Demonstração funcionando sem backend (salva só no navegador), com dados fictícios gerados a partir da data de hoje. |
| `dados-ficticios/` | Vendas e lançamentos do Diário fictícios em `.csv`, no formato aceito pela importação. |

**Navegadores testados:**

| Navegador | Situação |
|---|---|
| Chrome / Edge (Chromium) | todas as baterias automáticas |
| WebKit 26.6 (motor do Safari) | <ul><li>as baterias do painel, também contra o servidor real</li><li>mouse, teclado e toque reais</li><li>iPhone emulado</li><li>tema escuro</li></ul> |
| Firefox | todas as baterias automáticas |
| Safari de verdade (Mac/iPhone) | **não testado** |

O WebKit cobre o motor do Safari, mas não é idêntico ao navegador da Apple. Vale uma conferida rápida num iPhone ou Mac antes de liberar para todos.

O painel usa recursos padrão de navegadores modernos: Web Components, Shadow DOM, `fetch` e `DecompressionStream` (este último só para ler `.xlsx`; no Safari, exige a versão 16.4 ou superior). Onde o navegador não oferece calendário no campo de data, dá para digitar a data como `dd/mm/aaaa`.

---

## 2. Instalação em 3 passos

```html
<!-- 1) carregue o script (uma vez por página) -->
<script src="/caminho/relatorio-comercial.js"></script>

<!-- 2) coloque o componente onde o painel deve aparecer -->
<relatorio-comercial id="painel-am" titulo="Relatório Comercial"></relatorio-comercial>

<!-- 3) conecte ao backend -->
<script>
  document.getElementById('painel-am').configure({
    adapter: RelatorioComercial.createRestAdapter({ baseUrl: '/api/relatorio-comercial' }),
    // theme: 'light',  // opcional: tema inicial; sem ele, o painel abre no escuro (v1.10)
  });
</script>
```

Também é possível criar o painel só por JavaScript:

```js
const painel = RelatorioComercial.mount('#onde-montar', {
  adapter: RelatorioComercial.createRestAdapter({ baseUrl: '/api/relatorio-comercial' }),
});
```

Em React, Vue, Angular ou qualquer outro framework, o uso é o mesmo: renderize a tag `<relatorio-comercial>` e chame `configure()` depois que o elemento existir (por exemplo, em `useEffect` ou `mounted`).

---

## 3. Isolamento: por que não conflita com a plataforma

O requisito era que nomes de CSS e JS do painel não fossem afetados pela página e não afetassem a página. O painel garante isso assim:

- **Shadow DOM**: todo o HTML e CSS do painel vive dentro de uma *shadow root*. Seletores da plataforma (`.card`, `button`, `table`, `*`...) **não alcançam** o painel, e o CSS do painel não vaza para fora. Os testes rodam com um CSS hostil na página, por exemplo `* { color: red !important; font-family: serif !important }`, e o painel continua intacto.
- **Herança bloqueada**: o elemento raiz interno redefine fonte, cor, alinhamento e espaçamento, então nada é herdado da página.
- **Uma única variável global**: `window.RelatorioComercial`. Todo o resto fica dentro de uma IIFE.
- **Nomes prefixados**: a tag é `relatorio-comercial` e os eventos são `rc:ready`, `rc:change`, `rc:error` e `rc:theme`.
- **PDF sem tocar na página**: "Exportar PDF" monta o relatório num `iframe` invisível criado dentro do próprio Shadow DOM e imprime só ele; o `iframe` é removido depois. Nada é acrescentado ao HTML da plataforma e nenhuma requisição nova é feita.
- **Teclado**: teclas digitadas nos campos do painel não sobem para a página, então atalhos globais da plataforma não disparam enquanto alguém digita.
- **Carregamento duplo**: se o script for incluído duas vezes, a segunda é ignorada.

> Limitação conhecida: modais e popovers usam `position: fixed`. Se algum ancestral do painel na plataforma tiver `transform`, `filter` ou `contain: paint`, o navegador passa a posicioná-los em relação a esse ancestral. Evite essas propriedades nos contêineres do painel.

> **Confira a política de segurança de conteúdo (CSP) da plataforma.** O painel usa estilos embutidos: uma tag `<style>` dentro do Shadow DOM e atributos `style="..."`, por exemplo na largura das barras. Se a plataforma enviar um cabeçalho `Content-Security-Policy` com `style-src` **sem** `'unsafe-inline'`, o navegador bloqueia esses estilos e o painel aparece sem formatação. **Isso não foi testado.**
>
> Como verificar: veja o cabeçalho `Content-Security-Policy` nas respostas da plataforma (DevTools → Network). Se ele existir e for restritivo, é preciso adaptar o painel. O caminho é passar o CSS para `adoptedStyleSheets` e as larguras para `element.style`. É um ajuste localizado no código, mas precisa ser feito.

---

## 4. API do componente

### 4.1 `configure(opções)`

| Opção | Tipo | Descrição |
|---|---|---|
| `adapter` | objeto | **Obrigatório.** Camada de dados (seções 5 e 6). |
| `theme` | `'light'` \| `'dark'` \| `'auto'` | Tema **inicial**. `auto` segue o sistema operacional. Padrão: **escuro** (v1.10; antes, claro). Se a pessoa escolher outro no botão sol/lua do topo, a escolha dela prevalece e fica gravada só naquele navegador (`localStorage`, chave `relatorio-comercial:tema`; não vai para `settings`, então não muda a tela de mais ninguém). |
| `titulo` | texto | Título no topo. |
| `aba` | `'painel'` \| `'tendencias'` \| `'vendas'` \| `'diario'` \| `'cadastros'` | Aba inicial. |
| `readonly` | booleano | `true` esconde as abas de edição e mostra só Painel e Tendências (bom para perfis de visualização). A aba Diário fica de fora inteira, inclusive Visão por Agente, Dashboard Agentes e Renda dos Leads. |
| `senhaApagarDados` | texto | Senha do botão "Apagar dados do navegador…" (Cadastros → Configurações). Padrão: `0000`. **Só existe com o adaptador local** (demo): com o adaptador REST o botão não aparece. É uma trava contra cliques acidentais, não segurança: a senha fica visível para quem abrir o JavaScript. |

Os mesmos itens também funcionam como atributos HTML: `theme`, `titulo`, `aba` e `readonly`.

### 4.2 Métodos e eventos

```js
painel.refresh();          // recarrega cadastros e a aba atual (ex.: após alterações feitas fora do painel);
                           // no Diário, um dia com edições não salvas é mantido como está
painel.go('vendas');       // troca de aba por código
painel.store               // camada de dados (disponível depois de 'rc:ready'); ex.: para um script de migração:
await painel.store.restoreBackup(dadosDoBackup, { dryRun: true });  // prévia; sem dryRun grava (seção 8.1)
painel.resetLocalData();   // só no adaptador local (demo): abre o "Apagar dados do navegador" (senha + confirmação);
                           // com o adaptador REST não faz nada
painel.currentTheme        // tema na tela agora: 'dark' | 'light' (v1.10)
await painel.exportPdf({ theme: 'light', orientation: 'portrait' });
                           // o mesmo que o botão "Exportar PDF" da tela aberta (v1.10): theme 'dark' | 'light',
                           // orientation 'landscape' | 'portrait', tables (abre "Ver números…"), allAgents
                           // (Dashboard Agentes: todos os agentes, um por página); abre a impressão do navegador

painel.addEventListener('rc:ready',  (e) => { /* carregou */ });
painel.addEventListener('rc:change', (e) => { /* e.detail = { collection, action, record? } */ });
painel.addEventListener('rc:error',  (e) => { /* e.detail = { error, message } — útil para logs/monitoramento */ });
painel.addEventListener('rc:theme',  (e) => { /* e.detail = { theme: 'dark' | 'light' } — o tema da tela mudou (v1.10);
                                                    o demo usa para escurecer o fundo da página junto com o painel */ });

// Exemplo: sessão expirada -> mandar para o login da plataforma
painel.addEventListener('rc:error', (e) => {
  if (e.detail.error && e.detail.error.code === 'UNAUTHORIZED') window.location.href = '/login';
});
```

### 4.3 Cores (opcional)

O painel usa a paleta própria dele. Para alinhar a cor de destaque com a identidade da plataforma, use `::part`. É a única porta de personalização aberta de propósito:

```css
relatorio-comercial::part(root) { --accent: #0f766e; --accent-hover: #115e59; --s1: #0f766e; }
```

As cores padrão das faixas da Renda dos Leads ficam em `--inc-none` (cinza das faixas "Sem…") e `--inc-r0` a `--inc-r8` (do claro ao escuro), com uma versão para cada tema. Os usuários podem trocá-las pela própria tela (Personalizar), então não há motivo para mexer nelas aqui.

---

## 5. Backend: contrato REST

`RelatorioComercial.createRestAdapter({ baseUrl })` faz as chamadas abaixo. Se o backend seguir este contrato, **nada no painel precisa mudar**.

| Ação | Requisição | Resposta esperada |
|---|---|---|
| Listar | `GET {baseUrl}/{coleção}` | `200` + array de registros |
| Listar por período | `GET {baseUrl}/{coleção}?from=AAAA-MM-DD&to=AAAA-MM-DD` (só `sales` e `daily_entries`) | `200` + array |
| Criar | `POST {baseUrl}/{coleção}` + JSON do registro | `201` + **registro completo, com `id`** |
| Criar em lote | `POST {baseUrl}/{coleção}/bulk` + `{ "items": [...] }` | `201` + array dos registros criados |
| Alterar | `PATCH {baseUrl}/{coleção}/{id}` + campos alterados | `200` + registro completo |
| Excluir | `DELETE {baseUrl}/{coleção}/{id}` | `204`. Responda **`409`** se houver lançamentos ligados ao item |

**Coleções** (os nomes das tabelas do `schema.sql`): `products`, `sellers`, `origins`, `metrics`, `goals`, `sales`, `daily_entries`, `presets`, `settings`.

**Detalhes importantes:**

- **IDs** são gerados pelo backend, com uma exceção: em `settings`, o `id` é a chave da configuração e vem no corpo do `POST`. As chaves estão na seção 7.
- **`settings.value` é JSON em texto** e pode ter alguns KB (listas de IDs das personalizações). Use `TEXT` no banco, como no `schema.sql`, e não limite o tamanho a poucas centenas de caracteres.
- **Datas** são enviadas como `'AAAA-MM-DD'`. Se o banco devolver `'2026-09-28T00:00:00Z'`, o painel corta a hora. Não converta para UTC na gravação: é data de calendário.
  **Devolva a data como texto `AAAA-MM-DD`**, não como data/hora: o driver do SQL Server entrega as colunas `DATE` como meia-noite **UTC**, e lida no horário local de um servidor em UTC-3 vira o dia anterior. O backend de exemplo trata os dois casos (função `dateOnly`, v1.6.1; testado com o servidor em São Paulo, Los Angeles, Tóquio e UTC).
- **Tolerância**: o painel aceita números como texto (`"2100.00"`), booleanos `0/1`, `items` dos presets como array **ou** texto JSON, e respostas embrulhadas em `{ "data": [...] }`.
- **Filtro por período**: se o backend ignorar `from`/`to`, o painel filtra sozinho. Mas, por desempenho, **implemente o filtro** (índices em `date` já estão no schema).
- **`GET /sales` sem `from`/`to` devolve todas as vendas.** A aba Tendências (v1.5) faz essa leitura uma vez para saber a data da **primeira venda registrada** (os gráficos começam nela, e o período "Desde a primeira venda" da v1.6 parte dela) e só a refaz quando alguma venda muda.
- **`GET /daily_entries` sem `from`/`to` devolve o Diário inteiro.** A sub-aba Renda dos Leads (v1.4) faz essa leitura **uma vez ao ser aberta**, para saber desde quando cada produto tem as faixas de renda lançadas. Trocar período ou produto filtra o que já foi lido, sem novas chamadas. Para ter uma ideia do custo: nos testes, o Diário de ~1 ano (cerca de 7.500 lançamentos) foi lido em 50 ms pela API de exemplo, e o cálculo sobre 175 mil lançamentos levou menos de 30 ms. No ritmo atual da equipe (~45 lançamentos por dia), um ano dá uns 16 mil. Se a base ficar muito grande, o backend pode, no futuro, aceitar um filtro por métrica sem mudar o resto do contrato.
- **Dashboard Agentes (v1.7)** lê o Diário inteiro e todas as vendas (`GET /daily_entries` e `GET /sales` sem período) **uma vez ao ser aberto**: o início de cada agente depende do histórico. Trocar agente, período ou produto calcula sobre o que já foi lido, sem novas chamadas; a leitura é refeita quando um lançamento ou uma venda muda no painel, ou no botão Atualizar.
- **Erros**: responda com status HTTP adequado e corpo `{ "message": "texto para o usuário" }`. O painel trata cada caso assim (o código também vai em `rc:error` → `e.detail.error.code`):

| Situação | Status | `code` no painel | O que o usuário vê |
|---|---|---|---|
| Servidor fora do ar / sem internet | — | `NETWORK` | "Sem conexão com o servidor… nada do que você digitou foi perdido" |
| JSON ou parâmetro inválido | `400` | `REJECTED` | a `message` do servidor |
| Não autenticado / sessão expirada | `401` | `UNAUTHORIZED` | "Sua sessão expirou… entre novamente" |
| Sem permissão | `403` | `FORBIDDEN` | a `message` (ou texto padrão) |
| Registro não existe | `404` | `NOT_FOUND` | a `message` (ou texto padrão) |
| Excluir item com histórico | `409` | `IN_USE` | oferece **arquivar** em vez de excluir |
| Lote grande demais | `413` | `REJECTED` | a `message` |
| Validação, duplicado, referência inexistente | `422` | `REJECTED` | a `message` |
| Erro interno | `5xx` | `SERVER` | "O servidor encontrou um erro… tente novamente" |
| Resposta que não é JSON (ex.: página HTML de proxy) | — | `BAD_RESPONSE` | "Resposta inválida… verifique a baseUrl" |

  Em qualquer falha ao salvar, **o que foi digitado continua na tela** e basta clicar em salvar de novo. Importações grandes vão em lotes de até 1.000 registros; se a conexão cair no meio, o painel reanalisa o arquivo e "Importar" de novo continua de onde parou, sem duplicar.
  **Nunca** devolva detalhes internos (SQL, nomes de tabelas, stack trace) na `message`: ela aparece para o usuário.

### 5.1 Opções do adaptador REST

```js
RelatorioComercial.createRestAdapter({
  baseUrl: '/api/relatorio-comercial',              // obrigatório
  headers: async () => ({ Authorization: 'Bearer ' + await obterToken() }), // objeto ou função (pode ser async)
  credentials: 'include',                    // padrão 'same-origin' (envia cookies da própria origem)
  paths: { sales: 'vendas', daily_entries: 'diario' }, // se as rotas tiverem outros nomes
  fetch: minhaFuncaoFetch,                   // opcional: substitui window.fetch (interceptores, retries...)
  timeoutMs: 60000,                          // padrão 60 s (v1.6.1); 0 = sem limite. Passado o tempo, erro NETWORK com aviso
});
```

### 5.2 Regras que o backend deve garantir

O `schema.sql` cobre parte delas (chaves estrangeiras, `UNIQUE`, `CHECK`), e o **backend de exemplo implementa todas**. Se o backend for escrito do zero, confira cada item:

1. **Não apagar o que tem histórico**: excluir produto, vendedor, origem ou métrica usados em `sales` ou `daily_entries` deve falhar com `409`. O painel então oferece **arquivar** (`active = false`).
   **Não confie só nas chaves estrangeiras.** No SQLite elas vêm *desligadas* em cada conexão (precisa de `PRAGMA foreign_keys = ON`), e tabelas MyISAM do MySQL as ignoram. O backend de exemplo faz as duas coisas: liga o PRAGMA e confere as referências explicitamente antes de excluir (função `isInUse`).
2. **Excluir produto** remove junto a origem automática dele (`origins.product_id`, `ON DELETE CASCADE`), desde que nenhuma venda use essa origem.
3. **Excluir produto ou vendedor** remove as metas dele (`goals` não tem FK porque é polimórfica: o backend de exemplo faz isso na mesma transação). A **meta geral** (v1.6) usa `target_type = 'total'` e `target_id = 'all'`: aceite esse tipo e recuse outro alvo para ele (o exemplo responde `422`).
4. **Diário**: no máximo um registro por (dia, produto, agente, métrica) — `UNIQUE` no schema. O backend de exemplo responde `422` com uma mensagem clara quando alguém tenta gravar um repetido (por exemplo, duas pessoas preenchendo o mesmo dia ao mesmo tempo).
   **Não use `409` para isso**: o painel interpreta `409` como "item em uso" e ofereceria arquivar.
5. **DELETE idempotente** (recomendado): excluir algo que já não existe devolve `204`, assim cliques repetidos não geram erro.
6. **Validar a entrada no servidor**, mesmo o painel já validando, porque a API pode ser chamada por outros meios. O essencial:
   - datas sempre `AAAA-MM-DD` (uma data `02/10/2026` gravada como texto quebra os filtros por período);
   - valor de venda maior que zero e quantidades ≥ 0;
   - nomes não vazios;
   - referências existentes (produto, vendedor, origem, métrica);
   - lote em transação única: tudo ou nada.
7. **Não publique a pasta do projeto como arquivos estáticos.** Sirva só o `relatorio-comercial.js`. Com SQLite, o próprio arquivo do banco ficaria baixável pela URL.
8. **SQL Server**: o limite é de 2.100 parâmetros por comando, então insira lotes em blocos (o exemplo calcula o tamanho seguro conforme o número de colunas).
9. **Autenticação e permissão**: o painel não faz login. Proteja as rotas com a autenticação da plataforma. Para separar quem só visualiza de quem edita, use `readonly` no front **e** bloqueie `POST`/`PATCH`/`DELETE` no backend.
10. **Multiempresa** (se houver): adicione `tenant_id` em todas as tabelas e filtre no backend. O painel não precisa saber.
11. **Auditoria** (opcional): as colunas `created_by` em `sales` e `daily_entries` existem para o backend gravar quem lançou.

### 5.3 Backend de referência

`exemplo-backend/servidor.js` implementa o contrato e as regras acima em cerca de 360 linhas comentadas (Express + Knex), incluindo a validação de entrada. Funciona com PostgreSQL, MySQL, SQL Server ou SQLite trocando só o driver:

```bash
cd exemplo-backend
npm install                      # instala express, knex e os drivers pg, mysql2 e sqlite3
DB_CLIENT=pg DATABASE_URL=postgres://usuario:senha@host/banco npm start
# abra http://localhost:3000/exemplo-backend/pagina-rest.html
```

Para experimentar sem servidor de banco, use SQLite: crie o arquivo com o `schema.sql` (ex.: `sqlite3 am.sqlite < ../schema.sql`) e rode `DB_CLIENT=sqlite3 DATABASE_URL=./am.sqlite npm start`.

Variáveis opcionais do exemplo:
- `API_TOKEN`: exige `Authorization: Bearer <token>` nas rotas da API. No painel, use `headers: async () => ({ Authorization: 'Bearer ' + token })`.
- `STATIC_DIR`: pasta extra de páginas a servir.

O exemplo foi testado com Node 24 + SQLite (veja a seção 11). Ele serve como especificação executável. Se a plataforma usar outra linguagem (PHP, Python, .NET...), basta reproduzir as 6 rotas.

---

## 6. Sem REST? Adaptador personalizado

Se a plataforma acessa o banco de outro jeito (Supabase, Firebase, GraphQL, SDK interno...), escreva um objeto com estes 5 métodos assíncronos e passe-o em `configure({ adapter })`:

```js
const meuAdapter = {
  // lista registros; em 'sales' e 'daily_entries', q = { from, to } (datas 'AAAA-MM-DD')
  async list(colecao, q) { return [/* registros */]; },
  // cria e devolve o registro com id
  async create(colecao, registro) { return { id: '...', ...registro }; },
  // (opcional, recomendado) cria vários; sem ele o painel chama create() em sequência
  async bulkCreate(colecao, registros) { return [/* registros com id */]; },
  // altera campos e devolve o registro completo
  async update(colecao, id, campos) { return { id, ...campos }; },
  // exclui; se o item estiver em uso, lance um erro com err.code = 'IN_USE'
  async remove(colecao, id) {},
};
```

Exemplo com Supabase (esboço — ajuste ao seu projeto):

```js
const sb = supabase.createClient(URL, CHAVE);
const adapter = {
  async list(c, q) {
    let r = sb.from(c).select('*');
    if (q && q.from) r = r.gte('date', q.from);
    if (q && q.to) r = r.lte('date', q.to);
    const { data, error } = await r; if (error) throw error; return data;
  },
  async create(c, rec) { const { data, error } = await sb.from(c).insert(rec).select().single(); if (error) throw error; return data; },
  async bulkCreate(c, recs) { const { data, error } = await sb.from(c).insert(recs).select(); if (error) throw error; return data; },
  async update(c, id, p) { const { data, error } = await sb.from(c).update(p).eq('id', id).select().single(); if (error) throw error; return data; },
  async remove(c, id) {
    const { error } = await sb.from(c).delete().eq('id', id);
    if (error) { if (error.code === '23503') error.code = 'IN_USE'; throw error; }
  },
};
```

> Atenção ao Supabase: `list()` por padrão devolve no máximo 1000 linhas. Para períodos longos, use paginação (`.range()`).

**Erros num adaptador personalizado.** O adaptador REST já traduz falhas em mensagens amigáveis (tabela da seção 5). Num adaptador próprio, faça o mesmo lançando erros com estes campos:

```js
const err = new Error('detalhe técnico para o log');
err.code = 'UNAUTHORIZED';  // NETWORK | UNAUTHORIZED | FORBIDDEN | NOT_FOUND | IN_USE | SERVER | REJECTED
err.userMessage = 'Sua sessão expirou. Entre novamente.';  // texto mostrado ao usuário (opcional)
throw err;
```

- `IN_USE` em `remove()` faz o painel oferecer "Arquivar".
- Sem `userMessage`, o painel mostra "Erro: " + `err.message`.
- `bulkCreate` deve ser **tudo ou nada**: grave o lote numa única transação. É isso que permite retomar uma importação interrompida sem duplicar.

---

## 7. Modelo de dados (resumo)

```
sellers ──┐ (owner_seller_id, opcional)
          ▼
products ──1:1──► origins (origem automática)      origins sem product_id = "outras origens"
   ▲                 ▲
   │                 │
sales: date, lead_name, product_id (o que comprou), amount, seller_id, origin_id (de qual funil veio)
daily_entries: date, product_id, seller_id, metric_id, quantity        UNIQUE(date, product, seller, metric)
products: name, owner_seller_id, show_in_goals (v1.1; false = oculto em "Metas por produto")
metrics: name, kind (count|money), funnel_order (posição no funil), audit_role (sold_count|revenue)
goals: target_type (product|seller|total), target_id ('all' na meta geral, v1.6), period (weekly|monthly), amount, valid_from
presets: name, items (JSON) · settings: id (chave), value (JSON)
```

**Chaves de `settings`** (o `value` é sempre JSON; chaves desconhecidas são ignoradas pelo painel):

| Chave | Exemplo de `value` | Para que serve |
|---|---|---|
| `red_below`, `green_from` | `0.7`, `1` | limites de cor do status (Cadastros → Configurações) |
| `include_today` | `false` | "Últimos X dias" incluem hoje? |
| `week_start` | `1` | 1 = segunda, 0 = domingo |
| `default_period` | `"last_7"` | período ao abrir o painel: `today`, `yesterday`, `last_7`, `last_14`, `last_28`, `last_90`, `this_week`, `last_week`, `this_month`, `last_month` e, desde a v1.6, `last_6m`, `last_12m`, `this_year`, `last_year` |
| `funnel_hidden_metrics` | `["m6"]` | métricas escondidas de "Outras métricas" no cartão Funil (v1.1). **Sem uso na tela desde a v1.5**, quando o Funil saiu do Painel; o painel ainda lê, restaura e devolve em `computeDashboard().otherMetrics` |
| `agent_views` | `{"order":["s2","s1"],"hidden_agents":["s4"],"agents":{"s2":{"metrics":["m5","m1"]}}}` | Visão por Agente (v1.1): ordem dos cartões, agentes ocultos e métricas escolhidas por agente. Agente fora de `agents` = automático |
| `lead_income` | `{"bands":[{"metric_id":"m11","color":null},{"metric_id":"m12","color":"#aa0000"}],"unqualified":"m15"}` | Renda dos Leads (v1.4): métricas que são faixas de renda, **da menor para a maior** (é a ordem do gráfico); `color` = `"#rrggbb"` ou `null` (cor padrão); `unqualified` = métrica "Sem qualificação" ou `null`. `null` ou chave ausente = automático (reconhece pelo nome) |
| `agent_dashboard` | `{"conversion":{"from":"m3","to":"m5"},"response":null,"reactivation":null,"social":{"products":null,"metrics":null},"agents":{"s2":{"kpis":["m1","__conv","m6"],"order":["kpis","funnel","react"],"hidden":["cal"]}}}` | Dashboard Agentes (v1.7): `conversion` = métricas da conversão de **todos** os agentes, `to` ÷ `from` (ex.: Vendidos ÷ Leads que Responderam); `null` = última etapa do funil ÷ primeira. `response` (v1.8) = taxa de resposta, `to` ÷ `from`; `null` = automático pelo nome (Leads que Responderam ÷ Leads Contatadas). `reactivation` (v1.9) = resposta da reativação, `to` ÷ `from`; `null` = automático pelo nome (… Responderam - Reativação ÷ Reativação). `social` (v1.9, vale para todos) = `products`: produtos que são mídias sociais (`null` = pelo nome: TikTok, Instagram…) e `metrics`: métricas da seção Mídias sociais, na ordem (`null` = as que o agente lançou). `agents` = escolhas de cada agente (v1.9: valem só para ele): `kpis` = indicadores do topo, na ordem (`"__conv"` = a conversão, `"__react"` = a resposta da reativação; não são métricas); `order` / `hidden` = ordem e seções ocultas (`kpis`, `funnel`, `evol`, `rates`, `income`, `react`, `social`, `prod`, `others`, `cal`, `sales`). Cada chave é opcional; agente fora de `agents` = automático e ordem padrão |

**Onde fica cada personalização** (todas valem para todos que usam o painel):

| O que o usuário faz | Onde é gravado |
|---|---|
| Ocultar produto em "Metas por produto" | `products.show_in_goals` |
| Meta geral, um registro por mês (Cadastros → Produtos → Meta geral) | `goals` com `target_type = 'total'`, `target_id = 'all'` (v1.6) |
| Escolher etapas e ordem do funil (Cadastros → Métricas, coluna "Posição no funil"; organiza a Visão por Agente, o Dashboard Agentes e o Histórico do Diário) | `metrics.funnel_order` (posição; `NULL` = fora do funil) e `metrics.sort_order` (ordem geral) |
| Escolher métricas e ordem de um agente (Diário → Visão por Agente → Personalizar) | `settings.agent_views.agents["<id do agente>"].metrics` |
| Ordem dos cartões e agentes ocultos (Visão por Agente → Agentes e ordem) | `settings.agent_views.order` e `settings.agent_views.hidden_agents` |
| Faixas de renda, ordem, cores e "Sem qualificação" (Diário → Renda dos Leads → Personalizar) | `settings.lead_income` |
| Indicadores do topo e seções (ordem e ocultas) de um agente (Diário → Dashboard Agentes → Personalizar) | `settings.agent_dashboard.agents["<id do agente>"].kpis`, `.order` e `.hidden` |
| Métricas da conversão, da taxa de resposta e da resposta da reativação, para todos os agentes (Dashboard Agentes → botão Taxas) | `settings.agent_dashboard.conversion`, `.response` e `.reactivation` |
| Produtos que são mídias sociais e métricas da seção, para todos os agentes (Dashboard Agentes → Mídias sociais → Métricas) | `settings.agent_dashboard.social` |

As personalizações guardam **IDs**, não nomes: renomear um produto, agente ou métrica não as desfaz. IDs que deixarem de existir (item excluído) são ignorados.

**Regras de cálculo** (no front, em `computeDashboard`, `computeTrends`, `computeAudit`, `computeAgentView`, `computeAgentDashboard` e `computeLeadIncome`):

- **A quem a venda conta na meta** (`gpOf` em `computeDashboard`): se a origem é um funil (`origin_id → origins.product_id`), conta para esse funil, mesmo que o produto comprado seja outro (venda cruzada). Se a origem é fora de funil (`origins.product_id IS NULL`, ex.: Cliente Antigo), conta para o **produto vendido** (`sales.product_id`). Mudou na v1.2; antes essas vendas ficavam fora das metas. `k.funnelRevenue` ("Faturado via funis (tráfego)"; até a v1.10, "Faturado em funis") e a auditoria Diário × Vendas continuam só com as vendas vindas de funis. Cada linha de produto traz `revenueOther`/`countOther` (vindas de outras origens).
- **Meta proporcional**: para cada dia do período filtrado, pega a meta vigente no dia (maior `valid_from <= dia`) e soma `amount/7` (semanal) ou `amount/dias_do_mês` (mensal). Assim, mudar uma meta não reescreve o passado. `store.goalBreakdown(tipo, id, de, até)` devolve a mesma conta em trechos (`amount`, `period`, `div`, `days`, `value`), que é o que o tooltip da meta mostra.
- **Faturado só nos dias com meta** (v1.6): cada linha de produto traz `revenue` (tudo o que foi atribuído a ele no período) e `revenueGoal` (só os dias em que a meta dele valia). `pct`, `missing`, `k.goalRevenue` e a série acumulada usam `revenueGoal`. Antes, o faturado do período inteiro era comparado com a meta de poucos dias quando a meta começava no meio do período.
- **Meta geral** (v1.6, `goals` com `target_type = 'total'` e `target_id = 'all'`): meta da empresa, sem divisão por produto, para a época anterior às metas por produto. `store.generalGoalDays(de, até)` devolve `Map(dia → meta do dia)` só com os dias em que **nenhum produto com `show_in_goals`** (arquivado inclusive) tem meta própria; nesses dias a meta geral é comparada com **todas as vendas** (era a meta da empresa inteira; produtos ocultos nas metas entram). Em `computeDashboard`, `k.general = { goal, revenue, count, pct, status, missing, days, from, to, goalToDate }` (ou `null`), somado em `k.goal`, `k.goalRevenue`, `k.missing`, `k.goalToDate` e na série diária (`days[i].general`). Em `computeTrends`, `buckets[i].general = { goal, days, revenue, only }` e `hasGeneral`. A meta geral não entra em `products` ("Por produto") nem nas metas de vendedor.
- **Produto oculto** (`show_in_goals = false`): fica fora de "Metas por produto" e de tudo que é meta (`k.goal`, `k.missing`, ritmo, série acumulada), exceto nos dias da meta geral, que compara com todas as vendas. Receita, vendedores, funil, "O que foi vendido", origens e auditoria continuam com todos os produtos. `computeDashboard` devolve a lista em `hiddenProducts`.
- **Meta × faturamento total** (v1.11): `k.totalPct = k.revenue / k.goal`. É a MESMA meta de `k.goal` (produtos com meta e meta geral), comparada com TODO o faturamento do período, inclusive produtos sem meta e ocultos. Também calcula `k.totalStatus`, `k.totalMissing = max(k.goal − k.revenue, 0)` e, em período em andamento, `k.totalPacePct = k.revenue / k.goalToDate` (com `k.totalPaceStatus`). O cartão não aparece quando o período inteiro está na meta geral (`k.general.days` = dias do período), porque ali o resultado é igual ao de `k.goalPct`. É só cálculo no front: nada muda no banco.
- **Ritmo** (cartão "Ritmo · produtos com meta"): `k.goalToDate` é a soma, dia a dia, da meta de cada dia de `r.from` até `k.paceTo` (hoje, inclusive). `k.paceDays` é esse número de dias. Quando todos os dias do período valem o mesmo, o cartão mostra "= `k.paceDays` de `r.days` dias da meta de `k.goal`" (v1.11). Quando não valem (por exemplo, uma meta que começa no meio do período), mostra "parte da meta… que vale de … a …". Nos dois casos, a dica no valor lista o esperado de cada produto e da meta geral.
- **Meta de vendedor**: só existe se cadastrada para ele. O faturado do vendedor é tudo o que ele vendeu, de qualquer produto.
- **Períodos** (`computeRange(preset, settings, opts)`): devolve `from`/`to` e o período anterior (`prevFrom`/`prevTo`) de mesmo tamanho. "Últimos X dias" terminam ontem (ou hoje, com `include_today`); "Este mês" e "Mês passado" comparam com o mês anterior inteiro. Desde a v1.6: `last_6m`/`last_12m` = do dia 1 de 5 (ou 11) meses atrás até o fim do mês atual, comparados com os 6 (ou 12) meses antes; `this_year`/`last_year` = 1º/01 a 31/12, comparados com o ano anterior; `all` = de `opts.firstSale` até hoje: nas Tendências, a primeira venda da base ("Desde a primeira venda"); no Dashboard Agentes (v1.7), o primeiro lançamento ou venda do agente escolhido ("Desde o primeiro registro", nome passado em `opts.allName`).
- **Status**: abaixo de `red_below` = vermelho; a partir de `green_from` = verde; entre os dois = amarelo (configurável em Cadastros → Configurações).
- **"Hoje"** é o dia no fuso horário do navegador de quem está usando. As datas gravadas são dias de calendário, sem hora nem fuso.
- **Visão por Agente** (em `computeAgentView`): um cartão por agente com lançamentos no período. Sem personalização, mostra as métricas que ele preencheu, na ordem do funil; com personalização, as de `agent_views.agents[id].metrics`, na ordem gravada (as escolhidas sem lançamento aparecem com 0). As colunas são os produtos em que ele lançou algo no período.
- **Dashboard Agentes** (em `computeAgentDashboard(store, diário, vendas, período, { agent, product, unit, weekStart })`, v1.7; recebe o Diário e as vendas da base inteira):
  - **vendas do agente = vendas com ele em `sales.seller_id`** (coluna Vendedor), de qualquer produto. `products.owner_seller_id` (agente responsável) não entra;
  - **taxa entre duas métricas** (`stages[i].step`, `conv`, `rates`): soma da 2ª ÷ soma da 1ª, contando **só os pares dia + produto em que o agente lançou as duas**; `days` = em quantos dias a taxa se apoia. `conv` = `agent_dashboard.conversion` (`to` ÷ `from`; decidido com o usuário: Vendidos ÷ Leads que Responderam) ou, sem escolha ou com uma das métricas excluída, a última etapa do funil ÷ a primeira (etapas = métricas do funil que ele lançou no período, na ordem do funil). `conv.missing` = métricas da conversão que o agente não lançou no período (a conversão fica `null`);
  - **taxa de resposta** (v1.8, `daily.response`; no indicador da métrica numeradora, `kpis[i].resp`): `agent_dashboard.response` ou, no automático (`responsePair`), a primeira métrica de quantidade com "contatad" no nome → com "respond" (sem acento, na ordem da lista de métricas; v1.9: métricas com "reativ" ficam de fora). Mesma regra das taxas; `missing` como na conversão;
  - **resposta da reativação** (v1.9, `daily.react`; indicador `__react`): `agent_dashboard.reactivation` ou, no automático (`reactivationPair`), métrica de quantidade com "reativ" sem "respond" → com "reativ" e "respond". Mesma regra das taxas, fora das mídias sociais. Só existe para quem já lançou (em qualquer data) uma das duas; `react.start` = primeiro lançamento delas, `react.noPrev` se o período anterior começa antes; `react.status` = `before` | `empty` | `ok`; `total` / `answered` = somas das duas. As duas saem de "outras atividades"; `buckets[i].react` = a taxa por grupo;
  - **mídias sociais** (v1.9, `daily.social`; produtos de `socialConfig`): os lançamentos nesses produtos saem do funil, das taxas, da conversão, dos indicadores, de `byProduct` e de `products` (o filtro). `daily.days` e `daily.calendar` contam todos os lançamentos. `daily.social` só existe para quem lança neles e sem `opts.product`: `networks` (as redes com lançamento no período, na ordem do cadastro), `metrics` (as de `social.metrics` ou as que o agente lançou, na ordem da lista) com `total` (null = sem lançamento), `prev`, `step` (sobre a métrica de cima, mesma regra das taxas, dia + rede) e `nets` (o mesmo por rede); `buckets` / `prevBuckets` com `m` e `net[rede]`; `start`, `noPrev` e `status` como na reativação;
  - **seções** (v1.9, `layout` = `agdLayout`): `order` (a escolhida; seção que ela não cita entra depois da vizinha da ordem padrão), `hidden` e `visible`;
  - **média por dia** (`avg`) = total ÷ dias em que o agente lançou algo no período (com o filtro de produto);
  - **período anterior** = o de `computeRange`; num período em andamento, só **até o mesmo ponto** (`prev.to`, `prev.same`): com hoje = 21, o anterior vai do dia 1 ao 21;
  - **início do agente** = primeiro lançamento dele no Diário (`daily.start`): grupos antes disso saem, o grupo dele começa nele (`trimmed` = quantos saíram) e, se o período anterior começa antes, `daily.noPrev` (sem comparação). As vendas usam a primeira venda da base, como as Tendências (`sales.noPrev`);
  - **grupos** (`daily.buckets`, `sales.buckets`): dia, semana ou mês como nas Tendências, sem os futuros; uma métrica sem lançamento no grupo vale `null` ("—", a linha é interrompida), não 0. `prevBuckets` = os mesmos grupos deslocados para o período anterior (meses: os meses anteriores);
  - **filtro de produto**: Diário pelo `product_id` do lançamento; vendas pelo produto vendido. Com produto escolhido, `sales.goal = null` (a meta individual não é dividida por produto);
  - **meta individual** = `goalForRange('seller', …)`, a mesma do Painel; `goalToDate` no período em andamento;
  - indicadores (`daily.kpis`): os de `agent_dashboard.agents[id].kpis` ou, no automático (`daily.autoKpis`), primeira e última etapa, `__conv` e as métricas em R$ (até 6). A renda usa a configuração de `leadIncomeConfig`; "outras atividades" = métricas de quantidade fora do funil e fora das faixas de renda;
  - situações: `status` = `noagents` | `future` | `ok`; `daily.status` = `none` (nunca lançou) | `before` (período todo antes do início) | `empty` | `ok`.
- **Equipe** (em `computeTeamDashboard`, v1.8): uma chamada de `computeAgentDashboard` por agente, então as contas são as mesmas.
  - linhas (`rows`): agentes com lançamento (inclusive só em mídia social, v1.9) ou venda no período, fora `agent_views.hidden_agents` (`hidden` = nomes deles); com `opts.product`, só quem tem registro no produto, calculado com o filtro;
  - `stages` = etapas do funil lançadas por alguém; `constancy` = dias com lançamento ÷ dias desde o início do agente (`null` para quem nunca lançou no Diário);
  - `total.response` = Σ `response.num` ÷ Σ `response.den`, do mesmo jeito (`null` se ninguém lançou as duas); `total.conv` = Σ `conv.num` ÷ Σ `conv.den` dos agentes que lançaram as duas métricas; `null` quando a conversão automática dá pares diferentes entre agentes (`conv.mixed`);
  - `spark` = a métrica `opts.metric` (padrão: primeira etapa) nos grupos comuns `buckets`, alinhada pela data; `calendar` = lançamentos por dia (`days`, períodos de até 62 dias), `null` antes do início do agente.
- **Tendências** (em `computeTrends`, aba nova da v1.5):
  - agrupamento: o escolhido (`day` | `week` | `month`) ou, no automático, até 14 dias por dia, até 92 por semana, acima por mês. Os grupos nas pontas são cortados nos limites do período, e a meta acompanha o corte;
  - meta do grupo = soma das metas dos produtos exibidos nas metas (`show_in_goals`), proporcional aos dias do grupo, mais a meta geral dos dias em que ela vale (v1.6); "faturado com meta" = vendas atribuídas com a mesma regra do Painel (`gpOf`) aos produtos que têm meta, nos dias em que ela vale (`goalValues`), mais todas as vendas dos dias da meta geral. Grupo em andamento compara com a meta até hoje (`goalToDate`);
  - **primeira venda** (`opts.firstSale`): grupos inteiros antes dela saem, e o grupo dela começa nela. `status` = `nosales` (nenhuma venda), `before` (período todo antes) ou `ok`. O painel lê a data com `GET /sales` sem período, uma vez, e relê quando alguma venda muda;
  - comparação (`compare`): acumulado dia a dia × o período anterior de mesmo tamanho de `computeRange` (dia 1 com dia 1; mês × mês anterior). `noPrev` quando o anterior começa antes da primeira venda;
  - lista de produtos: a mesma do Painel (ativos, ou arquivados com atividade no período). Para um arquivado com lançamento só no Diário entrar, passe os lançamentos do período em `opts.daily` (a aba faz isso sozinha quando existe produto arquivado com meta, v1.6.1);
  - por produto (`products`): os mesmos produtos de "Metas por produto", com `values`, `goalValues` (só os dias com meta), `goals` e `pct` (faturado nos dias com meta ÷ meta até hoje).
- **Auditoria Diário × Vendas** (em `computeAudit`; na tela, Diário → Histórico desde a v1.5): por funil, compara as métricas com `audit_role` com as vendas cuja origem é aquele funil. `computeDashboard` continua devolvendo `audit`.
- **Renda dos Leads** (em `computeLeadIncome`; a configuração em uso vem de `leadIncomeConfig`):
  - faixas e "Sem qualificação" vêm de `settings.lead_income`. Sem essa chave (automático): faixas = métricas de quantidade com a palavra "renda" no nome, ordenadas Sem < Muito baixa < Baixa < Média < Alta < Muito alta; "Sem qualificação" = métrica com "sem qualifica", "não qualifica" ou "desqualifica" no nome. Métricas em R$ e IDs que não existem mais são ignorados;
  - **% de cada faixa = quantidade da faixa ÷ soma das faixas** (as qualificadas). "Sem qualificação" fica fora do %; "registradas" = qualificadas + sem qualificação;
  - **início do acompanhamento** de um produto = primeiro dia com qualquer uma dessas métricas lançada (mesmo com 0). Produtos sem nenhum lançamento delas não aparecem;
  - situações (`status`): `nocfg` (nenhuma faixa), `notracked` (faixas nunca lançadas), `future` (período ainda não começou), `before` (período todo antes do início), `empty` (nenhum lançamento no período), `ok`;
  - `periodDays` = dias do período até hoje; `covered` = quantos deles têm lançamento. Nada é projetado: dias sem lançamento não entram na conta;
  - evolução por semana (respeita `week_start`), ou por mês quando o período passa de 26 semanas. Semanas antes do início e futuras são retiradas; buracos no meio ficam.

### 7.1 Atualizando um banco criado com uma versão anterior

> Instalação nova: pule esta seção. O `schema.sql` já traz tudo o que as versões abaixo pediram.

**v1.10 → v1.11: nada muda no banco nem no backend.**
- **Painel:** os indicadores ficam mais claros e há um cartão novo, **Meta × faturamento total**, calculado no front com os dados que já existem.
- **Selo de status:** "Abaixo" passou a se chamar "Crítico". Se a plataforma lê o texto da tela (por exemplo, em testes automáticos), troque também os nomes: "Meta dos produtos" agora é "Meta · produtos com meta", "Falta para a meta" agora é "Falta · produtos com meta", "Ritmo até hoje" agora é "Ritmo · produtos com meta" e "Faturado em funis" agora é "Faturado via funis (tráfego)".
- **Para localizar os cartões:** cada um tem `data-kpi`: revenue, count, avg, funnel, goal, goal-total, missing, pace.

**v1.9 → v1.10: nada muda no banco nem no backend.** O tema passou a ser **escuro por padrão**: se a plataforma passava `theme: 'light'` só por costume, tire para usar o novo padrão (ou mantenha, se quiser o claro como padrão). A escolha de cada pessoa no botão sol/lua fica no navegador dela (`localStorage`), não no banco. "Exportar PDF" usa a impressão do navegador e não chama o backend.

**v1.8.1 → v1.9: nada muda no banco nem no backend.** A reativação, as mídias sociais e a personalização por agente ficam na chave `agent_dashboard` de `settings`, que já existe (campos novos: `reactivation`, `social` e, em cada agente, `order` e `hidden`; `kpis` passou a ser opcional). Configurações gravadas pela v1.7/v1.8 continuam valendo. O botão "Conversão" passou a se chamar **Taxas**. Atenção: TikTok e Instagram (e outros produtos com nome de rede social) **saem do funil** do Dashboard Agentes no automático; para manter algum no funil, desmarque em Mídias sociais → Métricas.

**v1.8 → v1.8.1: só documentação** (este guia e o README). Nada muda no painel, no banco ou no backend.

**v1.7 → v1.8: nada muda no banco nem no backend.** A visão Equipe usa as mesmas leituras e configurações do Dashboard Agentes.

**v1.6.1 → v1.7: nada muda no banco nem no backend.** O Dashboard Agentes usa lançamentos, vendas e metas de vendedor que já existem e grava a personalização numa chave nova de `settings` (`agent_dashboard`). Ele lê o Diário inteiro e todas as vendas ao ser aberto (seção 5), leituras que o backend já atende desde a v1.4/v1.5.

**v1.6 → v1.6.1: nada muda no banco.** São correções. Duas delas tocam o backend:
- se ele devolver datas como data/hora, devolva como texto `AAAA-MM-DD` (seção 5; o backend de exemplo já trata o caso do SQL Server);
- o painel agora desiste de uma chamada sem resposta depois de 60 s (`timeoutMs`, seção 5.1). Se alguma rota do backend demorar mais que isso de propósito (ex.: lotes muito grandes num servidor lento), aumente o valor.

**v1.5 → v1.6: uma mudança no banco e uma no backend**, só para a meta geral:

1. **`goals.target_type` passa a aceitar `'total'`.** O `CHECK` do `schema.sql` antigo só aceita `product` e `seller`. Troque a restrição (o nome dela varia: no PostgreSQL, `d goals`; no SQL Server, `sp_helpconstraint goals`; no SQLite, é preciso recriar a tabela):
   ```sql
   ALTER TABLE goals DROP CONSTRAINT <nome do check de target_type>;
   ALTER TABLE goals ADD CONSTRAINT goals_target_type_check CHECK (target_type IN ('product', 'seller', 'total'));
   ```
2. **Backend:** aceite `target_type = 'total'` com `target_id = 'all'` em `POST`/`PATCH /goals`, sem conferir o alvo em `products`/`sellers` (veja `checkRefs` em `exemplo-backend/servidor.js`).

Antes dessa troca, o painel continua funcionando com as metas por produto; só a gravação da meta geral falha (o backend recusa e a tela mostra o erro). Ao **restaurar um backup** com metas gerais num banco ainda não atualizado, as recusas (`4xx`, código `REJECTED` no adaptador) viram avisos e o resto (vendas, Diário, outras metas) é gravado normalmente; um erro de servidor ou de rede continua interrompendo a restauração, para ela ser retomada depois. Também muda o cálculo, sem mexer no banco: o faturado de um produto só é comparado com a meta nos dias em que ela valia (seção 7, regras de cálculo).

**v1.5 → nada muda no banco.** A aba Tendências usa vendas e metas que já existem. Confira só que o `GET /sales` sem `from`/`to` devolve todas as vendas (seção 5). O cartão Funil saiu do Painel; a chave `settings.funnel_hidden_metrics` pode ficar no banco (é ignorada pela tela).

**v1.4.1 → nada muda no banco nem no backend.** Ajuste visual dos indicadores e senha no "Apagar dados do navegador" (só existe no demo).

**v1.4 → nada muda no banco.** A Renda dos Leads usa métricas e lançamentos do Diário que já existem, e grava a personalização numa chave nova de `settings` (`lead_income`). Só confira se o `GET /daily_entries` sem `from`/`to` devolve o Diário inteiro (seção 5).

**v1.3 → nada muda no banco nem no backend.** A restauração de backup usa as rotas que já existem (seção 8.1).

**v1.2 → nada muda no banco nem no backend.** A mudança é só no cálculo do front: vendas de origens fora de funil passam a contar na meta do produto vendido. Os números de metas de períodos passados mudam junto, porque são calculados na hora a partir das vendas.

**v1.0 → v1.1:**

A v1.1 não tem rotas novas nem tabelas novas. Só duas coisas mudam no banco e no backend:

1. **Coluna nova em `products`**:
   ```sql
   ALTER TABLE products ADD COLUMN show_in_goals BOOLEAN NOT NULL DEFAULT TRUE;
   -- SQL Server: ALTER TABLE products ADD show_in_goals BIT NOT NULL DEFAULT 1;
   ```
   Se o backend valida os campos aceitos (como o exemplo faz), inclua `show_in_goals` (booleano) na lista de `products`.
   Antes de rodar o `ALTER`, o painel continua funcionando: trata todo produto como visível e não envia a coluna ao criar produtos. Só o botão "Nas metas" não consegue gravar.
2. **`settings.value` com alguns KB**: `agent_views` cresce cerca de 40 bytes por métrica escolhida por agente (com IDs UUID; 20 agentes × 15 métricas ≈ 14 KB). A coluna já é `TEXT` no `schema.sql`. Se o backend limitar o tamanho, deixe espaço: o exemplo aceita até 100 mil caracteres.

As demais personalizações usam colunas que já existiam (`metrics.funnel_order`, `metrics.sort_order`) e chaves novas em `settings`, que não precisam de nada no banco.

---

## 8. Migração da planilha antiga e de outra base

1. Crie as tabelas (`schema.sql`) e suba o backend.
2. Abra o painel → **Vendas → Importar arquivo** e envie a planilha. A aba "Vendas" é escolhida automaticamente e produtos, vendedores e origens que ainda não existem são criados na hora (com confirmação).
3. Faça o mesmo em **Diário → Importar arquivo**: a aba "Diário" é escolhida automaticamente.
4. Em **Cadastros → Métricas**, defina a **posição no funil** de cada métrica (ex.: Contatos Criados = 1 ... Vendidos = 6) e a coluna **Auditoria**: "Vendidos" = nº de vendas; "Valor Faturado" = valor faturado. As métricas criadas pela importação entram **fora do funil**: sem este passo, a Visão por Agente, o Dashboard Agentes e o Histórico do Diário não têm a ordem do funil, e a Auditoria Diário × Vendas fica desligada.
5. Em **Cadastros → Produtos / Vendedores**, defina as metas com a data em que elas passaram a valer ("Vale a partir de"). Use "Valer para todo o histórico" só se a meta realmente valia desde o começo dos dados: senão, os meses antigos aparecem como abaixo de uma meta que ainda não existia. Se antes havia só uma meta da empresa, sem divisão por produto, cadastre-a como **Meta geral** (Cadastros → Produtos, v1.6), um registro por mês.

Os formatos de arquivo aceitos (Excel, Google Sheets, CSV com `;` ou `,`, valores como `R$ 2.100`...) estão no [README](README.md#formatos-aceitos-na-importação).

### 8.1 Trazer os dados que já estão no navegador (ou em outra base)

Quem usou o `index.html` tem os dados guardados só no próprio navegador. Para levá-los ao banco:

1. No navegador antigo: **Cadastros → Configurações → Exportar todos os dados (JSON)**.
2. No painel já ligado ao banco: **Restaurar backup (JSON)** com esse arquivo, conferir a prévia e confirmar.

A restauração usa só as rotas normais da API (`GET`, `POST`, `POST /bulk`, `PATCH` em `settings`); não há rota especial. Como os IDs são gerados pelo banco, o painel **remapeia** todas as referências: vendas, Diário, metas, presets e os IDs das personalizações em `settings` (inclusive as faixas da Renda dos Leads e os indicadores do Dashboard Agentes, v1.7). A meta geral (`target_type = 'total'`, v1.6) não tem alvo para remapear e vai como está; se o banco ainda não a aceitar, ela vira aviso e o resto é gravado (seção 7.1). Backups de versões anteriores continuam sendo aceitos. Nada é apagado nem alterado. Cadastros com o mesmo nome são reaproveitados, e vendas iguais (data, lead, valor e produto) e lançamentos do Diário já existentes são pulados. Por isso dá para restaurar de novo depois de uma interrupção sem duplicar.

**Formato do backup** (o mesmo que o botão Exportar gera):
```json
{ "app": "relatorio-comercial", "version": "1.7.0", "exported_at": "2026-10-21T23:50:00Z",
  "products": [...], "sellers": [...], "origins": [...], "metrics": [...], "goals": [...],
  "sales": [...], "daily_entries": [...], "presets": [...], "settings": [...] }
```
Cada lista tem os registros como a API os devolve (seção 7). Para migrar de outro sistema, basta montar um JSON nesse formato: `app` é obrigatório e listas ausentes contam como vazias. Os `id` do arquivo servem só para ligar os registros entre si.

Para um script de migração sem tela: `await painel.store.restoreBackup(dados, { dryRun: true })` devolve a prévia (`counts`, `issues`), e sem `dryRun` grava. Os detalhes estão no comentário da função no `relatorio-comercial.js`.

---

## 9. Manutenção do código

`relatorio-comercial.js` está dividido em seções numeradas:

| Seção | Conteúdo |
|---|---|
| 1. Utilitários | datas, formatação pt-BR, leitura de CSV/XLSX, conversão de valores |
| 2. Dados | normalização, adaptador local, adaptador REST, `Store` (cache + regras de cadastro e metas, `goalBreakdown`, `restoreBackup`) |
| 3. Cálculos | períodos (`computeRange`), todos os números do painel (`computeDashboard`), a Auditoria (`computeAudit`), as Tendências (`computeTrends`), a Visão por Agente (`computeAgentView`), o Dashboard Agentes (`computeAgentDashboard`, a Equipe em `computeTeamDashboard` e a taxa de resposta em `responsePair`) e a Renda dos Leads (`leadIncomeConfig`, `computeLeadIncome`) |
| 4. Estilo | CSS (tokens de cor claro/escuro) e ícones SVG |
| 5. Núcleo | o Web Component: eventos delegados (`data-act`, `data-chg`, `data-inp`), modais, popover, tooltip |
| 6–10. Abas | Painel e Tendências (e gráficos SVG), Vendas, Diário (com o Dashboard Agentes em `AgentDashView`), Importação, Cadastros |
| 11. Registro | `customElements.define` e a API `window.RelatorioComercial` |

Para adicionar um botão: crie o elemento com `data-act="minha-acao"` e registre a função em `Object.assign(ACT, { 'minha-acao'(el, evento) { ... } })`. `this` é o componente.

**Telas que esperam o banco:** depois de cada `await` numa função de desenho, confira `if (this._stale(tok)) return;` antes de usar `this.store` ou mexer na tela. Nesse intervalo o usuário pode ter trocado de aba, ou a plataforma pode ter trocado a fonte de dados (`configure`). Foi assim que surgiu o erro "store is null" corrigido na v1.3.

`RelatorioComercial.utils` expõe `computeDashboard`, `computeTrends` (Tendências), `computeAudit` (Auditoria), `computeAgentView` (Visão por Agente), `computeAgentDashboard` e `computeTeamDashboard` (Dashboard Agentes e Equipe), `socialConfig` e `reactivationPair` (v1.9), `computeLeadIncome` e `leadIncomeConfig` (Renda dos Leads), `computeRange`, `parseMoney`, `parseDate`, `parseCSV`, `readXlsx`, `readTabularFile` e `Store`, úteis para testes automatizados.

---

## 10. Checklist de implantação

**Banco e backend**
- [ ] Tabelas criadas com `schema.sql`, com os ajustes do banco escolhido (fim do arquivo; no SQL Server, o índice filtrado de `origins`)
- [ ] Banco criado antes da v1.1: coluna `products.show_in_goals` adicionada (seção 7.1)
- [ ] Banco criado antes da v1.6: `CHECK` de `goals.target_type` aceitando `'total'` (meta geral, seção 7.1)
- [ ] `settings.value` aceitando JSON de alguns KB (seção 7.1)
- [ ] Rotas REST implementadas (seção 5) e protegidas pela autenticação da plataforma
- [ ] `DELETE` devolvendo `409` para itens com histórico, conferido no código e não só pelas chaves estrangeiras (seção 5.2, item 1)
- [ ] Entrada validada no servidor, principalmente datas `AAAA-MM-DD` (seção 5.2, item 6)
- [ ] `GET` de `sales` e `daily_entries` respeitando `from`/`to`, e devolvendo tudo quando não vierem (Tendências, Renda dos Leads e Dashboard Agentes, seção 5)
- [ ] Lotes (`/bulk`) gravados numa transação única
- [ ] Mensagens de erro sem detalhes internos (SQL, tabelas)
- [ ] Só o `relatorio-comercial.js` publicado como arquivo estático, nunca a pasta do projeto

**Página**
- [ ] `relatorio-comercial.js` servido pela plataforma, com a tag e o `configure()` na página
- [ ] CSP da plataforma conferida (seção 3): sem `style-src` restritivo, ou painel adaptado
- [ ] `rc:error` com `code === 'UNAUTHORIZED'` levando ao login da plataforma (seção 4.2)
- [ ] Perfil de leitura usando `readonly` (e bloqueio de escrita no backend)

**Dados e conferência final**
- [ ] Dados históricos importados (seção 8; quem já usava o demo no navegador: backup + restaurar, seção 8.1) e métricas/metas configuradas
- [ ] Teste rápido: lançar uma venda, preencher um dia no Diário e conferir o Painel
- [ ] Dashboard Agentes: escolher a conversão no botão **Taxas** (ex.: Vendidos ÷ Leads que Responderam) e conferir se a taxa de resposta e a resposta da reativação foram reconhecidas (cartão "Leads que Responderam", seção Reativação e Equipe). Fica gravado em `settings`, vale para todos e vai junto no backup
- [ ] Indicadores do Painel (v1.11): conferir com os gestores os limites do selo (Cadastros → Configurações; o padrão é Crítico abaixo de 70% e Na meta a partir de 100%). Se algum teste ou automação da plataforma lê os textos da tela, atualizar os nomes novos (seção 7.1).
- [ ] Tema (v1.10): decidir se a plataforma passa `theme` (sem ele, o painel abre no escuro) e, se ela tiver o próprio seletor de tema, ouvir `rc:theme` para acompanhar o painel
- [ ] Exportar PDF (v1.10): gerar um PDF do Painel e um do Dashboard Agentes nos navegadores usados e conferir o resultado (seção 11)
- [ ] Dashboard Agentes → Mídias sociais → **Métricas** (v1.9): conferir quais produtos são mídias sociais (no automático, TikTok e Instagram pelo nome) e escolher as métricas da seção, se quiser outra ordem
- [ ] Abrir uma vez num Safari de verdade (iPhone ou Mac), que não foi testado

---

## 11. Como tudo foi validado

A suíte automática não está neste repositório: as fixtures dela usam dados reais de operação, que não são públicos. Ela cobre a API (contrato REST, robustez, segurança, volume e desempenho) e o painel em Chromium, Firefox e WebKit via Playwright, inclusive uma segunda implementação independente das regras de negócio, que recalcula os números e os compara com os da tela.

**Não testado:**
- PostgreSQL, MySQL e SQL Server reais: mesmo código e mesmo `schema.sql`, mas só o SQLite foi executado;
- Safari de verdade (o WebKit cobre o motor, mas não é idêntico);
- CSP restritiva (seção 3);
- leitor de tela;
- várias pessoas usando ao mesmo tempo num banco de dados em produção.
