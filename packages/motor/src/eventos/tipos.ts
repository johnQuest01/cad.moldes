/**
 * Eventos (Parte 4).
 *
 * Toda edicao e um EVENTO, nunca um UPDATE destrutivo. O estado e o fold do log.
 *
 * D2 — o fold e funcao pura. Toda entropia (id, timestamp, autor) e gerada por
 * QUEM EMITE e viaja no payload/envelope. `randomUUID()` dentro do fold faria o
 * replay produzir IDs diferentes do snapshot e o teste de integridade falharia
 * por construcao.
 *
 * Este arquivo cresce a cada bloco: so entram aqui os eventos das operacoes que
 * ja existem. Declarar os 29 de uma vez criaria ramos mortos no fold.
 * Eventos deste bloco (Bloco 1): estrutura do modelo, da peca e do contorno.
 */
import type {
  DirecaoDobra,
  Id,
  TenantId,
  TipoLinhaInterna,
  TipoPique,
  TipoPonto,
  TipoSegmento,
  Vetor2,
  PropriedadesEncaixe,
} from '../tipos.js';
import type { UM } from '../unidades.js';

/** Versao de schema aceita hoje. Migracao futura sem reprocessar errado. */
export const VERSAO_SCHEMA_ATUAL = 1;

/**
 * Envelope comum a todo evento.
 *
 * `pecaId` e `null` em eventos de nivel de modelo — ParCostura vive no Modelo (D3)
 * porque as arestas pareadas estao em pecas diferentes.
 */
export interface Envelope<TTipo extends string, TPayload> {
  readonly id: Id;
  readonly tenantId: TenantId;
  readonly modeloId: Id;
  readonly pecaId: Id | null;
  readonly tipo: TTipo;
  readonly payload: TPayload;
  /** ISO 8601. Gerado por quem emite — nunca por `Date.now()` dentro do fold. */
  readonly timestamp: string;
  readonly autor: string;
  readonly versaoSchema: number;
}

export type CriarModelo = Envelope<
  'CriarModelo',
  {
    readonly nome: string;
    readonly tamanhos: readonly string[];
    readonly tamanhoBase: string;
  }
>;

export type CriarPeca = Envelope<
  'CriarPeca',
  {
    readonly nome: string;
    readonly encaixe: PropriedadesEncaixe;
  }
>;

export type CriarPonto = Envelope<
  'CriarPonto',
  {
    readonly pontoId: Id;
    readonly x: UM;
    readonly y: UM;
    readonly tipo: TipoPonto;
    readonly nome?: string;
  }
>;

/** Move um ponto para uma coordenada ABSOLUTA. O delta relativo e ModificarPonto (Bloco 7). */
export type MoverPonto = Envelope<
  'MoverPonto',
  {
    readonly pontoId: Id;
    readonly x: UM;
    readonly y: UM;
  }
>;

export type DefinirAresta = Envelope<
  'DefinirAresta',
  {
    readonly arestaId: Id;
    readonly pontoInicioId: Id;
    readonly pontoFimId: Id;
  }
>;

/**
 * Cria ou redefine um segmento. Segmento novo e ANEXADO ao fim do contorno —
 * e a ordem em que o modelista desenha. Splice no meio e InserirPonto (Bloco 13).
 */
export type DefinirSegmento = Envelope<
  'DefinirSegmento',
  {
    readonly segmentoId: Id;
    readonly arestaId: Id;
    readonly de: Id;
    readonly para: Id;
    readonly tipo: TipoSegmento;
    readonly controles?: readonly [Vetor2, Vetor2];
  }
>;

/** Margem de costura por ARESTA. Arestas diferentes podem ter margens diferentes. */
export type DefinirMargem = Envelope<
  'DefinirMargem',
  {
    readonly arestaId: Id;
    readonly margemUM: UM;
  }
>;

/**
 * D3: vive no Modelo — `pecaId` e null.
 *
 * D9: `embebidoUM` e OBRIGATORIO no payload, nao tem default. Declarar "esta
 * costura fecha exata" (zero) e "esta copa embebe 25 mm" sao decisoes de
 * modelagem diferentes, e o evento tem que registrar qual delas foi tomada —
 * assumir zero por omissao esconderia a manga que ficou sem embebido.
 */
export type DefinirParCostura = Envelope<
  'DefinirParCostura',
  {
    readonly parId: Id;
    readonly arestaA: Id;
    readonly arestaB: Id;
    readonly embebidoUM: UM;
  }
>;

export type DefinirMetadados = Envelope<
  'DefinirMetadados',
  {
    readonly nome: string;
    readonly descricao?: string;
  }
>;

