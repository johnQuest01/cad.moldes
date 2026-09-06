/**
 * Fold de eventos (Parte 4, D2).
 *
 * `(estado, evento) -> estado`, FUNCAO PURA:
 *   - sem `randomUUID()`, sem `Date.now()`, sem I/O, sem `Math.random()`;
 *   - toda entropia vem no envelope/payload de quem emitiu;
 *   - o estado de entrada nunca e mutado (tudo devolve objeto novo).
 *
 * Sem isso o replay produz IDs diferentes do snapshot e o teste de integridade
 * (teste 13) falha por construcao.
 */
import { ErroMotor, exigir, exigirDoMapa } from '../erros.js';
import type { Aresta, Id, Modelo, Peca, Ponto, Segmento } from '../tipos.js';
import { exigirUM } from '../unidades.js';
import {
  arredondarVertice,
  chanfrarVertice,
  converterSegmento,
  excluirPonto,
  inserirPonto,
  modificarPonto,
  moverControle,
  simplificarContorno,
} from '../edicao.js';
import { adicionarPique, moverPique, removerPique } from '../piques.js';
import { duplicarPeca } from '../duplicar.js';
import { dividirPeca } from '../dividir.js';
import { abrirPregas } from '../pregas.js';
import { espelharPeca, rotacionarPeca, transladarPeca } from '../transformar.js';
import { VERSAO_SCHEMA_ATUAL, type Evento } from './tipos.js';

