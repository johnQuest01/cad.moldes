/**
 * O catálogo: cada coisa que a IA sabe fazer neste CAD.
 *
 * A descrição de cada ferramenta é escrita para o MODELO ler, não para documentar
 * o código: ela diz quando usar, o que exige, e o que a ferramenta se recusa a
 * adivinhar. Descrição vaga aqui vira ferramenta usada na hora errada lá.
 */
import {
  definirEncaixe,
  abrirPenceComando,
  alinharPeca,
  definirBainha,
  desdobrarPecaComando,
  dimensionarPeca,
  gerarPregas,
  redefinirAresta,
  definirMargem,
  duplicarPeca,
  removerPeca,
  renomearPeca,
  simplificarContorno,
  type Gesto,
  type Referencia,
} from '@cad/editor';
import {
  MM,
  ErroMotor,
  aplicarGraduacao,
  anelDoContorno,
  conferirModelo,
  medirAresta,
  offsetMargem,
  umParaMM,
  type Id,
  type Modelo,
  type Peca,
} from '@cad/motor';

import type { Esquema, Ferramenta, Resultado } from './tipos.js';

const texto = (t: string): Resultado => ({ tipo: 'leitura', texto: t });
const erro = (m: string): Resultado => ({ tipo: 'erro', mensagem: m });

/** Envolve o que pode estourar no motor: a mensagem do motor volta inteira (J8). */
function tentar(f: () => Resultado): Resultado {
  try {
    return f();
  } catch (e) {
    if (e instanceof ErroMotor) return erro(`${e.codigo}: ${e.message}`);
    throw e;
  }
}

function acharPeca(modelo: Modelo, nomeOuId: string): { id: Id; peca: Peca } | null {
  const direta = modelo.pecas[nomeOuId];
  if (direta !== undefined) return { id: nomeOuId, peca: direta };
  const alvo = nomeOuId.trim().toLocaleLowerCase('pt-BR');
  for (const [id, peca] of Object.entries(modelo.pecas)) {
    if (peca.metadados.nome.trim().toLocaleLowerCase('pt-BR') === alvo) return { id, peca };
  }
  return null;
}

/** O erro que o modelo mais vai encontrar: peça que não existe. Ele lista as que existem. */
function semPeca(modelo: Modelo, pedido: string): Resultado {
  const nomes = Object.values(modelo.pecas).map((p) => p.metadados.nome);
  return erro(
    `Não existe peça "${pedido}". As peças do modelo são: ${nomes.join(', ') || '(nenhuma)'}.`,
  );
}

const objeto = (
  properties: Record<string, Record<string, unknown>>,
  required: string[] = [],
): Esquema => ({ type: 'object', properties, required });

const PECA_ARG = {
  peca: { type: 'string', description: 'Nome ou id da peça.' },
};

const caixaDe = (peca: Peca): { largura: number; altura: number } => {
  const anel = anelDoContorno(peca);
  return {
    largura: Math.max(...anel.map((p) => p.x)) - Math.min(...anel.map((p) => p.x)),
    altura: Math.max(...anel.map((p) => p.y)) - Math.min(...anel.map((p) => p.y)),
  };
};

// ------------------------------------------------------------------ leitura

const descrever: Ferramenta = {
  nome: 'descrever_modelo',
  descricao:
    'Lista o modelo inteiro: peças com nome, id, largura e altura em mm, os tamanhos da ' +
    'grade, e a largura do rolo de papel se estiver declarada. Use ANTES de qualquer ' +
    'alteração, para agir sobre o que existe de fato em vez de supor.',
  esquema: objeto({}),
  executar: (modelo) =>
    tentar(() => {
      const linhas = Object.entries(modelo.pecas).map(([id, peca]) => {
        const c = caixaDe(peca);
        return (
          `- ${peca.metadados.nome} (id ${id}): ${umParaMM(c.largura).toFixed(0)} × ` +
          `${umParaMM(c.altura).toFixed(0)} mm, ${Object.keys(peca.piques).length} pique(s), ` +
          `quantidade ${peca.encaixe.quantidadePorModelo}, giro "${peca.encaixe.giro}"` +
          (peca.encaixe.par ? ', sai em PAR (metade espelhada)' : '')
        );
      });
      const papel =
        modelo.papel === null
          ? 'Nenhum rolo de papel declarado — o encaixe não roda sem ele.'
          : `Rolo: ${umParaMM(modelo.papel.larguraUM).toFixed(0)} mm de largura, ` +
            `margem de segurança ${umParaMM(modelo.papel.margemDeSegurancaUM).toFixed(0)} mm.`;
      return texto(
        `Modelo "${modelo.nome}", tamanho base ${modelo.tamanhoBase}, ` +
          `tamanhos: ${modelo.tamanhos.join(', ')}.\n` +
          `${Object.keys(modelo.pecas).length} peça(s):\n${linhas.join('\n')}\n${papel}`,
      );
    }),
};

