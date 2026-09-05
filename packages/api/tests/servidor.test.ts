/**
 * Backend Fastify: persistir e ler eventos.
 *
 * Roda contra Postgres de verdade (PGlite) e usa `app.inject` — sem abrir porta,
 * sem servidor de verdade, e ainda assim passando pelo roteamento, pela
 * serializacao JSON e pelo tratador de erro do Fastify. E o caminho completo que
 * o editor da Fase 2 vai percorrer.
 */
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { MM, type Evento, type PropriedadesEncaixe } from '@cad/motor';
import { executorPostgres, RepositorioDeEventos } from '@cad/persistencia';

import { criarServidor, tenantDeDesenvolvimento } from '../src/index.js';

const TENANT = 'confeccao-a';
const OUTRO = 'confeccao-b';
const MODELO = 'mod-0001';
const PECA = 'pec-0001';

const ENCAIXE: PropriedadesEncaixe = {
  quantidadePorModelo: 1,
  giro: 'livre',
  faixaGiroGraus: 0,
  par: false,
  espelhado: false,
  dobraHorizontal: false,
  dobraVertical: false,
};

function log(tenantId = TENANT): Evento[] {
  let n = 0;
  const envelope = (pecaId: string | null) => ({
    id: `01JX${tenantId === TENANT ? 'AA' : 'BB'}${String(n++).padStart(4, '0')}`,
    tenantId,
    modeloId: MODELO,
    pecaId,
    timestamp: '2026-09-04T12:00:00.000Z',
    autor: 'modelista',
    versaoSchema: 1,
  });
  const cantos = [
    { x: 0, y: 0 },
    { x: 100 * MM, y: 0 },
    { x: 100 * MM, y: 200 * MM },
    { x: 0, y: 200 * MM },
  ];
  const eventos: Evento[] = [
    {
      ...envelope(null),
      tipo: 'CriarModelo',
      payload: { nome: 'Camisa', tamanhos: ['P', 'M', 'G'], tamanhoBase: 'M' },
    },
    { ...envelope(PECA), tipo: 'CriarPeca', payload: { nome: 'FRENTE', encaixe: ENCAIXE } },
  ];
  cantos.forEach((c, i) =>
    eventos.push({
      ...envelope(PECA),
      tipo: 'CriarPonto',
      payload: { pontoId: `pt-${i}`, x: c.x, y: c.y, tipo: 'contorno' },
    }),
  );
  cantos.forEach((_, i) =>
    eventos.push({
      ...envelope(PECA),
      tipo: 'DefinirAresta',
      payload: { arestaId: `ar-${i}`, pontoInicioId: `pt-${i}`, pontoFimId: `pt-${(i + 1) % 4}` },
    }),
  );
  cantos.forEach((_, i) =>
    eventos.push({
      ...envelope(PECA),
      tipo: 'DefinirSegmento',
      payload: {
        segmentoId: `sg-${i}`,
        arestaId: `ar-${i}`,
        de: `pt-${i}`,
        para: `pt-${(i + 1) % 4}`,
        tipo: 'reta',
      },
    }),
  );
  cantos.forEach((_, i) =>
    eventos.push({
      ...envelope(PECA),
      tipo: 'DefinirMargem',
      payload: { arestaId: `ar-${i}`, margemUM: 10 * MM },
    }),
  );
  return eventos;
}

const db = new PGlite();
afterAll(async () => {
  await db.close();
});

let app: FastifyInstance;
let repo: RepositorioDeEventos;

beforeEach(async () => {
  await db.exec('DROP TABLE IF EXISTS evento; DROP TABLE IF EXISTS snapshot;');
  repo = new RepositorioDeEventos(executorPostgres(db));
  await repo.criarEsquema();
  app = criarServidor({ repositorio: repo, tenant: tenantDeDesenvolvimento() });
});

const comTenant = (tenantId = TENANT) => ({ 'x-tenant-id': tenantId });

