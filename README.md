# Preventivatore Stampa 3D — Multi-articolo

Applicazione vanilla HTML+CSS+JS per calcolo preventivi stampa 3D con support multi-articolo, gruppi di rischio (A/B/C), sconto serie, fermo macchina, e PDF export.

## Struttura

- **index.html** — Markup HTML, nessuno stile inline
- **styles.css** — Tutti gli stili CSS (media queries, responsive grid)
- **app.js** — Logica JS vanilla, calcoli, storage, render

## Features

### Calcolo costi articolo
Per ogni articolo:
1. Costo materiale = gramsPerPiece × eurPerGram × qty
2. Costo stampa base = printHours × machineEurPerHour × qty
3. Costo stampa = printCostBase × group.printFactor
4. Costo design = (hasDesign ? designHours × designEurPerHour : 0) × group.designFactor
5. Costi variabili = materialCost + printCost
6. Sconto serie = variableCosts × seriesDiscountPct (se qty ≥ soglia e isSeries=true)
7. Base = (variableCosts - sconto) + designCost
8. Margine = base × group.marginPct
9. Totale = base + margine
10. Prezzo unitario = totale / qty

### Gruppi A/B/C
Ogni gruppo ha:
- `printFactor` — Moltiplicatore costo stampa
- `designFactor` — Moltiplicatore costo design
- `marginPct` — Percentuale margine

Default consigliati:
- **A**: stampa×1.00, design×0.80, margine 20%
- **B**: stampa×1.10, design×1.00, margine 25% (standard)
- **C**: stampa×1.25, design×1.30, margine 35%

### Setup / Fermo macchina
- `setupMode = "ORDER"` → Setup fee applicato una sola volta sulla commessa
- `setupMode = "ITEM"` → Setup fee applicato per ogni articolo

### Parsing ore
Accetta:
- `H:MM` (es. `1:30` = 1h30)
- `H.MM` o `H,MM` come ore+minuti (es. `1.30` = 1h30, `0.40` = 40 min)
- Ore decimali (es. `0,67` ≈ 40 min)

Implementato in `parseHoursSmart()`.

### Validazioni
Warnings automatici:
- Se `hasDesign=SI` ma `designHours=0` → costo design 0€
- Se `printHours=0` → controlla il valore
- Se `qty=0` → controlla

### PDF Export
Bottone "Esporta PDF" → `window.print()` con area dedicata `#printArea` contenente:
- Meta commessa (cliente, data, setup, articoli)
- Tabella righe con prezzo unitario e totale riga
- Riepilogo totali

### Persistenza
Salva automaticamente in `localStorage` con chiave `preventivatore3d_multi_groups_pdf_v2`.

## UI / UX
- **Grid responsivo**: 420px left panel + 1fr right, collassa a 1fr su mobile
- **Layout coerente**: Tutte le altezze input 40px, padding/gap uniforme, colori CSS var
- **Focus states**: Border scura + shadow light su focus
- **Chip badge**: Mostra gruppo articolo
- **Inline feedback**: Costi e validazioni show subito senza reload

## TODO: Evoluzione batch/mandate

### Concetto
Invece di "per commessa" vs "per articolo", permettere di raggruppare articoli in "mandate" (batch).
Ogni batch ha:
- Nome
- Setup fee proprio (eventualmente diverso)
- Lista articoli che vengono stampati insieme

### Implementazione futura
1. Aggiungere `state.batches: [{ id, name, setupFee, itemIds: [] }]`
2. Ogni item avrà `batchGroup: batchId` (nullable)
3. Nel selector di articoli, aggiungere dropdown "Assegna a batch"
4. In `quoteOrder()`, calcolare setup come somma per batch
5. In render, raggruppare articoli per batch

### Punti di aggancio nel codice
- Linea 120: `itemTemplate()` — Aggiungere field "Assegna a batch"
- Linea 142: `quoteItem()` — Nessuna modifica (calcolo rimane ugualeI)
- Linea 162: `quoteOrder()` — Commento su come sommare setup per batch
- Linea 360: `DEFAULTS` — Commento su struttura batches

## Offline
L'app funziona completamente offline, aperta dal browser. Salva tutto in localStorage.

## No framework
Vanilla JS (ES6), no build tool, no framework. Funziona ovunque.
