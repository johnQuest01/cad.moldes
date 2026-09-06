/**
 * Persistencia: guardar o rascunho e falar com o backend (Bloco 8).
 *
 * ## Por que ha um armazem local, e nao so o servidor
 * O log e append-only e o servidor e a fonte de verdade — mas o modelista trabalha
 * horas antes de salvar, e um travamento do navegador nao pode custar a manha
 * dele. O rascunho fica guardado localmente a cada gesto; quando ele salva, vai
 * para o servidor e o local e limpo.
 *
 * ## `Armazem` e `Rede` sao INJETADOS
 * Nada aqui conhece `localStorage` nem `fetch`: os dois entram como interface. E
 * o que permite testar a persistencia headless, e e o que vai deixar o wrap Tauri
 * (Fase 4) trocar o armazem por SQLite sem mexer numa linha desta logica.
 */
import type { Evento, Id, TenantId } from '@cad/motor';

import type { Sessao } from './sessao.js';

/** Guarda texto por chave. `localStorage`, SQLite ou memoria — tanto faz aqui. */
export interface Armazem {
  ler(chave: string): string | null;
  gravar(chave: string, valor: string): void;
  apagar(chave: string): void;
}

/** Armazem de memoria. E o que os testes usam, e serve de referencia do contrato. */
export function armazemDeMemoria(): Armazem {
  const mapa = new Map<string, string>();
  return {
    ler: (chave) => mapa.get(chave) ?? null,
    gravar: (chave, valor) => {
      mapa.set(chave, valor);
    },
    apagar: (chave) => {
      mapa.delete(chave);
    },
  };
}

/**
 * `localStorage`, com as duas armadilhas tratadas: janela anonima e cota estourada
 * fazem `setItem` LANCAR. Um editor que fecha porque nao conseguiu guardar rascunho
 * seria pior que um que nao guarda.
 */
export function armazemDoNavegador(local: Storage): Armazem {
  return {
    ler(chave) {
      try {
        return local.getItem(chave);
      } catch {
        return null;
      }
    },
    gravar(chave, valor) {
      try {
        local.setItem(chave, valor);
      } catch {
        // Sem espaco ou sem permissao: o trabalho continua, so nao ha rede de
        // seguranca. Quem precisa saber disso e o `guardarRascunho`, que devolve
        // `false` para a interface avisar.
      }
    },
    apagar(chave) {
      try {
        local.removeItem(chave);
      } catch {
        /* idem */
      }
    },
  };
}

const chaveDo = (tenantId: TenantId, modeloId: Id): string =>
  `cad.moldes:rascunho:${tenantId}:${modeloId}`;

/** O que fica guardado localmente. A versao serve para recusar formato velho. */
interface RascunhoGuardado {
  readonly versao: 1;
  readonly tenantId: TenantId;
  readonly modeloId: Id;
  readonly eventos: readonly Evento[];
}

/** Guarda os pendentes. Devolve `false` se o armazem nao aceitou. */
export function guardarRascunho(
  armazem: Armazem,
  tenantId: TenantId,
  modeloId: Id,
  pendentes: readonly Evento[],
): boolean {
  const chave = chaveDo(tenantId, modeloId);
  if (pendentes.length === 0) {
    armazem.apagar(chave);
    return true;
  }
  const guardado: RascunhoGuardado = { versao: 1, tenantId, modeloId, eventos: pendentes };
  armazem.gravar(chave, JSON.stringify(guardado));
  return armazem.ler(chave) !== null;
}

/**
 * Le o rascunho guardado. Devolve lista vazia quando nao ha nada, o conteudo esta
 * corrompido ou e de outro modelo — nunca estoura: abrir o editor nao pode falhar
 * por causa de lixo no armazem.
 */
export function lerRascunho(armazem: Armazem, tenantId: TenantId, modeloId: Id): Evento[] {
  const cru = armazem.ler(chaveDo(tenantId, modeloId));
  if (cru === null) return [];
  try {
    const guardado = JSON.parse(cru) as Partial<RascunhoGuardado>;
    if (guardado.versao !== 1) return [];
    if (guardado.tenantId !== tenantId || guardado.modeloId !== modeloId) return [];
    return Array.isArray(guardado.eventos) ? [...guardado.eventos] : [];
  } catch {
    return [];
  }
}

export function apagarRascunho(armazem: Armazem, tenantId: TenantId, modeloId: Id): void {
  armazem.apagar(chaveDo(tenantId, modeloId));
}

// ---------------------------------------------------------------- o servidor

/** O `fetch` que o cliente usa. Injetado para o teste nao precisar de rede. */
export type Rede = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface OpcoesDoCliente {
  readonly base: string;
  readonly tenantId: TenantId;
  /** O JWT assinado. O tenant do servidor sai do claim dele, nunca do cabecalho. */
  readonly token: string;
  readonly rede: Rede;
}

export type Resultado =
  | { readonly ok: true; readonly gravados: number }
  | { readonly ok: false; readonly status: number; readonly motivo: string };

/**
 * Manda os pendentes e, so se o servidor confirmar, SELA a sessao (E2).
 *
 * Selar antes da confirmacao seria mentir para o modelista: ele veria "salvo" e o
 * trabalho estaria so na tela. Por isso o selo depende do `201`.
 */
export async function salvar(
  sessao: Sessao,
  modeloId: Id,
  opcoes: OpcoesDoCliente,
): Promise<Resultado> {
  const eventos = sessao.pendentes;
  if (eventos.length === 0) return { ok: true, gravados: 0 };

  let resposta: Awaited<ReturnType<Rede>>;
  try {
    resposta = await opcoes.rede(`${opcoes.base}/modelos/${modeloId}/eventos`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${opcoes.token}`,
      },
      body: JSON.stringify({ eventos }),
    });
  } catch (erro) {
    // Sem rede o trabalho NAO se perde: ele continua pendente e guardado local.
    return { ok: false, status: 0, motivo: erro instanceof Error ? erro.message : 'sem rede' };
  }

  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string };
    return {
      ok: false,
      status: resposta.status,
      motivo: corpo.mensagem ?? `o servidor respondeu ${resposta.status}`,
    };
  }

  const gravados = eventos.length;
  sessao.selar();
  return { ok: true, gravados };
}

/** Le o log do servidor. E com ele que a sessao e aberta. */
export async function abrir(modeloId: Id, opcoes: OpcoesDoCliente): Promise<Evento[]> {
  const resposta = await opcoes.rede(`${opcoes.base}/modelos/${modeloId}/eventos`, {
    method: 'GET',
    headers: { authorization: `Bearer ${opcoes.token}` },
  });
  if (!resposta.ok) {
    throw new Error(`Nao foi possivel abrir o modelo "${modeloId}": ${resposta.status}.`);
  }
  const corpo = (await resposta.json()) as { eventos?: Evento[] };
  return corpo.eventos ?? [];
}