const medir: Ferramenta = {
  nome: 'medir_peca',
  descricao:
    'Mede uma peça: caixa, perímetro do contorno, perímetro da linha de corte, e o ' +
    'comprimento de cada aresta com a margem de costura dela. Use quando a pessoa ' +
    'perguntar "quanto mede", e quando precisar de um número antes de mexer.',
  esquema: objeto({ ...PECA_ARG, tamanho: { type: 'string', description: 'Tamanho da grade. Padrão: o base.' } }, ['peca']),
  executar: (modelo, args) =>
    tentar(() => {
      const achada = acharPeca(modelo, String(args.peca ?? ''));
      if (achada === null) return semPeca(modelo, String(args.peca ?? ''));
      const tamanho = typeof args.tamanho === 'string' ? args.tamanho : modelo.tamanhoBase;
      const peca = aplicarGraduacao(modelo, achada.id, tamanho);
      const c = caixaDe(peca);
      const volta = (pontos: readonly { x: number; y: number }[]): number => {
        let s = 0;
        for (let i = 0; i < pontos.length; i++) {
          const a = pontos[i]!;
          const b = pontos[(i + 1) % pontos.length]!;
          s += Math.hypot(b.x - a.x, b.y - a.y);
        }
        return s;
      };
      const arestas = Object.keys(peca.arestas).map((id) => {
        const margem = peca.margens[id] ?? 0;
        return `  ${id}: ${umParaMM(medirAresta(peca, id)).toFixed(1)} mm, margem ${umParaMM(margem).toFixed(1)} mm`;
      });
      return texto(
        `${peca.metadados.nome} no tamanho ${tamanho}:\n` +
          `  caixa ${umParaMM(c.largura).toFixed(1)} × ${umParaMM(c.altura).toFixed(1)} mm\n` +
          `  perímetro do contorno ${umParaMM(volta(anelDoContorno(peca))).toFixed(1)} mm\n` +
          `  perímetro do corte ${umParaMM(volta(offsetMargem(peca).pontos)).toFixed(1)} mm\n` +
          `  arestas:\n${arestas.join('\n')}`,
      );
    }),
};

const conferir: Ferramenta = {
  nome: 'conferir_modelo',
  descricao:
    'Roda a conferência do motor e lista os problemas: contorno que se cruza, peça mais ' +
    'larga que o rolo, par de costura pendente, regra de graduação órfã. Use antes de ' +
    'exportar ou encaixar, e sempre que a pessoa perguntar se está tudo certo.',
  esquema: objeto({}),
  executar: (modelo) =>
    tentar(() => {
      const p = conferirModelo(modelo);
      if (p.length === 0) return texto('Nenhum problema encontrado.');
      return texto(
        p.map((x) => `${x.gravidade.toUpperCase()} ${x.codigo}: ${x.mensagem}`).join('\n'),
      );
    }),
};

// ------------------------------------------------------------------ edição

const renomear: Ferramenta = {
  nome: 'renomear_peca',
  descricao: 'Troca o nome de uma peça. Nome vazio é recusado: peça sem nome ninguém acha no corte.',
  esquema: objeto({ ...PECA_ARG, nome: { type: 'string', description: 'O nome novo.' } }, ['peca', 'nome']),
  executar: (modelo, args) =>
    tentar(() => {
      const achada = acharPeca(modelo, String(args.peca ?? ''));
      if (achada === null) return semPeca(modelo, String(args.peca ?? ''));
      const nome = String(args.nome ?? '').trim();
      if (nome === '') return erro('O nome não pode ser vazio.');
      return {
        tipo: 'gestos',
        gestos: renomearPeca(modelo, achada.id, nome),
        resumo: `"${achada.peca.metadados.nome}" agora se chama "${nome}".`,
      };
    }),
};

const duplicar: Ferramenta = {
  nome: 'duplicar_peca',
  licenca: { alteraForma: false, criaPeca: true, removePeca: false },
  descricao:
    'Cria uma cópia independente da peça, deslocada para o lado. A cópia tem ids próprios ' +
    'e pode ser editada sem mexer na original.',
  esquema: objeto(PECA_ARG, ['peca']),
  executar: (modelo, args) =>
    tentar(() => {
      const achada = acharPeca(modelo, String(args.peca ?? ''));
      if (achada === null) return semPeca(modelo, String(args.peca ?? ''));
      const semente = `ia${Object.keys(modelo.pecas).length}`;
      return {
        tipo: 'gestos',
        gestos: duplicarPeca(modelo, achada.id, semente),
        resumo: `"${achada.peca.metadados.nome}" duplicada.`,
      };
    }),
};

const remover: Ferramenta = {
  nome: 'remover_peca',
  licenca: { alteraForma: false, criaPeca: false, removePeca: true },
  descricao:
    'Apaga uma peça do modelo. DESTRUTIVO: devolve um pedido de confirmação, e a pessoa ' +
    'é quem decide. Nunca chame isto para "limpar" sem a pessoa ter pedido.',
  esquema: objeto(PECA_ARG, ['peca']),
  executar: (modelo, args) =>
    tentar(() => {
      const achada = acharPeca(modelo, String(args.peca ?? ''));
      if (achada === null) return semPeca(modelo, String(args.peca ?? ''));
      if (Object.keys(modelo.pecas).length <= 1) {
        return erro('É a última peça do modelo; apagar deixaria o modelo vazio.');
      }
      return {
        tipo: 'confirmar',
        pergunta: `Apagar a peça "${achada.peca.metadados.nome}"? Isso some com o desenho dela.`,
        gestos: removerPeca(modelo, achada.id),
        resumo: `Peça "${achada.peca.metadados.nome}" apagada.`,
      };
    }),
};

