/**
 * Modelo de dados (Parte 1).
 *
 * Vocabulario obrigatorio — nao invente sinonimos:
 *  - Segmento: ligacao entre dois pontos consecutivos (reta ou curva Bezier). Unidade minima.
 *  - Aresta:   entidade com ID ESTAVEL agrupando os segmentos entre dois pontos notaveis.
 *              E o que recebe margem, e medido e e comparado.
 *  - Contorno: o ciclo fechado de segmentos = linha de costura, em CCW.
 *  - Linha de costura: o contorno desenhado. Linha de corte: derivada por offset da margem.
 */
import type { UM } from './unidades.js';

/** Identificador ULID ou UUIDv7 (ordenavel por tempo). Vem sempre no payload do evento (D2). */
export type Id = string;

/** Identificador da empresa. DECISAO INEGOCIAVEL 6: cidadao de primeira classe. */
export type TenantId = string;

/** Ponto no plano, em micrometros inteiros. Y-up (D4). */
export interface Vetor2 {
  readonly x: UM;
  readonly y: UM;
}

export type TipoPonto = 'contorno' | 'construcao' | 'interno';

export interface Ponto {
  readonly id: Id;
  readonly nome?: string;
  readonly x: UM;
  readonly y: UM;
  readonly tipo: TipoPonto;
}

/**
 * D1: curva = Bezier CUBICO, exatamente 2 pontos de controle. Nunca NURBS.
 * A entrada do editor e Catmull-Rom (o modelista clica pontos NA linha) e e
 * convertida para Bezier no armazenamento — handles de Bezier nao sao o modelo
 * mental do usuario.
 */
export type TipoSegmento = 'reta' | 'curva';

export interface Segmento {
  readonly id: Id;
  readonly arestaId: Id;
  readonly de: Id;
  readonly para: Id;
  readonly tipo: TipoSegmento;
  readonly controles?: readonly [Vetor2, Vetor2];
}

/**
 * D3: Aresta e entidade PERSISTIDA com ID estavel, nunca derivada de indice.
 * Derivar dinamicamente dos pontos notaveis renumera as arestas quando um ponto
 * e inserido, e faz margem-por-aresta e ParCostura apontarem para o lugar errado
 * em silencio. O ID precisa sobreviver a edicao.
 */
export interface Aresta {
  readonly id: Id;
  readonly pecaId: Id;
  readonly pontoInicioId: Id;
  readonly pontoFimId: Id;
}

/**
 * D3: ParCostura vive no MODELO, nao na Peca — cava-frente e cava-manga estao
 * em pecas diferentes. Declara que duas arestas costuram juntas.
 *
 * D9 — EMBEBIDO. Duas arestas que costuram juntas NAO precisam ter o mesmo
 * comprimento. Em tecido plano a copa da manga e de proposito mais comprida que a
 * cava: e o embebido, e e ele que da volume ao ombro. Valores praticados:
 * camisa de ombro caido ate 25 mm (as vezes zero), blusa de manga montada 25 mm,
 * alfaiataria 20 a 50 mm, malha zero. Sem este campo o motor exigiria comprimentos
 * iguais e acusaria erro em toda peca de tecido plano.
 */
export interface ParCostura {
  readonly id: Id;
  readonly modeloId: Id;
  readonly arestaA: Id;
  readonly arestaB: Id;
  /**
   * Quanto `arestaB` deve ser MAIOR que `arestaA`, em UM. Zero em costura reta.
   * Aceita negativo: o sinal so diz qual das duas e a maior, entao quem emite nao
   * precisa reordenar o par para declarar o embebido.
   */
  readonly embebidoUM: UM;
}

/**
 * Nomes confirmados no sistema do cliente, mais os dois que faltavam para cobrir
 * o DXF ASTM: `CHECK` (camada 82) e `U` (camada 83). Sem eles, um pique dessas
 * camadas viraria "risco generico" no round-trip da Fase 3 — exatamente o que a
 * Parte 1 proibe.
 */
export type TipoPique = 'I' | 'V' | 'V1' | 'V2' | 'T' | 'MX' | 'M+' | 'MX2' | 'CHECK' | 'U';

