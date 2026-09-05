/**
 * De onde vem o tenant da requisicao.
 *
 * Esta era a unica falha de seguranca conhecida do backend: o tenant saia do
 * cabecalho `x-tenant-id`, que o cliente escolhe. Quem soubesse o nome de outra
 * confeccao lia o molde dela trocando uma string — e a inegociavel 6 existe
 * justamente para isso nao acontecer.
 *
 * ## O desenho: falha FECHADA
 * O servidor nao tem mais um jeito padrao de descobrir o tenant. Quem monta o
 * servidor **precisa escolher** uma estrategia, e a de cabecalho tem `dev` no
 * nome e um aviso no log toda vez que sobe. Nao ha caminho em que alguem publique
 * sem perceber: nao escolher nao compila, e escolher a de desenvolvimento grita.
 *
 * ## Duas estrategias, porque duas sao reais
 *  - `tenantPorJwt` — producao. O tenant sai de um claim do token ASSINADO, que o
 *    cliente nao pode forjar sem a chave.
 *  - `tenantDeDesenvolvimento` — o cabecalho de antes, agora explicito.
 *
 * A verificacao usa `jose` (sem dependencias) e aceita tanto segredo compartilhado
 * (HS256) quanto JWKS remoto — quem emite o token e decisao de produto, e por isso
 * entra como configuracao e nao como codigo.
 */
import { jwtVerify, type JWTPayload } from 'jose';
import type { FastifyRequest } from 'fastify';

import { ErroDePersistencia } from '@cad/persistencia';

/** Descobre o tenant de uma requisicao, ou estoura. */
export interface EstrategiaDeTenant {
  readonly nome: string;
  /** `true` faz o servidor avisar no log que nao pode ir para producao assim. */
  readonly apenasDesenvolvimento: boolean;
  resolver(requisicao: FastifyRequest): Promise<string>;
}

function semTenant(motivo: string): never {
  throw new ErroDePersistencia('EVENTO_DE_OUTRO_TENANT', motivo);
}

/** Exatamente o que o `jwtVerify` do jose aceita como chave — sem reescrever a lista. */
export type ChaveDeVerificacao = Parameters<typeof jwtVerify>[1];

/**
 * Producao: o tenant sai de um claim do JWT assinado.
 *
 * `chave` e o que `jose` aceita: um segredo (`Uint8Array`, para HS256), uma chave
 * publica, ou o retorno de `createRemoteJWKSet(url)` para JWKS.
 */
export interface OpcoesDeJwt {
  readonly chave: ChaveDeVerificacao;
  /** Claim que carrega o tenant. Sem padrao: cada emissor usa um nome. */
  readonly claim: string;
  readonly emissor?: string;
  readonly audiencia?: string;
}

export function tenantPorJwt(opcoes: OpcoesDeJwt): EstrategiaDeTenant {
  return {
    nome: `jwt(claim=${opcoes.claim})`,
    apenasDesenvolvimento: false,
    async resolver(requisicao) {
      const autorizacao = requisicao.headers.authorization;
      if (typeof autorizacao !== 'string' || !autorizacao.startsWith('Bearer ')) {
        semTenant(
          'Requisicao sem "Authorization: Bearer <token>". Toda leitura e toda escrita ' +
            'pertencem a uma empresa, e a empresa vem do token.',
        );
      }

      let dados: JWTPayload;
      try {
        const verificado = await jwtVerify(autorizacao.slice('Bearer '.length), opcoes.chave, {
          ...(opcoes.emissor === undefined ? {} : { issuer: opcoes.emissor }),
          ...(opcoes.audiencia === undefined ? {} : { audience: opcoes.audiencia }),
        });
        dados = verificado.payload;
      } catch (erro) {
        // O motivo exato (assinatura, expiracao, emissor) fica no servidor: dizer
        // ao cliente qual das checagens falhou ajuda quem esta tentando forjar.
        requisicao.log.warn({ erro }, 'token recusado');
        semTenant('Token invalido.');
      }

      const tenantId = dados[opcoes.claim];
      if (typeof tenantId !== 'string' || tenantId.trim() === '') {
        semTenant(
          `O token nao traz o claim "${opcoes.claim}" com o tenant. O backend nao adivinha ` +
            `a empresa a partir de outro campo.`,
        );
      }
      return tenantId;
    },
  };
}

/**
 * Desenvolvimento: o tenant vem do cabecalho `x-tenant-id`.
 *
 * **Nao use em producao.** O cliente escolhe o valor, entao qualquer um le o molde
 * de qualquer confeccao. Existe porque desenvolver contra a API sem subir um
 * emissor de token e legitimo — e por isso o nome diz o que e, e o servidor avisa
 * no log a cada subida.
 */
export function tenantDeDesenvolvimento(): EstrategiaDeTenant {
  return {
    nome: 'cabecalho x-tenant-id (DESENVOLVIMENTO)',
    apenasDesenvolvimento: true,
    resolver(requisicao) {
      const cabecalho = requisicao.headers['x-tenant-id'];
      const tenantId = Array.isArray(cabecalho) ? cabecalho[0] : cabecalho;
      if (typeof tenantId !== 'string' || tenantId.trim() === '') {
        semTenant(
          'Requisicao sem "x-tenant-id". Toda leitura e toda escrita pertencem a uma ' +
            'empresa; nao ha rota sem tenant.',
        );
      }
      return Promise.resolve(tenantId);
    },
  };
}
