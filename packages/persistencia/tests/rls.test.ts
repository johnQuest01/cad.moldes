/**
 * Row Level Security por tenant (Parte 4, inegociavel 6).
 *
 * O filtro `WHERE tenant_id = $1` do repositorio ja isola. O RLS existe porque
 * filtro e codigo, e codigo tem bug: basta UMA consulta esquecer o `WHERE` para o
 * molde de uma confeccao aparecer na tela de outra. Com RLS, quem garante o
 * isolamento e o **banco**, e a consulta esquecida devolve vazio em vez de vazar.
 *
 * Postgres so. O SQLite local do Tauri nao tem RLS, e o motivo de isso ser
 * aceitavel esta em `src/executor.ts`.
 *
 * Rodar como superusuario nao testaria nada: superusuario **ignora** RLS. Os
 * testes assumem o papel `app` de proposito, que e o papel que a aplicacao usa.
 */
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ddl, ddlRls } from '../src/index.js';

const A = 'confeccao-a';
const B = 'confeccao-b';

const db = new PGlite();
afterAll(async () => {
  await db.close();
});

/** Roda como o papel da aplicacao, com o tenant da sessao definido. */
async function comoApp<T>(tenantId: string | null, acao: () => Promise<T>): Promise<T> {
  await db.exec('SET ROLE app');
  if (tenantId === null) await db.exec(`RESET app.tenant_id`);
  else await db.exec(`SET app.tenant_id = '${tenantId}'`);
  try {
    return await acao();
  } finally {
    await db.exec('RESET ROLE');
  }
}

beforeAll(async () => {
  for (const comando of ddl('postgres')) await db.exec(comando);
  for (const comando of ddlRls()) await db.exec(comando);

  // FORCE: sem isso o RLS nao vale para o DONO da tabela.
  await db.exec('ALTER TABLE evento FORCE ROW LEVEL SECURITY');
  await db.exec('ALTER TABLE snapshot FORCE ROW LEVEL SECURITY');

  await db.exec(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
        CREATE ROLE app NOLOGIN;
      END IF;
    END $$;
  `);
  await db.exec('GRANT SELECT, INSERT, UPDATE ON evento, snapshot TO app');

  // Semeia uma linha de cada tenant, como superusuario (que ignora RLS).
  for (const [tenant, id] of [
    [A, '01JXAA0001'],
    [B, '01JXBB0001'],
  ]) {
    await db.query(
      `INSERT INTO evento
         (id, tenant_id, modelo_id, peca_id, tipo, payload, ocorrido_em, autor, versao_schema)
       VALUES ($1, $2, 'mod-1', NULL, 'CriarModelo', $3, $4, 'teste', 1)`,
      [id, tenant, { nome: `Modelo de ${tenant}` }, '2026-09-04T12:00:00.000Z'],
    );
  }
});

describe('RLS por tenant (Postgres)', () => {
  it('cada tenant so enxerga as proprias linhas, mesmo numa consulta SEM filtro', async () => {
    // A consulta e de proposito um `SELECT *` sem `WHERE`: e o bug que o RLS pega.
    const doA = await comoApp(A, () => db.query('SELECT id, tenant_id FROM evento'));
    const doB = await comoApp(B, () => db.query('SELECT id, tenant_id FROM evento'));

    console.log('--- RLS: SELECT sem WHERE, de proposito ---');
    console.log(`sessao do tenant A ve: ${JSON.stringify(doA.rows)}`);
    console.log(`sessao do tenant B ve: ${JSON.stringify(doB.rows)}`);

    expect(doA.rows).toHaveLength(1);
    expect(doB.rows).toHaveLength(1);
    expect((doA.rows[0] as { tenant_id: string }).tenant_id).toBe(A);
    expect((doB.rows[0] as { tenant_id: string }).tenant_id).toBe(B);
  });

  it('sem `app.tenant_id` na sessao, a politica FECHA: nao ve nada', async () => {
    const semTenant = await comoApp(null, () => db.query('SELECT id FROM evento'));
    console.log(`sessao sem app.tenant_id ve ${semTenant.rows.length} linha(s) — falha FECHADA`);
    expect(semTenant.rows).toHaveLength(0);
  });

  it('a politica tambem impede GRAVAR na conta de outro tenant (WITH CHECK)', async () => {
    let recusou = false;
    let mensagem = '';
    try {
      await comoApp(A, () =>
        db.query(
          `INSERT INTO evento
             (id, tenant_id, modelo_id, peca_id, tipo, payload, ocorrido_em, autor, versao_schema)
           VALUES ('01JXCC0001', $1, 'mod-1', NULL, 'CriarModelo', $2, $3, 'invasor', 1)`,
          [B, { nome: 'invadido' }, '2026-09-04T12:00:00.000Z'],
        ),
      );
    } catch (erro) {
      recusou = true;
      mensagem = erro instanceof Error ? erro.message : String(erro);
    }
    console.log(`tenant A tentando gravar como tenant B -> recusado: ${recusou}`);
    console.log(`  ${mensagem.split('\n')[0]}`);
    expect(recusou).toBe(true);
    expect(mensagem.toLowerCase()).toContain('row-level security');
  });

  it('o superusuario ignora RLS — e por isso a aplicacao NAO deve conectar como um', async () => {
    const comoDono = await db.query('SELECT id, tenant_id FROM evento ORDER BY id');
    console.log(
      `superusuario ve ${comoDono.rows.length} linhas (as duas empresas). ` +
        `A aplicacao conecta como "app", nao como dono.`,
    );
    expect(comoDono.rows).toHaveLength(2);
  });
});
