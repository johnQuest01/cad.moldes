/**
 * Composicao: liga o driver do Neon ao repositorio e sobe o Fastify.
 *
 * Este arquivo e de proposito o mais burro do pacote — le variavel de ambiente,
 * monta os objetos, chama `listen`. Toda decisao esta em `servidor.ts` (rotas) e
 * em `@cad/persistencia` (SQL), que sao testados contra Postgres de verdade.
 *
 * **Nao tem teste automatizado**, e nao e descuido: e a unica parte que so faz
 * sentido contra uma instancia real do Neon, e nao ha uma disponivel aqui. O que
 * daria para testar dele — rota, erro, isolamento por tenant — ja esta testado em
 * `tests/servidor.test.ts` contra PGlite.
 *
 *     DATABASE_URL=postgres://... JWT_SEGREDO=... JWT_CLAIM_TENANT=tenant_id \
 *       PORT=3000 node dist/principal.js
 *
 * ## Sobre o papel do banco
 * A `DATABASE_URL` **nao deve** ser a de um superusuario: superusuario ignora RLS,
 * e o isolamento entre empresas passaria a depender so do `WHERE` das consultas.
 * Use o papel `app` do `ddlRls()`.
 */
import { Pool } from 'pg';

import { ddl, ddlRls, executorPostgres, RepositorioDeEventos } from '@cad/persistencia';

import { criarServidor } from './servidor.js';
import { tenantDeDesenvolvimento, tenantPorJwt, type EstrategiaDeTenant } from './tenant.js';

export async function principal(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL nao definida. Sem banco nao ha o que servir.');
  }
  const porta = Number(process.env['PORT'] ?? 3000);
  const criarEsquema = process.env['CRIAR_ESQUEMA'] === '1';

  const pool = new Pool({ connectionString: url });
  const repositorio = new RepositorioDeEventos(executorPostgres(pool));

  if (criarEsquema) {
    for (const comando of [...ddl('postgres'), ...ddlRls()]) {
      await pool.query(comando);
    }
  }

  const app = criarServidor({ repositorio, tenant: escolherEstrategia(), registrar: true });
  await app.listen({ port: porta, host: '0.0.0.0' });
}

/**
 * Escolhe a estrategia de tenant pelo ambiente, e RECUSA subir sem escolha.
 *
 * `JWT_SEGREDO` + `JWT_CLAIM_TENANT` liga a de producao. `TENANT_POR_CABECALHO=1`
 * liga a de desenvolvimento, de propria vontade e por escrito. Sem nenhum dos
 * dois o processo nao sobe — subir "aberto" tem que ser uma decisao, nunca o
 * caminho de menor resistencia.
 */
function escolherEstrategia(): EstrategiaDeTenant {
  const segredo = process.env['JWT_SEGREDO'];
  const claim = process.env['JWT_CLAIM_TENANT'];
  if (segredo !== undefined && segredo !== '' && claim !== undefined && claim !== '') {
    const emissor = process.env['JWT_EMISSOR'];
    const audiencia = process.env['JWT_AUDIENCIA'];
    return tenantPorJwt({
      chave: new TextEncoder().encode(segredo),
      claim,
      ...(emissor === undefined || emissor === '' ? {} : { emissor }),
      ...(audiencia === undefined || audiencia === '' ? {} : { audiencia }),
    });
  }
  if (process.env['TENANT_POR_CABECALHO'] === '1') return tenantDeDesenvolvimento();

  throw new Error(
    'Nenhuma estrategia de tenant configurada. Defina JWT_SEGREDO e JWT_CLAIM_TENANT para ' +
      'producao, ou TENANT_POR_CABECALHO=1 para desenvolvimento (inseguro: o cliente escolhe ' +
      'de que empresa ele e).',
  );
}

// Só executa quando este arquivo é o ponto de entrada, nunca ao ser importado.
if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  principal().catch((erro: unknown) => {
    console.error(erro);
    process.exit(1);
  });
}
