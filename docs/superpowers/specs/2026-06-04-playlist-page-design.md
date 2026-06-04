# Spec — Page `/playlist` : lecture synchronisée d'une playlist YouTube

**Date** : 2026-06-04
**Statut** : Design validé, à implémenter

## Contexte

Crowd Beat synchronise aujourd'hui la lecture d'**un seul** titre YouTube sur plusieurs
appareils via une room globale (`room:global`). L'état est stocké dans Upstash Redis
et distribué par Server-Sent Events ; chaque appareil mesure l'offset de son horloge
(NTP-style) et corrige sa dérive de lecture en continu.

On veut une page `/playlist` qui diffuse **toutes les musiques d'une playlist YouTube
les unes après les autres**, en synchronisation sur tous les appareils.

## Décisions de design (validées)

| Décision | Choix retenu |
|----------|--------------|
| Source de la playlist | Import d'une **playlist YouTube** (URL `?list=...`) |
| Récupération des titres | **API YouTube Data v3** (clé `YOUTUBE_API_KEY`) |
| Modèle room | **Room dédiée** `room:playlist`, distincte de `room:global` |
| Enchaînement auto | **Timeline continue par durées** (déterministe, sans race) |
| Contrôles | Play/Pause, Précédent/Suivant, clic sur un titre, indicateur + progression |
| Fin de playlist | **Arrêt** (pause sur le dernier titre, position = fin) |

## Principe central : timeline continue par durées

Toute la playlist est modélisée comme **une seule ligne de temps continue** exprimée en
secondes depuis le début de la playlist. Cette position globale détermine de façon
**déterministe** quel titre jouer et à quel offset — c'est la généralisation directe de
`expectedPosition` (existant) sur plusieurs titres.

Conséquence clé : **aucune coordination « next » entre appareils**. Chaque appareil
calcule la même position à partir de son horloge synchronisée, donc l'enchaînement est
automatique et identique partout.

```
Timeline globale (s) :  0        180       350            520
                        |--track0--|--track1--|----track2----|...
position globale = 365  ───────────────────▲  (track1, offset 185s)
```

## Modèle de données

Nouvelle room d'identifiant `playlist` (clé Redis `room:playlist`, via le helper
`roomKey('playlist')` ; voir « Rooms paramétrées »).

```ts
// types/room.ts (ajouts)
type PlaylistTrack = {
  videoId: string;
  title: string;
  durationS: number; // durée en secondes (depuis l'API YouTube)
};

type PlaylistState = {
  tracks: PlaylistTrack[];   // la file complète, avec durées
  isPlaying: boolean;
  startedAt: number;         // ms serveur : début du segment de lecture courant
  positionAtStart: number;   // secondes dans la timeline globale à startedAt
  updatedAt: number;
};
```

### Calcul de position

```
positionGlobale(serverNow) =
  isPlaying ? positionAtStart + (serverNow - startedAt) / 1000
            : positionAtStart
```

`resolvePlaylistPosition(state, serverNow)` parcourt les durées cumulées :
- retourne `{ index, offsetS, ended }`
- `ended = true` si `positionGlobale >= sum(durations)` → arrêt sur le dernier titre.

### Transitions d'état

| Action | Effet |
|--------|-------|
| `loadPlaylist(tracks)` | `tracks` posés, `isPlaying=true`, `positionAtStart=0`, `startedAt=now` |
| `play` | `isPlaying=true`, `startedAt=now` (positionAtStart inchangé) |
| `pause` | `positionAtStart = positionGlobale(now)`, `isPlaying=false` |
| `seekToTrack(i)` | `positionAtStart = somme des durées des titres < i`, `startedAt=now` |
| `next` | `seekToTrack(currentIndex + 1)` (borné ; si dépasse → fin/arrêt) |
| `prev` | `seekToTrack(currentIndex - 1)` (borné à 0) |
| Fin de timeline | `isPlaying=false`, `positionAtStart = duréeTotale` |

## Rooms paramétrées

Les routes deviennent multi-room via un paramètre `?room=<id>` (défaut `global`, donc
**aucune régression** sur `/`).

