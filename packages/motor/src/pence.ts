/**
 * Pence no contorno (a "Pence no contorno" da aba PRODUCAO do oficio).
 *
 * Uma pence e um bico que entra pela borda: a boca fica no contorno (largura =
 * `abertura`) e o vertice — o apice — fica dentro da peca, a `profundidade` da
 * borda. Costurada, ela tira folga do tecido e da forma tridimensional a peca.
 *
 * ## Como e construida
 * Dois pontos sao inseridos na aresta, um em cada lado da posicao pedida, a meia
 * abertura de distancia EM COMPRIMENTO DE ARCO (nao em corda: em cava curva os
 * dois sao diferentes, e a costureira mede pela borda). O trecho entre eles e
 * substituido por duas RETAS ate o apice — pence de perna reta, que e a pence de
 * oficio; quem quiser perna curva edita depois com as ferramentas de curva.
 *
 * ## Restricoes ditas
 *  - A boca nao pode atravessar um VERTICE do contorno: pence em cima de canto
 *    nao existe no oficio, e permiti-la partiria uma aresta em tres sem dono
 *    para margem e pique. Recusado com o motivo.
 *  - A boca tem que caber na aresta com folga de 2% em cada ponta.
 *
 * ## O que acontece com os piques da MESMA aresta (dito, e testado)
 * Pique ancora por FRACAO do comprimento da aresta, e abrir a pence muda esse
 * comprimento (a borda agora desce ate o apice e volta). Piques da aresta
 * continuam na mesma fracao — o lugar fisico desliza um pouco. E o mesmo
 * comportamento de qualquer edicao que muda o comprimento, e o modelista confere
 * na tela; travar pique em milimetro absoluto quebraria a graduacao (D3).
 */
import { exigir } from './erros.js';
import type { Id, Peca, Segmento, Vetor2 } from './tipos.js';
import { exigirUM, type UM } from './unidades.js';
import { inserirPonto } from './edicao.js';
import { localizarNoContorno } from './piques.js';
import { medirAresta, pontoEmS, tabelaArcoDaAresta, pontoNaTabela } from './geometria/medir.js';
import { anelDoContorno, anelEhSimples, area } from './geometria/anel.js';

/**
 * Abre uma pence na aresta, com a boca centrada na fracao `s` do comprimento.
 *
 * `prefixoId` apelida os ids novos (dois pontos da boca, o apice e os segmentos),
 * como em toda operacao que cria geometria: id vem de fora (D6).
 */