/**
 * Registra que as peças a seguir vieram de uma FOTO, e sob quais condições.
 *
 * Não muda o estado — é procedência. Existe porque daqui a dois anos alguém vai
 * perguntar por que aquela cava tem 3 mm a mais, e a resposta tem que estar no log,
 * não na memória de quem tirou a foto.
 *
 * O que ele guarda é o que determina a qualidade do resultado: qual quadro de
 * calibração foi usado, que foto era (por soma de verificação), quantos micrômetros
 * valia um pixel, o quanto o quadro fechou, e com que tolerância o contorno foi
 * simplificado. Um molde digitalizado a 1400 UM por pixel e outro a 350 são coisas
 * diferentes, e o log tem que saber distinguir.
 */
export type DigitalizarPorFoto = Envelope<
  'DigitalizarPorFoto',
  {
    readonly calibracaoId: Id;
    /** Soma de verificação da imagem. Identifica a foto, não a autentica. */
    readonly imagemSoma: string;
    readonly larguraPx: number;
    readonly alturaPx: number;
    readonly umPorPixel: UM;
    /** Pior desvio de uma marca à reta do lado dela, em UM. */
    readonly residuoDoQuadroUM: UM;
    readonly toleranciaUM: UM;
  }
>;

/**
 * Move um ponto por DELTA, com ou sem arrasto dos vizinhos (Parte 3, operacao 9).
 * O `MoverPonto` acima e coordenada absoluta; este e a edicao do modelista.
 *
 * `nVizinhos` viaja no payload mesmo no modo discreto: o evento tem que registrar
 * exatamente o que o modelista pediu, senao o replay de um log antigo depende de
 * qual era o padrao da interface naquele dia.
 */
export type ModificarPonto = Envelope<
  'ModificarPonto',
  {
    readonly pontoId: Id;
    readonly dx: UM;
    readonly dy: UM;
    readonly modo: 'discreto' | 'proporcional';
    readonly nVizinhos: number;
  }
>;

/**
 * Marca um ponto do contorno como GRADUAVEL (inegociavel 4: grade point e cidadao
 * de primeira classe, nao um extra da fase de graduacao).
 *
 * Marcar sem dar regra e legitimo e tem significado: pela D7 o grade point sem
 * regra fica PARADO — e assim que se declara a ancora da peca.
 */
export type MarcarGradePoint = Envelope<
  'MarcarGradePoint',
  {
    readonly gradePointId: Id;
    readonly pontoId: Id;
  }
>;

/**
 * Regra de graduacao: o incremento `(dx, dy)` de um grade point ENTRE DOIS
 * TAMANHOS CONSECUTIVOS da grade. Regra e DADO (linha de tabela), nunca codigo.
 *
 * Vive no Modelo (como o ParCostura), por isso `pecaId` e null: a grade de
 * tamanhos e do modelo, e o mesmo modelo grada pecas diferentes.
 */
export type DefinirRegraGraduacao = Envelope<
  'DefinirRegraGraduacao',
  {
    readonly regraId: Id;
    readonly pontoGraduacaoId: Id;
    readonly deTamanho: string;
    readonly paraTamanho: string;
    readonly dx: UM;
    readonly dy: UM;
  }
>;

/**
 * Eixo de dobra — entidade PERSISTIDA (Parte 3, op. 14): sobrevive a edicao,
 * gradua em posicao relativa e exporta como linha interna no DXF.
 */
export type DefinirEixoDobra = Envelope<
  'DefinirEixoDobra',
  {
    readonly eixoId: Id;
    readonly p1: Vetor2;
    readonly p2: Vetor2;
    readonly direcao: DirecaoDobra;
    readonly profundidadeUM?: UM;
  }
>;

export type RemoverEixoDobra = Envelope<'RemoverEixoDobra', { readonly eixoId: Id }>;

/** Espelha a peca inteira num eixo arbitrario (Parte 2, op. 5). */
export type EspelharPeca = Envelope<
  'EspelharPeca',
  {
    readonly p1: Vetor2;
    readonly p2: Vetor2;
  }
>;

export type RotacionarPeca = Envelope<
  'RotacionarPeca',
  {
    readonly centro: Vetor2;
    readonly anguloGraus: number;
  }
>;

export type TransladarPeca = Envelope<
  'TransladarPeca',
  {
    readonly dx: UM;
    readonly dy: UM;
  }
>;

/**
 * Acrescenta uma linha interna (fio, pence, furo, referencia de graduacao).
 *
 * `pontoIds` aponta para `Ponto` que ja existem na peca (D10) — normalmente
 * criados com `CriarPonto` de tipo `interno`. E o que permite marcar o fio como
 * grade point e grada-lo pela mesma regra do contorno.
 */
export type AdicionarLinhaInterna = Envelope<
  'AdicionarLinhaInterna',
  {
    readonly linhaId: Id;
    readonly tipo: TipoLinhaInterna;
    readonly pontoIds: readonly Id[];
  }
>;