const margem: Ferramenta = {
  nome: 'definir_margem',
  descricao:
    'Define a margem de costura, em MILÍMETROS, de uma aresta ou de todas as arestas de ' +
    'uma peça. Exige o número: não aceite "um pouco mais" — pergunte quantos milímetros. ' +
    'A margem cresce para FORA do contorno.',
  esquema: objeto(
    {
      ...PECA_ARG,
      milimetros: { type: 'number', description: 'A margem, em mm. Pode ser 0.' },
      aresta: {
        type: 'string',
        description: 'Id da aresta. Sem isto, vale para todas as arestas da peça.',
      },
    },
    ['peca', 'milimetros'],
  ),
  executar: (modelo, args) =>
    tentar(() => {
      const achada = acharPeca(modelo, String(args.peca ?? ''));
      if (achada === null) return semPeca(modelo, String(args.peca ?? ''));
      const mmPedido = Number(args.milimetros);
      if (!Number.isFinite(mmPedido) || mmPedido < 0) {
        return erro('A margem precisa ser um número de milímetros maior ou igual a zero.');
      }
      const alvo =
        typeof args.aresta === 'string' ? [args.aresta] : Object.keys(achada.peca.arestas);
      const faltando = alvo.filter((id) => achada.peca.arestas[id] === undefined);
      if (faltando.length > 0) {
        return erro(
          `A peça "${achada.peca.metadados.nome}" não tem a aresta "${faltando[0]}". ` +
            `As arestas dela são: ${Object.keys(achada.peca.arestas).join(', ')}.`,
        );
      }
      const refs: Referencia[] = alvo.map((arestaId) => ({
        tipo: 'aresta',
        pecaId: achada.id,
        arestaId,
      }));
      return {
        tipo: 'gestos',
        gestos: definirMargem(refs, mmPedido),
        resumo:
          `Margem de ${mmPedido} mm em ${alvo.length} aresta(s) de ` +
          `"${achada.peca.metadados.nome}".`,
      };
    }),
};

const encaixeDaPeca: Ferramenta = {
  nome: 'definir_encaixe_da_peca',
  descricao:
    'Define como a peça entra no encaixe: quantas vezes vai no molde, se sai em par ' +
    '(metade espelhada, como manga direita e esquerda) e quanto ela pode GIRAR. O giro é ' +
    'o fio do tecido e não é detalhe: "180" é tecido plano (pode virar de cabeça para ' +
    'baixo, não pode deitar), "90" é malha (pode deitar), "forcar" trava a posição.',
  esquema: objeto(
    {
      ...PECA_ARG,
      quantidade: { type: 'number', description: 'Quantas vezes a peça vai no molde.' },
      par: { type: 'boolean', description: 'Metade das cópias sai espelhada.' },
      giro: {
        type: 'string',
        enum: ['livre', '180', '90', 'forcar', 'esquerda', 'direita'],
        description: 'O que o fio do tecido permite.',
      },
    },
    ['peca'],
  ),
  executar: (modelo, args) =>
    tentar(() => {
      const achada = acharPeca(modelo, String(args.peca ?? ''));
      if (achada === null) return semPeca(modelo, String(args.peca ?? ''));
      const atual = achada.peca.encaixe;
      const quantidade =
        args.quantidade === undefined ? atual.quantidadePorModelo : Number(args.quantidade);
      if (!Number.isInteger(quantidade) || quantidade < 1) {
        return erro('A quantidade por modelo precisa ser um inteiro de 1 para cima.');
      }
      const giro = args.giro === undefined ? atual.giro : (args.giro as typeof atual.giro);
      const par = args.par === undefined ? atual.par : Boolean(args.par);
      return {
        tipo: 'gestos',
        gestos: definirEncaixe(modelo, achada.id, { ...atual, quantidadePorModelo: quantidade, giro, par }),
        resumo:
          `"${achada.peca.metadados.nome}": quantidade ${quantidade}, giro "${giro}"` +
          (par ? ', em par' : '') + '.',
      };
    }),
};

const simplificar: Ferramenta = {
  nome: 'simplificar_contorno',
  // A UNICA ferramenta que pode mexer no desenho — e ela pede confirmacao humana.
  licenca: { alteraForma: true, criaPeca: false, removePeca: false },
  descricao:
    'Reduz os pontos do contorno com tolerância explícita em MILÍMETROS. Serve para molde ' +
    'digitalizado ou importado, que vem com pontos demais. DESTRUTIVO: pede confirmação, ' +
    'porque tolerância grande demais come o desenho.',
  esquema: objeto(
    { ...PECA_ARG, milimetros: { type: 'number', description: 'Tolerância, em mm. Típico: 0,5 a 2.' } },
    ['peca', 'milimetros'],
  ),
  executar: (modelo, args) =>
    tentar(() => {
      const achada = acharPeca(modelo, String(args.peca ?? ''));
      if (achada === null) return semPeca(modelo, String(args.peca ?? ''));
      const tol = Number(args.milimetros);
      if (!Number.isFinite(tol) || tol <= 0) return erro('A tolerância precisa ser positiva.');
      return {
        tipo: 'confirmar',
        pergunta:
          `Simplificar o contorno de "${achada.peca.metadados.nome}" com tolerância de ` +
          `${tol} mm? Pontos somem e não voltam sozinhos (mas o desfazer traz).`,
        gestos: simplificarContorno(modelo, achada.id, tol),
        resumo: `Contorno de "${achada.peca.metadados.nome}" simplificado a ${tol} mm.`,
      };
    }),
};

