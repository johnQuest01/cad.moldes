/**
 * Erros do motor.
 *
 * REGRA DE ERRO (Parte 0): nada de `catch` silencioso, nada de default mascarando
 * falha. Falhou -> estoura com mensagem clara. Um molde silenciosamente errado e a
 * pior falha possivel; erro explicito e sucesso.
 */

export type CodigoErro =
  // unidades
  | 'VALOR_NAO_FINITO'
  | 'UM_NAO_INTEIRO'
  | 'UM_FORA_DA_FAIXA'
  // referencias
  | 'PECA_INEXISTENTE'
  | 'PECA_DUPLICADA'
  | 'PONTO_INEXISTENTE'
  | 'PONTO_DUPLICADO'
  | 'SEGMENTO_INEXISTENTE'
  | 'SEGMENTO_DUPLICADO'
  | 'ARESTA_INEXISTENTE'
  | 'ARESTA_DUPLICADA'
  | 'PAR_COSTURA_DUPLICADO'
  | 'PAR_COSTURA_INEXISTENTE'
  | 'LINHA_INTERNA_INEXISTENTE'
  | 'RECORTE_INEXISTENTE'
  | 'REGRA_GRADUACAO_INEXISTENTE'
  | 'NOME_VAZIO'
  // geometria
  | 'CONTORNO_ABERTO'
  | 'CONTORNO_VAZIO'
  | 'CONTORNO_DEGENERADO'
  | 'SEGMENTO_DESCONTINUO'
  | 'SEGMENTO_COMPRIMENTO_ZERO'
  | 'CURVA_SEM_CONTROLES'
  | 'CURVA_COM_CONTROLES_DEMAIS'
  | 'CURVA_DEGENERADA'
  | 'AREA_ZERO'
  // tesselacao e medicao (Bloco 3)
  | 'TOLERANCIA_INVALIDA'
  | 'TESSELACAO_NAO_CONVERGIU'
  | 'ARESTA_SEM_SEGMENTOS'
  | 'ARESTA_DESCONTINUA'
  | 'ARESTA_EXTREMOS_DIVERGENTES'
  | 'ARESTA_COMPRIMENTO_ZERO'
  | 'S_FORA_DA_FAIXA'
  // graduacao (Bloco 5)
  | 'TAMANHO_DESCONHECIDO'
  | 'GRADE_POINT_DUPLICADO'
  | 'GRADE_POINT_INEXISTENTE'
  | 'REGRA_GRADUACAO_DUPLICADA'
  | 'REGRA_GRADUACAO_NAO_CONSECUTIVA'
  // conferencia (Bloco 6)
  | 'CONFERENCIA_SEM_ARESTAS'
  // edicao de ponto (Bloco 7)
  | 'N_VIZINHOS_INVALIDO'
  | 'N_VIZINHOS_EXCEDE_CONTORNO'
  | 'PONTO_FORA_DO_CONTORNO'
  | 'PONTO_NOTAVEL_NAO_REMOVIVEL'
  | 'GRADE_POINT_NAO_REMOVIVEL'
  | 'MERGE_DE_CURVA_NAO_REPRESENTAVEL'
  | 'SEGMENTO_NAO_E_CURVA'
  | 'CONTROLE_INEXISTENTE'
  | 'FILLET_EM_CURVA_NAO_SUPORTADO'
  | 'FILLET_NAO_CABE'
  | 'VERTICE_DEGENERADO'
  | 'RAIO_INVALIDO'
  // offset
  | 'MARGEM_NEGATIVA'
  | 'MARGEM_AUSENTE'
  | 'OFFSET_NAO_CRESCEU'
  | 'OFFSET_MULTIPLOS_ANEIS'
  | 'OFFSET_VAZIO'
  | 'RECORTE_AINDA_NAO_SUPORTADO'
  // transformacoes e dobra (operacao 5 e Bloco 8)
  | 'EIXO_DEGENERADO'
  | 'EIXO_DOBRA_INEXISTENTE'
  | 'EIXO_DOBRA_ATRAVESSA_A_PECA'
  | 'EIXO_DOBRA_FORA_DO_CONTORNO'
  | 'DESDOBRA_NAO_FECHOU'
  | 'DESDOBRA_NAO_CRESCEU'
  // validacao (Bloco 10) — codigos que so aparecem como Problema, nunca lancados
  | 'CONTORNO_AUTO_INTERSECTADO'
  | 'PIQUE_ORFAO'
  | 'PIQUE_FORA_DA_ARESTA'
  | 'PIQUE_DUPLICADO'
  | 'PIQUE_DIMENSAO_INVALIDA'
  | 'PIQUE_MAIS_FUNDO_QUE_A_MARGEM'
  | 'FIO_AUSENTE'
  | 'GRADE_POINT_SEM_REGRA'
  | 'PONTO_INTERNO_SEM_REGRA'
  | 'REGRA_SEM_GRADE_POINT'
  | 'PAR_COSTURA_PENDENTE'
  // dividir (Bloco 9)
  | 'LINHA_DIVISAO_NAO_ATRAVESSA'
  | 'PARTE_DE_AREA_ZERO'
  | 'RECORTE_ATRAVESSA_A_DIVISAO'
  // pregas e projecao de pique
  | 'PREGA_SEM_EIXO'
  | 'PREGA_SEM_PROFUNDIDADE'
  | 'EIXOS_DE_PREGA_NAO_PARALELOS'
  | 'PIQUE_SEM_PROJECAO'
  // eventos
  | 'TENANT_DIVERGENTE'
  | 'EVENTO_SEM_TENANT'
  | 'EVENTO_VERSAO_DESCONHECIDA';

/**
 * Erro do motor com codigo estavel. O codigo e para o chamador decidir;
 * a mensagem e para o humano entender sem abrir o codigo-fonte.
 */
export class ErroMotor extends Error {
  readonly codigo: CodigoErro;
  readonly detalhes: Readonly<Record<string, unknown>>;

  constructor(codigo: CodigoErro, mensagem: string, detalhes: Record<string, unknown> = {}) {
    super(`[${codigo}] ${mensagem}`);
    this.name = 'ErroMotor';
    this.codigo = codigo;
    this.detalhes = Object.freeze({ ...detalhes });
  }
}

/** Estoura ErroMotor se a condicao for falsa. Use no lugar de `if (...) throw`. */
export function exigir(
  condicao: boolean,
  codigo: CodigoErro,
  mensagem: string,
  detalhes: Record<string, unknown> = {},
): asserts condicao {
  if (!condicao) throw new ErroMotor(codigo, mensagem, detalhes);
}

/**
 * Le uma chave de um mapa exigindo que exista.
 * Substitui o `?? valorPadrao` que esconderia a referencia quebrada.
 */
export function exigirDoMapa<T>(
  mapa: Readonly<Record<string, T>>,
  chave: string,
  codigo: CodigoErro,
  oQueE: string,
): T {
  const valor = mapa[chave];
  if (valor === undefined) {
    throw new ErroMotor(codigo, `${oQueE} de id "${chave}" nao existe.`, { id: chave });
  }
  return valor;
}
