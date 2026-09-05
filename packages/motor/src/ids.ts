/**
 * Geracao de identificadores.
 *
 * D2 — ESTE ARQUIVO NAO PODE SER IMPORTADO PELO FOLD.
 * O fold e funcao pura: toda entropia (id, timestamp, autor) e gerada AQUI, por
 * quem emite o evento, e viaja no envelope. `randomUUID()` dentro do fold faria o
 * replay produzir IDs diferentes do snapshot e quebraria o teste de integridade.
 *
 * ULID em vez de UUIDv4 porque e ordenavel por tempo — a ordenacao de eventos no
 * sync da Fase 10 sai de graca.
 */
import { ulid, monotonicFactory } from 'ulid';

import type { Id } from './tipos.js';

/** Gera um ULID novo. Impuro por definicao — so no emissor, nunca no fold. */
export function novoId(): Id {
  return ulid();
}

/**
 * Gerador monotonico: dois ULIDs criados no mesmo milissegundo saem em ordem
 * crescente. Use quando emitir varios eventos em rajada (montar uma peca inteira),
 * senao a ordenacao por id dentro do mesmo ms fica indefinida.
 */
export function criarGeradorMonotonico(): () => Id {
  const proximo = monotonicFactory();
  return () => proximo();
}
