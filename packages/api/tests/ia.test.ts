/**
 * A rota /ia/chamar: a chave mora no SERVIDOR, o navegador nunca a ve.
 *
 * Era o item 1.1 da revisao de usabilidade: chave de provedor em localStorage
 * numa maquina de chao de fabrica e a chave da empresa aberta no console. Aqui
 * fica provado que (1) a chave configurada no servidor vai no cabecalho ao
 * provedor e NUNCA volta na resposta, (2) sem chave a rota diz qual variavel
 * falta, (3) provedor desconhecido e pedido torto sao recusados com codigo, e
 * (4) a rota exige tenant como qualquer outra.
 */
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { executorPostgres, RepositorioDeEventos } from '@cad/persistencia';

import { criarServidor, tenantDeDesenvolvimento } from '../src/index.js';

const TENANT = 'confeccao-a';
const comTenant = { 'x-tenant-id': TENANT, 'content-type': 'application/json' };

/** Resposta crua no formato da Anthropic, que o adaptador sabe ler. */
const RESPOSTA_ANTHROPIC = {
  content: [{ type: 'text', text: 'A peça tem 4 arestas.' }],
  stop_reason: 'end_turn',
};

const PEDIDO = {
  modelo: 'claude-sonnet-5',
  instrucoes: 'Voce opera um CAD.',
  ferramentas: [],
  conversa: [{ papel: 'pessoa', texto: 'quantas arestas tem a peca?' }],
};

const pg = new PGlite();
let app: FastifyInstance;
let repo: RepositorioDeEventos;
let capturado: { url: string; cabecalhos: Record<string, string>; corpo: string } | null = null;

function buscarFalso(ok: boolean, corpo: unknown): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    capturado = {
      url: String(url),
      cabecalhos: (init?.headers ?? {}) as Record<string, string>,
      corpo: String(init?.body ?? ''),
    };
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => corpo,
      text: async () => JSON.stringify(corpo),
    } as Response;
  }) as typeof fetch;
}

function servidor(ia: Parameters<typeof criarServidor>[0]['ia']): FastifyInstance {
  return criarServidor({ repositorio: repo, tenant: tenantDeDesenvolvimento(), ia });
}

beforeEach(async () => {
  capturado = null;
  await pg.exec('DROP TABLE IF EXISTS evento; DROP TABLE IF EXISTS snapshot;');
  repo = new RepositorioDeEventos(executorPostgres(pg));
  await repo.criarEsquema();
});
afterAll(async () => {
  await pg.close();
});

describe('POST /ia/chamar', () => {
  it('poe a chave do servidor no cabecalho ao provedor, e ela NAO volta na resposta', async () => {
    app = servidor({
      chaves: { anthropic: 'sk-segredo-do-servidor' },
      buscar: buscarFalso(true, RESPOSTA_ANTHROPIC),
    });
    const r = await app.inject({
      method: 'POST',
      url: '/ia/chamar',
      headers: comTenant,
      payload: { provedorId: 'anthropic', pedido: PEDIDO },
    });
    expect(r.statusCode).toBe(200);
    // A ida: chave no cabecalho do PROVEDOR, montada pelo adaptador de sempre.
    expect(capturado!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(capturado!.cabecalhos['x-api-key']).toBe('sk-segredo-do-servidor');
    // A volta: formato neutro, e nem sinal da chave.
    const corpo = r.json() as { texto: string; chamadas: unknown[] };
    expect(corpo.texto).toBe('A peça tem 4 arestas.');
    expect(r.body.includes('sk-segredo-do-servidor')).toBe(false);
    console.log(`resposta neutra: "${corpo.texto}" — e a chave nao aparece no corpo`);
  });

  it('sem a chave do provedor, 503 dizendo QUAL variavel configurar', async () => {
    app = servidor({ chaves: {}, buscar: buscarFalso(true, RESPOSTA_ANTHROPIC) });
    const r = await app.inject({
      method: 'POST',
      url: '/ia/chamar',
      headers: comTenant,
      payload: { provedorId: 'anthropic', pedido: PEDIDO },
    });
    expect(r.statusCode).toBe(503);
    expect(r.json().codigo).toBe('IA_SEM_CHAVE');
    expect(r.json().mensagem).toContain('IA_CHAVE_ANTHROPIC');
    expect(capturado).toBeNull(); // nem tentou falar com o provedor
  });

  it('provedor desconhecido e 400; pedido sem conversa e 400', async () => {
    app = servidor({ chaves: { anthropic: 'x' }, buscar: buscarFalso(true, {}) });
    const semProvedor = await app.inject({
      method: 'POST',
      url: '/ia/chamar',
      headers: comTenant,
      payload: { provedorId: 'skynet', pedido: PEDIDO },
    });
    expect(semProvedor.statusCode).toBe(400);
    expect(semProvedor.json().codigo).toBe('PROVEDOR_DESCONHECIDO');

    const torto = await app.inject({
      method: 'POST',
      url: '/ia/chamar',
      headers: comTenant,
      payload: { provedorId: 'anthropic', pedido: { modelo: 'x' } },
    });
    expect(torto.statusCode).toBe(400);
    expect(torto.json().codigo).toBe('PEDIDO_INVALIDO');
  });

  it('provedor caido vira 502 com o inicio do corpo — sem cabecalho, sem chave', async () => {
    app = servidor({
      chaves: { anthropic: 'sk-nao-vaza' },
      buscar: buscarFalso(false, { error: 'overloaded' }),
    });
    const r = await app.inject({
      method: 'POST',
      url: '/ia/chamar',
      headers: comTenant,
      payload: { provedorId: 'anthropic', pedido: PEDIDO },
    });
    expect(r.statusCode).toBe(502);
    expect(r.json().codigo).toBe('PROVEDOR_FALHOU');
    expect(r.body.includes('sk-nao-vaza')).toBe(false);
  });

  it('sem tenant nao passa: a rota de IA se autentica como as outras', async () => {
    app = servidor({ chaves: { anthropic: 'x' }, buscar: buscarFalso(true, {}) });
    const r = await app.inject({
      method: 'POST',
      url: '/ia/chamar',
      headers: { 'content-type': 'application/json' },
      payload: { provedorId: 'anthropic', pedido: PEDIDO },
    });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(r.statusCode).toBeLessThan(500);
    expect(capturado).toBeNull();
  });
});
