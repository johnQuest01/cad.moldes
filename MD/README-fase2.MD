# FASE 2 — Índice das partes

O **editor**: a ferramenta que o modelista abre e usa o dia inteiro. A Fase 1 entregou o motor
(`@cad/motor`, 201 testes); esta fase põe um par de mãos nele.

> **Cole sempre a Parte 0 junto com a parte que for trabalhar.** As outras assumem as regras dela.

| Parte | Arquivo | Contém | Quando usar |
|---|---|---|---|
| 0 | `fase2-00-protocolo.md` | Contexto, protocolo, anti-genérico, **decisões inegociáveis E1–E14**, ordem de implementação, o que NÃO fazer | **Sempre** |
| 1 | `fase2-01-arquitetura.md` | Os dois pacotes (`@cad/editor` puro + `@cad/editor-pixi`), sessão e log local, undo/selo, câmera e coordenadas, camadas, cache e redesenho | Blocos 1 e 5 |
| 2 | `fase2-02-lacunas-do-motor.md` | **Bloco 0.** O que falta em `@cad/motor` antes de o editor existir: 11 eventos e 2 operações, com assinatura, validação e teste exigido | **Comece por aqui** |
| 3 | `fase2-03-interacao.md` | Hit-testing, snap (7 tipos e a ordem de prioridade), seleção (janela × cruzamento), atalhos, cursores, entrada numérica | Blocos 2, 3 e 8 |
| 4 | `fase2-04-ferramentas.md` | O catálogo completo: 22 ferramentas, cada uma com gesto, operação do motor, evento emitido, recusas e teste | Blocos 4 e 7 |
| 5 | `fase2-05-testes.md` | Como se testa um editor **headless**: harness de ponteiro, o renderizador-de-teste, o que é testável e o que fica para o olho | Ao fim de **cada** bloco |

## A decisão que estrutura tudo (E13)

**PixiJS fica na borda.** O comportamento do editor — câmera, snap, seleção, a máquina de estados de
cada ferramenta, o log local, o undo — vive em **`@cad/editor`, TypeScript puro, sem DOM e sem
Pixi**, e é testado headless como o motor. **`@cad/editor-pixi`** só desenha o que o `@cad/editor`
diz, e só traduz ponteiro e teclado em chamadas para ele.

É a mesma disciplina que fez a Fase 1 dar certo, aplicada um andar acima: se o comportamento só
puder ser verificado abrindo o navegador e olhando, ele não vai ser verificado.

## O que esta fase entrega

- Os **11 eventos e 2 operações** que faltavam no motor (Parte 2) — sem eles, metade das ferramentas
  não teria como virar log, e o editor viraria um caminho paralelo ao backend.
- `@cad/editor`: sessão, câmera, snap, seleção, 22 ferramentas, tudo testado headless.
- `@cad/editor-pixi`: render em camadas espelhando as do DXF ASTM, com traço de espessura constante
  na tela e overlay de texto/alças em pixels.
- O aplicativo: peças múltiplas na tela, painel de camadas, ficha de medidas, log de eventos,
  atalhos, entrada numérica exata, salvar/abrir contra `@cad/api`.

## O que NÃO é desta fase

- **Encaixe** (Fase 5) e **3D** — nem esboço.
- **Parser de DXF** (Fase 3). O editor abre e salva pelo log de eventos, não por DXF.
- **Colaboração em tempo real.** O log é append-only e preparado para isso, mas dois cursores na
  mesma peça é problema de outra fase.
- **Plotter / HPGL** (vem com o wrap Tauri, Fase 4).

## Estado

- **Bloco 0 — fechado.** Os 11 eventos e as 2 operações estão no motor, com **21 testes novos** e o
  número colado no fim da Parte 2. O motor foi de 164 para **185 testes**; com persistência e API,
  **222**. `VERSAO_SCHEMA_ATUAL` continua 1: log antigo reconstrói igual.
- **Bloco 1 — fechado.** `@cad/editor` existe: `Sessao` (log local, undo/redo por passo, selo,
  cache por versão) e `Camera` (mundo Y-up em UM ↔ tela Y-down em px, zoom no cursor, enquadrar,
  vista para culling). **26 testes** headless, com os números no fim da Parte 1 — incluindo o
  guarda-costas da E3, que falha se alguém importar Pixi ou tocar no DOM aqui dentro.
- **Bloco 2 — fechado.** `Camadas` (as 10 do DXF ASTM, com visível e travada), `Cena` (cache dos
  derivados por versão e tamanho), `acharAlvo` (6 tipos por prioridade) e `acharSnap` (7 tipos, raio
  em pixels). **45 testes** no editor. Números no fim da Parte 3 — incluindo os **16,7 mm** entre o
  meio por arco e o `t = 0.5` na cava, que é o bônus da D1 aparecendo na interface.
- **Bloco 3 — fechado.** `Selecao` guarda **referência, não coordenada** (sobrevive à edição e à
  graduação), com `podar` para as órfãs; marquee janela × cruzamento pela convenção de CAD.
  **58 testes** no editor. Números no fim da Parte 3.
- **Bloco 4 — fechado.** `Editor` (conduz ferramenta, câmera, cena, camadas e seleção) e as seis
  essenciais: selecionar, mover ponto, mover peça, pique, inserir ponto e medir. **78 testes** no
  editor. Números no fim da Parte 4 — inclusive a prévia calculada na peça **base**, que é o que
  impede a previsualização de mentir no modo proporcional.
- **Blocos 5 a 8 — a fazer.** O próximo é o Bloco 5: `@cad/editor-pixi`, o render.
