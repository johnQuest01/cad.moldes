/**
 * A fronteira com o banco.
 *
 * DECISAO INEGOCIAVEL 2: **sem ORM**. SQL direto. O que existe aqui nao e uma
 * camada de abstracao sobre o banco — e o contrato minimo que o repositorio
 * precisa para falar com QUALQUER driver, e ele tem exatamente um metodo.
 *
 * ## Por que dois dialetos, e nao um
 * A Fase 1 tem dois destinos reais e simultaneos, nao um hipotetico:
 *  - **Neon (Postgres)** na nuvem, com `JSONB` e RLS por tenant;
 *  - **SQLite local** dentro do Tauri, para o motor rodar offline no chao de
 *    fabrica (decisao da Parte 4).
 * O mesmo log tem que servir aos dois, senao o sync da Fase 10 vira conversao.
 *
 * ## O que muda entre eles, e o que nao muda
 * Mudam tres coisas, todas mecanicas: o marcador de parametro (`$1` x `?`), o tipo
 * do documento (`JSONB` x `TEXT`) e o do instante (`TIMESTAMPTZ` x `TEXT` ISO).
 * **Nao muda** o modelo: as mesmas tabelas, as mesmas colunas, a mesma ordem de
 * replay.
 *
 * ## O que o SQLite NAO tem
 * SQLite nao tem Row Level Security. No Postgres o isolamento entre empresas e
 * garantido pelo banco, alem do filtro da consulta; no SQLite so pelo filtro. Isso
 * e aceitavel *e so* porque o SQLite e o banco local de UMA empresa dentro do
 * Tauri dela — nao um banco multi-empresa. Se um dia o SQLite virar compartilhado,
 * esta diferenca deixa de ser aceitavel, e por isso ela esta escrita aqui e nao
 * escondida.
 */

/** Uma linha devolvida pelo banco. */
export type Linha = Record<string, unknown>;

/**
 * O contrato minimo com o driver. `pg`, `@neondatabase/serverless` e o PGlite
 * satisfazem isto sem adaptador nenhum; o `node:sqlite` precisa do de baixo.
 */
export interface Executor {
  readonly dialeto: Dialeto;
  consultar(sql: string, parametros: readonly unknown[]): Promise<Linha[]>;
}

export type Dialeto = 'postgres' | 'sqlite';

/** Cliente no formato `pg`: e o que Neon, node-postgres e PGlite expoem. */
export interface ClienteTipoPg {
  query(texto: string, valores?: readonly unknown[]): Promise<{ rows: Linha[] }>;
}

/** Executor para Postgres (Neon em producao, PGlite nos testes). */
export function executorPostgres(cliente: ClienteTipoPg): Executor {
  return {
    dialeto: 'postgres',
    async consultar(sql, parametros) {
      const resultado = await cliente.query(sql, parametros);
      return resultado.rows;
    },
  };
}

/**
 * Banco no formato `node:sqlite`. Tipado estruturalmente para este pacote nao
 * importar um modulo experimental que so o Tauri vai usar de verdade.
 */
export interface BancoTipoSqlite {
  prepare(sql: string): {
    all(...parametros: readonly unknown[]): unknown[];
    run(...parametros: readonly unknown[]): unknown;
  };
}

/**
 * Executor para SQLite. O `node:sqlite` e sincrono; a Promise existe so para o
 * repositorio ter uma assinatura so.
 */
export function executorSqlite(banco: BancoTipoSqlite): Executor {
  return {
    dialeto: 'sqlite',
    consultar(sql, parametros) {
      const preparado = banco.prepare(sql);
      // `all` em comando que nao devolve linha e legitimo no node:sqlite.
      const linhas = preparado.all(...parametros) as Linha[];
      return Promise.resolve(linhas);
    },
  };
}

/**
 * Troca os marcadores `$1, $2, ...` do SQL pelo que o dialeto usa.
 *
 * O SQL e escrito uma vez so, na forma do Postgres, e traduzido aqui. Escrever
 * duas versoes de cada consulta seria duas chances de divergirem em silencio.
 */
export function comMarcadores(sql: string, dialeto: Dialeto): string {
  return dialeto === 'postgres' ? sql : sql.replace(/\$\d+/g, '?');
}
