# FASE 1 · PARTE 5 — Testes obrigatórios

> Cole junto com a **Parte 0**. A fase **não fecha** sem todos passando, com a **saída numérica colada**.

## Testes de exemplo (número conferido)
1. Retângulo 100×200 mm, margem uniforme 10 mm → linha de corte **120×220 mm exata**, com **cantos em ângulo reto** (Miter, não arredondados). Se der 80×180, o winding está invertido; se os cantos saírem curvos, o JoinType está em Round. Ver D4.
2. Margem diferente por aresta (ex.: 10 mm nos lados, 40 mm na bainha) → dimensões de corte exatas conferidas.
3. Medir um arco de raio e ângulo conhecidos → comprimento conhecido dentro da tolerância.
4. Graduar um ponto por regra conhecida (ex.: +6 mm em x, +0 em y por tamanho) → coordenadas exatas em cada tamanho.
5. **Casamento**: cava da frente e cava da manga com comprimentos iguais no base **e** continuam iguais em P, M e G após graduar.
6. **Modo discreto**: mover um ponto em `dx` conhecido → só ele muda; vizinhos ficam nas coordenadas originais (comparação exata).
7. **Modo proporcional**: mover um ponto em `dx` com N vizinhos → o alvo desloca o valor cheio, os vizinhos deslocam frações decrescentes conforme `f(i) = (1 + cos(π·i/(N+1)))/2`, e os pontos fora do alcance **não** se movem. Conferir os números, não "parece suave".
8. **Simplificação**: reduzir pontos de uma curva conhecida com tolerância de 0,1 mm → medir o desvio máximo entre original e simplificada; tem que ficar **abaixo** da tolerância.
9. **Dobra simples**: meia peça de dimensão conhecida com eixo de dobra numa aresta → a peça desdobrada tem **exatamente** o dobro da largura, e o consumo/área usa a peça desdobrada.
10. **Dobra em eixo inclinado**: espelhar por um eixo a 30° → conferir as coordenadas resultantes contra o cálculo analítico da reflexão.
11. **Dobra múltipla**: peça dividida em 4 partes com profundidade conhecida → largura final e posição dos piques de prega batem com a conta manual; após graduar, as dobras continuam proporcionais.
12. **Dividir peça**: retângulo 100×200 mm cortado ao meio com margem nova de 10 mm nas arestas do corte → as duas partes medem **100×110 mm cada** (não 100×100), somando **mais** área que a original; piques de casamento nas posições correspondentes; após graduar, a linha de divisão acompanha a grade proporcionalmente.
13. **Integridade do event sourcing**: reconstruir N peças só a partir do log e comparar com o snapshot JSONB → batem 100%, **IDs inclusive**.
14. **Pique sob edição e graduação**: editar a curva onde o pique está ancorado → o pique acompanha; graduar → o pique mantém a posição relativa, com tipo/altura/largura/ângulo intactos.
15. **Pique por comprimento de arco (D1)**: numa curva Bézier assimétrica, `s = 0.5` cai no ponto que divide a curva em **dois comprimentos iguais** — medir os dois trechos e conferir que batem. Comparar com o resultado de usar `t = 0.5` cru: os pontos têm que ser **diferentes**. Se forem iguais, a tabela de comprimento de arco não está sendo usada.
16. **Fillet dentro da tolerância (D1)**: fillet de raio 10 mm num vértice de 90° com `κ = 4/3·tan(θ/4)` → medir o desvio radial máximo contra o arco de círculo ideal; tem que ficar na ordem de ~2,7 µm, muito abaixo de `TOLERANCIA_TESSELACAO_UM` (100 µm).
17. **Aresta com ID estável (D3)**: inserir e remover um ponto notável no meio do contorno → os `arestaId` existentes **não mudam**, e margem por aresta e `ParCostura` continuam apontando para as arestas certas.
18. **Normalização de winding (D4)**: alimentar o motor com o mesmo contorno em CW e em CCW → após `normalizarWinding`, ambos produzem geometria de corte **idêntica**.

## Testes de propriedade (fast-check) — maior alavanca desta fase
Teste de exemplo prova um caso; teste de invariante prova a classe inteira. Gerar polígonos válidos aleatórios e verificar:
- **Offset reversível:** offset `+d` seguido de offset `−d` volta à original dentro da tolerância.
- **Casamento preservado:** para qualquer regra de graduação, arestas pareadas continuam com o mesmo comprimento em todos os tamanhos.
- **Fold determinístico:** aplicar o mesmo log duas vezes produz estado byte-idêntico.
- **Simplificação limitada:** para qualquer contorno e tolerância, o desvio máximo medido nunca excede a tolerância.
- **Espelhar duas vezes = identidade** (mesmo eixo arbitrário).
- **Offset sempre cresce:** para qualquer peça válida e delta positivo, `área(corte) > área(costura)`.
- **`s` é monotônico:** para qualquer curva, `s` crescente produz pontos com distância acumulada crescente ao longo da aresta.

## Testes de entrada degenerada (o motor recusa, nunca corrompe)
Polígono auto-interseccionado, ponto duplicado, segmento de comprimento zero, curva com pontos de controle colados, contorno aberto, margem maior que a própria peça, coordenadas gigantes/minúsculas, eixo de dobra fora do contorno, dobras que se cruzam, `N` de dobras que não cabe, pique maior que a aresta, pique órfão após editar a curva, simplificação com tolerância absurda, `N` de vizinhos maior que o número de pontos.

**Critério:** o motor **recusa com erro claro** ou trata com segurança. Nunca trava, nunca corrompe, nunca gera um molde silenciosamente errado. Erro explícito é sucesso; resultado errado sem aviso é a pior falha possível.

## Como reportar ao fim de cada bloco
(1) o que foi feito; (2) saída dos testes obrigatórios; (3) saída dos testes de propriedade e degenerados; (4) o que quebrou e como corrigiu; (5) o que ficou pendente.
