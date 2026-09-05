/**
 * Dividir peca (Parte 3, operacao 15) — DISTINTA da dobra: aqui saem `N` pecas
 * independentes, nao uma peca cuja geometria de corte e espelhada.
 *
 * ## A regra critica
 * Cada parte recebe **margem de costura propria na aresta nova**. A soma das
 * partes consome MAIS tecido que a original, e isso e o certo: onde antes havia
 * tecido continuo agora ha duas bordas que precisam ser costuradas de volta. Gerar
 * as partes sem a margem nova entrega peca pequena que nao fecha — e o defeito so
 * aparece na maquina de costura.
 *
 * ## Como o corte e feito
 * Os pontos onde o eixo cruza o contorno sao INSERIDOS no contorno original
 * (operacao 13, ja testada), e so entao a peca e partida. Isso da duas coisas de
 * graca: a curva cortada e dividida por de Casteljau, sem virar poligonal, e cada
 * pedaco continua sabendo de que aresta veio — entao a margem de cada aresta
 * herdada segue junto, com o mesmo `arestaId` (D3). A aresta NOVA e a unica que
 * ganha id derivado do prefixo.
 *
 * ## O que e herdado e o que e recusado
 * Herdam: propriedades de encaixe, grade points (cada um vai para a parte que
 * ficou com o seu ponto) e o fio, RECORTADO no lado de cada parte — recortar um
 * segmento num semiplano e conta exata, nao chute. Sao recusados o recorte interno
 * e o eixo de dobra que ATRAVESSAM a linha de divisao: reparti-los e decisao de
 * modelagem, nao mecanica.
 */
import { ErroMotor, exigir } from './erros.js';
import type {
  Aresta,
  Id,
  LinhaInterna,
  Peca,
  Pique,
  Ponto,
  PontoGraduacao,
  Segmento,
  Vetor2,
} from './tipos.js';
import { exigirUM, TOLERANCIA_MEDICAO_UM, type UM } from './unidades.js';
import { area } from './geometria/anel.js';
import { anelDoContorno } from './geometria/anel.js';
import { tesselarSegmento } from './geometria/tesselar.js';
import { inserirPonto } from './edicao.js';
import { direcaoDoEixo, ladoDoEixo, type Eixo, type Vetor2Flutuante } from './transformar.js';

/** Distancia ao eixo abaixo da qual um ponto conta como estando EM CIMA dele. */
const NA_LINHA_UM = 2;

/**
 * Corta a peca em duas por um eixo livre.
 *
 * `margemNovaUM` e a margem das duas arestas de corte — uma em cada parte.
 * `prefixoId` gera os ids das entidades novas (D2: entropia vem de fora).
 */
export function dividirPeca(
  peca: Peca,
  eixo: Eixo,
  margemNovaUM: UM,
  prefixoId: Id,
): [Peca, Peca] {
  exigirUM(margemNovaUM, 'margemNovaUM de dividirPeca');
  exigir(
    margemNovaUM >= 0,
    'MARGEM_NEGATIVA',
    `A margem da aresta de corte e ${margemNovaUM} UM. Margem negativa encolheria as partes ` +
      `justamente onde elas precisam de tecido para voltar a ser costuradas.`,
    { pecaId: peca.id, margemNovaUM },
  );

  const direcao = direcaoDoEixo(eixo, peca.id);
  exigirAtravessaDeLadoALado(peca, eixo, direcao);

  const cortada = inserirCruzamentos(peca, eixo, direcao, prefixoId);
  const naLinha = verticesNaLinha(cortada, eixo, direcao);
  exigir(
    naLinha.length === 2,
    'LINHA_DIVISAO_NAO_ATRAVESSA',
    `Depois de inserir os cruzamentos, o eixo toca o contorno da peca ` +
      `"${peca.metadados.nome}" em ${naLinha.length} ponto(s); a divisao em duas partes ` +
      `precisa de exatamente 2.`,
    { pecaId: peca.id, pontos: naLinha.length },
  );

  const [corteA, corteB] = naLinha;
  const primeira = montarParte(cortada, corteA!, corteB!, eixo, direcao, margemNovaUM, prefixoId, 1);
  const segunda = montarParte(cortada, corteB!, corteA!, eixo, direcao, margemNovaUM, prefixoId, 2);

  const areaOriginal = area(anelDoContorno(peca));
  for (const parte of [primeira, segunda]) {
    const areaParte = area(anelDoContorno(parte));
    exigir(
      areaParte > 0,
      'PARTE_DE_AREA_ZERO',
      `A parte "${parte.metadados.nome}" saiu com area zero. O eixo passou rente ao ` +
        `contorno em vez de atravessa-lo.`,
      { pecaId: peca.id, parte: parte.id },
    );
    exigir(
      areaParte < areaOriginal,
      'PARTE_DE_AREA_ZERO',
      `A parte "${parte.metadados.nome}" tem area ${areaParte} UM2, maior ou igual a peca ` +
        `inteira (${areaOriginal} UM2). O corte nao separou nada.`,
      { pecaId: peca.id, parte: parte.id },
    );
  }

  return [primeira, segunda];
}

