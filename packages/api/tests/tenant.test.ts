/**
 * De onde vem o tenant (inegociavel 6).
 *
 * Os tokens aqui sao ASSINADOS de verdade, com a mesma biblioteca que verifica.
 * Um token falso montado a mao provaria que o codigo le um objeto; o que precisa
 * ser provado e que **assinatura errada nao passa** — e isso so um token assinado
 * de verdade demonstra.
 */
import { PGlite } from '@electric-sql/pglite';
import { SignJWT } from 'jose';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { executorPostgres, RepositorioDeEventos } from '@cad/persistencia';

import { criarServidor, tenantDeDesenvolvimento, tenantPorJwt } from '../src/index.js';

const SEGREDO = new TextEncoder().encode('segredo-de-teste-com-tamanho-suficiente-123456');
const OUTRO_SEGREDO = new TextEncoder().encode('outro-segredo-completamente-diferente-7890');
const CLAIM = 'tenant_id';
const TENANT = 'confeccao-a';
const EMISSOR = 'https://auth.exemplo';

const db = new PGlite();
afterAll(async () => {
  await db.close();
});

let repo: RepositorioDeEventos;
beforeEach(async () => {
  await db.exec('DROP TABLE IF EXISTS evento; DROP TABLE IF EXISTS snapshot;');
  repo = new RepositorioDeEventos(executorPostgres(db));
  await repo.criarEsquema();
});

function comJwt(extra: Partial<Parameters<typeof tenantPorJwt>[0]> = {}): FastifyInstance {
  return criarServidor({
    repositorio: repo,
    tenant: tenantPorJwt({ chave: SEGREDO, claim: CLAIM, ...extra }),
  });
}

interface OpcoesDeToken {
  readonly chave?: Uint8Array;
  readonly claims?: Record<string, unknown>;
  readonly emissor?: string;
  readonly expiraEm?: string;
}

