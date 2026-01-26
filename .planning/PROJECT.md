# OVH Cost Manager v3 — Multi-Service Cost Visibility

## What This Is

OVH Cost Manager est un outil open-source de gestion et visualisation des coûts OVHcloud. Il récupère les données de facturation via l'API OVH, les stocke localement dans SQLite, et fournit un dashboard React interactif avec analyses par projet, par service, tendances et exports. L'objectif v3 est de passer d'une vision centrée cloud à une visibilité unifiée sur tous les services OVH (dédiés, VPS, stockage, cloud).

## Core Value

**Tous les coûts OVH visibles et analysables sur un dashboard unifié** — serveurs dédiés, VPS, stockage et cloud — avec consommation temps réel et prévisions.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. Inferred from existing codebase. -->

- ✓ Import des factures OVH via API (`/me/bill`) — existing
- ✓ Import des projets cloud (`/cloud/project`) — existing
- ✓ Classification des services par type (Compute, Storage, Network, Database, AI/ML) — existing
- ✓ Dashboard interactif avec onglets Overview, Compare, Trends — existing
- ✓ Analyse par projet cloud et par type de service — existing
- ✓ Tendances mensuelles et quotidiennes — existing
- ✓ Export CSV des factures et détails — existing
- ✓ Export Markdown des rapports — existing
- ✓ Authentification OIDC optionnelle — existing
- ✓ Import différentiel (seulement les nouvelles factures) — existing
- ✓ Support i18n FR/EN — existing
- ✓ CLI de téléchargement de factures PDF/HTML — existing
- ✓ Rate limiting API et sécurité CORS — existing
- ✓ Tests unitaires (validation, classification, CSV) — existing

### Active

<!-- Current scope. Building toward these. -->

- [ ] Consommation temps réel via `/me/consumption/usage/current`
- [ ] Prévision de fin de mois via `/me/consumption/usage/forecast`
- [ ] Historique de consommation via `/me/consumption/usage/history`
- [ ] Solde de dette et crédits via `/me/debtAccount` et `/me/credit/balance`
- [ ] Détails de paiement par facture via `/me/bill/{id}/payment`
- [ ] Inventaire des serveurs dédiés (bare metal) via `/dedicated/server`
- [ ] Inventaire des VPS via `/vps`
- [ ] Inventaire du stockage NetApp via `/storage/netapp`
- [ ] Mapping coûts → services hors cloud (bill_details.domain → inventaire)
- [ ] Consommation détaillée par projet cloud via `/cloud/project/{id}/consumption`
- [ ] Quotas et instances par projet cloud via `/cloud/project/{id}/quota`
- [ ] Nouvel onglet Inventaire dans le dashboard
- [ ] Camembert unifié : Cloud / Dédié / VPS / Stockage / Autre
- [ ] Alertes visuelles d'expiration de services
- [ ] Export CSV enrichi avec resource_type et payment_status

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Alertes de coûts OVH (nécessite permissions écriture) — reporté, posture lecture seule maintenue
- Catalogue de prix / simulateur (complexité élevée, valeur incertaine) — reporté
- Application mobile — web-first
- Multi-tenant / multi-compte OVH — un compte par instance
- Optimisation automatique des ressources — hors périmètre v3

## Context

- **Projet open-source** pour la communauté OVH, hébergé sur GitHub
- **Codebase brownfield** : monorepo Node.js avec 4 workspaces (cli, data, server, dashboard)
- **Stack existant** : Express.js, React 18, SQLite (better-sqlite3), Recharts, TailwindCSS
- **API OVH** : actuellement 5 endpoints utilisés, token `GET /me/*` + `GET /cloud/project/*`
- **4 phases de hardening** déjà réalisées (sécurité, fiabilité, performance, qualité)
- **28 issues CONCERNS.md** traitées
- Le champ `domain` dans `bill_details` contient le `serviceName` du produit OVH — clé pour le mapping coûts → services

## Constraints

- **Lecture seule** : Toutes les permissions API restent en GET — pas d'écriture sur l'infra OVH
- **Stack existant** : Node.js / Express / React / SQLite — pas de changement de stack
- **Permissions API** : Régénération du token nécessaire une seule fois (avant inventaire) pour ajouter `/dedicated/server/*`, `/vps/*`, `/storage/*`, `/ip/*`
- **Rate limiting OVH** : Réutiliser le pattern `parallelWithLimit()` pour les appels API en volume
- **Rétrocompatibilité** : Les endpoints et tables existants ne doivent pas casser

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Lecture seule uniquement (pas d'alertes OVH) | Minimise le risque de sécurité, pas de modification de l'infra | — Pending |
| Phases 1-2 sans changement de permission | Permet de livrer de la valeur immédiatement sans régénérer le token | — Pending |
| Mapping domain → resource_type | Le champ domain des bill_details contient le serviceName OVH, clé pour l'inventaire | — Pending |
| SQLite uniquement (pas de migration vers PostgreSQL) | Suffisant pour un usage mono-instance, simplicité d'installation | — Pending |

---
*Last updated: 2026-01-26 after initialization*