export function abrirPence(
  peca: Peca,
  arestaId: Id,
  s: number,
  aberturaUM: UM,
  profundidadeUM: UM,
  prefixoId: Id,
): Peca {
  exigirUM(aberturaUM, 'aberturaUM de abrirPence');
  exigirUM(profundidadeUM, 'profundidadeUM de abrirPence');
  exigir(
    aberturaUM > 0 && profundidadeUM > 0,
    'PENCE_INVALIDA',
    `Pence com abertura ${aberturaUM} UM e profundidade ${profundidadeUM} UM nao tira folga ` +
      `nenhuma. Os dois precisam ser positivos.`,
    { pecaId: peca.id, aberturaUM, profundidadeUM },
  );
  exigir(
    Number.isFinite(s) && s > 0 && s < 1,
    'PENCE_INVALIDA',
    `A posicao s = ${String(s)} da boca precisa estar entre 0 e 1 (fracao do comprimento da aresta).`,
    { pecaId: peca.id, arestaId, s },
  );

  const comprimento = medirAresta(peca, arestaId);
  const meiaBoca = aberturaUM / 2 / comprimento;
  const sA = s - meiaBoca;
  const sB = s + meiaBoca;
  exigir(
    sA > 0.02 && sB < 0.98,
    'PENCE_INVALIDA',
    `A boca da pence (${aberturaUM} UM em torno de s = ${s}) nao cabe na aresta ` +
      `"${arestaId}" (${Math.round(comprimento)} UM): passaria a menos de 2% de um vertice. ` +
      `Aproxime a pence do meio da aresta ou diminua a abertura.`,
    { pecaId: peca.id, arestaId, sA, sB },
  );

  // Os dois lados da boca tem que cair no MESMO segmento: pence nao atravessa
  // vertice. Conferido ANTES de inserir, com os alvos fisicos dos dois lados.
  const tabela = tabelaArcoDaAresta(peca, arestaId);
  const alvoA = pontoNaTabela(tabela, sA, arestaId);
  const alvoB = pontoNaTabela(tabela, sB, arestaId);
  const lugarA = localizarNoContorno(peca, alvoA);
  const lugarB = localizarNoContorno(peca, alvoB);
  exigir(
    lugarA.arestaId === arestaId && lugarB.arestaId === arestaId,
    'PENCE_INVALIDA',
    `A boca da pence caiu fora da aresta "${arestaId}" (achou "${lugarA.arestaId}" e ` +
      `"${lugarB.arestaId}"). Confira a posicao.`,
    { pecaId: peca.id, arestaId },
  );
  exigir(
    lugarA.segmentoId === lugarB.segmentoId,
    'PENCE_INVALIDA',
    `A boca da pence atravessa um vertice do contorno (comeca no segmento ` +
      `"${lugarA.segmentoId}" e termina no "${lugarB.segmentoId}"). Pence em cima de canto ` +
      `nao existe no oficio — mova a boca ou diminua a abertura.`,
    { pecaId: peca.id, arestaId },
  );

  // O centro fisico e a normal interna saem ANTES de cortar: e a geometria
  // original que define para onde o apice aponta.
  const centro = pontoEmS(peca, arestaId, s);
  const tangente = { x: alvoB.x - alvoA.x, y: alvoB.y - alvoA.y };
  const norma = Math.hypot(tangente.x, tangente.y);
  exigir(
    norma > 0,
    'PENCE_INVALIDA',
    `A boca da pence tem largura zero na aresta "${arestaId}".`,
    { pecaId: peca.id, arestaId },
  );
  // Contorno CCW: o interior fica a ESQUERDA do sentido de percurso. A normal
  // interna e a tangente girada 90 graus no sentido anti-horario.
  const interna = { x: -tangente.y / norma, y: tangente.x / norma };
  const apice: Vetor2 = {
    x: Math.round(centro.x + interna.x * profundidadeUM),
    y: Math.round(centro.y + interna.y * profundidadeUM),
  };

  // Corta A, relocaliza e corta B (a insercao de A mudou os segmentos).
  let cortada = inserirPonto(peca, lugarA.segmentoId, lugarA.sNoSegmento, `${prefixoId}a`);
  const lugarB2 = localizarNoContorno(cortada, alvoB);
  cortada = inserirPonto(cortada, lugarB2.segmentoId, lugarB2.sNoSegmento, `${prefixoId}b`);

  const pontoA = `${prefixoId}a-p`;
  const pontoB = `${prefixoId}b-p`;

  // O segmento da boca: o unico que vai de A para B no contorno.
  const doMeio = cortada.contorno.find((id) => {
    const seg = cortada.segmentos[id]!;
    return seg.de === pontoA && seg.para === pontoB;
  });
  exigir(
    doMeio !== undefined,
    'PENCE_INVALIDA',
    `Depois de inserir os dois lados da boca, nao sobrou um segmento unico entre eles na ` +
      `peca "${peca.metadados.nome}". Isso e um defeito interno — reporte com o modelo.`,
    { pecaId: peca.id, arestaId },
  );

  const apiceId = `${prefixoId}q-p`;
  const pernaVoltaId = `${prefixoId}q-s`;
  exigir(
    cortada.pontos[apiceId] === undefined && cortada.segmentos[pernaVoltaId] === undefined,
    'PENCE_INVALIDA',
    `O prefixo "${prefixoId}" ja foi usado nesta peca. Cada pence precisa do seu.`,
    { pecaId: peca.id, prefixoId },
  );

  const antigo = cortada.segmentos[doMeio]!;
  const perna1: Segmento = {
    id: antigo.id,
    arestaId: antigo.arestaId,
    de: pontoA,
    para: apiceId,
    tipo: 'reta',
  };
  const perna2: Segmento = {
    id: pernaVoltaId,
    arestaId: antigo.arestaId,
    de: apiceId,
    para: pontoB,
    tipo: 'reta',
  };
  const posicao = cortada.contorno.indexOf(doMeio);
  const contorno = [...cortada.contorno];
  contorno.splice(posicao + 1, 0, pernaVoltaId);

  const aberta: Peca = {
    ...cortada,
    pontos: {
      ...cortada.pontos,
      [apiceId]: { id: apiceId, x: apice.x, y: apice.y, tipo: 'contorno' },
    },
    segmentos: { ...cortada.segmentos, [antigo.id]: perna1, [pernaVoltaId]: perna2 },
    contorno,
  };

  // A pence TIRA area (o bico entra). Se a area cresceu, a normal apontou para
  // fora — e isso seria um molde silenciosamente maior.
  const areaAntes = area(anelDoContorno(peca));
  const anelDepois = anelDoContorno(aberta);
  const areaDepois = area(anelDepois);
  exigir(
    areaDepois < areaAntes,
    'PENCE_INVALIDA',
    `A pence AUMENTOU a area da peca "${peca.metadados.nome}" (${areaAntes} -> ${areaDepois} ` +
      `UM2). O apice caiu para fora do contorno.`,
    { pecaId: peca.id, areaAntes, areaDepois },
  );

  // As pernas novas nao podem CRUZAR o resto do contorno — uma pence funda ao
  // lado de outra faz exatamente isso, e um contorno que se cruza nao tem
  // dentro e fora. Recusar aqui e o erro explicito; deixar passar seria
  // corromper o molde calado (o estresse pegou este caso).
  exigir(
    anelEhSimples(anelDepois),
    'PENCE_INVALIDA',
    `A pence em s = ${s} da aresta "${arestaId}" cruzaria o contorno da peca ` +
      `"${peca.metadados.nome}" (as pernas invadem outra pence ou uma regiao ja recortada). ` +
      `Afaste a pence ou diminua a profundidade.`,
    { pecaId: peca.id, arestaId, s },
  );

  return aberta;
}
