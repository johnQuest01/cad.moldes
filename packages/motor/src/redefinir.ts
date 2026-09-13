/**
 * Redefinir o comprimento de uma aresta — o "Redefinir perimetro" do oficio.
 *
 * O modelista mede a cava da frente, mede a cabeca da manga, e a segunda tem que
 * CASAR com a primeira (mais o embebido). Hoje ele ve a diferenca com a
 * ferramenta de medir e corrige puxando ponto no olho. Isto aqui impoe o numero.
 *
 * ## Como: escala uniforme em torno do PONTO INICIAL da aresta
 * Todos os pontos da aresta (menos o pivo) e os controles das Beziers dela sao
 * escalados por `alvo / atual` em torno do ponto inicial. Escala uniforme
 * multiplica comprimento de arco pelo fator EXATAMENTE — nao ha reamostragem nem
 * aproximacao, e a forma da curva e preservada (so muda de tamanho).
 *
 * ## O ponto final se move, e a aresta VIZINHA sente
 * O ponto final e compartilhado com a proxima aresta: mover ele estica a vizinha,
 * como qualquer edicao de ponto. E o mesmo comportamento do oficio — quem redefine
 * a lateral sabe que a barra acompanha — e e por isso que esta operacao NAO fecha
 * o contorno sozinha: ela mexe numa aresta e deixa o resto para o modelista ver.
 *
 * ## A faixa
 * Mesma regra do dimensionar: fator entre 0,25 e 4. Impor 10 mm numa cava de
 * 600 mm e quase sempre engano de unidade, e o erro diz isso.
 */
import { exigir, exigirDoMapa } from './erros.js';
import type { Id, Peca, Ponto, Segmento, Vetor2 } from './tipos.js';
import { exigirUM, type UM } from './unidades.js';
import { medirAresta } from './geometria/medir.js';
import { segmentosDaAresta } from './geometria/aresta.js';
import { anelDoContorno, anelEhSimples } from './geometria/anel.js';

export function redefinirComprimentoDaAresta(
  peca: Peca,
  arestaId: Id,
  comprimentoUM: UM,
): Peca {
  exigirUM(comprimentoUM, 'comprimentoUM de redefinirComprimentoDaAresta');
  const aresta = exigirDoMapa(peca.arestas, arestaId, 'ARESTA_INEXISTENTE', 'Aresta');
  const atual = medirAresta(peca, arestaId);
  exigir(
    atual > 0,
    'ARESTA_INEXISTENTE',
    `A aresta "${arestaId}" da peca "${peca.metadados.nome}" tem comprimento zero.`,
    { pecaId: peca.id, arestaId },
  );
  const fator = comprimentoUM / atual;
  exigir(
    Number.isFinite(fator) && fator >= 0.25 && fator <= 4,
    'VALOR_NAO_FINITO',
    `Redefinir a aresta "${arestaId}" de ${Math.round(atual)} para ${comprimentoUM} UM e um ` +
      `fator de ${fator.toFixed(3)} — fora da faixa aceita (0,25 a 4). Diferenca dessa ordem ` +
      `e quase sempre engano de unidade; confira a medida.`,
    { pecaId: peca.id, arestaId, fator },
  );

  const pivo = exigirDoMapa(peca.pontos, aresta.pontoInicioId, 'PONTO_INEXISTENTE', 'Ponto');
  const escalar = (p: Vetor2): Vetor2 => ({
    x: Math.round(pivo.x + (p.x - pivo.x) * fator),
    y: Math.round(pivo.y + (p.y - pivo.y) * fator),
  });

  const daAresta = segmentosDaAresta(peca, arestaId);
  const pontosDaAresta = new Set<Id>();
  for (const s of daAresta) {
    pontosDaAresta.add(s.de);
    pontosDaAresta.add(s.para);
  }
  pontosDaAresta.delete(aresta.pontoInicioId);

  const pontos: Record<Id, Ponto> = { ...peca.pontos };
  for (const id of pontosDaAresta) {
    const p = pontos[id]!;
    const movido = escalar(p);
    pontos[id] = { ...p, x: movido.x, y: movido.y };
  }
  const segmentos: Record<Id, Segmento> = { ...peca.segmentos };
  for (const s of daAresta) {
    if (s.controles !== undefined) {
      segmentos[s.id] = {
        ...s,
        controles: [escalar(s.controles[0]), escalar(s.controles[1])],
      };
    }
  }

  const nova: Peca = { ...peca, pontos, segmentos };

  // Esticar uma aresta arrasta os pontos DELA — e numa aresta cheia de pences,
  // uma perna arrastada pode cruzar a vizinha. Contorno que se cruza nao tem
  // dentro e fora; recusar aqui e o erro explicito (o estresse pegou o caso,
  // semente 7, passo 111 — o mesmo genero de furo que a pence tinha).
  exigir(
    anelEhSimples(anelDoContorno(nova)),
    'CONTORNO_AUTO_INTERSECTADO',
    `Redefinir a aresta "${arestaId}" para ${comprimentoUM} UM faria o contorno da peca ` +
      `"${peca.metadados.nome}" cruzar a si mesmo (os pontos arrastados invadem uma pence ou ` +
      `um recorte vizinho). Diminua a mudanca ou desfaca os recortes da aresta antes.`,
    { pecaId: peca.id, arestaId, comprimentoUM },
  );

  return nova;
}
