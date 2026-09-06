# cad.moldes — Fase 1

Motor geométrico 2D para modelagem de moldes de confecção, em TypeScript puro, mais a persistência
por log de eventos e o backend. **Fase 1 fechada e Fase 2 até o Bloco 5: 313 testes passando** (187 motor + 89 editor +
18 persistência + 19 API).

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
| `app/` | o editor |
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

O editor completo em PixiJS (Fase 2), o parser de DXF (Fase 3) e o encaixe (Fase 5). A `demo/`
cobre o gesto — arrastar ponto, cravar pique, inserir ponto —, não a ferramenta inteira.