const dimensionar: Ferramenta = {
  nome: 'dimensionar_peca',
  // Mexe no desenho de verdade — por isso tem a licença E pede confirmação. É a
  // segunda ferramenta com essa licença na vida do catálogo, e o critério para
  // entrar foi o mesmo: operação de ofício (compensar encolhimento de malha),
  // número explícito, e um humano dizendo sim antes de acontecer.
  licenca: { alteraForma: true, criaPeca: false, removePeca: false },
  descricao:
    'Dimensiona a peça por percentual, com X e Y separados — é o ENCOLHIMENTO do ofício: ' +
    'a ficha do tecido diz "encolhe 3% no comprimento e 2% na largura", então o molde é ' +
    'ampliado para 103 × 102 antes do corte. 100 = como está. Exige os números: se a ' +
    'pessoa não disser os percentuais, PERGUNTE — nunca chute encolhimento. Margem de ' +
    'costura e piques não mudam de tamanho, só a peça. DESTRUTIVO: pede confirmação.',
  esquema: objeto(
    {
      ...PECA_ARG,
      percentual_largura: {
        type: 'number',
        description: 'Novo tamanho em X, em % do atual. 103 = cresce 3%. Entre 25 e 400.',
      },
      percentual_altura: {
        type: 'number',
        description: 'Novo tamanho em Y, em % do atual. Se faltar, usa o mesmo da largura.',
      },
    },
    ['peca', 'percentual_largura'],
  ),
  executar: (modelo, args) =>
    tentar(() => {
      const achada = acharPeca(modelo, String(args.peca ?? ''));
      if (achada === null) return semPeca(modelo, String(args.peca ?? ''));
      const px = Number(args.percentual_largura);
      const py = args.percentual_altura === undefined ? px : Number(args.percentual_altura);
      for (const p of [px, py]) {
        if (!Number.isFinite(p) || p < 25 || p > 400) {
          return erro(
            `Percentual ${String(p)} fora da faixa (25 a 400). Encolhimento de tecido fica na ` +
              `casa de poucos por cento: para compensar 3%, o percentual é 103.`,
          );
        }
      }
      return {
        tipo: 'confirmar',
        pergunta:
          `Dimensionar "${achada.peca.metadados.nome}" para ${px}% na largura e ${py}% na ` +
          `altura? O desenho da peça muda de tamanho de verdade.`,
        gestos: dimensionarPeca(modelo, achada.id, px, py),
        resumo: `"${achada.peca.metadados.nome}" dimensionada para ${px}% × ${py}%.`,
      };
    }),
};

const espelhar: Ferramenta = {
  nome: 'espelhar_peca',
  descricao:
    'Espelha a peça inteira num eixo vertical ou horizontal que passa pelo centro dela. ' +
    'Para fazer o par de uma manga, prefira duplicar e espelhar a cópia.',
  esquema: objeto(
    {
      ...PECA_ARG,
      eixo: { type: 'string', enum: ['vertical', 'horizontal'], description: 'A direção do espelho.' },
    },
    ['peca', 'eixo'],
  ),
  executar: (modelo, args) =>
    tentar(() => {
      const achada = acharPeca(modelo, String(args.peca ?? ''));
      if (achada === null) return semPeca(modelo, String(args.peca ?? ''));
      const anel = anelDoContorno(achada.peca);
      const cx = Math.round((Math.min(...anel.map((p) => p.x)) + Math.max(...anel.map((p) => p.x))) / 2);
      const cy = Math.round((Math.min(...anel.map((p) => p.y)) + Math.max(...anel.map((p) => p.y))) / 2);
      const vertical = args.eixo !== 'horizontal';
      const gestos: Gesto[] = [
        {
          tipo: 'EspelharPeca',
          pecaId: achada.id,
          payload: vertical
            ? { p1: { x: cx, y: cy }, p2: { x: cx, y: cy + 1000 } }
            : { p1: { x: cx, y: cy }, p2: { x: cx + 1000, y: cy } },
        },
      ];
      return {
        tipo: 'gestos',
        gestos,
        resumo: `"${achada.peca.metadados.nome}" espelhada no eixo ${vertical ? 'vertical' : 'horizontal'}.`,
      };
    }),
};

