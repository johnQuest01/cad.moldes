# FASE 2 · PARTE 0 — Contexto e protocolo

> **Sempre cole esta parte junto com a parte que for trabalhar.** As outras cinco assumem estas regras.
> Índice: 0 protocolo · 1 arquitetura · 2 lacunas do motor · 3 interação · 4 ferramentas · 5 testes.

## Contexto

CAD de moldes 2D para substituir o pipeline do Audaces numa confecção. A **Fase 1** entregou o
motor: `@cad/motor` (TypeScript puro, 164 testes), `@cad/persistencia` (log + snapshot, Postgres e
SQLite) e `@cad/api` (Fastify, tenant por JWT). 201 testes no total, cada um com o número medido
colado na Parte 6 da Fase 1.

Esta fase entrega **o editor**: a janela em que o modelista desenha, arrasta, crava pique, gradua e
confere — o dia inteiro, todos os dias. Ela **consome** `@cad/motor` sem tocar no núcleo, exceto
pelo **Bloco 0** (Parte 2), que fecha lacunas que a própria Fase 1 deixou: operações que existem mas
não têm evento, e gestos que o modelista faz mas o motor ainda não sabe representar.

### Quem usa, e o que isso exige

Uma modelista de confecção que hoje usa Audaces. Ela não vai ler manual, não vai aceitar perder
trabalho, e mede erro em **centímetros de tecido desperdiçado por peça, vezes o tamanho do lote**.
Três consequências que valem como requisito:

1. **Precisão exata, não aproximada.** Todo arrasto tem que aceitar valor digitado. "Arrastei mais
   ou menos 2 cm" não existe em modelagem.
2. **Nada de trabalho perdido.** O log é append-only e é salvo; um travamento não pode custar a
   manhã dela.
3. **O gesto tem que ser o do ofício.** Mover ponto com decaimento nos vizinhos, cravar pique na
   aresta, casar costuras — não "editar vértices de polígono".

## Protocolo obrigatório (verify-before-act)

Antes de escrever **qualquer** código:
1. Releia a parte inteira.
2. Devolva, em no máximo 5 linhas, o que você entendeu.
3. Se **qualquer coisa** conflitar com o que já existe no repositório, **PARE e pergunte** — não improvise.

## Ordem de implementação (siga; não faça tudo de uma vez)

| Bloco | O quê | Onde está especificado |
|---|---|---|
| **0** | As lacunas do motor: 11 eventos + 2 operações | Parte 2 |
| 1 | `@cad/editor`: sessão, log local, undo/selo, câmera e conversões | Parte 1 |
| 2 | Hit-testing e snap | Parte 3 |
| 3 | Seleção (clique, shift, janela × cruzamento) | Parte 3 |
| 4 | Máquina de ferramentas + as 6 essenciais (selecionar, mover ponto, mover peça, pique, inserir ponto, medir) | Parte 4 |
| 5 | `@cad/editor-pixi`: camadas, desenho, overlay, espessura constante | Parte 1 |
| 6 | Painéis: camadas, ficha de medidas, propriedades, log de eventos | Parte 1 |
| 7 | As 16 ferramentas restantes | Parte 4 |
| 8 | Persistência contra `@cad/api`, offline, atalhos, acabamento | Parte 1 |

**Pare e mostre os testes rodando ao fim de cada bloco** — não emende os nove.

## Regra de teste (inegociável, herdada da Fase 1)

Todo teste é **executado** e a saída numérica **colada** na resposta. "Passou" sem o número batendo
= **não feito**.

A Parte 5 explica como isso é possível num editor: o comportamento mora em código puro, e o que
sobra de visual é verificado por **lista de comandos de desenho**, não por pixel.

## Regra de erro

Nada de `catch` silencioso, nada de default mascarando falha. Falhou → estoura com mensagem clara.

**Com uma diferença desta fase:** o motor estoura, mas o **editor não pode fechar**. Toda chamada ao
motor dentro de uma ferramenta é encapsulada: se o motor recusar, a ferramenta **cancela o gesto,
não emite evento nenhum, e a mensagem do `ErroMotor` aparece para o modelista**, com o código. O
estado do documento fica exatamente como estava. Ver E7.

## Critério anti-genérico (o que eu vou rejeitar)

Esta fase não é "fazer um canvas com uns círculos arrastáveis". Serão **rejeitados**:

- Ferramenta que altera a peça **sem emitir evento**. Não existe caminho paralelo ao log.
- Comportamento (snap, seleção, câmera, ferramenta) implementado **dentro** de um componente de
  render ou de um handler de DOM, em vez de em `@cad/editor` puro. Isso torna o teste impossível e
  é a violação mais grave desta fase.
- Função sem teste com **número conferido**.
- `TODO`, stub, ou só o caminho feliz.
- Reimplementar geometria que o motor já tem. Se o editor precisa de uma conta geométrica nova, ela
  vai **para o motor**, com teste, não para o editor.
- Número mágico solto (raio de captura, espessura, tolerância) em vez de constante nomeada.
- `any`, `@ts-ignore`, tipo frouxo.
- Abstração "para o futuro" que não é usada agora.
- Estado do documento guardado em duplicidade (uma cópia no editor, outra no log). O documento **é**
  o fold do log. Ver E1.

## Decisões inegociáveis (não reinterprete, não "melhore")

As decisões **D1–D10** da Fase 1 continuam valendo integralmente. Estas são as desta fase.