/**
 * Crava um pique na aresta, na posicao `s` de COMPRIMENTO DE ARCO.
 *
 * `s` — e nao coordenada — porque e o que faz o pique acompanhar a peca: gradua
 * junto, sobrevive a edicao do vertice e ao espelhamento (que inverte `s -> 1-s`).
 * Guardar x/y seria descolar o pique da aresta no primeiro tamanho novo.
 *
 * As dimensoes vem no payload em vez de default no fold, porque o fold e puro e
 * o padrao pode mudar de ateliê para ateliê; quem emite resolve (ha
 * `ALTURA_PADRAO_DO_PIQUE_UM` / `LARGURA_PADRAO_DO_PIQUE_UM` para isso).
 */
export type AdicionarPique = Envelope<
  'AdicionarPique',
  {
    readonly piqueId: Id;
    readonly arestaId: Id;
    readonly s: number;
    readonly tipo: TipoPique;
    readonly alturaUM: UM;
    readonly larguraUM: UM;
    readonly anguloGraus: number;
  }
>;

/** Arrasta o pique ao longo da mesma aresta. */
export type MoverPique = Envelope<'MoverPique', { readonly piqueId: Id; readonly s: number }>;

/** Tira o pique da peca. */
export type RemoverPique = Envelope<'RemoverPique', { readonly piqueId: Id }>;

/**
 * Move um dos dois controles de um segmento curvo — e o gesto que da forma a cava
 * e ao decote. Os extremos do segmento NAO se movem (ver `moverControle`).
 */
export type MoverControle = Envelope<
  'MoverControle',
  {
    readonly segmentoId: Id;
    readonly indice: 0 | 1;
    readonly dx: UM;
    readonly dy: UM;
  }
>;

/**
 * Copia a peca inteira com ids novos derivados de `prefixoId` (D2).
 *
 * `comGraduacao` decide se as regras do MODELO que apontam para os grade points da
 * peca original ganham copia apontando para os da nova. Sem isso, a copia nasce
 * sem graduacao e o validador acusa — o que tambem e uma escolha legitima do
 * modelista, e por isso e campo, nao comportamento fixo.
 */
export type DuplicarPeca = Envelope<
  'DuplicarPeca',
  {
    readonly novoPecaId: Id;
    readonly prefixoId: Id;
    readonly dx: UM;
    readonly dy: UM;
    readonly comGraduacao: boolean;
  }
>;

/**
 * Corta a peca em duas por um eixo livre. A peca do envelope DESAPARECE e as duas
 * partes (`<id>-1` e `<id>-2`) entram no lugar.
 */
export type DividirPeca = Envelope<
  'DividirPeca',
  {
    readonly p1: Vetor2;
    readonly p2: Vetor2;
    readonly margemNovaUM: UM;
    readonly prefixoId: Id;
  }
>;

/** Abre as pregas dos eixos dados e deixa a peca PLANA, com os piques de prega. */
export type AbrirPregas = Envelope<
  'AbrirPregas',
  {
    readonly eixoIds: readonly Id[];
    readonly prefixoId: Id;
  }
>;

/**
 * Dimensiona a peca por fatores por eixo — o Encolhimento e o Dimensionar do oficio.
 *
 * Os fatores viajam como NUMERO (1,03 = cresce 3%), nunca como percentual, para o
 * evento nao depender de convencao de tela. Margens e faca do pique nao escalam;
 * ver `dimensionarPeca` no motor, que e quem decide isso e explica por que.
 */
export type DimensionarPeca = Envelope<
  'DimensionarPeca',
  {
    readonly centro: Vetor2;
    readonly fatorX: number;
    readonly fatorY: number;
  }
>;

/**
 * MATERIALIZA a meia-peca desdobrada no eixo: vira a peca inteira, editavel.
 * A geometria e a validacao moram em  no motor.
 */
export type DesdobrarPeca = Envelope<
  'DesdobrarPeca',
  {
    readonly eixoDobraId: Id;
    readonly prefixoId: Id;
  }
>;

/**
 * Abre uma PENCE no contorno: boca de  centrada na fracao  da
 * aresta, apice a  para dentro. Geometria e recusas em
 *  no motor.
 */
export type AbrirPence = Envelope<
  'AbrirPence',
  {
    readonly arestaId: Id;
    readonly s: number;
    readonly aberturaUM: UM;
    readonly profundidadeUM: UM;
    readonly prefixoId: Id;
  }
>;

/** Troca as propriedades de encaixe depois de a peca existir (quantidade, giro, par). */
export type DefinirEncaixe = Envelope<
  'DefinirEncaixe',
  {
    readonly encaixe: PropriedadesEncaixe;
  }
>;

/**
 * Declara o rolo de papel do plotter. Vive no MODELO (`pecaId` null): o rolo e da
 * casa, nao da peca.
 */