describe('API — persistir e ler eventos', () => {
  it('POST grava o log e ja devolve o estado reconstruido', async () => {
    const eventos = log();
    const resposta = await app.inject({
      method: 'POST',
      url: `/modelos/${MODELO}/eventos`,
      headers: comTenant(),
      payload: { eventos },
    });
    const corpo = resposta.json() as { novos: number; recebidos: number; estado: unknown };

    console.log('--- POST /modelos/:id/eventos ---');
    console.log(`status ${resposta.statusCode} | novos ${corpo.novos} de ${corpo.recebidos}`);
    const estado = corpo.estado as { nome: string; pecas: Record<string, { pontos: object }> };
    console.log(
      `estado devolvido: modelo "${estado.nome}" com ` +
        `${Object.keys(estado.pecas[PECA]!.pontos).length} pontos na peca`,
    );

    expect(resposta.statusCode).toBe(201);
    expect(corpo.novos).toBe(eventos.length);
    expect(Object.keys(estado.pecas[PECA]!.pontos)).toHaveLength(4);
  });

  it('GET do modelo devolve o snapshot; GET dos eventos devolve o log na ordem', async () => {
    await app.inject({
      method: 'POST',
      url: `/modelos/${MODELO}/eventos`,
      headers: comTenant(),
      payload: { eventos: log() },
    });

    const snapshot = await app.inject({ url: `/modelos/${MODELO}`, headers: comTenant() });
    const doLog = await app.inject({ url: `/modelos/${MODELO}/eventos`, headers: comTenant() });
    const eventos = (doLog.json() as { eventos: Evento[] }).eventos;

    console.log(`GET /modelos/${MODELO}          -> ${snapshot.statusCode}`);
    console.log(
      `GET /modelos/${MODELO}/eventos  -> ${doLog.statusCode}, ${eventos.length} eventos, ` +
        `de ${eventos[0]!.id} a ${eventos[eventos.length - 1]!.id}`,
    );
    expect(snapshot.statusCode).toBe(200);
    expect(eventos).toHaveLength(log().length);
    expect([...eventos].map((e) => e.id)).toEqual([...eventos].map((e) => e.id).sort());
  });

  it('GET /integridade responde 200 quando o snapshot bate com o log', async () => {
    await app.inject({
      method: 'POST',
      url: `/modelos/${MODELO}/eventos`,
      headers: comTenant(),
      payload: { eventos: log() },
    });
    const resposta = await app.inject({
      url: `/modelos/${MODELO}/integridade`,
      headers: comTenant(),
    });
    const corpo = resposta.json() as { bate: boolean; eventos: number; ateEventoId: string };
    console.log(
      `GET /integridade -> ${resposta.statusCode} | bate ${corpo.bate}, ` +
        `${corpo.eventos} eventos ate ${corpo.ateEventoId}`,
    );
    expect(resposta.statusCode).toBe(200);
    expect(corpo.bate).toBe(true);
  });

  it('um tenant nao le o modelo do outro pela API', async () => {
    await app.inject({
      method: 'POST',
      url: `/modelos/${MODELO}/eventos`,
      headers: comTenant(TENANT),
      payload: { eventos: log(TENANT) },
    });

    const doDono = await app.inject({ url: `/modelos/${MODELO}`, headers: comTenant(TENANT) });
    const doOutro = await app.inject({ url: `/modelos/${MODELO}`, headers: comTenant(OUTRO) });

    console.log(`dono le  -> ${doDono.statusCode}`);
    console.log(`outro le -> ${doOutro.statusCode} (${(doOutro.json() as { codigo: string }).codigo})`);
    expect(doDono.statusCode).toBe(200);
    expect(doOutro.statusCode).toBe(404);
  });

  it('recusa requisicao sem x-tenant-id com 403', async () => {
    const resposta = await app.inject({ url: `/modelos/${MODELO}` });
    const corpo = resposta.json() as { codigo: string; mensagem: string };
    console.log(`sem x-tenant-id -> ${resposta.statusCode} ${corpo.codigo}`);
    console.log(`  ${corpo.mensagem}`);
    expect(resposta.statusCode).toBe(403);
  });

  it('recusa evento cujo tenant nao e o da sessao', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: `/modelos/${MODELO}/eventos`,
      headers: comTenant(OUTRO),
      payload: { eventos: log(TENANT) },
    });
    const corpo = resposta.json() as { codigo: string };
    console.log(`evento do tenant A gravado na sessao de B -> ${resposta.statusCode} ${corpo.codigo}`);
    expect(resposta.statusCode).toBe(403);
    expect(corpo.codigo).toBe('EVENTO_DE_OUTRO_TENANT');
  });

  it('erro do MOTOR chega ao cliente com o codigo dele, nao como 500', async () => {
    // Log que comeca sem CriarModelo: o fold recusa.
    const quebrado = log().slice(1);
    const resposta = await app.inject({
      method: 'POST',
      url: `/modelos/${MODELO}/eventos`,
      headers: comTenant(),
      payload: { eventos: quebrado },
    });
    const corpo = resposta.json() as { codigo: string; mensagem: string };
    console.log(`log sem CriarModelo -> ${resposta.statusCode} ${corpo.codigo}`);
    console.log(`  ${corpo.mensagem.slice(0, 120)}`);
    expect(resposta.statusCode).toBeLessThan(500);
    expect(corpo.codigo).toBe('PECA_INEXISTENTE');
  });

  it('modelo inexistente da 404, e corpo sem eventos da 400', async () => {
    const inexistente = await app.inject({ url: '/modelos/mod-nao-existe', headers: comTenant() });
    const semEventos = await app.inject({
      method: 'POST',
      url: `/modelos/${MODELO}/eventos`,
      headers: comTenant(),
      payload: { eventos: [] },
    });
    console.log(`GET modelo inexistente -> ${inexistente.statusCode}`);
    console.log(`POST sem eventos       -> ${semEventos.statusCode}`);
    expect(inexistente.statusCode).toBe(404);
    expect(semEventos.statusCode).toBe(400);
  });

  it('reenviar o mesmo lote e no-op: o log nao duplica', async () => {
    const eventos = log();
    const primeira = await app.inject({
      method: 'POST',
      url: `/modelos/${MODELO}/eventos`,
      headers: comTenant(),
      payload: { eventos },
    });
    const segunda = await app.inject({
      method: 'POST',
      url: `/modelos/${MODELO}/eventos`,
      headers: comTenant(),
      payload: { eventos },
    });
    const doLog = await app.inject({ url: `/modelos/${MODELO}/eventos`, headers: comTenant() });

    console.log(
      `1o POST: ${(primeira.json() as { novos: number }).novos} novos | ` +
        `2o POST (retry): ${(segunda.json() as { novos: number }).novos} novos | ` +
        `log tem ${(doLog.json() as { eventos: Evento[] }).eventos.length}`,
    );
    expect((segunda.json() as { novos: number }).novos).toBe(0);
    expect((doLog.json() as { eventos: Evento[] }).eventos).toHaveLength(eventos.length);
  });

  it('/saude responde sem tenant', async () => {
    const resposta = await app.inject({ url: '/saude' });
    console.log(`GET /saude -> ${resposta.statusCode} ${resposta.body}`);
    expect(resposta.statusCode).toBe(200);
  });
});