1. **E1 — O documento é o fold do log.** O editor nunca guarda uma `Peca` mutável como fonte de
   verdade. Ele guarda **o log persistido + um log local (rascunho)**; o modelo exibido é
   `reconstruir([...persistido, ...rascunho.slice(0, cursor)])`, com cache. Toda ferramenta produz
   evento; nada altera peça por baixo.

2. **E2 — Undo/redo mexe só no rascunho, e o salvamento sela.** `desfazer` recua o cursor,
   `refazer` avança, e uma ação nova trunca a cauda. **Salvar** anexa o rascunho ao servidor e o
   esvazia — e o que foi salvo **não volta por undo**: desfazer algo salvo é fazer a operação
   inversa, que é uma edição normal com evento próprio. O log é append-only e auditável; essa é a
   razão de ele existir.

3. **E3 — PixiJS fica na borda.** Comportamento em `@cad/editor` (puro, sem DOM, sem Pixi, testado
   headless); render e entrada em `@cad/editor-pixi`. Um `import` de `pixi.js` dentro de
   `@cad/editor` é erro de arquitetura, não detalhe.

4. **E4 — O mundo é Y-up e em UM.** O núcleo é Y-up (D4); o Pixi é Y-down. A inversão acontece em
   **um** lugar: o container do mundo, com `scale.y = -1`. Nenhum código fora dele nega coordenada.
   1 unidade de mundo = 1 UM.

5. **E5 — Texto, alças e cotas vivem no overlay, em pixels.** Dentro do container espelhado, texto
   sai de cabeça para baixo e alça muda de tamanho com o zoom. Overlay é uma camada Y-down, sem
   escala, cujos elementos são posicionados projetando mundo → tela.

6. **E6 — Traço de espessura constante na tela.** Toda linha é desenhada com
   `width = espessuraEmPx * umPorPixel`. Uma margem de 1 cm não pode virar um risco grosso ao dar
   zoom out; e a linha de costura não pode sumir no zoom in.

7. **E7 — Ferramenta é máquina de estados pura, e o erro do motor cancela o gesto.** Contrato único
   (`aoEntrar`, `aoApontar`, `aoArrastar`, `aoSoltar`, `aoTecla`, `aoSair`), sem acesso ao DOM. Se a
   operação do motor lançar `ErroMotor`, a ferramenta **não emite evento**, volta ao estado anterior
   e devolve o problema para a interface mostrar.

8. **E8 — Nada é recalculado por frame.** Tesselação, offset de margem e graduação são caros e
   determinísticos: são **cacheados por (peçaId, versão do log, tamanho exibido)** e invalidados por
   evento novo, nunca por tempo. O `requestAnimationFrame` só desenha o que já está calculado.

9. **E9 — O tamanho na tela é visualização; a edição vai para o tamanho base.** Já provado na demo
   da Fase 1: como a regra de graduação é aditiva, o ponto arrastado segue o cursor mesmo com outro
   tamanho na tela. Editar "no tamanho G" e esperar que só o G mude é o erro que destrói uma grade.

10. **E10 — Precisão exata é obrigatória, não um extra.** Toda ferramenta de arrasto aceita, no meio
    do gesto, um valor digitado (dx/dy, ângulo, distância, raio, `s`). Sem isso a ferramenta não
    está pronta. Ver Parte 3, "entrada numérica".

11. **E11 — Snap é do editor, não do motor.** O motor entrega a geometria; decidir que o cursor
    "agarrou" um vértice é regra de interface, com raio medido **em pixels** (constante na tela) e
    convertido para UM pela escala. Alt segurado desliga todo snap.

12. **E12 — `tenant_id` continua cidadão de primeira classe.** Todo evento que o editor emite carrega
    tenant, modelo, peça, autor e timestamp. O autor é o usuário logado, não "editor".

13. **E13 — IDs vêm de fora do fold (D2 continua valendo).** O editor gera ULID monotônico
    (`criarGeradorMonotonico` do motor) por sessão e o coloca no envelope. O fold continua puro; o
    replay continua reproduzindo os mesmos ids.

14. **E14 — Uma peça errada nunca sai calada.** O validador (`validarInconsistencias`,
    `validarCasamento`) roda a cada versão do documento, e os problemas aparecem na tela ligados à
    entidade que os causou — clicar no problema seleciona e enquadra a peça/aresta. Aviso é amarelo,
    erro é vermelho, e erro **bloqueia a exportação**, não o desenho.

## Quando parar e perguntar

Pergunte em vez de decidir sozinho quando: (a) o prompt conflitar com o repositório; (b) faltar
informação de domínio (como o ofício faz de verdade); (c) a biblioteca não suportar o caso; (d) você
precisar violar um item inegociável. **Perguntar não é falha — implementar errado com confiança é.**

## Entrega desta fase

- `@cad/motor` com o Bloco 0 fechado: 11 eventos e 2 operações novas, com teste numérico.
- **`@cad/editor`**: TypeScript puro. Sessão, câmera, snap, seleção, 22 ferramentas. Roda no Node.
- **`@cad/editor-pixi`**: PixiJS 8. Camadas, overlay, espessura constante, culling.
- O aplicativo, servido por Vite, falando com `@cad/api`.
- CI headless continua verde, agora com os testes do editor dentro.

## O que NÃO fazer nesta fase

- Nada de encaixe automático (Fase 5) nem 3D.
- Nada de parser/exportador de DXF (Fase 3). Abrir e salvar é pelo log.
- Nada de colaboração em tempo real.
- Nada de plotter/HPGL — isso vem com o wrap Tauri.
- **Nada de reescrever o motor.** Se uma conta geométrica falta, ela entra no motor com teste, pela
  porta da frente, e a Parte 2 diz como.
