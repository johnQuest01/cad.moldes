/**
 * Repositorio de eventos e snapshots (Parte 4).
 *
 * "Toda edicao e um evento, nunca um UPDATE destrutivo." Aqui nao existe `UPDATE`
 * em `evento`, nem `DELETE`: so `INSERT` e `SELECT`. O unico `UPDATE` do arquivo
 * esta no `snapshot`, que e cache derivado — e ele e reescrito inteiro, nunca
 * remendado.
 *
 * ## Anexar e idempotente, mas nao e permissivo
 * O mesmo evento pode chegar duas vezes (retry de rede, sync da Fase 10). Reanexar
 * um evento **identico** e no-op. Reanexar um evento com o **mesmo id e conteudo
 * diferente** estoura: dois eventos diferentes com o mesmo ULID significam gerador
 * de id quebrado ou log corrompido, e engolir isso trocaria a historia da peca em
 * silencio.
 *
 * ## A comparacao de integridade e canonica, nao textual
 * `JSONB` do Postgres reordena as chaves do documento. Comparar
 * `JSON.stringify(a) === JSON.stringify(b)` reprovaria um snapshot correto so
 * porque o banco devolveu `{y, x}` em vez de `{x, y}`. A comparacao ordena as
 * chaves recursivamente antes de serializar — ignora **so** a ordem de chave, que
 * em JSON nao carrega significado, e continua pegando qualquer diferenca de valor,
 * de id ou de estrutura.
 */
import { reconstruir, type Evento, type Modelo } from '@cad/motor';

import { comMarcadores, type Executor, type Linha } from './executor.js';
import { ddl } from './esquema.js';

/** Erro da persistencia. Codigo estavel para o chamador; mensagem para o humano. */
export class ErroDePersistencia extends Error {
  readonly codigo: CodigoDePersistencia;
  readonly detalhes: Readonly<Record<string, unknown>>;

  constructor(
    codigo: CodigoDePersistencia,
    mensagem: string,
    detalhes: Record<string, unknown> = {},
  ) {
    super(`[${codigo}] ${mensagem}`);
    this.name = 'ErroDePersistencia';
    this.codigo = codigo;
    this.detalhes = Object.freeze({ ...detalhes });
  }
}

export type CodigoDePersistencia =
  | 'EVENTO_DIVERGENTE'
  | 'EVENTO_DE_OUTRO_TENANT'
  | 'EVENTO_DE_OUTRO_MODELO'
  | 'LOG_VAZIO'
  | 'SNAPSHOT_AUSENTE'
  | 'SNAPSHOT_DIVERGENTE';

/** Resultado da conferencia do teste 13, com os numeros para o relatorio. */
export interface Integridade {
  readonly bate: boolean;
  readonly eventos: number;
  readonly ateEventoId: string;
  /** Primeira diferenca encontrada, quando nao bate. */
  readonly diferenca?: string;
}

export class RepositorioDeEventos {
  constructor(private readonly executor: Executor) {}

  /** Cria as tabelas se ainda nao existirem. Idempotente. */
  async criarEsquema(): Promise<void> {
    for (const comando of ddl(this.executor.dialeto)) {
      await this.executor.consultar(comando, []);
    }
  }

  /**
   * Anexa eventos ao log. Devolve quantos eram novos.
   * Ordem de insercao nao importa: o replay ordena por id (ULID).
   */
  async anexar(tenantId: string, modeloId: string, eventos: readonly Evento[]): Promise<number> {
    let novos = 0;
    for (const evento of eventos) {
      if (evento.tenantId !== tenantId) {
        throw new ErroDePersistencia(
          'EVENTO_DE_OUTRO_TENANT',
          `O evento "${evento.id}" e do tenant "${evento.tenantId}" mas esta sendo gravado ` +
            `na sessao do tenant "${tenantId}". Recusando para nao vazar dado entre empresas.`,
          { eventoId: evento.id, tenantId, doEvento: evento.tenantId },
        );
      }
      if (evento.modeloId !== modeloId) {
        throw new ErroDePersistencia(
          'EVENTO_DE_OUTRO_MODELO',
          `O evento "${evento.id}" e do modelo "${evento.modeloId}" mas esta sendo gravado ` +
            `no log do modelo "${modeloId}".`,
          { eventoId: evento.id, modeloId, doEvento: evento.modeloId },
        );
      }
      if (await this.anexarUm(evento)) novos++;
    }
    return novos;
  }

