/**
 * Backend Fastify (entrega da Parte 0): persiste e le eventos. Nada mais.
 *
 * Nao ha geometria aqui. O motor e puro e roda igual no Node, no browser e dentro
 * do Tauri; se esta camada comecasse a calcular offset ou graduacao, existiriam
 * duas verdades sobre a mesma peca. O que a API faz e: receber evento, gravar,
 * devolver estado.
 *
 * ## De onde vem o tenant
 * De uma `EstrategiaDeTenant` que quem monta o servidor **precisa escolher** — nao
 * ha padrao. Em producao, `tenantPorJwt`: o tenant sai de um claim do token
 * assinado, que o cliente nao forja. Em desenvolvimento,
 * `tenantDeDesenvolvimento`, que le o cabecalho `x-tenant-id` e faz o servidor
 * avisar no log a cada subida.
 *
 * O desenho e de falha FECHADA: nao escolher nao compila, e escolher a de
 * desenvolvimento grita. Antes o cabecalho era o caminho padrao e silencioso — o
 * que significava que publicar sem autenticacao era o comportamento normal.
 *
 * ## Por que o snapshot e regravado a cada POST
 * O snapshot e cache derivado do log. Regravar no mesmo passo do append mantem os
 * dois sempre em dia, e `GET /integridade` prova isso a qualquer momento. Se um
 * dia isso ficar caro, o lugar de mudar e aqui — no motor nao muda nada.
 */
import Fastify, { type FastifyInstance } from 'fastify';

import { acharProvedor, type Pedido } from '@cad/ia';
import type { Evento } from '@cad/motor';
import type { RepositorioDeEventos } from '@cad/persistencia';

import type { EstrategiaDeTenant } from './tenant.js';

export interface OpcoesDaIa {
  /**
   * Chave por provedor (`anthropic`, `openai`, `google`, `compativel`). O padrao
   * le `IA_CHAVE_ANTHROPIC` etc. do ambiente — a chave mora no SERVIDOR, nunca
   * desce ao navegador (era o item 1.1 da revisao: chave em localStorage numa
   * maquina de chao de fabrica e chave exposta).
   */
  readonly chaves?: Readonly<Record<string, string>>;
  /** Base do provedor "compativel" (`IA_BASE_COMPATIVEL` no ambiente). */
  readonly bases?: Readonly<Record<string, string>>;
  /** Trocavel nos testes; em producao e o fetch global do Node. */
  readonly buscar?: typeof fetch;
}

export interface OpcoesDoServidor {
  readonly repositorio: RepositorioDeEventos;
  /** Obrigatoria: sem estrategia nao ha como saber de quem e a requisicao. */
  readonly tenant: EstrategiaDeTenant;
  /** `true` liga o log de requisicao do Fastify. Desligado nos testes. */
  readonly registrar?: boolean;
  /** Configuracao do encaminhamento de IA. Sem chave nenhuma, a rota diz isso. */
  readonly ia?: OpcoesDaIa;
}

interface CorpoDeIa {
  readonly provedorId: string;
  readonly pedido: Pedido;
}

interface ParamsDoModelo {
  readonly modeloId: string;
}

interface CorpoDeEventos {
  readonly eventos: readonly Evento[];
}

