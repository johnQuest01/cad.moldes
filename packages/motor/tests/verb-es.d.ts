/**
 * Tipagem do build ES do verb — so o que os testes usam como oraculo.
 *
 * O pacote publica typings para o entry-point padrao (`verb-nurbs`), que toca
 * `window` e nao carrega no Node. O build ES carrega, mas vem sem declaracao.
 * Em vez de `any` (proibido pela Parte 0), declaramos aqui a superficie exata
 * consumida: se o verb mudar a assinatura, o typecheck acusa.
 */
declare module 'verb-nurbs/build/js/verb.es.js' {
  /** Estrutura opaca do verb (grau, nos e pontos de controle homogeneos). */
  export interface DadosCurvaNurbs {
    readonly degree: number;
    readonly knots: number[];
    readonly controlPoints: number[][];
  }

  /** Ponto do verb: sempre 3D, `[x, y, z]`. */
  type PontoVerb = number[];

  const verb: {
    readonly geom: {
      readonly BezierCurve: new (controlPoints: number[][]) => {
        asNurbs(): DadosCurvaNurbs;
      };
    };
    readonly eval: {
      readonly Eval: {
        rationalCurvePoint(curva: DadosCurvaNurbs, u: number): PontoVerb;
      };
      readonly Tess: {
        rationalCurveAdaptiveSample(
          curva: DadosCurvaNurbs,
          tolerancia: number,
          incluirU: boolean,
        ): PontoVerb[];
      };
      readonly Analyze: {
        /** Comprimento de arco por Gauss-Legendre. Sem `u`, mede a curva inteira. */
        rationalCurveArcLength(curva: DadosCurvaNurbs, u?: number): number;
        rationalCurveClosestParam(curva: DadosCurvaNurbs, ponto: PontoVerb): number;
      };
    };
  };

  export default verb;
}