async function assinar(opcoes: OpcoesDeToken = {}): Promise<string> {
  let token = new SignJWT({ [CLAIM]: TENANT, ...opcoes.claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(opcoes.expiraEm ?? '5m');
  if (opcoes.emissor !== undefined) token = token.setIssuer(opcoes.emissor);
  return token.sign(opcoes.chave ?? SEGREDO);
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('Tenant por JWT — producao', () => {
  it('token valido passa, e o tenant vem do claim assinado', async () => {
    const app = comJwt();
    const resposta = await app.inject({
      url: '/modelos/mod-1',
      headers: bearer(await assinar()),
    });
    // 404 e o certo: o token vale, e simplesmente nao ha snapshot desse modelo.
    console.log(`--- JWT ---`);
    console.log(`token valido -> ${resposta.statusCode} (404 = autorizado, modelo vazio)`);
    expect(resposta.statusCode).toBe(404);
  });

  it('assinatura de OUTRA chave e recusada', async () => {
    const app = comJwt();
    const resposta = await app.inject({
      url: '/modelos/mod-1',
      headers: bearer(await assinar({ chave: OUTRO_SEGREDO })),
    });
    const corpo = resposta.json() as { codigo: string; mensagem: string };
    console.log(`token assinado com outra chave -> ${resposta.statusCode} ${corpo.codigo}`);
    console.log(`  "${corpo.mensagem}" — de proposito nao diz qual checagem falhou`);
    expect(resposta.statusCode).toBe(403);
    expect(corpo.mensagem).toContain('Token invalido');
  });

  it('token expirado e recusado', async () => {
    const app = comJwt();
    const expirado = await new SignJWT({ [CLAIM]: TENANT })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(SEGREDO);
    const resposta = await app.inject({ url: '/modelos/mod-1', headers: bearer(expirado) });
    console.log(`token expirado ha 1 hora -> ${resposta.statusCode}`);
    expect(resposta.statusCode).toBe(403);
  });

  it('emissor errado e recusado quando o emissor e exigido', async () => {
    const app = comJwt({ emissor: EMISSOR });
    const certo = await app.inject({
      url: '/modelos/mod-1',
      headers: bearer(await assinar({ emissor: EMISSOR })),
    });
    const errado = await app.inject({
      url: '/modelos/mod-1',
      headers: bearer(await assinar({ emissor: 'https://outro.emissor' })),
    });
    console.log(`emissor certo -> ${certo.statusCode} | emissor errado -> ${errado.statusCode}`);
    expect(certo.statusCode).toBe(404);
    expect(errado.statusCode).toBe(403);
  });

  it('token sem o claim do tenant e recusado — o backend nao adivinha a empresa', async () => {
    const app = comJwt();
    const semClaim = await new SignJWT({ sub: 'usuario-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(SEGREDO);
    const resposta = await app.inject({ url: '/modelos/mod-1', headers: bearer(semClaim) });
    const corpo = resposta.json() as { mensagem: string };
    console.log(`token sem o claim "${CLAIM}" -> ${resposta.statusCode}`);
    console.log(`  ${corpo.mensagem}`);
    expect(resposta.statusCode).toBe(403);
    expect(corpo.mensagem).toContain(CLAIM);
  });

  it('sem Authorization, e com x-tenant-id, continua recusado', async () => {
    const app = comJwt();
    const semNada = await app.inject({ url: '/modelos/mod-1' });
    // O cabecalho antigo NAO e mais aceito: e o buraco que esta parte fechou.
    const comCabecalhoAntigo = await app.inject({
      url: '/modelos/mod-1',
      headers: { 'x-tenant-id': 'confeccao-b' },
    });
    console.log(`sem Authorization        -> ${semNada.statusCode}`);
    console.log(`so com x-tenant-id       -> ${comCabecalhoAntigo.statusCode} (o buraco fechou)`);
    expect(semNada.statusCode).toBe(403);
    expect(comCabecalhoAntigo.statusCode).toBe(403);
  });

  it('dois tenants com tokens proprios nao se enxergam', async () => {
    const app = comJwt();
    const tokenA = await assinar({ claims: { [CLAIM]: 'confeccao-a' } });
    const tokenB = await assinar({ claims: { [CLAIM]: 'confeccao-b' } });

    const eventos = [
      {
        id: '01JXAA0000',
        tenantId: 'confeccao-a',
        modeloId: 'mod-1',
        pecaId: null,
        timestamp: '2026-09-04T12:00:00.000Z',
        autor: 'a',
        versaoSchema: 1,
        tipo: 'CriarModelo',
        payload: { nome: 'Camisa de A', tamanhos: ['M'], tamanhoBase: 'M' },
      },
    ];
    const gravou = await app.inject({
      method: 'POST',
      url: '/modelos/mod-1/eventos',
      headers: bearer(tokenA),
      payload: { eventos },
    });
    const leA = await app.inject({ url: '/modelos/mod-1', headers: bearer(tokenA) });
    const leB = await app.inject({ url: '/modelos/mod-1', headers: bearer(tokenB) });

    console.log(`A grava -> ${gravou.statusCode} | A le -> ${leA.statusCode} | B le -> ${leB.statusCode}`);
    expect(gravou.statusCode).toBe(201);
    expect(leA.statusCode).toBe(200);
    expect(leB.statusCode).toBe(404);
  });
});

describe('Tenant de desenvolvimento — existe, mas grita', () => {
  it('funciona pelo cabecalho e se declara como so para desenvolvimento', () => {
    const estrategia = tenantDeDesenvolvimento();
    console.log(
      `estrategia "${estrategia.nome}" | apenasDesenvolvimento=${estrategia.apenasDesenvolvimento}`,
    );
    expect(estrategia.apenasDesenvolvimento).toBe(true);
    expect(estrategia.nome).toContain('DESENVOLVIMENTO');
  });

  it('a de JWT NAO se declara como de desenvolvimento', () => {
    const estrategia = tenantPorJwt({ chave: SEGREDO, claim: CLAIM });
    console.log(`estrategia "${estrategia.nome}" | apenasDesenvolvimento=${estrategia.apenasDesenvolvimento}`);
    expect(estrategia.apenasDesenvolvimento).toBe(false);
  });
});
