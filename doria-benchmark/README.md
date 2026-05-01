# DORIA · Benchmark — prototype de test

Prototype React/Vite autonome du module **Benchmark** de la plateforme DORIA (comparaison de 2 à 6 marques à partir des exports JSON de DORIA Verbatim). Le mode démo est activé par défaut avec un jeu de données mockées (Disneyland Paris, Parc Astérix, Futuroscope), aucune clé API requise.

## Lancer l'application

```bash
cd doria-benchmark
npm install
npm run dev
```

L'app s'ouvre sur http://localhost:5173.

## Ce qui est inclus

- Phase d'import (2 à 6 marques, JSON ou mode démo)
- 6 onglets de restitution : Vue d'ensemble, Catégories, Évolution temporelle, Profils (référentiel corpus + psychographique IA), Innovations, Analyse IA
- Chat contextuel sur le benchmark

## Mode IA

Par défaut (sans clé API) : les onglets "Analyse IA" et le chat utilisent des réponses **simulées localement** — pas d'appel réseau, donc pas d'erreur, idéal pour tester l'interface.

Pour brancher Claude réel :

```bash
cp .env.example .env.local
# éditer .env.local et mettre VITE_ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```

> Note : l'appel direct depuis le navigateur utilise le header `anthropic-dangerous-direct-browser-access`. À n'utiliser qu'en développement local — en production, passer par un proxy backend.

## Tester les fonctionnalités

1. **Mode démo** : déjà activé, cliquer "Lancer le benchmark →"
2. **Import manuel** : désactiver le mode démo, saisir au moins 2 marques. Format JSON attendu :

```json
{
  "verbatims": 1234,
  "avgNote": 3.9,
  "posRate": 65,
  "mentions": 3200,
  "categories": [{"name":"...","mentions":0,"pct":0,"note":0,"pos":0,"neg":0}],
  "socioProfiles": [{"name":"...","pct":0}],
  "psychoProfiles": [{"name":"...","pct":0}],
  "innovations": [{"theme":"...","suggestion":"..."}],
  "timeline": [{"period":"...","note":0,"sentPct":0}],
  "strengths": ["..."],
  "weaknesses": ["..."]
}
```

3. **Parcourir les onglets** : chaque onglet teste une dimension différente (comparaison directe vs structurelle pour les profils, convergence d'innovations, etc.)
4. **Générer l'analyse IA** : onglet "Analyse IA" → bouton "Générer l'analyse"
5. **Chat** : tester des questions comme "Quelle marque capitalise le mieux sur les familles ?" ou "Qui est le leader ?"

## Structure

```
doria-benchmark/
├── index.html
├── package.json
├── vite.config.js
├── .env.example
└── src/
    ├── main.jsx
    └── App.jsx        ← tout le module benchmark
```

## Écarts avec le code source

Par rapport à `doria_benchmark.jsx` d'origine :
- `callClaude` ajoute les headers Anthropic obligatoires (`x-api-key`, `anthropic-version`) et un fallback mock si pas de clé
- Mode démo activé par défaut au chargement
- Chart "Note moyenne globale" corrigé (duplicate `<Bar>` retiré, `<Cell>` utilisé pour couleurs par marque)
- Bannière explicite quand MOCK_AI est actif