/** Antes de mexer em nada: o eixo tem que deixar area dos DOIS lados. */
function exigirAtravessaDeLadoALado(peca: Peca, eixo: Eixo, direcao: Vetor2Flutuante): void {
  const anel = anelDoContorno(peca);
  let positivos = 0;
  let negativos = 0;
  for (const ponto of anel) {
    const lado = ladoDoEixo(ponto, eixo, direcao);
    if (lado > NA_LINHA_UM) positivos++;
    else if (lado < -NA_LINHA_UM) negativos++;
  }
  exigir(
    positivos > 0 && negativos > 0,
    'LINHA_DIVISAO_NAO_ATRAVESSA',
    `O eixo de divisao nao atravessa a peca "${peca.metadados.nome}" de lado a lado: ` +
      `${positivos} vertice(s) de um lado e ${negativos} do outro. Um eixo que so encosta ` +
      `no contorno nao separa nada.`,
    { pecaId: peca.id, positivos, negativos },
  );
}

/** Insere um ponto em cada segmento que o eixo cruza, para o corte cair em vertice. */
function inserirCruzamentos(
  peca: Peca,
  eixo: Eixo,
  direcao: Vetor2Flutuante,
  prefixoId: Id,
): Peca {
  let atual = peca;
  let contador = 0;

  // O contorno muda a cada insercao, entao percorre os ids originais e reavalia.
  for (const segmentoId of peca.contorno) {
    const s = cruzamentoNoSegmento(atual, segmentoId, eixo, direcao);
    if (s === null) continue;
    atual = inserirPonto(atual, segmentoId, s, `${prefixoId}-c${contador++}`);
  }
  return atual;
}

/**
 * Posicao `s` (por comprimento de arco) onde o eixo cruza o segmento, ou `null`.
 * Trabalha sobre a poligonal do proprio segmento, entao vale igual para reta e
 * para curva — e o `s` devolvido e o que `inserirPonto` espera.
 */
