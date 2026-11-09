-- =============================================================================
-- Relatório Comercial — esquema do banco de dados (SQL genérico)
-- =============================================================================
-- Escrito em SQL padrão para funcionar, com ajustes mínimos, em PostgreSQL,
-- MySQL/MariaDB, SQL Server e SQLite. Ajustes por banco estão no fim do arquivo.
--
-- Convenções
--  * IDs são texto (VARCHAR(36)) para aceitar UUID. Se preferir inteiros
--    autoincrementais, troque o tipo — o painel trata IDs como opacos.
--  * Datas de negócio (date) são DATE "puro" (sem fuso): 'AAAA-MM-DD'.
--  * Valores monetários: DECIMAL(14,2). Quantidades do Diário: DECIMAL(14,2)
--    (algumas métricas são em R$).
--  * "active" = FALSE significa ARQUIVADO: o item some dos seletores, mas
--    continua aparecendo no histórico. Nada é apagado por arquivar.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Cadastros
-- ---------------------------------------------------------------------------
CREATE TABLE sellers (                       -- vendedores / agentes (mesma lista)
  id          VARCHAR(36)  PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  active      BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (                      -- cada produto é um funil
  id              VARCHAR(36)  PRIMARY KEY,
  name            VARCHAR(120) NOT NULL,
  owner_seller_id VARCHAR(36)  NULL REFERENCES sellers(id) ON DELETE SET NULL,  -- "agente responsável" (informativo)
  show_in_goals   BOOLEAN      NOT NULL DEFAULT TRUE,  -- FALSE = oculto em "Metas por produto" e nos indicadores de meta do Painel (v1.1)
  active          BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order      INTEGER      NOT NULL DEFAULT 0,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Origem da lead. Duas formas:
--  * product_id preenchido  -> origem automática do produto (o nome exibido é o do produto; name fica NULL)
--  * product_id NULL        -> outra origem ("Cliente Antigo", "Indicação"...): a venda conta na meta do PRODUTO VENDIDO (v1.2)
-- O próprio painel cria a origem automática quando um produto é criado.
CREATE TABLE origins (
  id          VARCHAR(36)  PRIMARY KEY,
  name        VARCHAR(120) NULL,
  product_id  VARCHAR(36)  NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  active      BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (product_id IS NOT NULL OR name IS NOT NULL)
);

CREATE TABLE metrics (                       -- métricas do Diário
  id            VARCHAR(36)  PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  kind          VARCHAR(10)  NOT NULL DEFAULT 'count' CHECK (kind IN ('count', 'money')),
  funnel_order  INTEGER      NULL,           -- posição no funil (1 = topo). NULL = fora do funil
  audit_role    VARCHAR(20)  NULL CHECK (audit_role IN ('sold_count', 'revenue')),  -- conferência Diário x Vendas
  active        BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order    INTEGER      NOT NULL DEFAULT 0,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- Metas (opcionais, com histórico de vigência)
-- ---------------------------------------------------------------------------
-- A meta válida num dia D é o registro com o maior valid_from <= D (NULL = "desde sempre").
-- amount NULL ou 0 = "sem meta a partir desta data".
-- O painel rateia por dia: weekly = amount / 7 ; monthly = amount / dias do mês.
-- Meta geral (v1.6): target_type = 'total' e target_id = 'all' — meta da empresa, sem divisão por produto, para o
-- período antes das metas por produto. Só vale nos dias em que nenhum produto com show_in_goals tem meta própria.
-- Migração de um banco anterior à v1.6: troque o CHECK de target_type para aceitar 'total', por exemplo:
--   ALTER TABLE goals DROP CONSTRAINT <nome do check>;  -- PostgreSQL: \d goals mostra o nome
--   ALTER TABLE goals ADD CONSTRAINT goals_target_type_check CHECK (target_type IN ('product', 'seller', 'total'));
CREATE TABLE goals (
  id           VARCHAR(36)   PRIMARY KEY,
  target_type  VARCHAR(10)   NOT NULL CHECK (target_type IN ('product', 'seller', 'total')),
  target_id    VARCHAR(36)   NOT NULL,      -- products.id, sellers.id ou 'all' (meta geral) — polimórfico: sem FK
  period       VARCHAR(10)   NOT NULL DEFAULT 'weekly' CHECK (period IN ('weekly', 'monthly')),
  amount       DECIMAL(14,2) NULL,
  valid_from   DATE          NULL,
  created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_goals_target ON goals (target_type, target_id);

-- ---------------------------------------------------------------------------
-- Lançamentos
-- ---------------------------------------------------------------------------
-- Vendas (equivale à aba "Vendas" da planilha antiga)
-- product_id = o que a lead comprou ; origin_id = de onde ela veio. Meta: se a origem é um funil, conta para esse funil;
-- se é outra origem (ex.: Cliente Antigo), conta para o produto comprado (v1.2).
CREATE TABLE sales (
  id          VARCHAR(36)   PRIMARY KEY,
  date        DATE          NOT NULL,
  lead_name   VARCHAR(200)  NOT NULL,
  product_id  VARCHAR(36)   NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  amount      DECIMAL(14,2) NOT NULL CHECK (amount > 0),
  seller_id   VARCHAR(36)   NOT NULL REFERENCES sellers(id)  ON DELETE RESTRICT,
  origin_id   VARCHAR(36)   NOT NULL REFERENCES origins(id)  ON DELETE RESTRICT,
  notes       VARCHAR(1000) NULL,
  created_by  VARCHAR(120)  NULL,           -- opcional: preencha no backend com o usuário logado
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_sales_date ON sales (date);

-- Diário (equivale à aba "Diário"): uma linha por dia + produto + agente + métrica
CREATE TABLE daily_entries (
  id          VARCHAR(36)   PRIMARY KEY,
  date        DATE          NOT NULL,
  product_id  VARCHAR(36)   NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  seller_id   VARCHAR(36)   NOT NULL REFERENCES sellers(id)  ON DELETE RESTRICT,
  metric_id   VARCHAR(36)   NOT NULL REFERENCES metrics(id)  ON DELETE RESTRICT,
  quantity    DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_by  VARCHAR(120)  NULL,
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (date, product_id, seller_id, metric_id)
);
CREATE INDEX ix_daily_date ON daily_entries (date);

-- ---------------------------------------------------------------------------
-- Presets do Diário e configurações
-- ---------------------------------------------------------------------------
-- items = JSON: [{"product_id":"...","seller_id":"...","metric_id":"..."}, ...]
-- (o painel aceita receber items como array JSON ou como texto JSON)
CREATE TABLE presets (
  id          VARCHAR(36)  PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  items       TEXT         NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Chave/valor. O painel grava: red_below, green_from, include_today, week_start, default_period,
-- funnel_hidden_metrics e agent_views (v1.1), lead_income (v1.4: faixas da Renda dos Leads). Veja INTEGRACAO.md, seção 7.
-- value é JSON em texto (ex.: '0.7', 'true', '"last_7"'). O id (chave) é enviado pelo painel.
CREATE TABLE settings (
  id          VARCHAR(40)  PRIMARY KEY,
  value       TEXT         NOT NULL,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Ajustes por banco
-- =============================================================================
-- PostgreSQL : funciona como está. Opcional: id UUID DEFAULT gen_random_uuid(); items JSONB.
-- MySQL      : funciona como está (BOOLEAN vira TINYINT(1); o painel entende 0/1).
--              "date" é palavra reservada em alguns modos: se der erro, use `date` entre crases.
--              Para updated_at automático: ... DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP.
-- SQL Server : BOOLEAN -> BIT, TRUE/FALSE -> 1/0, TIMESTAMP -> DATETIME2, TEXT -> NVARCHAR(MAX);
--              "date" precisa de colchetes: [date].
--              UNIQUE em origins.product_id: o SQL Server só aceita um NULL numa coluna UNIQUE.
--              Troque por um índice filtrado:
--              CREATE UNIQUE INDEX ux_origins_product ON origins(product_id) WHERE product_id IS NOT NULL;
-- SQLite     : funciona como está (ative PRAGMA foreign_keys = ON).
--
-- =============================================================================
-- Atualizando um banco criado com uma versão anterior
-- =============================================================================
-- O painel funciona mesmo sem estas colunas (trata como o valor padrão), mas
-- não consegue GRAVAR a configuração correspondente até que elas existam.
--
-- v1.2, v1.3 e v1.4: nada muda no banco (a v1.4 usa uma chave nova em settings: lead_income).
--
-- v1.1 — ocultar produto em "Metas por produto":
--   ALTER TABLE products ADD COLUMN show_in_goals BOOLEAN NOT NULL DEFAULT TRUE;
--   (SQL Server: ALTER TABLE products ADD show_in_goals BIT NOT NULL DEFAULT 1;)
--
-- Multiempresa: se a plataforma tiver várias contas/empresas, adicione uma coluna
-- tenant_id em TODAS as tabelas e filtre por ela no backend (o painel não precisa saber).
