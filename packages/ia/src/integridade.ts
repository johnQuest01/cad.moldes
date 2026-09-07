/**
 * A guarda: a IA não pode adulterar molde para caber melhor.
 *
 * ## O medo, que é justo
 * "Otimize o espaço" é um pedido que, para um modelo de linguagem, tem uma saída
 * tentadora e catastrófica: **encolher a peça**. Cortar 5 mm da cava, aparar a
 * barra, simplificar o contorno até virar um polígono grosseiro — tudo isso
 * economiza tecido, e nada disso é aceitável. A roupa não fecha, e ninguém
 * descobre até a costura.
 *
 * Instrução no prompt não resolve isso. Instrução é pedido; o que impede é
 * **invariante**.
 *
 * ## O invariante
 * Cada peça tem uma impressão digital: quantos pontos tem o contorno, que área ele
 * fecha e que perímetro ele tem. Depois de **toda** ação da IA, as impressões são
 * comparadas com as de antes. Se uma peça mudou de forma e a ferramenta usada não
 * tinha licença para mudar forma, a ação é **desfeita** e o modelo recebe a recusa
 * escrita.
 *
 * As três licenças são declaradas ferramenta por ferramenta, e são poucas:
 *
 * | licença | quem tem | por quê |
 * |---|---|---|
 * | `alteraForma` | só `simplificar_contorno` | e ela já pede confirmação humana |
 * | `criaPeca` | `duplicar_peca` | |
 * | `removePeca` | `remover_peca` | e ela também pede confirmação |
 *
 * Todo o resto — margem, encaixe, giro, espelho, nome, rolo — **não pode mudar a
 * forma de nada**, e a guarda garante isso mesmo que o modelo se convença do
 * contrário.
 *
 * ## O que é rígido continua passando
 * Espelhar, girar e mover não mudam a forma: mudam onde ela está. Área e perímetro
 * sobrevivem — a menos do arredondamento para micrômetro inteiro, que é o motivo
 * de a comparação ter tolerância em vez de ser exata. A tolerância é medida, não
 * chutada: ver o teste do giro de 30 graus.
 *
 * ## O encaixe nem entra aqui
 * O encaixe não é edição: ele decide **posição e ângulo**, e quem move a peça são
 * as operações do motor. Não existe caminho pelo qual encaixar mude um contorno —
 * isso é decisão H7 da Fase 5, e é estrutural, não uma checagem.
 */
import { anelDoContorno, type Id, type Modelo } from '@cad/motor';

export interface Impressao {
  readonly pontos: number;
  readonly areaUM: number;
  readonly perimetroUM: number;
}

export interface Licenca {
  /** Pode mudar o DESENHO de uma peça. Quase ninguém tem. */
  readonly alteraForma: boolean;
  readonly criaPeca: boolean;
  readonly removePeca: boolean;
}

export const SEM_LICENCA: Licenca = { alteraForma: false, criaPeca: false, removePeca: false };

/**
 * Quanto área e perímetro podem variar sem que isso conte como mudança de forma.
 *
 * Um giro arredonda cada ponto para micrômetro inteiro, e num contorno de 155
 * pontos isso soma. Medido no pior caso do projeto — giro de 30 graus numa peça
 * digitalizada — a variação fica em alguns décimos de milésimo. 1 em 10 000 deixa
 * o arredondamento passar e ainda pega qualquer corte de verdade: 0,01% de 700 mm
 * é 0,07 mm, e ninguém "otimiza tecido" com 0,07 mm.
 */
export const TOLERANCIA_DE_FORMA = 1e-4;

function perimetroDe(pontos: readonly { x: number; y: number }[]): number {
  let s = 0;
  for (let i = 0; i < pontos.length; i++) {
    const a = pontos[i]!;
    const b = pontos[(i + 1) % pontos.length]!;
    s += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return s;
}

function areaDe(pontos: readonly { x: number; y: number }[]): number {
  let dobro = 0;
  for (let i = 0; i < pontos.length; i++) {
    const a = pontos[i]!;
    const b = pontos[(i + 1) % pontos.length]!;
    dobro += a.x * b.y - b.x * a.y;
  }
  return Math.abs(dobro) / 2;
}

/** A impressão digital de cada peça do modelo. */
export function impressaoDoModelo(modelo: Modelo): Record<Id, Impressao> {
  const saida: Record<Id, Impressao> = {};
  for (const [id, peca] of Object.entries(modelo.pecas)) {
    try {
      const anel = anelDoContorno(peca);
      saida[id] = {
        pontos: anel.length,
        areaUM: areaDe(anel),
        perimetroUM: perimetroDe(anel),
      };
    } catch {
      // Peça que nem contorno fecha não tem forma a preservar. A conferência do
      // motor já reclama dela por outro caminho.
    }
  }
  return saida;
}

const diferenca = (a: number, b: number): number => (a === 0 ? (b === 0 ? 0 : 1) : Math.abs(b - a) / a);

/**
 * Compara duas impressões e devolve o que a licença não autoriza.
 *
 * Lista vazia quer dizer que a ação é aceitável. Qualquer item na lista é motivo
 * para **desfazer** o que foi feito — não para avisar e seguir.
 */
export function conferirIntegridade(
  antes: Readonly<Record<Id, Impressao>>,
  depois: Readonly<Record<Id, Impressao>>,
  licenca: Licenca,
  nomes: Readonly<Record<Id, string>> = {},
): string[] {
  const problemas: string[] = [];
  const nomeDe = (id: Id): string => nomes[id] ?? id;

  for (const id of Object.keys(antes)) {
    const a = antes[id]!;
    const b = depois[id];
    if (b === undefined) {
      if (!licenca.removePeca) {
        problemas.push(`A peça "${nomeDe(id)}" SUMIU, e esta ação não tem permissão para apagar peça.`);
      }
      continue;
    }
    if (licenca.alteraForma) continue;

    const dArea = diferenca(a.areaUM, b.areaUM);
    const dPerimetro = diferenca(a.perimetroUM, b.perimetroUM);
    if (a.pontos !== b.pontos) {
      problemas.push(
        `A peça "${nomeDe(id)}" tinha ${a.pontos} pontos de contorno e ficou com ${b.pontos}. ` +
          `Esta ação não tem permissão para mexer no desenho.`,
      );
    } else if (dArea > TOLERANCIA_DE_FORMA || dPerimetro > TOLERANCIA_DE_FORMA) {
      problemas.push(
        `A peça "${nomeDe(id)}" mudou de FORMA: a área variou ${(dArea * 100).toFixed(3)}% e o ` +
          `perímetro ${(dPerimetro * 100).toFixed(3)}%. Esta ação não tem permissão para isso — ` +
          `molde não se encolhe para caber no tecido.`,
      );
    }
  }

  for (const id of Object.keys(depois)) {
    if (antes[id] === undefined && !licenca.criaPeca) {
      problemas.push(`Apareceu a peça "${nomeDe(id)}", e esta ação não tem permissão para criar peça.`);
    }
  }

  return problemas;
}
