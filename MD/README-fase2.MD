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

Especificação escrita; **nada implementado ainda**. O próximo passo é o **Bloco 0** (Parte 2).
