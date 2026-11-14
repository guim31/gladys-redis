# Redis

Vos clés Redis (ou Valkey) en capteurs Gladys, et l'écriture depuis vos scènes :
une passerelle simple entre Gladys et les scripts maison qui gardent déjà des
compteurs, des états ou des files dans Redis.

Testée contre de vrais Redis 7.4 et Valkey 8.1 (Docker), avec et sans mot de
passe, avec un utilisateur ACL et avec les notifications keyspace. Retours et
signalements de bugs bienvenus sur
[GitHub](https://github.com/guim31/gladys-redis/issues).

## Ce que vous obtenez

- **Un appareil par clé ajoutée** : une chaîne ou un champ de hash donne sa
  valeur (un nombre ou un texte), une liste, un ensemble, un ensemble trié ou un
  flux donne sa longueur.
- **Un appareil pour le serveur** : joignable, version, mémoire utilisée, clients
  connectés, clés de la base.
- **Des mises à jour immédiates** avec les notifications keyspace, si votre
  serveur les envoie ; sinon les clés sont lues à l'intervalle choisi.
- **Des actions de scène** pour écrire une valeur, incrémenter un nombre et
  publier un message, désactivées par défaut.
- Un **déclencheur de scène** quand une clé change (écrite, supprimée,
  expirée…).
- Un **widget de tableau de bord** avec la valeur de chaque clé.

## Prérequis

- Redis 6 ou plus récent, ou Valkey, joignable depuis Gladys par le réseau (pas
  `localhost` : l'intégration tourne dans son propre conteneur).
- Un utilisateur ACL demande Redis 6 ou plus récent ; avec un simple
  `requirepass`, laissez l'utilisateur vide.

## Configuration

- **Adresse** : nom ou adresse IP du serveur. `redis://hôte:port` et
  `rediss://hôte:port` (TLS) sont acceptés aussi, sans identifiants.
- **Port**, **Numéro de base** (0, sauf si vos scripts utilisent `SELECT`).
- **Utilisateur (ACL, facultatif)** et **Mot de passe (facultatif)**.
- **Connexion TLS**, et **Accepter les certificats auto-signés** pour un
  certificat maison.
- **Intervalle de rafraîchissement** : de 10 secondes à 10 minutes ; chaque clé
  coûte deux commandes par lecture (`TYPE`, puis la lecture elle-même).
- **Autoriser l'écriture depuis les scènes** : désactivé par défaut ; voir
  Scènes.
- **Canaux autorisés à la publication** : les canaux que « Publier un message
  Redis » peut utiliser, séparés par des virgules.
- **Langue des noms et des messages** : les noms des fonctionnalités du serveur
  et les messages des actions.

Utilisez ensuite **Tester la connexion** : elle lit le serveur et chaque clé, et
dit ce qui ne va pas.

Un utilisateur ACL n'a besoin que de lire les clés ajoutées. Par exemple, en
lecture seule :
`ACL SETUSER gladys on >motdepasse ~sensors:* +@read +info +dbsize +ping +hello +select +type`,
plus `+@write +publish &*` pour écrire et publier depuis les scènes, et
`+subscribe &__keyspace@0__:*` pour les notifications.

### Notifications keyspace

Cochez **Suivre les notifications keyspace** pour relire une clé dès qu'elle
change. L'intégration s'abonne au canal exact de chaque clé ajoutée (jamais à un
motif) mais **ne modifie jamais la configuration du serveur** : c'est à lui de
les envoyer. Par exemple, dans `redis.conf` : `notify-keyspace-events KA`, ou à
chaud : `CONFIG SET notify-keyspace-events KA`. **Tester la connexion** dit si
le serveur les envoie. La lecture périodique reste en filet de sécurité.

## Ajouter des clés

Gladys n'a pas de champ liste dans un formulaire de configuration : les clés
s'ajoutent avec l'action **Ajouter une clé** de la page de configuration, et
l'intégration les garde.

- **Clé** : le nom exact, ex. `sensors:garage:temperature`. Pas de motif :
  l'intégration ne parcourt jamais la base.
- **Champ du hash (hash seulement)** : pour un hash, le champ à lire, ex.
  `power`.
- **Type dans Gladys** : Automatique (nombre ou texte), Nombre, Température
  (°C), Humidité (%), Pourcentage (%), Puissance (W), Énergie (kWh), Texte.
  Automatique choisit d'après la valeur actuelle : un nombre, ou du texte. Une
  liste, un ensemble, un ensemble trié ou un flux se lit comme sa longueur.
- **Nom (facultatif)** : le nom de l'appareil ; la clé par défaut.

La même clé ajoutée de nouveau change son nom ou son type (un nouveau type est
une nouvelle fonctionnalité : utilisez « Mettre à jour » dans l'onglet
Découverte). **Supprimer une clé** arrête de suivre une clé ; son appareil reste
dans Gladys jusqu'à ce que vous le supprimiez. Jusqu'à 50 clés.

## Appareils

Ajoutez les appareils à suivre depuis l'onglet **Découverte** de l'intégration :
le serveur, et un appareil par clé. Les valeurs sont envoyées quand elles
changent, et de nouveau toutes les 6 heures sinon. Tant que le serveur ne répond
pas, les appareils clés apparaissent injoignables et la fonctionnalité
« Joignable » du serveur passe à 0.

## Scènes

### Déclencheurs

**Une clé Redis change** : une notification keyspace est arrivée pour une clé
suivie. Filtres : la clé (vide : toutes) et l'événement Redis (`set`, `del`,
`expired`, `incrbyfloat`, `hset`…, vide : tous). Variables : la clé, son nom,
l'événement et la nouvelle valeur (vide s'il n'y en a pas). Demande les
notifications keyspace (voir plus haut). Pour agir sur une valeur (au-dessus
d'un seuil…), utilisez plutôt l'appareil clé dans un déclencheur « État d'un
appareil ».

### Actions

L'écriture est refusée tant que **Autoriser l'écriture depuis les scènes** n'est
pas coché, et ne touche que les clés suivies : la scène choisit un appareil clé.
Une liste, un ensemble ou un flux n'est jamais écrasé.

- **Écrire une valeur Redis** : `SET` (ou `HSET` pour un champ de hash), avec une
  expiration facultative en secondes (sur un hash, l'expiration porte sur toute
  la clé). La valeur accepte les variables de scène.
- **Incrémenter une valeur Redis** : `INCRBYFLOAT` (ou `HINCRBYFLOAT`), de 1 si
  vide, négatif pour décrémenter, la virgule est acceptée. Donne la nouvelle
  valeur.
- **Publier un message Redis** : `PUBLISH` sur un canal listé dans **Canaux
  autorisés à la publication**. Donne le nombre d'abonnés atteints.

## Tableau de bord

Le widget **Valeurs Redis** liste la valeur de chaque clé suivie (ou de celles
choisies dans ses réglages), une ligne pour le serveur, et un bouton
**Actualiser**. Les réglages permettent de masquer la ligne du serveur et le
bouton.

## Limites

- Chaînes, champs de hash, listes, ensembles, ensembles triés et flux ; les
  autres types (modules comme RedisJSON) ne sont pas lus.
- Ni Redis Cluster ni Sentinel : un seul serveur.
- Un texte est coupé à 255 caractères.

## Dépannage

- **« ne répond pas »** : vérifiez l'adresse et le port, et que Redis écoute sur
  le réseau (`bind`, `protected-mode`), pas seulement sur `127.0.0.1`.
- **« accès refusé »** : vérifiez l'utilisateur et le mot de passe ; laissez
  l'utilisateur vide avec un simple `requirepass`.
- **« refusée par les ACL de l'utilisateur »** : l'utilisateur ACL ne peut pas
  lire cette clé ou lancer cette commande (voir Configuration).
- **Pas de mise à jour immédiate** : le serveur n'envoie pas les notifications
  keyspace ; **Tester la connexion** le dit.
- Plus de détails avec `LOG_LEVEL=debug` dans les logs de l'intégration.
  Signalez un problème sur
  [GitHub](https://github.com/guim31/gladys-redis/issues).

Redis est une marque de Redis Ltd. Cette intégration n'est affiliée ni à Redis
Ltd ni au projet Valkey.
