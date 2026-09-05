# FASE 1 · PARTE 0 — Contexto e protocolo

> **Sempre cole esta parte junto com a parte que for trabalhar.** As outras cinco assumem estas regras.
> Índice: 0 protocolo · 1 modelo de dados · 2 operações base · 3 operações de edição · 4 event sourcing · 5 testes.

## Contexto
CAD de moldes 2D para substituir o pipeline do Audaces numa confecção: **criar/editar molde → graduar → encaixar → cortar (DXF/plotter)**. Web primeiro, depois embrulhado em Tauri como app Windows offline. Stack: TypeScript, backend Fastify, Neon PostgreSQL.

Esta fase **não tem interface visual**. É só o **motor**: biblioteca TypeScript pura (`@cad/motor`), sem DOM, sem render, 100% testável headless. O editor PixiJS (Fase 2) vai **consumir** esta biblioteca sem tocar no núcleo. Se o motor não estiver correto e testado, nada em cima dele funciona.

## Protocolo obrigatório (verify-before-act)
Antes de escrever **qualquer** código:
1. Releia a parte inteira.
2. Devolva, em no máximo 5 linhas, o que você entendeu.
3. Se **qualquer coisa** conflitar com o que já existe no repositório, **PARE e pergunte** — não improvise.

Só depois da minha confirmação, implemente.

## Ordem de implementação (siga; não faça tudo de uma vez)
1. Tipos + constantes + vocabulário → 2. Ponto/Segmento/Peça e o fold de eventos → 3. Tesselar e medir → 4. Offset de margem → 5. Graduação → 6. Casamento e comparar perímetros → 7. Modificar discreto/proporcional → 8. Dobra → 9. Dividir → 10. Validações.

**Pare e mostre os testes rodando ao fim de cada bloco** — não emende os dez.

## Regra de teste (inegociável)
Todo teste é **executado** e a saída numérica **colada** na resposta. "Passou" sem o número batendo = **não feito**.

## Regra de erro
Nada de `catch` silencioso, nada de default mascarando falha (ex.: `?? 0` que esconde bug). Falhou → estoura com mensagem clara.

## Critério anti-genérico (o que eu vou rejeitar)
Esta fase não é "escrever classes de geometria". É reproduzir o comportamento de um CAD de molde real, usado em produção, onde erro custa tecido. Serão **rejeitados**:
- Função que existe mas não tem teste com **número conferido**.
- `TODO`, stub, `throw new Error('not implemented')`, ou só o caminho feliz.
- Reimplementação na mão de offset de polígono, NURBS ou simplificação, existindo biblioteca.
- Operação que altera a peça sem evento correspondente.
- Número mágico solto em vez da constante nomeada.
- `any`, `@ts-ignore`, ou tipo frouxo em geometria.
- Camada de abstração "para o futuro" que não é usada agora.

**Poucas funções corretas e testadas > muitas funções plausíveis.**

## Decisões inegociáveis (não reinterprete, não "melhore")
1. **Unidade interna = micrômetro inteiro.** `1 mm = 1000 unidades`. Todo cálculo geométrico em inteiro (exigência do clipper2). cm e mm são **só formatação** na borda. **Nunca** guarde float de milímetro no núcleo — arredondamento acumulado destrói precisão de CAD.
2. **Sem ORM.** SQL direto contra o Neon. Sem Prisma, sem TypeORM.
3. **Geometria vem de biblioteca testada, nunca de conta caseira.** `clipper2` (offset de polígono = margem de costura) e `verb-nurbs`/`verb` (curvas: tesselar e medir). **Proibido** implementar offset de polígono ou NURBS na mão.
4. **Grade points são cidadãos de primeira classe desde já.** Não são "algo pra adicionar na fase de graduação".
5. **Modelo compatível com DXF-AAMA/ASTM desde o dia zero.** Contorno, grade point, fio, pique, texto/metadados existem nomeados no modelo, pra a importação da Fase 3 mapear 1:1 sem reescrever nada.
6. **`tenant_id` (empresa) é cidadão de primeira classe** em toda entidade persistida e em todo evento. O produto é multi-empresa; retrofit de isolamento depois é dor e furo de segurança.
7. TypeScript `strict: true`, sem `any` implícito.
8. **Curva = Bézier cúbico** (nunca NURBS). Entrada por Catmull-Rom convertido para Bézier. Ver D1 na Parte 1.
9. **O fold é função pura.** Toda entropia (id, timestamp, autor) vem no payload do evento — nada de `randomUUID()` ou `Date.now()` dentro do fold. Ver D2.
10. **Geometria: contorno CCW, núcleo Y-up, delta de offset positivo = pra fora, JoinType Miter.** O editor (Y-down) inverte só no render. Ver D4.
11. **Posição de pique é `s` por comprimento de arco**, nunca o parâmetro `t` de Bézier. `t = 0.5` não é o meio da curva.

## Quando parar e perguntar
Pergunte em vez de decidir sozinho quando: (a) o prompt conflitar com o repositório; (b) faltar informação de domínio; (c) a biblioteca escolhida não suportar o caso; (d) você precisar violar um item inegociável. **Perguntar não é falha — implementar errado com confiança é.**

## Entrega desta fase
- Pacote TS puro **`@cad/motor`**: sem framework, DOM ou render. Roda no Node e no browser.
- Backend **Fastify + Neon** só para persistir/ler eventos.
- Testes rodando em CI headless.
- A Fase 2 (editor PixiJS) e o wrap Tauri importam `@cad/motor` **sem alterar o núcleo**.

## O que NÃO fazer nesta fase
- Nada de render, canvas, PixiJS, UI.
- Nada de encaixe automático (Fase 6, via deepnest).
- Nada de 3D.
- Nada de parser de DXF (só deixar o modelo pronto pra ele).