export type DefinirPapel = Envelope<
  'DefinirPapel',
  {
    readonly papelId: Id;
    readonly nome: string;
    readonly larguraUM: UM;
    readonly margemDeSegurancaUM: UM;
  }
>;

/** Tira a peca do modelo. `ParCostura` que apontava para ela fica, e a conferencia acusa. */
export type RemoverPeca = Envelope<'RemoverPeca', Record<string, never>>;

export type RemoverLinhaInterna = Envelope<'RemoverLinhaInterna', { readonly linhaId: Id }>;

export type RemoverRecorte = Envelope<'RemoverRecorte', { readonly recorteId: Id }>;

/**
 * Desmarca um grade point. As regras que apontavam para ele NAO sao apagadas em
 * cascata: apagar em silencio esconderia do modelista que ele acabou de perder a
 * graduacao daquele ponto. Elas ficam, e `validarModelo` acusa.
 */
export type DesmarcarGradePoint = Envelope<
  'DesmarcarGradePoint',
  { readonly gradePointId: Id }
>;

export type RemoverRegraGraduacao = Envelope<
  'RemoverRegraGraduacao',
  { readonly regraId: Id }
>;

export type RemoverParCostura = Envelope<'RemoverParCostura', { readonly parId: Id }>;

/** Recorte interno (camada 11 do DXF ASTM): anel FECHADO dentro da peca. */
export type AdicionarRecorte = Envelope<
  'AdicionarRecorte',
  {
    readonly recorteId: Id;
    readonly pontoIds: readonly Id[];
  }
>;

/**
 * Insere um ponto no meio de um segmento, na posicao `s` de COMPRIMENTO DE ARCO.
 *
 * `prefixoId` e a entropia que vem de fora (D2): o fold deriva dele os ids do
 * ponto e do segmento novos, de forma deterministica, para o replay reproduzir
 * exatamente os mesmos ids do snapshot.
 */
export type InserirPonto = Envelope<
  'InserirPonto',
  {
    readonly segmentoId: Id;
    readonly s: number;
    readonly prefixoId: Id;
  }
>;

/** Remove um ponto do meio de uma aresta, fundindo os dois segmentos vizinhos. */
export type ExcluirPonto = Envelope<
  'ExcluirPonto',
  {
    readonly pontoId: Id;
  }
>;

/** Converte um segmento entre reta e curva, preservando os extremos. */
export type ConverterSegmento = Envelope<
  'ConverterSegmento',
  {
    readonly segmentoId: Id;
    readonly para: TipoSegmento;
  }
>;

/** Fillet: troca o canto por um arco de raio `raioUM`. */
export type ArredondarVertice = Envelope<
  'ArredondarVertice',
  {
    readonly pontoId: Id;
    readonly raioUM: UM;
    readonly prefixoId: Id;
  }
>;

/** Chanfro: troca o canto por uma reta que corta os dois lados a `distanciaUM`. */
export type ChanfrarVertice = Envelope<
  'ChanfrarVertice',
  {
    readonly pontoId: Id;
    readonly distanciaUM: UM;
    readonly prefixoId: Id;
  }
>;

/**
 * Douglas-Peucker no contorno com tolerancia EXPLICITA.
 *
 * A tolerancia viaja no payload em vez de sair de uma constante: simplificar e
 * destrutivo, e o log tem que registrar com que criterio o modelista aceitou
 * perder pontos naquele dia.
 */
export type SimplificarContorno = Envelope<
  'SimplificarContorno',
  {
    readonly toleranciaUM: UM;
  }
>;

export type Evento =
  | CriarModelo
  | CriarPeca
  | CriarPonto
  | MoverPonto
  | DefinirAresta
  | DefinirSegmento
  | DefinirMargem
  | DefinirParCostura
  | DefinirMetadados
  | DigitalizarPorFoto
  | ModificarPonto
  | AdicionarLinhaInterna
  | AdicionarRecorte
  | AdicionarPique
  | MoverPique
  | RemoverPique
  | MoverControle
  | DuplicarPeca
  | DividirPeca
  | AbrirPregas
  | DefinirEncaixe
  | DefinirPapel
  | RemoverPeca
  | RemoverLinhaInterna
  | RemoverRecorte
  | DesmarcarGradePoint
  | RemoverRegraGraduacao
  | RemoverParCostura
  | DefinirEixoDobra
  | RemoverEixoDobra
  | EspelharPeca
  | DimensionarPeca
  | DesdobrarPeca
  | AbrirPence
  | RotacionarPeca
  | TransladarPeca
  | InserirPonto
  | ExcluirPonto
  | ConverterSegmento
  | ArredondarVertice
  | ChanfrarVertice
  | SimplificarContorno
  | MarcarGradePoint
  | DefinirRegraGraduacao;

export type TipoEvento = Evento['tipo'];
