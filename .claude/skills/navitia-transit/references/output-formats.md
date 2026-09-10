# Output formats — mandatory boards

Referenced from `SKILL.md` §7. Every rule here is binding.

Render every result as the board below. Do not invent your own layout, do not dump JSON, do not answer a board-shaped question in prose.

## 7.1 Shared conventions

**Mode icons** — from the `mode` field: `Metro` 🚇 · `Train`/`RER`/`Transilien`/`TER` 🚆 · `Tram` 🚊 · `Bus`/`Autocar` 🚌 · `walking` 🚶 · `bike`/`bss` 🚲 · `car` 🚗 · `boat`/`ferry` ⛴️ · `transfer` ⇄ · `waiting` ⏳ · anything else 🚉.

**Section kinds** — a journey section is named by its `mode` alone. A section with a `line` is a transit leg; `mode: walking`/`bike`/`bss`/`car` without a `line` is a fallback leg; `mode: transfer` and `mode: waiting` are the gaps between legs.

**Line badges** — `{icon} **{label}**`, where `label` is:
- `"{network} {line}"` when `network` is itself a mode word — `RER`, `Transilien`, `Métro`, `Bus`, `Tramway`, `Noctilien`. `line: "D"`, `network: "RER"` → **RER D**.
- `"{line}"` alone when `network` is an operator — `RATP`, `SNCF`, `IDFM`, `Keolis`. `line: "14"`, `network: "RATP"` → **14**, never "RATP 14".

**Names** — strip the **final** parenthesised group from every stop, direction and place name: `Robinson (Sceaux)` → `Robinson`. Strip only the last one: `Aéroport CDG 2 (Terminal 2) (Le Mesnil-Amelot)` → `Aéroport CDG 2 (Terminal 2)`.

**Times** — `HH:MM`, seconds dropped. If a time falls on a later date than `now`, suffix `+1`: `00:24+1`.

**Durations** — respace the field: `13min` → `13 min`, `3h03` → `3 h 03`.

**Countdowns** — from `time` − `now`: `≤ 0` → `à quai`; `< 60 min` → `N min`; otherwise `H h MM`. **Bold** it when ≤ 10 minutes.

**Pipes** in a name must be escaped `\|` inside a table cell.

## 7.2 `next_departures` / `next_arrivals`

```
🚉 **Châtelet - les Halles** · prochains départs
*temps réel · 31/08 à 11:59*

| Dans | Ligne | Direction | Heure |
|---|---|---|---|
| **1 min** | 🚆 **RER B** | Robinson | 11:59 |
| **3 min** | 🚆 **RER A** | Marne-la-Vallée - Chessy | 12:02 · ⚠️ +3 min |
| 14 min | 🚇 **14** | Saint-Denis Pleyel | 12:13 |
```

- Title: the stop name shared by most rows. Subtitle: `temps réel` if any row has `realtime: true`, else `horaires théoriques`, then `DD/MM à HH:MM` from `now`.
- `Heure`: append ` · ⚠️ +N min` when `scheduled` is present and `time` is later; ` · ⏱️ N min d'avance` when earlier.
- Append ` · 🕐 théorique` to a row **only** when the board mixes freshness — some rows realtime, some not. A wholly theoretical board says it once in the subtitle instead.
- Add a fifth `Arrêt` column **only** when rows have different `stop` values (a station with several platforms).
- `arrivals`: same board, titled `prochaines arrivées`.

## 7.3 `plan_journey`

Lead with the comparison table whenever there is more than one itinerary, then detail each.

~~~
**2 itinéraires · Châtelet - les Halles → 14 Place Carpeaux** · départ 11:59

| Durée | Trajet | Horaires | |
|---|---|---|---|
| **13 min** | 🚆 **RER A** › 🚶 4 min | 12:00 → 12:13 | ⭐ recommandé |
| **22 min** | 🚶 3 min › 🚇 **1** › 🚆 **RER A** | 11:58 → 12:20 | 🚶 moins de marche |

### ⭐ recommandé · 13 min · 12:00 → 12:13

🚆 **RER A** › 🚶 4 min

*direct · 🚶 4 min de marche · 🌱 110 g CO₂*

```
12:00  🚆 RER A  dir. Cergy le Haut
       Châtelet - les Halles → La Défense · 3 arrêts · 9 min
12:09  🚶 Marche 4 min → 14 Place Carpeaux
12:13  🏁 Arrivée
```
~~~

