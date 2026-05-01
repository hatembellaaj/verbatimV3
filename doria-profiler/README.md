# DORIA Profiler — Module Verbatim

MVP du **Module Verbatim** de DORIA Profiler v3.0 — pipeline complet de catégorisation et de profilage psychographique de verbatims clients à partir d'un CSV.

> Spec de référence : `PROFILER_Specs_Fonctionnelles_V1.docx.pdf` (Couches 1 + 5).

---

## Pipeline en 4 phases

| Phase | Rôle | Sortie |
|---|---|---|
| **1. Import** | Upload CSV, auto-mapping des colonnes (verbatim, note, date, profil, source, score_fidelite, id_externe), stats descriptives | Items mappés au format Doria |
| **2. Calibration** | 4 passes inductives LLM : Découverte (100) → Validation (200) → Stabilisation (200) → Résidus (50). Produit la taxonomie thématique ET la typologie psychographique. | Taxonomie + Profils figés |
| **3. Analyse** | Batches de 10 verbatims, parallélisme 4. Pour chaque verbatim : catégorie/sous-cat/tonalité/confiance + profil psy/PAD/biais cognitifs/motivations/signaux. Marquage `isUnclassified` si confiance < 0,5. | Items enrichis |
| **4. Résultats** | 4 onglets — Catégories (4 quadrants vol×insat), Évolution (timeline), Profils & Psychologie (radar PAD + biais + tension map), Items bruts (table filtrable). Chat contextuel + drill-down. Export CSV UTF-8 BOM. | Dashboard + CSV |

---

## Démarrage — Docker (recommandé)

Prérequis : Docker Desktop ou Docker Engine + Docker Compose v2.

```bash
cd doria-profiler
cp .env.example .env.local           # puis renseigner VITE_ANTHROPIC_API_KEY
docker compose --profile dev up      # http://localhost:5174 (hot-reload activé)
```

Pour build et servir la version production via nginx :

```bash
# La clé API est figée dans le bundle JS au moment du build
export VITE_ANTHROPIC_API_KEY=sk-ant-...
docker compose --profile prod up --build   # http://localhost:8080
```

Arrêt :

```bash
docker compose --profile dev down       # ou --profile prod
```

### Démarrage — Node natif (alternative)

```bash
npm install
cp .env.example .env.local
npm run dev                  # http://localhost:5174
npm run build && npm run preview
```

Sans clé API, l'app fonctionne en **mode démo** (taxonomie et résultats factices) — utile pour tester l'interface sans consommer de tokens.

---

## Paramètres clés (spec § II.1)

| Paramètre | Valeur | Source |
|---|---|---|
| Modèle | `claude-sonnet-4-6` (surchargeable via `VITE_ANTHROPIC_MODEL`) | spec II.1 |
| BATCH_SIZE | 10 | spec III.2 |
| Concurrency | 4 | choix MVP |
| Seuil de confiance | 0,5 | spec III.3 |
| Taille calibration | 100 + 200 + 200 + 50 | spec II.2 |

---

## Couche 1 — Classification thématique

- Catégories + sous-catégories **inductives** (taxonomie construite par Claude depuis l'échantillon, pas imposée a priori)
- Tonalité : `positif | négatif | neutre | mixte`
- Score de confiance ∈ [0, 1] — verbatims < 0,5 marqués `isUnclassified`

## Couche 5 — Profilage psychographique

- **Profils inductifs** (3-5 personas émergents)
- **PAD** (Mehrabian & Russell 1974) : Valence × Arousal × Dominance ∈ [-1, +1]
- **7 biais cognitifs** : confirmation · halo · récence · ancrage · dissonance · comparaison sociale · contraste
- **Motivations + signaux saillants** par verbatim

---

## Format CSV attendu

L'auto-mapping détecte ces colonnes via regex (cf. `src/lib/csv.js`) :

| Champ Doria | Pattern de détection | Obligatoire |
|---|---|---|
| `verbatim` | `verbatim\|avis\|comment\|texte\|text\|feedback\|review` | ✅ |
| `note` | `^note$\|score\|rating\|nps\|stars\|^star` | — |
| `date` | `date\|time\|publié\|published\|created` | — |
| `profil` | `profil\|segment\|type\|categor\|venu\|qui` | — |
| `source` | `^source$\|platform\|site\|plateforme` | — |
| `score_fidelite` | `fidelite\|fidélité\|loyalty\|ltv\|rfm\|recurrence` | — |
| `id_externe` | `^id$\|id_ext\|external\|uuid\|reference` | — |

Délimiteurs supportés : `,` `;` `\t` (auto-détection PapaParse). Encodage UTF-8 (BOM toléré).

Si l'auto-mapping rate, les colonnes sont éditables manuellement dans la phase Import.

---

## Persistance

État de session sauvé en `localStorage` (clé `doria-profiler:session`). Bouton **Nouveau** pour repartir de zéro.

---

## Coût indicatif

Sur 500 verbatims, mode réel (sans cache) :

| Phase | Appels | Tokens estimés |
|---|---|---|
| Calibration (4 passes) | 4 | ~30 k in / ~6 k out |
| Analyse (50 batches × 10) | 50 | ~150 k in / ~80 k out |
| **Total** | ~54 | **≈ 1,80 – 2,50 $** |

Le chat contextuel n'envoie **jamais les verbatims bruts** — uniquement les stats agrégées.

---

## Architecture

```
doria-profiler/
├── index.html
├── package.json
├── vite.config.js
├── .env.example
├── Dockerfile · Dockerfile.dev · docker-compose.yml · .dockerignore
└── src/
    ├── main.jsx
    ├── App.jsx                    # state machine 4 phases + persistence
    ├── api/
    │   └── claude.js              # wrapper Messages API + retry + MOCK
    ├── lib/
    │   ├── csv.js                 # PapaParse + auto-mapping + stats
    │   ├── prompts.js             # 5 templates (P1-P4 + analyse + chat)
    │   ├── storage.js             # localStorage helpers
    │   ├── theme.js               # palette + styles partagés
    │   └── utils.js               # parseDate, parseJSON, pLimit, downloadCSV
    └── components/
        ├── PhaseImport.jsx
        ├── PhaseCalibrate.jsx
        ├── PhaseAnalyse.jsx
        └── PhaseResults.jsx       # 4 onglets + chat + drill-down
```

---

## Hors périmètre v1 (différé)

- Module Churn / Concurrence / Innovation (autres modules PROFILER)
- Scraping (Trustpilot/Google Reviews) — input CSV uniquement
- Audio (transcription) — texte uniquement
- Multi-tenant / JWT / backend
- Module Benchmark (multi-marques)
