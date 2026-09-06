/**
 * @cad/foto — digitalizar molde por foto (Fase 6).
 *
 * A especificação normativa está em `MD/fase6-foto.MD`. O que este pacote entrega,
 * por enquanto, é a base sobre a qual todo o resto se apoia: o quadro de
 * referência e a homografia que transforma pixel em milímetro real.
 *
 * Sem isso, nada mais faz sentido: uma foto RGB **não tem escala** (decisão I1), e
 * um contorno perfeito fora de escala é um molde errado em toda parte ao mesmo
 * tempo.
 */
export {
  TOLERANCIA_DO_QUADRO_UM,
  cantosDoQuadro,
  conferirCalibracao,
  type Calibracao,
  type ProblemaDeCalibracao,
} from './calibracao.js';

export {
  ErroDeHomografia,
  estimarHomografia,
  paraUM,
  projetar,
  residuoDeReprojecao,
  type Homografia,
  type PontoImagem,
} from './homografia.js';

export {
  LIMIAR_CROMA_PARDO,
  LIMIAR_LUZ_BORDA,
  segmentar,
  type Imagem,
  type Mascara,
  type OpcoesDeSegmentacao,
  type Segmentacao,
} from './imagem.js';

export {
  buracosDe,
  contornoDaRegiao,
  preencherBuracos,
  rotular,
  type Regiao,
  type Rotulagem,
} from './regioes.js';

export {
  detectarQuadro,
  type Marca,
  type OpcoesDoQuadro,
  type ProblemaDoQuadro,
  type QuadroDetectado,
} from './quadro.js';

export {
  TOLERANCIA_DE_ASPECTO,
  aspectoDetectado,
  conferirQuadroContraCalibracao,
} from './quadro.js';