const rotacionar: Ferramenta = {
  nome: 'rotacionar_peca',
  descricao:
    'Gira a peça em torno do centro dela, em GRAUS, sentido anti-horário. Girar no ' +
    'desenho não é girar no tecido: quem manda no tecido é o giro declarado no encaixe.',
  esquema: objeto({ ...PECA_ARG, graus: { type: 'number', description: 'Ângulo em graus.' } }, [
    'peca',
    'graus',
  ]),
  executar: (modelo, args) =>
    tentar(() => {
      const achada = acharPeca(modelo, String(args.peca ?? ''));
      if (achada === null) return semPeca(modelo, String(args.peca ?? ''));
      const graus = Number(args.graus);
      if (!Number.isFinite(graus)) return erro('O ângulo precisa ser um número de graus.');
      const anel = anelDoContorno(achada.peca);
      const centro = {
        x: Math.round((Math.min(...anel.map((p) => p.x)) + Math.max(...anel.map((p) => p.x))) / 2),
        y: Math.round((Math.min(...anel.map((p) => p.y)) + Math.max(...anel.map((p) => p.y))) / 2),
      };
      return {
        tipo: 'gestos',
        gestos: [{ tipo: 'RotacionarPeca', pecaId: achada.id, payload: { centro, anguloGraus: graus } }],
        resumo: `"${achada.peca.metadados.nome}" girada ${graus} graus.`,
      };
    }),
};

const papel: Ferramenta = {
  nome: 'definir_rolo_de_papel',
  descricao:
    'Declara a largura do rolo de tecido ou papel, em MILÍMETROS, e a margem de segurança ' +
    'de cada lado. Sem isso o encaixe se recusa a rodar, porque metro de tecido sem saber ' +
    'a largura do rolo não quer dizer nada.',
  esquema: objeto(
    {
      largura_mm: { type: 'number', description: 'Largura total do rolo, em mm. Ex.: 1600.' },
      margem_mm: { type: 'number', description: 'Margem de segurança de cada lado, em mm. Ex.: 10.' },
      nome: { type: 'string', description: 'Como chamar este rolo.' },
    },
    ['largura_mm'],
  ),
  executar: (modelo, args) =>
    tentar(() => {
      const largura = Number(args.largura_mm);
      if (!Number.isFinite(largura) || largura <= 0) {
        return erro('A largura do rolo precisa ser um número positivo de milímetros.');
      }
      const margemMM = args.margem_mm === undefined ? 10 : Number(args.margem_mm);
      const nome = typeof args.nome === 'string' ? args.nome : `${largura.toFixed(0)} mm`;
      return {
        tipo: 'gestos',
        gestos: [
          {
            tipo: 'DefinirPapel',
            pecaId: null,
            payload: {
              papelId: `papel-${Math.round(largura)}`,
              nome,
              larguraUM: Math.round(largura * MM),
              margemDeSegurancaUM: Math.round(margemMM * MM),
            },
          },
        ],
        resumo: `Rolo de ${largura} mm, margem de ${margemMM} mm de cada lado.`,
      };
    }),
};

const LICENCA_DE_FORMA = { alteraForma: true, criaPeca: false, removePeca: false } as const;

/** Acha uma aresta da peça pelo id, com a lista das existentes no erro. */
function acharAresta(peca: Peca, pedido: string): Id | null {
  if (peca.arestas[pedido] !== undefined) return pedido;
  return null;
}
const semAresta = (peca: Peca, pedido: string): Resultado =>
  erro(
    `Não existe a aresta "${pedido}" na peça "${peca.metadados.nome}". As arestas dela são: ` +
      `${Object.keys(peca.arestas).join(', ')}. Use medir_peca para ver o comprimento de cada uma.`,
  );

const pregas: Ferramenta = {
  nome: 'gerar_pregas',
  licenca: LICENCA_DE_FORMA,
  descricao:
    'Gera pregas numa aresta, como o diálogo do ofício: quantas pregas, distância entre ' +
    'elas em mm, e as duas larguras da dobra em mm (largura 2 pode ser 0 para prega ' +
    'simples). A peça ALARGA quantidade × (largura1+largura2) mm — é tecido a mais, e os ' +
    'piques de cada dobra saem sozinhos. Exige TODOS os números; se a pessoa não disser, ' +
    'PERGUNTE. DESTRUTIVO: pede confirmação.',
  esquema: objeto(
    {
      ...PECA_ARG,
      aresta: { type: 'string', description: 'Id da aresta onde as pregas entram.' },
      quantidade: { type: 'number', description: 'Quantas pregas. Inteiro de 1 a 60.' },
      distancia_mm: { type: 'number', description: 'Distância entre pregas, em mm.' },
      largura1_mm: { type: 'number', description: 'Primeira dobra da prega, em mm.' },
      largura2_mm: { type: 'number', description: 'Segunda dobra, em mm. 0 = prega simples.' },
    },
    ['peca', 'aresta', 'quantidade', 'distancia_mm', 'largura1_mm'],
  ),
  executar: (modelo, args) =>
    tentar(() => {
      const achada = acharPeca(modelo, String(args.peca ?? ''));
      if (achada === null) return semPeca(modelo, String(args.peca ?? ''));
      const arestaId = acharAresta(achada.peca, String(args.aresta ?? ''));
      if (arestaId === null) return semAresta(achada.peca, String(args.aresta ?? ''));
      const quantidade = Number(args.quantidade);
      const distancia = Number(args.distancia_mm);
      const l1 = Number(args.largura1_mm);
      const l2 = Number(args.largura2_mm ?? 0);
      const semente = `iapg${Object.keys(achada.peca.eixosDobra).length}`;
      try {
        const gestos = gerarPregas(
          modelo,
          achada.id,
          arestaId,
          { quantidade, distanciaMM: distancia, largura1MM: l1, largura2MM: l2 },
          semente,
        );
        return {
          tipo: 'confirmar',
          pergunta:
            `Gerar ${quantidade} prega(s) de ${l1}+${l2} mm a cada ${distancia} mm na aresta ` +
            `"${arestaId}" de "${achada.peca.metadados.nome}"? A peça alarga ` +
            `${quantidade * (l1 + l2)} mm.`,
          gestos,
          resumo: `${quantidade} prega(s) geradas em "${achada.peca.metadados.nome}".`,
        };
      } catch (e) {
        return erro(String(e instanceof Error ? e.message : e));
      }
    }),
};

