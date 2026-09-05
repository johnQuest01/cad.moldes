# FASE 1 — Índice das partes

Substitui o arquivo único `cad-moldes-fase1-motor.md`. Cole a **Parte 0 + a parte que for trabalhar**, nunca tudo.

| Parte | Arquivo | Contém | Quando usar |
|---|---|---|---|
| 0 | `fase1-00-protocolo.md` | Contexto, verify-before-act, anti-genérico, 7 decisões inegociáveis, ordem de implementação | **Sempre.** As outras assumem estas regras |
| 1 | `fase1-01-modelo-dados.md` | Entidades, vocabulário, assinaturas TS, **4 decisões fechadas (D1–D4)**, orçamento de tolerância | Bloco 1–2 (tipos, ponto/segmento/peça) |
| 2 | `fase1-02-operacoes-base.md` | Offset, tesselar, medir, graduar, espelhar, casamento, comparar perímetros, validar | Blocos 3–6 |
| 3 | `fase1-03-operacoes-edicao.md` | Modificar discreto/proporcional, fillet, simplificar, inserir/excluir ponto, dobra, dividir | Blocos 7–9 |
| 4 | `fase1-04-event-sourcing.md` | Eventos, persistência Neon+JSONB, IDs determinísticos, compat DXF, offline | Bloco 2 e ao persistir |
| 5 | `fase1-05-testes.md` | 14 testes de exemplo, testes de propriedade (fast-check), entrada degenerada | Ao fim de **cada** bloco |
| 6 | `fase1-06-estado-e-tolerancias.md` | **Descritiva.** Estado por bloco, D5 (tesselação própria), D6 (offset por aresta), D7/D8/D8b (graduação), conferência, orçamento de tolerância preenchido | Para saber onde o código está antes de retomar |
| 8 | `fase1-08-persistencia.md` | **Descritiva.** Log de eventos e snapshot (Neon + SQLite), RLS por tenant, backend Fastify | Ao mexer em persistência ou na API |
| 7 | `fase1-07-casos-reais.md` | **Descritiva.** Casos de teste vindos de fontes externas (DXF ASTM, M. Müller & Sohn, margens de indústria, embebido de manga) + figuras geradas pelo motor | Ao conferir o motor contra o ofício, não só contra si mesmo |

## Decisões fechadas (D1–D4, aplicadas em todas as partes)
- **D1 — Curva = Bézier cúbico**, não NURBS (DXF exporta polilinha; NURBS só ganharia em cônicas). Entrada por Catmull-Rom. Fillet via `κ = 4/3·tan(θ/4)`, erro ~2,7 µm contra tolerância de 100 µm.
- **D2 — Fold é função pura**; id/timestamp/autor vêm no payload. UUIDv7 ou ULID.
- **D3 — `Aresta` com ID estável** + **`ParCostura` no `Modelo`** (as arestas pareadas vivem em peças diferentes).
- **D4 — CCW, Y-up, delta positivo = fora, JoinType Miter**, com assertion `área(corte) > área(costura)` dentro do `offsetMargem`.
- **Bônus da D1:** posição de pique é **`s` por comprimento de arco**, nunca o `t` de Bézier — `t = 0.5` não é o meio da curva.

## Diferenças em relação ao arquivo original
Nada foi removido. Foi acrescentado:
- As **decisões D1–D4** acima, com justificativa, refletidas nas invariantes (Parte 0), nos tipos (Parte 1), no offset e na medição (Parte 2), nos eventos (Parte 4) e em 5 testes novos (Parte 5).
- **Projeção do pique costura→corte** — **única lacuna ainda aberta**, marcada na Parte 1.
- **`tenant_id`** como decisão inegociável nº 6 (Parte 0) e em todo evento (Parte 4).
- **Âncora da graduação** e **não persistir polilinha tesselada** explicitados na Parte 2.
- **Inserir/excluir ponto** como operação 13 e eventos próprios (Partes 3 e 4).
- **Testes de propriedade com fast-check** e **teste de pique sob edição/graduação** na Parte 5.
- **Orçamento de tolerância** a preencher (Parte 1) e **decisão de armazenamento offline** (Parte 4).

## Ordem sugerida
Bloco 1 (tipos + constantes + Ponto/Segmento/Aresta/Peça + fold puro) → **teste 1 rodando**: retângulo 100×200 mm + margem 10 mm = **120×220 exato, cantos retos**. Depois Bloco 2 e seguintes, parando e colando a saída a cada bloco.

**Nenhuma pendência de decisão em aberto.** O armazenamento offline ficou **Tauri + SQLite**
(Parte 8): o mesmo esquema serve ao Neon e à máquina offline, com RLS por tenant no Postgres.

A **autenticação** também está fechada: o tenant sai de um claim de JWT assinado, e o servidor
recusa subir sem uma estratégia escolhida. O **CI headless** roda `typecheck → testes → build →
artefatos → figuras`, tudo sem servidor de banco.

**Piques pelo cursor — fechado.** Faltava o caminho de fora para dentro: cravar, arrastar e tirar
pique **pelo log**. Entraram as operações `adicionarPique` / `moverPique` / `removerPique`, os três
eventos correspondentes, `localizarNoContorno` (coordenada do cursor → `(aresta, s)` e
`(segmento, s)`, que é o que a Fase 2 vai usar em todo clique no contorno) e a regra de ofício
`PIQUE_MAIS_FUNDO_QUE_A_MARGEM` no validador. 12 testes novos, medidos na Parte 6.

**Demonstração navegável (`demo/`).** O motor rodando no navegador, com manipulação direta:
arrastar vértice (discreto ou proporcional), cravar e deslizar pique, inserir ponto — e **cada gesto
vira um evento no log**, listado na tela, com desfazer por `pop()`. Não é um caminho paralelo ao
backend: é o mesmo `fold`. `npm run demo` para rodar, `npm run demo:build` para gerar.

**O que fica para as próximas fases:** o **editor completo em PixiJS** (Fase 2 — camadas, zoom/pan,
seleção múltipla, réguas; a demo cobre o gesto, não a ferramenta inteira), o parser de DXF (Fase 3)
e o encaixe (Fase 5).

## Onde o código está (resumo — detalhe na Parte 6)
**Fase 1 fechada, entregas da Parte 0 inclusive: motor `@cad/motor`, persistência
`@cad/persistencia` e backend `@cad/api`, com 201 testes passando** (164 + 18 + 19).
Os 18 testes de exemplo da Parte 5 estão conferidos com número (o 14 pela metade), e o **teste 13
roda também dentro do banco**, no Postgres e no SQLite. Decisões tomadas em código, todas com evidência medida na Parte 6:
**D5** (a tesselação é do motor; o `verb` virou oráculo de teste), **D6** (o offset por aresta é
deslocamento paralelo aqui, com a união ainda no clipper2) e **D7/D8/D8b** (graduação sem âncora
global, incremento entre tamanhos consecutivos, pontos livres acompanhando por comprimento de
arco). Decisões novas: **D9** (embebido no ParCostura) e **D10** (geometria interna feita de `Ponto`,
que fez o fio graduar pela mesma regra do contorno). A **projeção do pique costura → corte**, única
lacuna que a Parte 1 deixou marcada, está fechada.