  /** Log completo de um modelo, na ordem do ULID. */
  async lerLog(tenantId: string, modeloId: string): Promise<Evento[]> {
    const linhas = await this.consultar(
      `SELECT id, tenant_id, modelo_id, peca_id, tipo, payload, ocorrido_em, autor, versao_schema
         FROM evento
        WHERE tenant_id = $1 AND modelo_id = $2
        ORDER BY id`,
      [tenantId, modeloId],
    );
    return linhas.map((linha) => this.paraEvento(linha));
  }

  /** Reconstroi o modelo a partir do log. E a verdade; o snapshot e so cache. */
  async reconstruirDoLog(tenantId: string, modeloId: string): Promise<Modelo> {
    const log = await this.lerLog(tenantId, modeloId);
    if (log.length === 0) {
      throw new ErroDePersistencia(
        'LOG_VAZIO',
        `Nao ha eventos do modelo "${modeloId}" para o tenant "${tenantId}".`,
        { tenantId, modeloId },
      );
    }
    return reconstruir(log);
  }

  /**
   * Regrava o snapshot inteiro a partir do log. Devolve o estado gravado.
   *
   * O `DO UPDATE` usa `excluded.*` em vez de repetir `$3, $4, $5`: um marcador
   * repetido vira dois `?` na traducao para SQLite e desalinha os parametros.
   */
  async gravarSnapshot(tenantId: string, modeloId: string): Promise<Modelo> {
    const log = await this.lerLog(tenantId, modeloId);
    if (log.length === 0) {
      throw new ErroDePersistencia(
        'LOG_VAZIO',
        `Nao da para gravar snapshot do modelo "${modeloId}": o log esta vazio.`,
        { tenantId, modeloId },
      );
    }
    const estado = reconstruir(log);
    const ateEventoId = log[log.length - 1]!.id;

    await this.consultar(
      `INSERT INTO snapshot (modelo_id, tenant_id, estado, ate_evento_id, atualizado_em)
            VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, modelo_id)
       DO UPDATE SET estado = excluded.estado,
                     ate_evento_id = excluded.ate_evento_id,
                     atualizado_em = excluded.atualizado_em`,
      [modeloId, tenantId, this.paraDocumento(estado), ateEventoId, new Date().toISOString()],
    );
    return estado;
  }

  /** Le o snapshot. `null` quando ainda nao foi gravado. */
  async lerSnapshot(tenantId: string, modeloId: string): Promise<Modelo | null> {
    const linhas = await this.consultar(
      `SELECT estado FROM snapshot WHERE tenant_id = $1 AND modelo_id = $2`,
      [tenantId, modeloId],
    );
    const linha = linhas[0];
    return linha === undefined ? null : (this.doDocumento(linha['estado']) as Modelo);
  }

  /**
   * **Teste de integridade da Parte 4**: reconstroi so pelo log e compara com o
   * snapshot. Devolve o resultado em vez de estourar — quem chama decide se isso
   * e alarme ou relatorio.
   */
  async conferirIntegridade(tenantId: string, modeloId: string): Promise<Integridade> {
    const log = await this.lerLog(tenantId, modeloId);
    if (log.length === 0) {
      throw new ErroDePersistencia(
        'LOG_VAZIO',
        `Nao ha o que conferir: o log do modelo "${modeloId}" esta vazio.`,
        { tenantId, modeloId },
      );
    }
    const snapshot = await this.lerSnapshot(tenantId, modeloId);
    if (snapshot === null) {
      throw new ErroDePersistencia(
        'SNAPSHOT_AUSENTE',
        `O modelo "${modeloId}" tem ${log.length} evento(s) mas nenhum snapshot gravado.`,
        { tenantId, modeloId, eventos: log.length },
      );
    }

    const doLog = canonico(reconstruir(log));
    const doSnapshot = canonico(snapshot);
    const base = {
      eventos: log.length,
      ateEventoId: log[log.length - 1]!.id,
    };
    if (doLog === doSnapshot) return { bate: true, ...base };
    return { bate: false, ...base, diferenca: primeiraDiferenca(doLog, doSnapshot) };
  }

