/**
 * @cad/persistencia — log de eventos e snapshot do CAD de moldes.
 *
 * SQL direto, sem ORM (inegociavel 2). Dois destinos com o MESMO esquema: Neon
 * (Postgres) na nuvem e SQLite local dentro do Tauri, para o chao de fabrica
 * offline. O motor nao sabe que este pacote existe: `@cad/motor` continua puro.
 */
export {
  executorPostgres,
  executorSqlite,
  comMarcadores,
  type Executor,
  type Dialeto,
  type Linha,
  type ClienteTipoPg,
  type BancoTipoSqlite,
} from './executor.js';

export { ddl, ddlRls } from './esquema.js';

export {
  RepositorioDeEventos,
  ErroDePersistencia,
  canonico,
  type CodigoDePersistencia,
  type Integridade,
} from './repositorio.js';