/**
 * Camada do DXF ASTM D6673 de cada tipo de pique (inegociavel 5: o modelo carrega
 * o conceito nomeado desde o dia zero, para a importacao da Fase 3 mapear 1:1).
 *
 * Camada 4 = slit e V-notch · 80 = T-notch · 81 = castle · 82 = check · 83 = U-notch.
 *
 * ⚠ `M+` e `MX2` estao em 81 por leitura do nome (variantes de castle). Os outros
 * oito vem direto da norma. Confirmar os dois com o cliente antes da Fase 3.
 */
export const CAMADA_ASTM_DO_PIQUE: Readonly<Record<TipoPique, number>> = Object.freeze({
  I: 4,
  V: 4,
  V1: 4,
  V2: 4,
  T: 80,
  MX: 81,
  'M+': 81,
  MX2: 81,
  CHECK: 82,
  U: 83,
});

/**
 * Pique (notch) parametrizado — nao e um risco solto.
 *
 * `s` e a posicao normalizada por COMPRIMENTO DE ARCO (0..1) sobre a aresta,
 * NUNCA o parametro `t` de Bezier: em curva, t = 0,5 nao e o meio da curva.
 * Consequencia: o pique segue a curva quando ela e editada e sobrevive a
 * graduacao, porque a posicao e relativa e nao coordenada absoluta.
 */
export interface Pique {
  readonly id: Id;
  readonly tipo: TipoPique;
  readonly alturaUM: UM;
  readonly larguraUM: UM;
  readonly anguloGraus: number;
  readonly arestaId: Id;
  readonly s: number;
}

export type DirecaoDobra = 'dentro' | 'fora';

/** Eixo de dobra: entidade PERSISTIDA. Sobrevive a edicao e gradua em posicao relativa. */
export interface EixoDobra {
  readonly id: Id;
  readonly p1: Vetor2;
  readonly p2: Vetor2;
  readonly direcao: DirecaoDobra;
  readonly profundidadeUM?: UM;
}

/**
 * O fio nao e "so uma linha": e a direcao do tecido. Cada tipo tem semantica propria.
 * `referenciaGraduacao` e a camada 5 do DXF ASTM — a linha em torno da qual o
 * sistema de origem gradua. O motor nao gradua por ela (D7: a ancora e emergente),
 * mas precisa carregar o conceito para nao perde-lo no round-trip.
 */
export type TipoLinhaInterna = 'fio' | 'pence' | 'furo' | 'referenciaGraduacao';

/**
 * D10 — geometria interna e feita de `Ponto`, como o contorno.
 *
 * Antes `pontos` era `Vetor2[]` cru, e por isso o fio, a pence e o furo nao podiam
 * ser marcados como grade point: a graduacao nao tinha onde pegar. Guardando ID DE
 * PONTO, a geometria interna passa a graduar pela MESMA regra do contorno (D7:
 * ponto com regra anda, ponto sem regra e ancora) — sem mecanismo novo, e sem o
 * motor precisar recusar peca com fio.
 *
 * Aberta: nao fecha ciclo. Quem fecha e o `Recorte`.
 */
export interface LinhaInterna {
  readonly id: Id;
  readonly tipo: TipoLinhaInterna;
  readonly pontos: readonly Id[];
}

/**
 * Recorte interno — camada 11 do DXF ASTM. Um vazado FECHADO dentro da peca
 * (casa de gola, furo de alca), que sai do tecido junto com o contorno externo.
 *
 * Anel fechado, sem repetir o primeiro no fim, como o `Poligono`.
 * Diferente da `LinhaInterna`, que e aberta e nao e cortada.
 *
 * O modelo carrega o conceito (inegociavel 5), mas NENHUMA operacao geometrica o
 * trata ainda: `offsetMargem` recusa peca com recorte em vez de devolver so o anel
 * externo e mandar para o corte uma peca sem o vazado.
 */
export interface Recorte {
  readonly id: Id;
  /** Ids de `Ponto` formando anel FECHADO, sem repetir o primeiro no fim (D10). */
  readonly pontos: readonly Id[];
}

export type ModoTecido = 'aberto' | 'tubular';

/**
 * Material/Tecido. `gramaturaGM2` e OBRIGATORIA: o peso por pacote no encaixe
 * (Fase 5) e `area x gramatura`.
 */
export interface Material {
  readonly id: Id;
  readonly tenantId: TenantId;
  readonly nome: string;
  readonly larguraUM: UM;
  readonly gramaturaGM2: number;
  readonly modo: ModoTecido;
}