const pence: Ferramenta = {
  nome: 'abrir_pence',
  licenca: LICENCA_DE_FORMA,
  descricao:
    'Abre uma PENCE no contorno: boca de X mm centrada numa posição da aresta (0 a 1, ' +
    '0,5 = meio) e ápice a Y mm para dentro. É a pence de cintura/busto do ofício. A boca ' +
    'não pode passar por cima de canto. Exige abertura e profundidade em mm — não chute. ' +
    'DESTRUTIVO: pede confirmação.',
  esquema: objeto(
    {
      ...PECA_ARG,
      aresta: { type: 'string', description: 'Id da aresta da boca.' },
      posicao: { type: 'number', description: 'Onde na aresta, de 0 a 1. Padrão 0,5 (meio).' },
      abertura_mm: { type: 'number', description: 'Largura da boca, em mm.' },
      profundidade_mm: { type: 'number', description: 'Profundidade até o ápice, em mm.' },
    },
    ['peca', 'aresta', 'abertura_mm', 'profundidade_mm'],
  ),
  executar: (modelo, args) =>
    tentar(() => {
      const achada = acharPeca(modelo, String(args.peca ?? ''));
      if (achada === null) return semPeca(modelo, String(args.peca ?? ''));
      const arestaId = acharAresta(achada.peca, String(args.aresta ?? ''));
      if (arestaId === null) return semAresta(achada.peca, String(args.aresta ?? ''));
      const s = args.posicao === undefined ? 0.5 : Number(args.posicao);
      const abertura = Number(args.abertura_mm);
      const profundidade = Number(args.profundidade_mm);
      const semente = `iapn${Object.keys(achada.peca.pontos).length}`;
      return {
        tipo: 'confirmar',
        pergunta:
          `Abrir pence de ${abertura} × ${profundidade} mm na aresta "${arestaId}" de ` +
          `"${achada.peca.metadados.nome}", em s=${s}? O contorno da peça muda.`,
        gestos: abrirPenceComando(modelo, achada.id, arestaId, s, abertura, profundidade, semente),
        resumo: `Pence de ${abertura}×${profundidade} mm aberta em "${achada.peca.metadados.nome}".`,
      };
    }),
};

const desdobrar: Ferramenta = {
  nome: 'desdobrar_peca',
  licenca: LICENCA_DE_FORMA,
  descricao:
    'Desdobra a meia-peça no eixo de dobra: vira a peça INTEIRA, com as arestas espelhadas ' +
    'ganhando margem da irmã e os piques espelhados. Use quando a pessoa desenhou a metade ' +
    '(meia-frente na dobra do tecido) e quer a peça aberta. Exige um eixo de dobra já ' +
    'definido na peça — se não houver, diga isso. DESTRUTIVO: pede confirmação.',
  esquema: objeto(
    {
      ...PECA_ARG,
      eixo: { type: 'string', description: 'Id do eixo de dobra. Sem ele, usa o único que houver.' },
    },
    ['peca'],
  ),
  executar: (modelo, args) =>
    tentar(() => {
      const achada = acharPeca(modelo, String(args.peca ?? ''));
      if (achada === null) return semPeca(modelo, String(args.peca ?? ''));
      const eixos = Object.keys(achada.peca.eixosDobra);
      let eixoId = typeof args.eixo === 'string' && args.eixo !== '' ? args.eixo : null;
      if (eixoId === null) {
        if (eixos.length !== 1) {
          return erro(
            eixos.length === 0
              ? `A peça "${achada.peca.metadados.nome}" não tem eixo de dobra. Peça à pessoa ` +
                `para traçar o eixo (ferramenta X) na lateral da dobra antes.`
              : `A peça tem ${eixos.length} eixos de dobra (${eixos.join(', ')}); diga qual usar.`,
          );
        }
        eixoId = eixos[0]!;
      }
      const semente = `iadd${Object.keys(achada.peca.pontos).length}`;
      return {
        tipo: 'confirmar',
        pergunta:
          `Desdobrar "${achada.peca.metadados.nome}" pelo eixo "${eixoId}"? A metade vira a ` +
          `peça inteira — a área dobra.`,
        gestos: desdobrarPecaComando(modelo, achada.id, eixoId, semente),
        resumo: `"${achada.peca.metadados.nome}" desdobrada.`,
      };
    }),
};