function cruzamentoNoSegmento(
  peca: Peca,
  segmentoId: Id,
  eixo: Eixo,
  direcao: Vetor2Flutuante,
): number | null {
  const pontos = tesselarSegmento(peca, segmentoId, TOLERANCIA_MEDICAO_UM);
  const lados = pontos.map((p) => ladoDoEixo(p, eixo, direcao));

  // Extremo em cima do eixo ja e um vertice de corte: nao ha o que inserir.
  if (Math.abs(lados[0]!) <= NA_LINHA_UM || Math.abs(lados[lados.length - 1]!) <= NA_LINHA_UM) {
    return null;
  }

  const acumulado: number[] = [0];
  for (let i = 1; i < pontos.length; i++) {
    const a = pontos[i - 1]!;
    const b = pontos[i]!;
    acumulado.push(acumulado[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = acumulado[acumulado.length - 1]!;
  if (total === 0) return null;

  for (let i = 1; i < pontos.length; i++) {
    const anterior = lados[i - 1]!;
    const atual = lados[i]!;
    if (anterior === atual || anterior * atual > 0) continue;
    const fracao = anterior / (anterior - atual);
    const arco = acumulado[i - 1]! + fracao * (acumulado[i]! - acumulado[i - 1]!);
    const s = arco / total;
    if (s <= 0 || s >= 1) continue;
    return s;
  }
  return null;
}

/** Ids dos vertices do contorno que caem em cima do eixo, na ordem do contorno. */
function verticesNaLinha(peca: Peca, eixo: Eixo, direcao: Vetor2Flutuante): Id[] {
  const encontrados: Id[] = [];
  for (const segmentoId of peca.contorno) {
    const pontoId = peca.segmentos[segmentoId]!.de;
    const ponto = peca.pontos[pontoId]!;
    if (Math.abs(ladoDoEixo(ponto, eixo, direcao)) <= NA_LINHA_UM) encontrados.push(pontoId);
  }
  return encontrados;
}

/** Monta uma parte: do vertice `de` ate o `para`, andando para a frente no contorno. */
function montarParte(
  peca: Peca,
  de: Id,
  para: Id,
  eixo: Eixo,
  direcao: Vetor2Flutuante,
  margemNovaUM: UM,
  prefixoId: Id,
  numero: number,
): Peca {
  const inicio = peca.contorno.findIndex((id) => peca.segmentos[id]!.de === de);
  const total = peca.contorno.length;
  const trecho: Segmento[] = [];
  for (let k = 0; k < total; k++) {
    const segmento = peca.segmentos[peca.contorno[(inicio + k) % total]!]!;
    trecho.push(segmento);
    if (segmento.para === para) break;
  }

  const arestaDoCorte = `${prefixoId}-corte-${numero}`;
  const segmentoDoCorte: Segmento = {
    id: `${prefixoId}-sg-${numero}`,
    arestaId: arestaDoCorte,
    de: para,
    para: de,
    tipo: 'reta',
  };

  // Pontos do contorno da parte.
  const pontos: Record<Id, Ponto> = {};
  for (const segmento of trecho) {
    pontos[segmento.de] = peca.pontos[segmento.de]!;
    pontos[segmento.para] = peca.pontos[segmento.para]!;
  }

  // Arestas herdadas: mesmo id (D3), extremos ajustados ao pedaco que sobrou.
  const arestas: Record<Id, Aresta> = {};
  const margens: Record<Id, UM> = {};
  for (const segmento of trecho) {
    const existente = arestas[segmento.arestaId];
    arestas[segmento.arestaId] =
      existente === undefined
        ? {
            id: segmento.arestaId,
            pecaId: `${peca.id}-${numero}`,
            pontoInicioId: segmento.de,
            pontoFimId: segmento.para,
          }
        : { ...existente, pontoFimId: segmento.para };
    const margem = peca.margens[segmento.arestaId];
    if (margem !== undefined) margens[segmento.arestaId] = margem;
  }
  arestas[arestaDoCorte] = {
    id: arestaDoCorte,
    pecaId: `${peca.id}-${numero}`,
    pontoInicioId: para,
    pontoFimId: de,
  };
  margens[arestaDoCorte] = margemNovaUM;

  const segmentos: Record<Id, Segmento> = {};
  for (const segmento of trecho) segmentos[segmento.id] = segmento;
  segmentos[segmentoDoCorte.id] = segmentoDoCorte;

  // Pique de casamento no meio da aresta nova: e por ele que o costureiro casa as
  // duas partes de volta. Mesmo `s` nas duas, entao caem no mesmo lugar.
  const piqueDoCorte: Pique = {
    id: `${prefixoId}-pq-${numero}`,
    tipo: 'I',
    alturaUM: 6350,
    larguraUM: 1590,
    anguloGraus: 0,
    arestaId: arestaDoCorte,
    s: 0.5,
  };

  const { linhasInternas, pontosInternos } = repartirInternos(
    peca,
    eixo,
    direcao,
    numero,
    prefixoId,
  );
  Object.assign(pontos, pontosInternos);

  return {
    ...peca,
    id: `${peca.id}-${numero}`,
    pontos,
    segmentos,
    arestas,
    contorno: [...trecho.map((s) => s.id), segmentoDoCorte.id],
    margens,
    linhasInternas,
    recortes: exigirDoLadoCerto(peca, eixo, direcao, numero),
    piques: { [piqueDoCorte.id]: piqueDoCorte },
    eixosDobra: {},
    gradePoints: repartirGradePoints(peca, pontos),
    metadados: { ...peca.metadados, nome: `${peca.metadados.nome}_${numero}` },
  };
}

/**
 * Fio, pence e furo: cada linha e RECORTADA no semiplano da parte. Segmento
 * cortado por semiplano e conta exata — o ponto de corte fica em cima do eixo.
 */
function repartirInternos(
  peca: Peca,
  eixo: Eixo,
  direcao: Vetor2Flutuante,
  numero: number,
  prefixoId: Id,
): { linhasInternas: Record<Id, LinhaInterna>; pontosInternos: Record<Id, Ponto> } {
  const sinal = numero === 1 ? 1 : -1;
  const linhasInternas: Record<Id, LinhaInterna> = {};
  const pontosInternos: Record<Id, Ponto> = {};

  const doMeuLado = (pontoId: Id): number =>
    ladoDoEixo(peca.pontos[pontoId]!, eixo, direcao) * sinal;

  for (const linha of Object.values(peca.linhasInternas)) {
    const mantidos: Id[] = [];
    let corte = 0;

    for (let i = 0; i < linha.pontos.length; i++) {
      const pontoId = linha.pontos[i]!;
      const lado = doMeuLado(pontoId);
      if (lado >= -NA_LINHA_UM) {
        mantidos.push(pontoId);
        pontosInternos[pontoId] = peca.pontos[pontoId]!;
      }

      // Par que atravessa o eixo: entra o ponto de corte, EM CIMA do eixo.
      const proximoId = linha.pontos[i + 1];
      if (proximoId === undefined) continue;
      const ladoProximo = doMeuLado(proximoId);
      if (lado * ladoProximo >= 0) continue;

      const a = peca.pontos[pontoId]!;
      const b = peca.pontos[proximoId]!;
      const fracao = lado / (lado - ladoProximo);
      const id = `${prefixoId}-${linha.id}-${numero}-${corte++}`;
      const noEixo: Ponto = {
        id,
        x: Math.round(a.x + (b.x - a.x) * fracao),
        y: Math.round(a.y + (b.y - a.y) * fracao),
        tipo: 'interno',
      };
      mantidos.push(id);
      pontosInternos[id] = noEixo;
    }

    // Uma linha precisa de dois pontos; um ponto solto do lado de ca nao e linha.
    if (mantidos.length >= 2) {
      linhasInternas[linha.id] = { ...linha, pontos: mantidos };
    } else {
      for (const id of mantidos) delete pontosInternos[id];
    }
  }
  return { linhasInternas, pontosInternos };
}

/** Recorte inteiro de um lado fica; recorte que atravessa a linha e recusado. */
function exigirDoLadoCerto(
  peca: Peca,
  eixo: Eixo,
  direcao: Vetor2Flutuante,
  numero: number,
): Record<Id, { readonly id: Id; readonly pontos: readonly Id[] }> {
  const sinal = numero === 1 ? 1 : -1;
  const meus: Record<Id, { readonly id: Id; readonly pontos: readonly Id[] }> = {};

  for (const recorte of Object.values(peca.recortes)) {
    let deste = 0;
    let doOutro = 0;
    for (const pontoId of recorte.pontos) {
      const lado = ladoDoEixo(peca.pontos[pontoId]!, eixo, direcao) * sinal;
      if (lado > NA_LINHA_UM) deste++;
      else if (lado < -NA_LINHA_UM) doOutro++;
    }
    if (deste > 0 && doOutro > 0) {
      throw new ErroMotor(
        'RECORTE_ATRAVESSA_A_DIVISAO',
        `O recorte "${recorte.id}" da peca "${peca.metadados.nome}" fica dos dois lados da ` +
          `linha de divisao. Reparti-lo entre as duas pecas e decisao de modelagem, nao ` +
          `mecanica: recusando em vez de escolher por conta propria.`,
        { pecaId: peca.id, recorteId: recorte.id },
      );
    }
    if (deste > 0) meus[recorte.id] = recorte;
  }
  return meus;
}

/** Grade point vai para a parte que ficou com o ponto dele. */
function repartirGradePoints(peca: Peca, pontos: Record<Id, Ponto>): Record<Id, PontoGraduacao> {
  const meus: Record<Id, PontoGraduacao> = {};
  for (const gradePoint of Object.values(peca.gradePoints)) {
    if (pontos[gradePoint.pontoId] !== undefined) meus[gradePoint.id] = gradePoint;
  }
  return meus;
}

/** Coordenada de um ponto, para quem so precisa do par. */
export function coordenadaDoPonto(peca: Peca, pontoId: Id): Vetor2 {
  const ponto = peca.pontos[pontoId];
  if (ponto === undefined) {
    throw new ErroMotor('PONTO_INEXISTENTE', `Ponto "${pontoId}" nao existe.`, { pontoId });
  }
  return { x: ponto.x, y: ponto.y };
}
