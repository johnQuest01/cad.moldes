/**
 * Esquema do log de eventos e do snapshot (Parte 4).
 *
 * ## Duas tabelas, e por que exatamente duas
 * `evento` e o log **append-only**: e a verdade. `snapshot` e leitura rapida — o
 * estado atual em JSONB, derivavel do log a qualquer momento. Se as duas
 * divergirem, quem esta certo e o log; `conferirIntegridade` existe para provar
 * que nao divergiram.
 *
 * ## `tenant_id` em toda linha (inegociavel 6)
 * Nas duas tabelas, e nao so no `evento`. Retrofit de isolamento depois e dor e
 * furo de seguranca.
 *
 * ## A ordem do replay e o ULID, nao um serial
 * O log e lido `ORDER BY id`. O id e ULID (D2), ordenavel por tempo, entao a ordem
 * e a mesma **em qualquer maquina**, sem depender de quem inseriu primeiro. Um
 * `BIGSERIAL` daria a ordem de chegada NAQUELE banco — o que faria duas maquinas
 * que trabalharam offline reconstruirem estados diferentes do mesmo conjunto de
 * eventos, e o teste de integridade da Fase 10 falharia por construcao.
 */
import type { Dialeto } from './executor.js';

/**
 * DDL do log e do snapshot. Idempotente (`IF NOT EXISTS`), para poder rodar na
 * subida do app tanto no Neon quanto no SQLite local do Tauri.
 */
export function ddl(dialeto: Dialeto): string[] {
  const documento = dialeto === 'postgres' ? 'JSONB' : 'TEXT';
  const instante = dialeto === 'postgres' ? 'TIMESTAMPTZ' : 'TEXT';

  return [
    `CREATE TABLE IF NOT EXISTS evento (
       id            TEXT PRIMARY KEY,
       tenant_id     TEXT NOT NULL,
       modelo_id     TEXT NOT NULL,
       peca_id       TEXT,
       tipo          TEXT NOT NULL,
       payload       ${documento} NOT NULL,
       ocorrido_em   ${instante} NOT NULL,
       autor         TEXT NOT NULL,
       versao_schema INTEGER NOT NULL
     )`,
    // O indice cobre a unica leitura quente: o log de um modelo, na ordem do ULID.
    `CREATE INDEX IF NOT EXISTS evento_do_modelo
       ON evento (tenant_id, modelo_id, id)`,
    `CREATE TABLE IF NOT EXISTS snapshot (
       modelo_id      TEXT NOT NULL,
       tenant_id      TEXT NOT NULL,
       estado         ${documento} NOT NULL,
       ate_evento_id  TEXT NOT NULL,
       atualizado_em  ${instante} NOT NULL,
       PRIMARY KEY (tenant_id, modelo_id)
     )`,
  ];
}

/**
 * RLS por tenant. **So Postgres** — SQLite nao tem, e o motivo de isso ser
 * aceitavel offline esta escrito em `executor.ts`.
 *
 * A politica le `app.tenant_id`, que a aplicacao define por conexao com
 * `SET LOCAL app.tenant_id = ...`. Sem isso definido, `current_setting(..., true)`
 * devolve NULL e a politica **nao deixa ver nada** — falha fechada, que e o lado
 * certo para errar.
 */
export function ddlRls(): string[] {
  return [
    `ALTER TABLE evento ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE snapshot ENABLE ROW LEVEL SECURITY`,
    `DROP POLICY IF EXISTS evento_do_tenant ON evento`,
    `CREATE POLICY evento_do_tenant ON evento
       USING (tenant_id = current_setting('app.tenant_id', true))
       WITH CHECK (tenant_id = current_setting('app.tenant_id', true))`,
    `DROP POLICY IF EXISTS snapshot_do_tenant ON snapshot`,
    `CREATE POLICY snapshot_do_tenant ON snapshot
       USING (tenant_id = current_setting('app.tenant_id', true))
       WITH CHECK (tenant_id = current_setting('app.tenant_id', true))`,
  ];
}
