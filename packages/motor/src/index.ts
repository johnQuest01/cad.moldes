/**
 * @cad/motor — motor geometrico do CAD de moldes.
 *
 * TypeScript puro: sem DOM, sem render, sem framework. Roda no Node e no browser.
 * O editor da Fase 2 (PixiJS) e o wrap Tauri consomem este pacote sem alterar o nucleo.
 */

export {
  MM,
  CM,
  TOLERANCIA_TESSELACAO_UM,
  TOLERANCIA_MEDICAO_UM,
  TOLERANCIA_CASAMENTO_UM,
  LIMITE_MITER,
  mmParaUM,
  cmParaUM,
  umParaMM,
  umParaCM,
  exigirUM,
  type UM,
} from './unidades.js';

export { ErroMotor, exigir, exigirDoMapa, type CodigoErro } from './erros.js';

export { CAMADA_ASTM_DO_PIQUE } from './tipos.js';

export type {
  Id,
  TenantId,
  Vetor2,
  TipoPonto,
  Ponto,
  TipoSegmento,
  Segmento,
  Aresta,
  ParCostura,
  TipoPique,
  Recorte,
  Pique,
  DirecaoDobra,
  EixoDobra,
  TipoLinhaInterna,
  LinhaInterna,
  ModoTecido,
  Material,
  PontoGraduacao,
  RegraGraduacao,
  Giro,
  PropriedadesEncaixe,
  MetadadosPeca,
  Peca,
  Modelo,
  Poligono,
  GravidadeProblema,
  Problema,
} from './tipos.js';

export { areaComSinal, area, ehCCW, anelDoContorno, contemPonto } from './geometria/anel.js';
export { normalizarWinding, areaDoContorno } from './geometria/winding.js';
export { cruzarSegmentos, seCruzam } from './geometria/interseccao.js';

export {
  pontoEmT,
  limiteDesvioDaCorda,
  subdividirNoMeio,
  tesselarBezier,
  bezierDe,
  type Bezier,
  type Vetor2F,
} from './geometria/bezier.js';
export { tesselarSegmento, tesselarContorno } from './geometria/tesselar.js';
export { segmentosDaAresta } from './geometria/aresta.js';
export {
  tabelaArcoDaAresta,
  medirAresta,
  medirSegmento,
  pontoEmS,
  pontoNaTabela,
  type TabelaArco,
} from './geometria/medir.js';

export { offsetMargem } from './offset.js';

export { aplicarGraduacao } from './graduacao.js';

export {
  transladarPeca,
  rotacionarPeca,
  espelharPeca,
  refletirPonto,
  direcaoDoEixo,
  ladoDoEixo,
  type Eixo,
} from './transformar.js';

export { dividirPeca } from './dividir.js';

export { duplicarPeca, type PecaDuplicada } from './duplicar.js';

export { abrirPregas, aberturaDasPregas } from './pregas.js';

export { projetarPique, projetarPiques, type PiqueProjetado } from './pique.js';

export {
  adicionarPique,
  moverPique,
  removerPique,
  localizarNoContorno,
  ALTURA_PADRAO_DO_PIQUE_UM,
  LARGURA_PADRAO_DO_PIQUE_UM,
  type LugarNoContorno,
  type PiqueNovo,
} from './piques.js';

export {
  contornoDesdobrado,
  linhaDeCorteDesdobrada,
  areaDesdobrada,
} from './dobra.js';

export {
  modificarPonto,
  moverControle,
  fatorDeDecaimento,
  inserirPonto,
  excluirPonto,
  converterSegmento,
  arredondarVertice,
  chanfrarVertice,
  simplificarContorno,
  type ModoDeEdicao,
} from './edicao.js';

export { validarInconsistencias, validarModelo } from './validar.js';

export {
  validarCasamento,
  compararPerimetros,
  type LinhaDeConferencia,
} from './conferencia.js';

export { fold, reconstruir } from './eventos/fold.js';
export { VERSAO_SCHEMA_ATUAL } from './eventos/tipos.js';
export type {
  Envelope,
  Evento,
  TipoEvento,
  CriarModelo,
  CriarPeca,
  CriarPonto,
  MoverPonto,
  DefinirAresta,
  DefinirSegmento,
  DefinirMargem,
  DefinirParCostura,
  DefinirMetadados,
  ModificarPonto,
  AdicionarLinhaInterna,
  AdicionarRecorte,
  AdicionarPique,
  MoverPique,
  RemoverPique,
  MoverControle,
  DuplicarPeca,
  DividirPeca,
  AbrirPregas,
  DefinirEncaixe,
  RemoverPeca,
  RemoverLinhaInterna,
  RemoverRecorte,
  DesmarcarGradePoint,
  RemoverRegraGraduacao,
  RemoverParCostura,
  DefinirEixoDobra,
  RemoverEixoDobra,
  EspelharPeca,
  RotacionarPeca,
  TransladarPeca,
  InserirPonto,
  ExcluirPonto,
  ConverterSegmento,
  ArredondarVertice,
  ChanfrarVertice,
  SimplificarContorno,
  MarcarGradePoint,
  DefinirRegraGraduacao,
} from './eventos/tipos.js';

export { novoId, criarGeradorMonotonico } from './ids.js';
