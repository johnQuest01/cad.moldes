/**
 * @cad/dxf — importar e exportar DXF-AAMA/ASTM (Fase 3).
 *
 * TypeScript puro, sem DOM: roda no Node, no navegador e sob o Tauri. Importar
 * produz EVENTOS (F4), nunca uma `Peca` montada a mao — o documento continua sendo
 * o fold do log.
 */
export {
  CAMADA,
  TIPO_DO_PIQUE_POR_CAMADA,
  camadaDoPique,
  emMilimetros,
  paraUM,
  lerPares,
  escreverPares,
  nomeDeBloco,
  type Par,
} from './formato.js';

export { exportarDxf, pecasDe, type OpcoesDeExportacao, type Exportacao } from './exportar.js';

export {
  importarDxf,
  ARREDONDAMENTO_DA_MARGEM_UM,
  type OpcoesDeImportacao,
  type Importacao,
} from './importar.js';