const bainha: Ferramenta = {
  nome: 'definir_bainha',
  descricao:
    'Marca a BAINHA de uma aresta: a barra ganha a altura da dobra como margem de corte e ' +
    'um pique em cada lateral vizinha marca onde dobrar. Não muda o desenho da peça — só ' +
    'margem e piques. Exige a altura em mm.',
  esquema: objeto(
    {
      ...PECA_ARG,
      aresta: { type: 'string', description: 'Id da aresta da barra.' },
      altura_mm: { type: 'number', description: 'Altura da bainha, em mm. Ex.: 25.' },
    },
    ['peca', 'aresta', 'altura_mm'],
  ),
  executar: (modelo, args) =>
    tentar(() => {
      const achada = acharPeca(modelo, String(args.peca ?? ''));
      if (achada === null) return semPeca(modelo, String(args.peca ?? ''));
      const arestaId = acharAresta(achada.peca, String(args.aresta ?? ''));
      if (arestaId === null) return semAresta(achada.peca, String(args.aresta ?? ''));
      const altura = Number(args.altura_mm);
      const semente = `iabn${Object.keys(achada.peca.piques).length}`;
      try {
        return {
          tipo: 'gestos',
          gestos: definirBainha(modelo, achada.id, arestaId, altura, semente),
          resumo:
            `Bainha de ${altura} mm na aresta "${arestaId}" de "${achada.peca.metadados.nome}": ` +
            `margem virou ${altura} mm e as laterais ganharam o pique da dobra.`,
        };
      } catch (e) {
        return erro(String(e instanceof Error ? e.message : e));
      }
    }),
};

const alinhar: Ferramenta = {
  nome: 'alinhar_peca',
  descricao:
    'Alinha uma peça pela caixa de OUTRA: mesma esquerda, direita, topo, base, ou centro ' +
    'com centro. Translação pura — nada de forma muda. Útil para arrumar a mesa antes de ' +
    'comparar ou medir.',
  esquema: objeto(
    {
      ...PECA_ARG,
      referencia: { type: 'string', description: 'Nome ou id da peça que fica parada.' },
      lado: {
        type: 'string',
        enum: ['esquerda', 'direita', 'topo', 'base', 'centro'],
        description: 'O que casar.',
      },
    },
    ['peca', 'referencia', 'lado'],
  ),
  executar: (modelo, args) =>
    tentar(() => {
      const achada = acharPeca(modelo, String(args.peca ?? ''));
      if (achada === null) return semPeca(modelo, String(args.peca ?? ''));
      const ref = acharPeca(modelo, String(args.referencia ?? ''));
      if (ref === null) return semPeca(modelo, String(args.referencia ?? ''));
      const lado = String(args.lado) as 'esquerda' | 'direita' | 'topo' | 'base' | 'centro';
      try {
        return {
          tipo: 'gestos',
          gestos: alinharPeca(modelo, achada.id, ref.id, lado),
          resumo:
            `"${achada.peca.metadados.nome}" alinhada com "${ref.peca.metadados.nome}" ` +
            `pela ${lado}.`,
        };
      } catch (e) {
        return erro(String(e instanceof Error ? e.message : e));
      }
    }),
};

const redefinir: Ferramenta = {
  nome: 'redefinir_aresta',
  licenca: LICENCA_DE_FORMA,
  descricao:
    'Impõe o COMPRIMENTO de uma aresta, em mm — o "redefinir perímetro" do ofício. Serve ' +
    'para casar a cabeça da manga com a cava (meça as duas com medir_peca primeiro, some o ' +
    'embebido, e imponha o total). A forma da curva é preservada: é escala, não redesenho. ' +
    'A aresta vizinha acompanha pelo canto compartilhado. DESTRUTIVO: pede confirmação.',
  esquema: objeto(
    {
      ...PECA_ARG,
      aresta: { type: 'string', description: 'Id da aresta.' },
      comprimento_mm: { type: 'number', description: 'O comprimento final, em mm.' },
    },
    ['peca', 'aresta', 'comprimento_mm'],
  ),
  executar: (modelo, args) =>
    tentar(() => {
      const achada = acharPeca(modelo, String(args.peca ?? ''));
      if (achada === null) return semPeca(modelo, String(args.peca ?? ''));
      const arestaId = acharAresta(achada.peca, String(args.aresta ?? ''));
      if (arestaId === null) return semAresta(achada.peca, String(args.aresta ?? ''));
      const alvo = Number(args.comprimento_mm);
      const atual = umParaMM(medirAresta(achada.peca, arestaId));
      return {
        tipo: 'confirmar',
        pergunta:
          `Redefinir a aresta "${arestaId}" de "${achada.peca.metadados.nome}" de ` +
          `${atual.toFixed(1)} para ${alvo} mm? O canto compartilhado com a vizinha se move.`,
        gestos: redefinirAresta(modelo, achada.id, arestaId, alvo),
        resumo: `Aresta "${arestaId}" redefinida de ${atual.toFixed(1)} para ${alvo} mm.`,
      };
    }),
};


// ------------------------------------------------------------------ ações do app

const acao = (nome: string, descricao: string, esquema: Esquema, resumo: string): Ferramenta => ({
  nome,
  descricao,
  esquema,
  executar: (_modelo, args) => ({ tipo: 'acao', acao: nome, argumentos: args, resumo }),
});

const encaixarFerramenta = acao(
  'encaixar',
  'Roda o encaixe: põe as peças na faixa do tecido pelo No-Fit Polygon, respeitando o fio ' +
    'de cada uma, e devolve metros de rolo e aproveitamento. Exige o rolo declarado.',
  { type: 'object', properties: {}, required: [] },
  'Encaixe calculado.',
);