/** Aplica um evento ao modelo e devolve o modelo novo. Nao muta a entrada. */
export function fold(modelo: Modelo | null, evento: Evento): Modelo {
  exigir(
    evento.versaoSchema === VERSAO_SCHEMA_ATUAL,
    'EVENTO_VERSAO_DESCONHECIDA',
    `Evento "${evento.id}" tem versaoSchema ${evento.versaoSchema}; este motor le ` +
      `apenas ${VERSAO_SCHEMA_ATUAL}. Migre o log antes de reconstruir.`,
    { eventoId: evento.id, versaoSchema: evento.versaoSchema },
  );
  exigir(
    typeof evento.tenantId === 'string' && evento.tenantId.length > 0,
    'EVENTO_SEM_TENANT',
    `Evento "${evento.id}" (${evento.tipo}) nao tem tenantId. ` +
      `Isolamento multi-empresa e inegociavel: todo evento carrega tenant.`,
    { eventoId: evento.id },
  );

  if (evento.tipo === 'CriarModelo') {
    exigir(
      modelo === null,
      'PECA_DUPLICADA',
      `CriarModelo recebido, mas o modelo "${evento.modeloId}" ja existe no log.`,
      { eventoId: evento.id, modeloId: evento.modeloId },
    );
    exigir(
      evento.payload.tamanhos.includes(evento.payload.tamanhoBase),
      'PECA_INEXISTENTE',
      `O tamanho base "${evento.payload.tamanhoBase}" nao esta na grade ` +
        `[${evento.payload.tamanhos.join(', ')}].`,
      { eventoId: evento.id },
    );
    return {
      id: evento.modeloId,
      tenantId: evento.tenantId,
      nome: evento.payload.nome,
      pecas: {},
      tamanhos: [...evento.payload.tamanhos],
      tamanhoBase: evento.payload.tamanhoBase,
      paresCostura: {},
      regrasGraduacao: {},
      materiais: {},
    };
  }

  exigir(
    modelo !== null,
    'PECA_INEXISTENTE',
    `Evento "${evento.tipo}" chegou antes de CriarModelo. O log tem que comecar pelo modelo.`,
    { eventoId: evento.id, tipo: evento.tipo },
  );
  exigir(
    modelo.tenantId === evento.tenantId,
    'TENANT_DIVERGENTE',
    `Evento "${evento.id}" e do tenant "${evento.tenantId}" mas o modelo pertence a ` +
      `"${modelo.tenantId}". Recusando para nao vazar dado entre empresas.`,
    { eventoId: evento.id },
  );
  exigir(
    modelo.id === evento.modeloId,
    'PECA_INEXISTENTE',
    `Evento "${evento.id}" aponta para o modelo "${evento.modeloId}" mas o log ` +
      `esta reconstruindo o modelo "${modelo.id}".`,
    { eventoId: evento.id },
  );

  switch (evento.tipo) {
    case 'CriarPeca': {
      const pecaId = exigirPecaId(evento.pecaId, evento.tipo, evento.id);
      exigir(
        modelo.pecas[pecaId] === undefined,
        'PECA_DUPLICADA',
        `A peca "${pecaId}" ja existe. CriarPeca nao sobrescreve peca existente.`,
        { eventoId: evento.id, pecaId },
      );
      const peca: Peca = {
        id: pecaId,
        tenantId: evento.tenantId,
        modeloId: modelo.id,
        pontos: {},
        segmentos: {},
        arestas: {},
        contorno: [],
        margens: {},
        linhasInternas: {},
        recortes: {},
        piques: {},
        eixosDobra: {},
        gradePoints: {},
        metadados: { nome: evento.payload.nome },
        encaixe: evento.payload.encaixe,
      };
      return comPeca(modelo, peca);
    }

    case 'CriarPonto': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { pontoId, x, y, tipo, nome } = evento.payload;
      exigir(
        peca.pontos[pontoId] === undefined,
        'PONTO_DUPLICADO',
        `O ponto "${pontoId}" ja existe na peca "${peca.id}".`,
        { eventoId: evento.id, pontoId },
      );
      const base = {
        id: pontoId,
        x: exigirUM(x, `payload.x do evento ${evento.id}`),
        y: exigirUM(y, `payload.y do evento ${evento.id}`),
        tipo,
      };
      const ponto: Ponto = nome === undefined ? base : { ...base, nome };
      return comPeca(modelo, { ...peca, pontos: { ...peca.pontos, [pontoId]: ponto } });
    }

    case 'MoverPonto': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { pontoId, x, y } = evento.payload;
      const anterior = exigirDoMapa(peca.pontos, pontoId, 'PONTO_INEXISTENTE', 'Ponto');
      const ponto: Ponto = {
        ...anterior,
        x: exigirUM(x, `payload.x do evento ${evento.id}`),
        y: exigirUM(y, `payload.y do evento ${evento.id}`),
      };
      return comPeca(modelo, { ...peca, pontos: { ...peca.pontos, [pontoId]: ponto } });
    }

    case 'DefinirAresta': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { arestaId, pontoInicioId, pontoFimId } = evento.payload;
      exigirDoMapa(peca.pontos, pontoInicioId, 'PONTO_INEXISTENTE', 'Ponto de inicio da aresta');
      exigirDoMapa(peca.pontos, pontoFimId, 'PONTO_INEXISTENTE', 'Ponto de fim da aresta');
      const aresta: Aresta = { id: arestaId, pecaId: peca.id, pontoInicioId, pontoFimId };
      return comPeca(modelo, { ...peca, arestas: { ...peca.arestas, [arestaId]: aresta } });
    }

    case 'DefinirSegmento': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { segmentoId, arestaId, de, para, tipo, controles } = evento.payload;
      exigirDoMapa(peca.arestas, arestaId, 'ARESTA_INEXISTENTE', 'Aresta do segmento');
      exigirDoMapa(peca.pontos, de, 'PONTO_INEXISTENTE', 'Ponto "de" do segmento');
      exigirDoMapa(peca.pontos, para, 'PONTO_INEXISTENTE', 'Ponto "para" do segmento');

      if (tipo === 'curva') {
        exigir(
          controles !== undefined && controles.length === 2,
          'CURVA_SEM_CONTROLES',
          `Segmento "${segmentoId}" e curva e precisa de exatamente 2 pontos de controle ` +
            `(D1: Bezier cubico). Recebi ${controles === undefined ? 'nenhum' : String(controles.length)}.`,
          { eventoId: evento.id, segmentoId },
        );
        for (const controle of controles) {
          exigirUM(controle.x, `controle.x do segmento ${segmentoId}`);
          exigirUM(controle.y, `controle.y do segmento ${segmentoId}`);
        }
      } else {
        exigir(
          controles === undefined,
          'CURVA_COM_CONTROLES_DEMAIS',
          `Segmento "${segmentoId}" e reta mas veio com pontos de controle. ` +
            `Use tipo 'curva' ou remova os controles.`,
          { eventoId: evento.id, segmentoId },
        );
      }

      const base = { id: segmentoId, arestaId, de, para, tipo };
      const segmento: Segmento = controles === undefined ? base : { ...base, controles };
      const jaExistia = peca.segmentos[segmentoId] !== undefined;
      return comPeca(modelo, {
        ...peca,
        segmentos: { ...peca.segmentos, [segmentoId]: segmento },
        contorno: jaExistia ? peca.contorno : [...peca.contorno, segmentoId],
      });
    }

    case 'DefinirMargem': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { arestaId, margemUM } = evento.payload;
      exigirDoMapa(peca.arestas, arestaId, 'ARESTA_INEXISTENTE', 'Aresta da margem');
      const margem = exigirUM(margemUM, `payload.margemUM do evento ${evento.id}`);
      exigir(
        margem >= 0,
        'MARGEM_NEGATIVA',
        `Margem ${margem} UM na aresta "${arestaId}" e negativa.`,
        { eventoId: evento.id, arestaId, margem },
      );
      return comPeca(modelo, { ...peca, margens: { ...peca.margens, [arestaId]: margem } });
    }

    case 'DefinirParCostura': {
      const { parId, arestaA, arestaB, embebidoUM } = evento.payload;
      exigir(
        modelo.paresCostura[parId] === undefined,
        'PAR_COSTURA_DUPLICADO',
        `O par de costura "${parId}" ja existe no modelo "${modelo.id}".`,
        { eventoId: evento.id, parId },
      );
      exigirArestaNoModelo(modelo, arestaA, evento.id);
      exigirArestaNoModelo(modelo, arestaB, evento.id);
      exigir(
        arestaA !== arestaB,
        'PAR_COSTURA_DUPLICADO',
        `O par de costura "${parId}" aponta duas vezes para a aresta "${arestaA}".`,
        { eventoId: evento.id, parId },
      );
      return {
        ...modelo,
        paresCostura: {
          ...modelo.paresCostura,
          [parId]: {
            id: parId,
            modeloId: modelo.id,
            arestaA,
            arestaB,
            embebidoUM: exigirUM(embebidoUM, `payload.embebidoUM do evento ${evento.id}`),
          },
        },
      };
    }

    case 'ModificarPonto': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { pontoId, dx, dy, modo, nVizinhos } = evento.payload;
      return comPeca(modelo, modificarPonto(peca, pontoId, dx, dy, modo, nVizinhos));
    }

    case 'DefinirEixoDobra': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { eixoId, p1, p2, direcao, profundidadeUM } = evento.payload;
      for (const [nome, ponto] of [
        ['p1', p1],
        ['p2', p2],
      ] as const) {
        exigirUM(ponto.x, `payload.${nome}.x do evento ${evento.id}`);
        exigirUM(ponto.y, `payload.${nome}.y do evento ${evento.id}`);
      }
      exigir(
        p1.x !== p2.x || p1.y !== p2.y,
        'EIXO_DEGENERADO',
        `O eixo de dobra "${eixoId}" tem os dois pontos na mesma coordenada ` +
          `(${p1.x}, ${p1.y}); nao define direcao.`,
        { eventoId: evento.id, eixoId },
      );
      const base = { id: eixoId, p1, p2, direcao };
      const eixo =
        profundidadeUM === undefined
          ? base
          : {
              ...base,
              profundidadeUM: exigirUM(
                profundidadeUM,
                `payload.profundidadeUM do evento ${evento.id}`,
              ),
            };
      return comPeca(modelo, { ...peca, eixosDobra: { ...peca.eixosDobra, [eixoId]: eixo } });
    }

    case 'RemoverEixoDobra': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      exigirDoMapa(peca.eixosDobra, evento.payload.eixoId, 'EIXO_DOBRA_INEXISTENTE', 'Eixo de dobra');
      const eixosDobra = { ...peca.eixosDobra };
      delete eixosDobra[evento.payload.eixoId];
      return comPeca(modelo, { ...peca, eixosDobra });
    }

    case 'EspelharPeca': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { p1, p2 } = evento.payload;
      return comPeca(modelo, espelharPeca(peca, { p1, p2 }));
    }

    case 'RotacionarPeca': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { centro, anguloGraus } = evento.payload;
      return comPeca(modelo, rotacionarPeca(peca, centro, anguloGraus));
    }

    case 'TransladarPeca': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { dx, dy } = evento.payload;
      return comPeca(modelo, transladarPeca(peca, dx, dy));
    }

    case 'AdicionarPique': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { piqueId, arestaId, s, tipo, alturaUM, larguraUM, anguloGraus } = evento.payload;
      return comPeca(
        modelo,
        adicionarPique(peca, { id: piqueId, arestaId, s, tipo, alturaUM, larguraUM, anguloGraus }),
      );
    }

    case 'MoverPique': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      return comPeca(modelo, moverPique(peca, evento.payload.piqueId, evento.payload.s));
    }

    case 'RemoverPique': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      return comPeca(modelo, removerPique(peca, evento.payload.piqueId));
    }

    case 'AdicionarLinhaInterna': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { linhaId, tipo, pontoIds } = evento.payload;
      exigir(
        peca.linhasInternas[linhaId] === undefined,
        'PONTO_DUPLICADO',
        `A linha interna "${linhaId}" ja existe na peca "${peca.id}".`,
        { eventoId: evento.id, linhaId },
      );
      exigir(
        pontoIds.length >= 2,
        'CONTORNO_DEGENERADO',
        `A linha interna "${linhaId}" tem ${pontoIds.length} ponto(s); uma linha precisa ` +
          `de pelo menos 2.`,
        { eventoId: evento.id, linhaId },
      );
      for (const pontoId of pontoIds) {
        exigirDoMapa(peca.pontos, pontoId, 'PONTO_INEXISTENTE', 'Ponto da linha interna');
      }
      return comPeca(modelo, {
        ...peca,
        linhasInternas: {
          ...peca.linhasInternas,
          [linhaId]: { id: linhaId, tipo, pontos: [...pontoIds] },
        },
      });
    }

    case 'AdicionarRecorte': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { recorteId, pontoIds } = evento.payload;
      exigir(
        peca.recortes[recorteId] === undefined,
        'PONTO_DUPLICADO',
        `O recorte "${recorteId}" ja existe na peca "${peca.id}".`,
        { eventoId: evento.id, recorteId },
      );
      exigir(
        pontoIds.length >= 3,
        'CONTORNO_DEGENERADO',
        `O recorte "${recorteId}" tem ${pontoIds.length} ponto(s); um anel fechado precisa ` +
          `de pelo menos 3.`,
        { eventoId: evento.id, recorteId },
      );
      for (const pontoId of pontoIds) {
        exigirDoMapa(peca.pontos, pontoId, 'PONTO_INEXISTENTE', 'Ponto do recorte');
      }
      return comPeca(modelo, {
        ...peca,
        recortes: { ...peca.recortes, [recorteId]: { id: recorteId, pontos: [...pontoIds] } },
      });
    }

    case 'InserirPonto': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { segmentoId, s, prefixoId } = evento.payload;
      return comPeca(modelo, inserirPonto(peca, segmentoId, s, prefixoId));
    }

    case 'ExcluirPonto': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      return comPeca(modelo, excluirPonto(peca, evento.payload.pontoId));
    }

    case 'ConverterSegmento': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { segmentoId, para } = evento.payload;
      return comPeca(modelo, converterSegmento(peca, segmentoId, para));
    }

    case 'ArredondarVertice': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { pontoId, raioUM, prefixoId } = evento.payload;
      return comPeca(modelo, arredondarVertice(peca, pontoId, raioUM, prefixoId));
    }

    case 'ChanfrarVertice': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { pontoId, distanciaUM, prefixoId } = evento.payload;
      return comPeca(modelo, chanfrarVertice(peca, pontoId, distanciaUM, prefixoId));
    }

    case 'SimplificarContorno': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      return comPeca(modelo, simplificarContorno(peca, evento.payload.toleranciaUM));
    }

    case 'MarcarGradePoint': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { gradePointId, pontoId } = evento.payload;
      exigirDoMapa(peca.pontos, pontoId, 'PONTO_INEXISTENTE', 'Ponto do grade point');
      exigir(
        peca.gradePoints[gradePointId] === undefined,
        'GRADE_POINT_DUPLICADO',
        `O grade point "${gradePointId}" ja existe na peca "${peca.id}".`,
        { eventoId: evento.id, gradePointId },
      );
      for (const existente of Object.values(peca.gradePoints)) {
        exigir(
          existente.pontoId !== pontoId,
          'GRADE_POINT_DUPLICADO',
          `O ponto "${pontoId}" ja esta marcado como grade point ("${existente.id}"). ` +
            `Dois grade points no mesmo ponto dariam duas regras concorrentes para a ` +
            `mesma coordenada.`,
          { eventoId: evento.id, pontoId, gradePointId: existente.id },
        );
      }
      return comPeca(modelo, {
        ...peca,
        gradePoints: { ...peca.gradePoints, [gradePointId]: { id: gradePointId, pontoId } },
      });
    }

    case 'DefinirRegraGraduacao': {
      const { regraId, pontoGraduacaoId, deTamanho, paraTamanho, dx, dy } = evento.payload;
      exigir(
        modelo.regrasGraduacao[regraId] === undefined,
        'REGRA_GRADUACAO_DUPLICADA',
        `A regra de graduacao "${regraId}" ja existe no modelo "${modelo.id}".`,
        { eventoId: evento.id, regraId },
      );
      exigirGradePointNoModelo(modelo, pontoGraduacaoId, evento.id);

      const de = modelo.tamanhos.indexOf(deTamanho);
      const para = modelo.tamanhos.indexOf(paraTamanho);
      exigir(
        de >= 0 && para >= 0,
        'TAMANHO_DESCONHECIDO',
        `A regra "${regraId}" liga "${deTamanho}" a "${paraTamanho}", mas a grade do ` +
          `modelo e [${modelo.tamanhos.join(', ')}].`,
        { eventoId: evento.id, regraId, deTamanho, paraTamanho },
      );
      exigir(
        para === de + 1,
        'REGRA_GRADUACAO_NAO_CONSECUTIVA',
        `A regra "${regraId}" vai de "${deTamanho}" a "${paraTamanho}", que nao sao ` +
          `tamanhos consecutivos na grade [${modelo.tamanhos.join(', ')}] nessa ordem. ` +
          `O incremento e sempre de um tamanho para o SEGUINTE; o acumulado ate um ` +
          `tamanho distante e somado pelo motor, nao declarado a mao.`,
        { eventoId: evento.id, regraId, deTamanho, paraTamanho },
      );

      for (const existente of Object.values(modelo.regrasGraduacao)) {
        exigir(
          !(
            existente.pontoGraduacaoId === pontoGraduacaoId &&
            existente.deTamanho === deTamanho &&
            existente.paraTamanho === paraTamanho
          ),
          'REGRA_GRADUACAO_DUPLICADA',
          `Ja existe a regra "${existente.id}" para o grade point "${pontoGraduacaoId}" ` +
            `no passo "${deTamanho}" -> "${paraTamanho}". Duas regras para o mesmo passo ` +
            `dariam dois resultados para a mesma coordenada.`,
          { eventoId: evento.id, regraId, conflitante: existente.id },
        );
      }

      return {
        ...modelo,
        regrasGraduacao: {
          ...modelo.regrasGraduacao,
          [regraId]: {
            id: regraId,
            pontoGraduacaoId,
            deTamanho,
            paraTamanho,
            dx: exigirUM(dx, `payload.dx do evento ${evento.id}`),
            dy: exigirUM(dy, `payload.dy do evento ${evento.id}`),
          },
        },
      };
    }

    case 'MoverControle': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { segmentoId, indice, dx, dy } = evento.payload;
      return comPeca(modelo, moverControle(peca, segmentoId, indice, dx, dy));
    }

    case 'DuplicarPeca': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { novoPecaId, prefixoId, dx, dy, comGraduacao } = evento.payload;
      exigir(
        modelo.pecas[novoPecaId] === undefined,
        'PECA_DUPLICADA',
        `Ja existe a peca "${novoPecaId}"; DuplicarPeca nao sobrescreve peca existente.`,
        { eventoId: evento.id, pecaId: novoPecaId },
      );
      const { peca: copia, gradePointsNovos } = duplicarPeca(peca, novoPecaId, prefixoId, {
        dx,
        dy,
      });

      const comCopia = comPeca(modelo, copia);
      if (!comGraduacao) return comCopia;

      // As regras vivem no MODELO: copiar a peca sem copiar as regras deixaria a
      // copia parada na graduacao. Cada regra que apontava para um grade point da
      // original ganha uma gemea apontando para o correspondente da copia.
      const regrasGraduacao = { ...comCopia.regrasGraduacao };
      let n = 0;
      for (const regra of Object.values(modelo.regrasGraduacao)) {
        const novoGradePoint = gradePointsNovos.get(regra.pontoGraduacaoId);
        if (novoGradePoint === undefined) continue;
        const id = `${prefixoId}-r-${n++}`;
        regrasGraduacao[id] = { ...regra, id, pontoGraduacaoId: novoGradePoint };
      }
      return { ...comCopia, regrasGraduacao };
    }

    case 'DividirPeca': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { p1, p2, margemNovaUM, prefixoId } = evento.payload;
      const [parte1, parte2] = dividirPeca(peca, { p1, p2 }, margemNovaUM, prefixoId);
      // A peca original DESAPARECE: ela nao existe mais depois de cortada, e
      // deixa-la no modelo faria o encaixe contar tecido duas vezes.
      const pecas = { ...modelo.pecas };
      delete pecas[peca.id];
      pecas[parte1.id] = parte1;
      pecas[parte2.id] = parte2;
      return { ...modelo, pecas };
    }

    case 'AbrirPregas': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { eixoIds, prefixoId } = evento.payload;
      return comPeca(modelo, abrirPregas(peca, [...eixoIds], prefixoId));
    }

    case 'DefinirEncaixe': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      return comPeca(modelo, { ...peca, encaixe: evento.payload.encaixe });
    }

    case 'RemoverPeca': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      // ParCostura que apontava para uma aresta dela fica pendurado de proposito:
      // apagar em cascata esconderia que uma costura perdeu o par. O validador acusa.
      const pecas = { ...modelo.pecas };
      delete pecas[peca.id];
      return { ...modelo, pecas };
    }

    case 'RemoverLinhaInterna': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { linhaId } = evento.payload;
      exigirDoMapa(peca.linhasInternas, linhaId, 'LINHA_INTERNA_INEXISTENTE', 'Linha interna');
      const linhasInternas = { ...peca.linhasInternas };
      delete linhasInternas[linhaId];
      return comPeca(modelo, { ...peca, linhasInternas });
    }

    case 'RemoverRecorte': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { recorteId } = evento.payload;
      exigirDoMapa(peca.recortes, recorteId, 'RECORTE_INEXISTENTE', 'Recorte');
      const recortes = { ...peca.recortes };
      delete recortes[recorteId];
      return comPeca(modelo, { ...peca, recortes });
    }

    case 'DesmarcarGradePoint': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { gradePointId } = evento.payload;
      exigirDoMapa(peca.gradePoints, gradePointId, 'GRADE_POINT_INEXISTENTE', 'Grade point');
      // As regras que apontavam para ele NAO sao apagadas junto (ver o tipo do
      // evento): elas ficam orfas e `validarModelo` acusa.
      const gradePoints = { ...peca.gradePoints };
      delete gradePoints[gradePointId];
      return comPeca(modelo, { ...peca, gradePoints });
    }

    case 'RemoverRegraGraduacao': {
      const { regraId } = evento.payload;
      exigirDoMapa(
        modelo.regrasGraduacao,
        regraId,
        'REGRA_GRADUACAO_INEXISTENTE',
        'Regra de graduacao',
      );
      const regrasGraduacao = { ...modelo.regrasGraduacao };
      delete regrasGraduacao[regraId];
      return { ...modelo, regrasGraduacao };
    }

    case 'RemoverParCostura': {
      const { parId } = evento.payload;
      exigirDoMapa(modelo.paresCostura, parId, 'PAR_COSTURA_INEXISTENTE', 'Par de costura');
      const paresCostura = { ...modelo.paresCostura };
      delete paresCostura[parId];
      return { ...modelo, paresCostura };
    }

    case 'DefinirMetadados': {
      const peca = obterPeca(modelo, evento.pecaId, evento.tipo, evento.id);
      const { nome, descricao } = evento.payload;
      exigir(
        nome.trim().length > 0,
        'NOME_VAZIO',
        `A peca "${peca.id}" ficaria sem nome. Uma peca sem nome no molde e uma peca ` +
          `que ninguem acha na hora do corte.`,
        { eventoId: evento.id, pecaId: peca.id },
      );
      const metadados = descricao === undefined ? { nome } : { nome, descricao };
      return comPeca(modelo, { ...peca, metadados });
    }

    default: {
      const naoTratado: never = evento;
      throw new ErroMotor(
        'EVENTO_VERSAO_DESCONHECIDA',
        `Tipo de evento nao tratado pelo fold: ${JSON.stringify(naoTratado)}`,
      );
    }
  }
}

