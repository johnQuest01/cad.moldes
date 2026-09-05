/**
 * @cad/api — backend Fastify do CAD de moldes.
 *
 * So persiste e le eventos (entrega da Parte 0). Nenhuma geometria: o motor e
 * puro e roda igual no Node, no browser e dentro do Tauri.
 */
export { criarServidor, type OpcoesDoServidor } from './servidor.js';
export {
  tenantPorJwt,
  tenantDeDesenvolvimento,
  type EstrategiaDeTenant,
  type OpcoesDeJwt,
  type ChaveDeVerificacao,
} from './tenant.js';
export { principal } from './principal.js';