- **Order**: print the itineraries in the order the response lists them — it is the ranking the server intends. Never re-sort. When the response carries `ordered_by: "reliability"`, the list was re-ranked because line preferences were requested: add `*classé par fiabilité — préférence de ligne appliquée.*` under the table and leave the order alone. The tags still come from `type`, so ⭐ recommandé may not land on the first row.
- **Header route**: `from` of the first section → `to` of the last, both cleaned.
- **Chain** (`🚆 **RER A** › 🚶 4 min`): walk through `sections` in order. A section with a `line` → its badge. A fallback leg (`mode: walking`/`bike`/`bss`/`car`, no `line`) → `{icon} {duration}`. Skip `mode: transfer` and `mode: waiting` entirely — the `›` implies the change. Skip any leg whose duration is in seconds (Navitia emits a `0s` hop between a station and its own platforms). Join with ` › `.
- **Tag**, from `type`: `best` → ⭐ recommandé · `rapid`/`fastest` → ⚡ le + rapide · `comfort` → 😌 le + confortable · `less_fallback_walk` → 🚶 moins de marche · `less_fallback_bike`/`less_fallback_bss` → 🚲 moins de vélo · `non_pt_walk` → 🚶 tout à pied · `non_pt_bike` → 🚲 tout à vélo · `non_pt_bss` → 🚲 vélo en libre-service. Unmapped type with `transfers: 0` → ↔️ sans correspondance. Otherwise no tag.
- **Metrics line**: `direct` when `transfers` is 0 and the journey uses public transport; `N correspondances` when 1 or more; omit entirely on a walk-only journey. Then `🚶 {walking} de marche` and `🌱 {co2_g} g CO₂` when present.
- **Timeline**, inside a fenced block so the time gutter aligns. One entry per section, at its `departure`:
  - a section with a `line` → `HH:MM  {icon} {label}  dir. {direction}`, then an indented `       {from} → {to} · {stops} arrêts · {duration}`.
  - `mode: transfer` → `HH:MM  ⇄  Correspondance {duration}`
  - `mode: waiting` → `HH:MM  ⏳ Attente {duration}`
  - `mode: walking` without a `line` → `HH:MM  🚶 Marche {duration} → {to}`; skip sub-minute legs.
  - Close with `HH:MM  🏁 Arrivée` at the journey's `arrival`.
- **`criteria_ranker`** is ranking metadata, not a transit fact: it drives the order, it is never printed.
- **Disruptions**, after all itineraries, one blockquote each:
  `> ⚠️ **{severity}** — {cause} : {messages joined}`

## 7.4 `stop_schedules` / `terminus_schedules`

```
🚉 **Châtelet - les Halles** · horaires · *à partir de 11:59*

🚆 **RER A** → Saint-Germain-en-Laye
`12:00` `12:04` `12:08` `12:12` `12:16` `12:20`

🚆 **RER D** → Melun
*terminus*
```

One block per entry in `schedules`, times as inline code chips, at most 12 then ` …`. When `times` is empty, italicise `note` instead.

## 7.5 `route_schedules`

```
🚆 **RER B** → Aéroport Charles de Gaulle 2

| Arrêt | EJRE | PEBU | KLEB |
|---|---|---|---|
| Châtelet - les Halles | 11:56 | 12:04 | 12:20 |
| Gare du Nord | 12:00 | — | 12:24 |
```

Column headers come from `trips`; use `·` where a trip has no headsign. A `null` in a stop's `times` means that trip skips the stop — print `—` and **keep the column position**. Show at most 8 columns; if you drop any, add `*8 premiers départs affichés sur N.*` underneath.

## 7.6 `search_places` / `places_nearby`

```
📍 **« châtelet »** — 3 résultats

1. **Châtelet - les Halles** · 🚉 arrêt · Paris  ·  `stop_area:FRIDF:IDFM:474151`
2. **Gare de Lyon** · 🚉 arrêt · Paris · *à 180 m*  ·  `stop_area:FRIDF:IDFM:463302`
3. **14 Place Carpeaux** · 🏠 adresse · Puteaux  ·  `2.237;48.892`
```

Type icons and labels: `stop_area` 🚉 arrêt · `stop_point` 🚏 quai · `address` 🏠 adresse · `poi` 📌 lieu · `administrative_region` 🏙️ ville. Include `distance` only when present. Always print the id in backticks — the user needs it, and so do you for the next call. Fall back to `coord` when there is no id.

## 7.7 `search_pt_objects`

```
🔎 **« metro 14 »** — 2 résultats

1. 🚇 **Metro 14** · ligne · RATP  ·  `line:FRIDF:IDFM:C01384`
2. 🚆 **RER A** · ligne · RER  ·  `line:FRIDF:IDFM:C01742`
```

Type labels: `network` réseau · `commercial_mode` mode · `line` ligne · `route` itinéraire · `stop_area` arrêt · `stop_point` quai. Strip an **operator** prefix from the name (`RATP Metro 14` → `Metro 14`) but keep a **mode** prefix (`RER A` stays `RER A`).

## 7.8 Nothing to show

An empty result gets one line, not a board: `🚉 Aucun départ à venir.` · `⚠️ Aucun itinéraire trouvé.` · `📍 Aucun résultat pour « … ».`