/** Reconstroi o modelo do zero a partir do log inteiro. Puro: mesmo log -> mesmo estado. */
export function reconstruir(eventos: readonly Evento[]): Modelo {
  let modelo: Modelo | null = null;
  for (const evento of eventos) modelo = fold(modelo, evento);
  exigir(
    modelo !== null,
    'PECA_INEXISTENTE',
    'Log vazio: nao ha o que reconstruir. O primeiro evento tem que ser CriarModelo.',
  );
  return modelo;
}

function comPeca(modelo: Modelo, peca: Peca): Modelo {
  return { ...modelo, pecas: { ...modelo.pecas, [peca.id]: peca } };
}

function exigirPecaId(pecaId: Id | null, tipo: string, eventoId: string): Id {
  exigir(
    pecaId !== null,
    'PECA_INEXISTENTE',
    `Evento "${eventoId}" (${tipo}) precisa de pecaId, mas veio null. ` +
      `pecaId null e reservado a eventos de nivel de modelo.`,
    { eventoId },
  );
  return pecaId;
}

function obterPeca(modelo: Modelo, pecaId: Id | null, tipo: string, eventoId: string): Peca {
  const id = exigirPecaId(pecaId, tipo, eventoId);
  return exigirDoMapa(modelo.pecas, id, 'PECA_INEXISTENTE', 'Peca');
}

function exigirGradePointNoModelo(modelo: Modelo, gradePointId: Id, eventoId: string): void {
  for (const pecaId of Object.keys(modelo.pecas)) {
    if (modelo.pecas[pecaId]!.gradePoints[gradePointId] !== undefined) return;
  }
  throw new ErroMotor(
    'GRADE_POINT_INEXISTENTE',
    `O grade point "${gradePointId}" da regra de graduacao nao existe em nenhuma peca ` +
      `do modelo "${modelo.id}". Emita MarcarGradePoint antes da regra.`,
    { eventoId, gradePointId },
  );
}

function exigirArestaNoModelo(modelo: Modelo, arestaId: Id, eventoId: string): void {
  for (const pecaId of Object.keys(modelo.pecas)) {
    if (modelo.pecas[pecaId]!.arestas[arestaId] !== undefined) return;
  }
  throw new ErroMotor(
    'ARESTA_INEXISTENTE',
    `A aresta "${arestaId}" do par de costura nao existe em nenhuma peca do modelo "${modelo.id}".`,
    { eventoId, arestaId },
  );
}
