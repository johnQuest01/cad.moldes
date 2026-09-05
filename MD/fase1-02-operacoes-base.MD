# FASE 1 · PARTE 2 — Operações base do motor (1 a 8)

> Cole junto com a **Parte 0** (protocolo) e a **Parte 1** (modelo). Estas são as operações que tudo o mais consome.

1. **Offset de margem** (linha de costura → linha de corte) via clipper2, respeitando margem **por aresta**. Curvas tesseladas na tolerância antes do offset.
   - **D4 aplicada:** contorno normalizado para **CCW** antes (shoelace), **delta positivo = pra fora**, **JoinType = Miter** com limite (Round arredondaria os cantos do retângulo do teste 1).
   - **Assertion obrigatória dentro da função** (não só no teste): `área(corte) > área(costura)`. Sentido invertido estoura na hora, em vez de mandar molde pequeno pro corte.

2. **Tesselar curva** (verb) → polilinha na `TOLERANCIA_TESSELACAO_UM`, mantendo associação com o segmento original.
   - **Nunca persista a polilinha tesselada** — só a definição da curva. Tesselar sempre na leitura. Polilinha persistida vira float que varia entre plataformas e quebra o teste de integridade da Parte 4.

3. **Medir comprimento** de uma aresta/segmento (reta ou curva Bézier).
   - Construir a **tabela de comprimento de arco acumulado** aqui: é ela que sustenta `pontoEmS` e a ancoragem de pique por `s` (D1/Parte 1). Bézier não tem comprimento fechado — some o tesselado e faça busca binária para converter `s → t`.

4. **Aplicar graduação**: dado um tamanho, aplicar as regras a todos os grade points → novas coordenadas → recomputar geometria derivada.
   - **Definir e documentar:** qual é a **âncora** (o ponto/origem que fica parado ao graduar) e se o incremento é **acumulado a partir do tamanho base** ou aplicado entre tamanhos consecutivos. Ambíguo hoje; muda o resultado.

5. **Espelhar / rotacionar / transladar** peça. O **espelhamento aceita eixo arbitrário** (dois pontos ou ponto + ângulo), não só H/V — estes são casos particulares.

6. **Validar casamento de costuras**: para cada `ParCostura` do `Modelo` (D3), as duas arestas devem ter o **mesmo comprimento em todos os tamanhos**. A relação é dado declarado, não inferida da geometria.

7. **Comparar perímetros (conferência)**: dado um conjunto de arestas **soma (+)** e outro **subtração (−)**, calcular `Total(+)`, `Total(−)` e a **diferença**, **para cada tamanho da grade**. Retornar tabela `tamanho × medida`. É como o modelista prova que a costura fecha.

8. **Validar inconsistências**: contorno aberto, auto-interseção, pique órfão ou fora do contorno, fio ausente, grade point sem regra, margem inválida. Retorna lista legível — **nunca** conserta sozinho em silêncio.