const exportar = acao(
  'exportar',
  'Baixa um arquivo do modelo: "dxf" para outro CAD, "hpgl" para a plotadora ou a ' +
    'cortadora, "risco" para o desenho do encaixe em SVG.',
  {
    type: 'object',
    properties: {
      formato: { type: 'string', enum: ['dxf', 'hpgl', 'risco'], description: 'O formato.' },
      encaixado: {
        type: 'boolean',
        description: 'Só para hpgl: usar o encaixe em vez da fila. Padrão: true.',
      },
    },
    required: ['formato'],
  },
  'Arquivo gerado.',
);

const trocarTamanho = acao(
  'mostrar_tamanho',
  'Troca o tamanho da grade que aparece na tela. Não edita nada: as edições continuam ' +
    'indo para o tamanho base, e o que se vê é o resultado graduado.',
  {
    type: 'object',
    properties: { tamanho: { type: 'string', description: 'Ex.: P, M, G.' } },
    required: ['tamanho'],
  },
  'Tamanho da tela trocado.',
);

const enquadrar = acao(
  'enquadrar',
  'Ajusta o zoom para caber tudo na tela. Use quando a pessoa se perder no desenho.',
  { type: 'object', properties: {}, required: [] },
  'Vista enquadrada.',
);


const desfazer = acao(
  'desfazer',
  'Volta atrás uma ou mais alterações, como o Ctrl+Z. Use quando a pessoa disser que não ' +
    'gostou, que ficou pior, ou que quer voltar. Cada rodada sua é um passo — então "desfaz ' +
    'o que você fez" costuma ser 1.',
  {
    type: 'object',
    properties: {
      quantos: { type: 'number', description: 'Quantos passos voltar. Padrão 1.' },
    },
    required: [],
  },
  'Desfeito.',
);

const refazer = acao(
  'refazer',
  'Refaz o que foi desfeito, como o Ctrl+Shift+Z. Use se a pessoa se arrepender de ter voltado.',
  { type: 'object', properties: {}, required: [] },
  'Refeito.',
);

const descartarTudo = acao(
  'descartar_alteracoes',
  'Joga fora TODAS as alterações pendentes e volta o desenho ao estado em que ele estava ' +
    'quando foi aberto. DESTRUTIVO e amplo: use só quando a pessoa disser claramente que ' +
    'quer recomeçar do zero, e avise antes que tudo se perde.',
  { type: 'object', properties: {}, required: [] },
  'Tudo descartado; o desenho voltou ao original.',
);

const redigitalizar = acao(
  'redigitalizar_foto',
  'Lê a MESMA foto de novo com outros ajustes, para melhorar contorno tremido ou borda ' +
    'errada. Dois botões: "detalhe" (tolerância em mm — menor guarda mais detalhe e mais ' +
    'tremido; maior alisa e come detalhe) e "sensibilidade da cor" (quanto o papel precisa ' +
    'puxar para o marrom; menor pega papel mais claro ou em sombra, maior evita pegar o ' +
    'fundo). Se a pessoa reclamar de "borda estranha", "sobrou pedaço" ou "faltou pedaço", ' +
    'é esta a ferramenta.',
  {
    type: 'object',
    properties: {
      tolerancia_mm: {
        type: 'number',
        description: 'Tolerância do contorno, em mm. Típico 1 a 3. Menor = mais detalhe.',
      },
      sensibilidade_cor: {
        type: 'number',
        description: 'Quanto o papel puxa para o marrom, de 20 a 120. Padrão 60.',
      },
    },
    required: [],
  },
  'Foto lida de novo.',
);

const otimizar = acao(
  'otimizar_encaixe',
  'Procura o encaixe que gasta MENOS TECIDO: roda o encaixe várias vezes, com ordens de ' +
    'colocação e ângulos diferentes, e fica com o melhor. Nunca sai pior que o encaixe ' +
    'normal. Use quando a pessoa pedir para economizar tecido, sobrar mais espaço ou ' +
    'aproveitar melhor o rolo. Mais tentativas gastam mais tempo de conta.',
  {
    type: 'object',
    properties: {
      tentativas: { type: 'number', description: 'Quantas ordens tentar. Padrão 12, máximo 64.' },
    },
    required: [],
  },
  'Encaixe otimizado.',
);

/** Tudo o que a IA sabe fazer. A ordem é a que aparece para o modelo. */
export const CATALOGO: readonly Ferramenta[] = [
  descrever,
  medir,
  conferir,
  renomear,
  duplicar,
  remover,
  margem,
  encaixeDaPeca,
  simplificar,
  espelhar,
  rotacionar,
  dimensionar,
  pregas,
  pence,
  desdobrar,
  bainha,
  alinhar,
  redefinir,
  papel,
  encaixarFerramenta,
  exportar,
  trocarTamanho,
  enquadrar,
  desfazer,
  refazer,
  descartarTudo,
  redigitalizar,
  otimizar,
];

export function acharFerramenta(nome: string): Ferramenta | null {
  return CATALOGO.find((f) => f.nome === nome) ?? null;
}
