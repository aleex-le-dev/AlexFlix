<div align="center">

# 🟥 ALEXFLIX

**Ta vidéothèque Freebox, avec l'expérience Netflix.**

![React](https://img.shields.io/badge/React-19-E50914?style=flat-square&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-E50914?style=flat-square&logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-5-141414?style=flat-square&logo=fastify&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-4-141414?style=flat-square&logo=tailwindcss&logoColor=white)
![TMDB](https://img.shields.io/badge/TMDB-API-141414?style=flat-square&logo=themoviedatabase&logoColor=white)

</div>

---

## ✦ L'expérience

- **Qui est-ce ?** : écran de profils, accès direct depuis la maison, code PIN à distance, **profil enfant** (animation et films familiaux uniquement)
- **Bannière plein écran** qui défile toute seule, rangées horizontales fluides (souris, tactile, pavé tactile)
- **Catégories = tes dossiers** : ton rangement sur le disque devient le catalogue, sagas rangées dans l'ordre, séries détectées via TMDB
- **Fiches complètes** : affiches HD (WebP), synopsis, casting cliquable, bandes-annonces sans interface YouTube, épisodes par saison
- **Recherche instantanée**, Ma liste, reprise de lecture (retirable), « Les mieux notés »
- **Lecteur** : épisode suivant avec décompte, panneau Épisodes / Saga, plein écran paysage sur mobile
- **Son partout** : les pistes Dolby (AC3 / E-AC3) sont converties en AAC stéréo pour le navigateur ; VLC reste proposé pour le Dolby 5.1
- **Mobile** : barre d'onglets en bas, aperçu complet à glisser (lecture, bande-annonce, épisodes, saga)
- **Lecture et téléchargement** servis directement par la Freebox, PC éteint
- **Synchro depuis le site** : « Vérifier les nouveautés » et « Synchroniser » dans les Paramètres (PC allumé)

## ✦ Comment ça marche

```
Disque Freebox ──API Freebox OS──▶ Scan + TMDB ──FTP──▶ Hébergeur web (site privé)
       ▲                                                          │
       └────────────── lecture / téléchargement ◀─────────────────┘
```

Le site (pochettes, fiches) est hébergé chez ton hébergeur ; les vidéos ne quittent jamais la Freebox.
Le site ne peut ni ajouter ni supprimer de fichiers sur le disque : pour ajouter un film, le déposer sur la Freebox puis lancer « Vérifier les nouveautés ».

## ✦ Démarrage

```powershell
Copy-Item .env.example .env   # renseigner TMDB, Freebox, FTP, code PIN
npm run setup
npm run dev                   # http://localhost:5173
```

## ✦ Publication

Double-cliquer sur **`deploy.bat`** : scan du disque, pochettes TMDB, liens Freebox et mise en ligne FTP.

| Commande | Effet |
|---|---|
| `deploy.bat` | Scan + liens + mise en ligne |
| `.\deploy.ps1 -SansScan` | Mise en ligne du catalogue actuel |
| `.\deploy.ps1 -SiteSeul` | Interface + catalogue, sans scan |
| `.\deploy.ps1 -SansAudio` | Tout, sauf la conversion du son |
| `npm run audio --prefix server` | Conversion AAC seule (FFmpeg requis), suivie dans Paramètres |

## ✦ Synchro depuis le site

Double-cliquer une fois sur **`installer-synchro.bat`** : l'agent (`server/src/sync-agent.ts`) démarre sans fenêtre à chaque ouverture de session Windows et exécute les demandes faites depuis la page Paramètres. Pour le retirer : supprimer « AlexFlix Sync.vbs » dans `shell:startup`.

## ✦ Stack

`React 19` · `Vite` · `Tailwind 4` · `Swiper` · `Framer Motion` · `Fastify 5` · `TypeScript` · `FFmpeg` · `API TMDB` · `API Freebox OS`

## ✦ Sécurité

Aucun identifiant dans le dépôt : tout est dans `.env` et `data/` (ignorés par Git). Site non indexé, HTTPS forcé, PIN limité en tentatives.

---

<div align="center"><sub>Projet personnel · Non affilié à Netflix · Données et images : TMDB</sub></div>
