# FASE 1 · PARTE 4 — Event sourcing, persistência e compat DXF

> Cole junto com a **Parte 0**. Esta parte é o que dá undo, versionamento e sync multi-máquina (Fase 10) de graça — e o que quebra em silêncio se os IDs não forem determinísticos.

## Event sourcing
Toda edição é um **evento**, nunca um UPDATE destrutivo. O estado da peça é o `fold` dos eventos.

**Regra de completude:** *toda* operação do motor que altera a peça precisa ter um evento correspondente. Operação sem evento = undo e versionamento quebrados para ela — e o bug só aparece muito depois.

**Eventos:** `CriarPonto`, `MoverPonto`, `ModificarPonto` (com modo discreto/proporcional e N), `InserirPonto`, `ExcluirPonto`, `DefinirSegmento` (reta/curva Bézier), `ConverterSegmento` (reta↔curva), `DefinirAresta`, `DefinirParCostura`, `DefinirMargem` (por aresta), `AdicionarLinhaInterna`, `AdicionarPique`, `AlterarPique`, `RemoverPique`, `FundirPiqueAoContorno`, `ArredondarVertice`, `ChanfrarVertice`, `SimplificarContorno`, `MarcarGradePoint`, `DefinirRegraGraduacao`, `DefinirEixoDobra`, `RemoverEixoDobra`, `DividirPeca`, `EspelharPeca`, `RotacionarPeca`, `TransladarPeca`, `DefinirMetadados`, `DefinirPropriedadesEncaixe`, `DefinirMaterial`.

**Cada evento guarda:** `id`, `tenantId`, `pecaId`, `tipo`, `payload` (JSONB), `timestamp`, `autor`, `versaoSchema` (migração futura sem reprocessar errado).

## Fold puro e IDs determinísticos (D2 — fechada)
O fold é `(estado, evento) → estado`, **função pura**: sem `randomUUID()`, sem `Date.now()`, sem I/O. Toda entropia — `id`, `timestamp`, `autor` — é gerada por **quem emite** o evento e viaja no **payload**. `randomUUID()` dentro do fold faria o replay produzir IDs diferentes do snapshot, e o teste de integridade falharia por construção.
- IDs em **UUIDv7 ou ULID** (ordenáveis por tempo) — ajuda a ordenação de eventos no sync da Fase 10 de graça.

## Persistência
- Log de eventos em tabela no Neon; snapshot do estado atual em coluna **JSONB** para leitura rápida.
- Isso dá versionamento e undo de graça, e permite recalcular qualquer coisa retroativamente.
- **`tenant_id` em toda linha** (log e snapshot), com RLS por tenant.
- **Teste de integridade:** reconstruir a peça só pelo log e comparar com o snapshot — devem bater 100%.

## ⚠ Armazenamento offline (decisão a tomar antes desta parte)
O app tem que rodar offline no chão de fábrica, mas esta parte só especifica Neon (nuvem). Onde os eventos ficam sem rede? **Tauri → SQLite local** (recomendado: acesso a filesystem e plotter) ou **PWA → OPFS/IndexedDB** (limitado: HPGL via Web Serial é só Chromium e capenga). Escolher agora — muda o que se escreve aqui.

## Compatibilidade DXF-AAMA (só o modelo agora; parser é Fase 3)
O modelo precisa carregar os conceitos que o padrão apparel exporta, pra importação futura ser 1:1: contorno como polilinha fechada, **grade points** em conceito próprio, **fio** em conceito próprio, **piques/notches** com tipo (camadas ASTM 4/80/81/82/83), e texto/metadados de peça. **Não implemente o parser agora** — só garanta que o modelo tem esses conceitos nomeados.
