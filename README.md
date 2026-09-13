# cad.moldes

Motor geométrico 2D para modelagem de moldes de confecção, em TypeScript puro, mais a persistência
por log de eventos e o backend. **Fases 1 a 7 completas, mais as ferramentas de PRODUÇÃO do ofício
(pregas, pence, bainha, desdobrar, redefinir aresta, alinhar), o teste de estresse do motor (3 rajadas
determinísticas de 150 operações), o estresse do leigo na IA (fuzz das 28 ferramentas) e o modo
demonstração (escanear molde de imagem da internet, sem escala, só para brincar — calibrado com
três imagens reais: foto de ateliê, encaixe colorido e diagrama): 565 testes passando**
(219 motor + 148 editor + 14 DXF + 9 plotter + 15 encaixe + 57 foto + 61 IA + 18 persistência + 24 API).

A especificação normativa está em [`MD/`](MD/README-fase1.MD) — comece pelo índice. A **Parte 6**
diz onde o código está e traz cada decisão com o número medido que a sustenta.

## Pacotes

| Pacote | O que é |
|---|---|
| `@cad/motor` | o núcleo geométrico. TypeScript puro: sem DOM, sem render, sem framework. Roda no Node e no navegador |
| `@cad/persistencia` | log de eventos + snapshot, no Postgres (Neon) e no SQLite local, pelo mesmo esquema |
| `@cad/api` | backend Fastify. O tenant sai de um claim de JWT assinado |
| `@cad/editor` | o comportamento do editor: sessão, câmera, snap, seleção, ferramentas. Puro, sem DOM |
| `@cad/editor-pixi` | render e entrada, em PixiJS 8 |
| `app/` | o editor. O encaixe e a digitalizacao rodam num Web Worker: a tela nao congela |
| `@cad/dxf` | importar e exportar DXF-AAMA/ASTM |
| `@cad/plotter` | gerar HPGL para a plotadora e a cortadora |
| `@cad/encaixe` | encaixar as peças na faixa do tecido, por No-Fit Polygon |
| `@cad/foto` | digitalizar molde por foto: quadro, homografia, segmentação, contorno e curvas |
| `@cad/ia` | o catálogo de ferramentas que o assistente usa para operar o CAD |
| `demo/` | o motor rodando no navegador, com o cursor |

## Rodar

```bash
npm ci
npm test            # os testes, contra o FONTE — não dependem do build
npm run app         # o editor, em http://localhost:5200
npm run demo        # a demonstração do motor, em http://localhost:5199
```

```bash
npm run typecheck
npm run build
node scripts/verificar-dist.mjs   # importa cada pacote pelo NOME e faz o motor calcular
node scripts/gerar-figuras.mjs    # as figuras da documentação saem do próprio motor
```

## As regras que não se negociam

Estão na [Parte 0](MD/fase1-00-protocolo.MD), e valem para qualquer coisa que entre aqui:

- **Micrometro inteiro.** `1 mm = 1000 UM`. Nunca float de milímetro no núcleo.
- **Toda operação é evento.** O estado é o `fold` do log; o fold é função pura, e toda entropia
  (id, timestamp, autor) viaja no payload.
- **`tenant_id` em toda entidade persistida e em todo evento.** Isolamento multi-empresa.
- **Geometria vem de biblioteca testada**, não escrita à mão — e onde o motor tem a sua própria
  (tesselação, deslocamento paralelo), existe uma decisão documentada com o erro medido.
- **Todo teste é RODADO e o número é colado.** "Passou" sem o número não conta.
- **Erro explícito é sucesso.** Um molde silenciosamente errado é a pior falha possível.

## O que fica para as próximas fases

O wrap Tauri, que é o que dá acesso à porta serial para mandar o HPGL à máquina, e a
digitalização de molde por foto (Fase 6).