export function criarServidor(opcoes: OpcoesDoServidor): FastifyInstance {
  const app = Fastify({ logger: opcoes.registrar === true });
  const repo = opcoes.repositorio;
  const tenantDaRequisicao = (requisicao: Parameters<EstrategiaDeTenant['resolver']>[0]) =>
    opcoes.tenant.resolver(requisicao);

  if (opcoes.tenant.apenasDesenvolvimento) {
    app.log.warn(
      `ATENCAO: estrategia de tenant "${opcoes.tenant.nome}" — o cliente escolhe de que ` +
        `empresa ele e. NAO publique assim: qualquer um le o molde de qualquer confeccao.`,
    );
  }

  /**
   * Erro do dominio vira 4xx com o codigo; qualquer outro vira 500 sem detalhe.
   * O codigo do `ErroDePersistencia` e do `ErroMotor` e estavel e feito para o
   * chamador decidir — e a mensagem foi escrita para um humano ler.
   */
  app.setErrorHandler((erro: unknown, _requisicao, resposta) => {
    const codigo = (erro as { codigo?: string }).codigo;
    if (typeof codigo === 'string') {
      const status = codigo.includes('OUTRO_TENANT') ? 403 : statusDoCodigo(codigo);
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      return resposta.status(status).send({ codigo, mensagem });
    }
    app.log.error(erro);
    return resposta.status(500).send({ codigo: 'ERRO_INTERNO', mensagem: 'Erro interno.' });
  });

  app.get('/saude', () => ({ ok: true }));

  /** Anexa eventos ao log do modelo e regrava o snapshot. */
  app.post<{ Params: ParamsDoModelo; Body: CorpoDeEventos }>(
    '/modelos/:modeloId/eventos',
    async (requisicao, resposta) => {
      const tenantId = await tenantDaRequisicao(requisicao);
      const { modeloId } = requisicao.params;
      const eventos = requisicao.body?.eventos;

      if (!Array.isArray(eventos) || eventos.length === 0) {
        return resposta.status(400).send({
          codigo: 'CORPO_SEM_EVENTOS',
          mensagem: 'O corpo precisa ter { "eventos": [...] } com pelo menos um evento.',
        });
      }

      const novos = await repo.anexar(tenantId, modeloId, eventos);
      const estado = await repo.gravarSnapshot(tenantId, modeloId);
      return resposta.status(201).send({ novos, recebidos: eventos.length, estado });
    },
  );

  /** Estado atual do modelo, direto do snapshot. */
  app.get<{ Params: ParamsDoModelo }>('/modelos/:modeloId', async (requisicao, resposta) => {
    const tenantId = await tenantDaRequisicao(requisicao);
    const estado = await repo.lerSnapshot(tenantId, requisicao.params.modeloId);
    if (estado === null) {
      return resposta.status(404).send({
        codigo: 'SNAPSHOT_AUSENTE',
        mensagem: `Nao ha snapshot do modelo "${requisicao.params.modeloId}" para este tenant.`,
      });
    }
    return estado;
  });

  /** O log inteiro, na ordem do ULID. E ele que o sync da Fase 10 vai consumir. */
  app.get<{ Params: ParamsDoModelo }>('/modelos/:modeloId/eventos', async (requisicao) => {
    const tenantId = await tenantDaRequisicao(requisicao);
    const eventos = await repo.lerLog(tenantId, requisicao.params.modeloId);
    return { eventos };
  });

  /**
   * Encaminha UMA chamada de IA ao provedor, com a chave do ambiente.
   *
   * O navegador manda o pedido neutro (instrucoes, ferramentas, conversa) e o
   * provedor escolhido; quem poe a chave e fala com o provedor e o servidor.
   * A resposta volta ja lida no formato neutro (`Resposta` do @cad/ia), entao o
   * cliente nem sabe o formato bruto do provedor. Erro do provedor volta com o
   * status dele e o INICIO do corpo — o suficiente para diagnosticar sem vazar
   * cabecalho nem chave.
   */
  app.post<{ Body: CorpoDeIa }>('/ia/chamar', async (requisicao, resposta) => {
    await tenantDaRequisicao(requisicao); // autentica; a conversa em si nao e persistida
    const { provedorId, pedido } = requisicao.body ?? {};
    const provedor = acharProvedor(String(provedorId ?? ''));
    if (provedor === null) {
      return resposta.status(400).send({
        codigo: 'PROVEDOR_DESCONHECIDO',
        mensagem: `Nao existe o provedor "${String(provedorId)}".`,
      });
    }
    if (pedido === undefined || typeof pedido.modelo !== 'string' || !Array.isArray(pedido.conversa)) {
      return resposta.status(400).send({
        codigo: 'PEDIDO_INVALIDO',
        mensagem: 'O corpo precisa de { provedorId, pedido: { modelo, instrucoes, ferramentas, conversa } }.',
      });
    }

    const chaves = opcoes.ia?.chaves ?? chavesDoAmbiente();
    const chave = chaves[provedor.id];
    if (chave === undefined || chave === '') {
      return resposta.status(503).send({
        codigo: 'IA_SEM_CHAVE',
        mensagem:
          `O servidor nao tem a chave do provedor "${provedor.id}". Configure a variavel ` +
          `de ambiente IA_CHAVE_${provedor.id.toUpperCase()} e reinicie.`,
      });
    }

    const bases = opcoes.ia?.bases ?? basesDoAmbiente();
    const buscar = opcoes.ia?.buscar ?? fetch;
    const doProvedor = await buscar(provedor.url(pedido, chave, bases[provedor.id]), {
      method: 'POST',
      headers: provedor.cabecalhos(chave),
      body: JSON.stringify(provedor.corpo(pedido)),
    });
    if (!doProvedor.ok) {
      const corpo = await doProvedor.text();
      return resposta.status(502).send({
        codigo: 'PROVEDOR_FALHOU',
        mensagem: `${provedor.nome} respondeu ${doProvedor.status}: ${corpo.slice(0, 300)}`,
      });
    }
    return provedor.ler(await doProvedor.json());
  });

  /** Teste de integridade da Parte 4, sob demanda: log x snapshot. */
  app.get<{ Params: ParamsDoModelo }>(
    '/modelos/:modeloId/integridade',
    async (requisicao, resposta) => {
      const tenantId = await tenantDaRequisicao(requisicao);
      const integridade = await repo.conferirIntegridade(tenantId, requisicao.params.modeloId);
      // 409: o recurso existe, mas esta em estado inconsistente.
      return resposta.status(integridade.bate ? 200 : 409).send(integridade);
    },
  );

  return app;
}

/** IA_CHAVE_ANTHROPIC=sk-... vira { anthropic: 'sk-...' }. */
function chavesDoAmbiente(): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [nome, valor] of Object.entries(process.env)) {
    if (nome.startsWith('IA_CHAVE_') && valor !== undefined && valor !== '') {
      saida[nome.slice('IA_CHAVE_'.length).toLowerCase()] = valor;
    }
  }
  return saida;
}

function basesDoAmbiente(): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [nome, valor] of Object.entries(process.env)) {
    if (nome.startsWith('IA_BASE_') && valor !== undefined && valor !== '') {
      saida[nome.slice('IA_BASE_'.length).toLowerCase()] = valor;
    }
  }
  return saida;
}

function statusDoCodigo(codigo: string): number {
  if (codigo === 'LOG_VAZIO' || codigo === 'SNAPSHOT_AUSENTE') return 404;
  if (codigo === 'EVENTO_DIVERGENTE') return 409;
  return 400;
}