/**
 * O PAPEL do plotter. Nao confundir com `Material`, que e o TECIDO.
 *
 * Sao duas larguras diferentes e as duas mandam em coisas diferentes: a do tecido
 * limita o encaixe (Fase 5), a do papel limita o que da para IMPRIMIR. Um ateliê
 * com rolo de papel de 1,60 m e tecido de 1,50 m tem as duas, e elas nao se
 * substituem.
 *
 * Larguras de rolo praticadas na modelagem: 90 cm, 1,60 m e 1,80 m, comprimento
 * continuo. A `margemDeSegurancaUM` e a faixa em cada borda que a plotadora nao
 * alcanca — nenhuma imprime ate o fio do papel.
 */
export interface Papel {
  readonly id: Id;
  readonly nome: string;
  /** Largura do rolo, de borda a borda. */
  readonly larguraUM: UM;
  /** Faixa perdida em CADA borda. A largura util e `largura - 2 x margem`. */
  readonly margemDeSegurancaUM: UM;
}

/** Marca um ponto do contorno como graduavel. */
export interface PontoGraduacao {
  readonly id: Id;
  readonly pontoId: Id;
}

/** Regra como DADO (linha de tabela), nunca como codigo. */
export interface RegraGraduacao {
  readonly id: Id;
  readonly pontoGraduacaoId: Id;
  readonly deTamanho: string;
  readonly paraTamanho: string;
  readonly dx: UM;
  readonly dy: UM;
}

export type Giro = 'livre' | '180' | '90' | 'forcar' | 'esquerda' | 'direita';

/** Campos confirmados na tela do cliente. */
export interface PropriedadesEncaixe {
  readonly materialId?: Id;
  readonly quantidadePorModelo: number;
  readonly giro: Giro;
  readonly faixaGiroGraus: number;
  readonly par: boolean;
  readonly espelhado: boolean;
  readonly dobraHorizontal: boolean;
  readonly dobraVertical: boolean;
}

export interface MetadadosPeca {
  readonly nome: string;
  readonly descricao?: string;
}

/**
 * Peca. O `contorno` e a lista ORDENADA de ids de segmento formando o ciclo
 * fechado da linha de costura, em CCW (D4).
 */
export interface Peca {
  readonly id: Id;
  readonly tenantId: TenantId;
  readonly modeloId: Id;
  readonly pontos: Readonly<Record<Id, Ponto>>;
  readonly segmentos: Readonly<Record<Id, Segmento>>;
  readonly arestas: Readonly<Record<Id, Aresta>>;
  readonly contorno: readonly Id[];
  /** arestaId -> margem de costura em UM. Arestas diferentes podem ter margens diferentes. */
  readonly margens: Readonly<Record<Id, UM>>;
  readonly linhasInternas: Readonly<Record<Id, LinhaInterna>>;
  /** Vazados fechados dentro da peca (camada 11 do DXF ASTM). */
  readonly recortes: Readonly<Record<Id, Recorte>>;
  readonly piques: Readonly<Record<Id, Pique>>;
  readonly eixosDobra: Readonly<Record<Id, EixoDobra>>;
  readonly gradePoints: Readonly<Record<Id, PontoGraduacao>>;
  readonly metadados: MetadadosPeca;
  readonly encaixe: PropriedadesEncaixe;
}

/** Colecao de pecas + grade de tamanhos + regras + pares de costura. */
export interface Modelo {
  readonly id: Id;
  readonly tenantId: TenantId;
  readonly nome: string;
  readonly pecas: Readonly<Record<Id, Peca>>;
  readonly tamanhos: readonly string[];
  readonly tamanhoBase: string;
  readonly paresCostura: Readonly<Record<Id, ParCostura>>;
  readonly regrasGraduacao: Readonly<Record<Id, RegraGraduacao>>;
  readonly materiais: Readonly<Record<Id, Material>>;
  /** O papel do plotter. `null` enquanto ninguem declarou qual rolo a casa usa. */
  readonly papel: Papel | null;
}

/** Anel fechado de pontos, CCW, sem repetir o primeiro ponto no fim. */
export interface Poligono {
  readonly pontos: readonly Vetor2[];
}

export type GravidadeProblema = 'erro' | 'aviso';

/** Saida das validacoes. O motor RELATA; nunca conserta sozinho em silencio. */
export interface Problema {
  readonly gravidade: GravidadeProblema;
  readonly codigo: string;
  readonly mensagem: string;
  readonly pecaId?: Id;
  readonly arestaId?: Id;
  readonly pontoId?: Id;
}