- `lib/room.ts` : helpers `roomKey(id)`, `roomChannel(id)`, `listenerPrefix(id)`
  (la room globale conserve ses clés actuelles ; convention de nommage à figer dans
  l'implémentation pour rester rétrocompatible avec `room:global`).
- `/api/state`, `/api/control`, `/api/events` lisent `?room=` et opèrent sur cette room.
- `/api/time` reste global (horloge serveur, indépendante de la room).
- Hooks `use-room-sync` et `use-server-clock` acceptent un `roomId` (défaut `global`).

> Note : `room:playlist` stocke un `PlaylistState`, `room:global` un `RoomState`. Les deux
> modèles cohabitent ; les helpers de sérialisation distinguent selon la room ou le shape.

## Import de la playlist YouTube

- Route `POST /api/playlist/import` :
  - reçoit l'URL ou l'ID de playlist (`?list=` ou ID brut) ;
  - appelle **YouTube Data API v3** :
    - `playlistItems.list` (paginé via `pageToken`) → IDs vidéo + titres ;
    - `videos.list` (par lots de 50) → `contentDetails.duration` (ISO 8601) ;
  - parse ISO 8601 (`PT3M30S` → 210 s) ;
  - renvoie `PlaylistTrack[]`.
- Clé `YOUTUBE_API_KEY` lue dans l'environnement ; ajoutée à `.env.example`.
- Action de contrôle `loadPlaylist` (via `POST /api/control?room=playlist`) qui pose la
  file et démarre la timeline à 0.

## Page `/playlist` (UI)

Réutilise les composants existants :
- `Player` (YouTube IFrame) et `JoinOverlay` (déverrouillage audio mobile).

Éléments propres à la page :
- **Import** : champ pour coller l'URL de la playlist YouTube + bouton importer.
- **Contrôles** : Play/Pause, Précédent, Suivant.
- **Liste des titres** : titre courant surligné ; **clic sur un titre = saut** (`seekToTrack`).
- **Indicateur** : titre en cours (n° / total), barre de progression du titre courant, temps.

Boucle de synchronisation :
- réutilise `use-server-clock` et `use-room-sync` (room `playlist`) ;
- à chaque changement de `currentIndex` (calculé via `resolvePlaylistPosition`), charge le
  nouveau `videoId` dans le lecteur ;
- applique la correction de dérive existante (seek dur > 300 ms / ajustement de vitesse
  10–300 ms) sur l'**offset intra-titre**.

## Logique pure et tests

Nouveau `lib/playlist-logic.ts`, testé avec Vitest (même style que `sync-logic.ts` /
`control-logic.ts`) :
- `parseIso8601Duration(s) -> number` (secondes)
- `resolvePlaylistPosition(state, serverNow) -> { index, offsetS, ended }`
- `computeNextPlaylistState(current, action, now) -> PlaylistState`
  pour `loadPlaylist | play | pause | seekToTrack | next | prev`

Tests couvrant : frontières entre titres, dépassement (fin), pause/reprise, next/prev
bornés, parsing ISO 8601 (heures/minutes/secondes, formats partiels).

## Gestion d'erreurs

- URL de playlist invalide → message clair, état inchangé.
- `YOUTUBE_API_KEY` absente → erreur explicite côté serveur (500 + message).
- Playlist vide / privée → message clair, pas de chargement.
- Vidéo indisponible sur un appareil donné → la timeline continue ; l'appareil rejoint
  automatiquement au titre suivant (pas de blocage global).

## Hors périmètre (YAGNI)

- Pas de réordonnancement / suppression de titres dans la file.
- Pas d'ajout incrémental à une playlist en cours.
- Pas de mode boucle (décidé : arrêt en fin de liste).
- Pas de déclenchement `ENDED` complémentaire (la timeline par durées suffit).
- Pas de persistance des playlists entre sessions au-delà de l'état de la room.

## Fichiers touchés (estimation)

**Nouveaux**
- `app/playlist/page.tsx`
- `app/api/playlist/import/route.ts`
- `lib/playlist-logic.ts` + `lib/playlist-logic.test.ts`
- `lib/youtube-data.ts` (client API YouTube Data + parsing durée) + test

**Modifiés**
- `types/room.ts` (types `PlaylistTrack`, `PlaylistState`, action `loadPlaylist`)
- `lib/room.ts` (helpers de room paramétrés)
- `lib/control-logic.ts` ou nouveau handler playlist (selon factorisation)
- `app/api/state/route.ts`, `app/api/control/route.ts`, `app/api/events/route.ts` (param `room`)
- `hooks/use-room-sync.ts`, `hooks/use-server-clock.ts` (param `roomId`)
- `.env.example` (`YOUTUBE_API_KEY`)