  private async anexarUm(evento: Evento): Promise<boolean> {
    const jaGravado = await this.consultar(
      `SELECT id, tenant_id, modelo_id, peca_id, tipo, payload, ocorrido_em, autor, versao_schema
         FROM evento WHERE id = $1`,
      [evento.id],
    );

    if (jaGravado.length > 0) {
      const existente = this.paraEvento(jaGravado[0]!);
      if (canonico(existente) !== canonico(evento)) {
        throw new ErroDePersistencia(
          'EVENTO_DIVERGENTE',
          `O evento "${evento.id}" ja esta no log com conteudo DIFERENTE. Dois eventos ` +
            `distintos com o mesmo ULID significam gerador de id quebrado ou log corrompido; ` +
            `gravar por cima trocaria a historia da peca em silencio.`,
          { eventoId: evento.id },
        );
      }
      return false;
    }

    await this.consultar(
      `INSERT INTO evento
         (id, tenant_id, modelo_id, peca_id, tipo, payload, ocorrido_em, autor, versao_schema)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        evento.id,
        evento.tenantId,
        evento.modeloId,
        evento.pecaId,
        evento.tipo,
        this.paraDocumento(evento.payload),
        evento.timestamp,
        evento.autor,
        evento.versaoSchema,
      ],
    );
    return true;
  }

  private consultar(sql: string, parametros: readonly unknown[]): Promise<Linha[]> {
    return this.executor.consultar(comMarcadores(sql, this.executor.dialeto), parametros);
  }

  /** JSONB aceita objeto; TEXT do SQLite precisa da string. */
  private paraDocumento(valor: unknown): unknown {
    return this.executor.dialeto === 'postgres' ? valor : JSON.stringify(valor);
  }

  private doDocumento(valor: unknown): unknown {
    return typeof valor === 'string' ? JSON.parse(valor) : valor;
  }

  private paraEvento(linha: Linha): Evento {
    const instante = linha['ocorrido_em'];
    return {
      id: String(linha['id']),
      tenantId: String(linha['tenant_id']),
      modeloId: String(linha['modelo_id']),
      pecaId: linha['peca_id'] === null ? null : String(linha['peca_id']),
      tipo: String(linha['tipo']),
      payload: this.doDocumento(linha['payload']),
      timestamp: instante instanceof Date ? instante.toISOString() : String(instante),
      autor: String(linha['autor']),
      versaoSchema: Number(linha['versao_schema']),
    } as Evento;
  }
}

/**
 * JSON com as chaves ordenadas recursivamente.
 *
 * Existe por um motivo so: `JSONB` do Postgres nao preserva a ordem das chaves.
 * Ordenar antes de comparar ignora **apenas** isso — valor, id, tipo e estrutura
 * continuam sendo comparados exatamente.
 */
export function canonico(valor: unknown): string {
  return JSON.stringify(ordenar(valor));
}

function ordenar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (valor === null || typeof valor !== 'object') return valor;
  const entradas = Object.entries(valor as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return Object.fromEntries(entradas.map(([chave, dentro]) => [chave, ordenar(dentro)]));
}

/** Trecho onde as duas serializacoes divergem, para a mensagem de erro ser util. */
function primeiraDiferenca(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const inicio = Math.max(0, i - 40);
  return `posicao ${i}: log "...${a.slice(inicio, i + 40)}..." x snapshot "...${b.slice(inicio, i + 40)}..."`;
}
