# Laboratoire cloud native — Étape 3 : trois services indépendants

Node.js + Express, PostgreSQL et Kafka. Le projet fonctionne localement sur le Mac
avec Docker Compose. Aucun service AWS n'est nécessaire à cette étape.

## Organisation

```text
services/
  commandes/
    src/server.js          démarrage et arrêt HTTP
    src/app.js             routes et traitements Commandes
    src/database.js        connexion et initialisation PostgreSQL
    src/catalog-client.js  appels HTTP au Catalogue (délai maximum : 2 secondes)
    src/outbox-relay.js    publication des événements vers Kafka
    src/kafka.js           configuration du client Kafka
    public/               page de démonstration
    test/                 tests API et livraison des événements
    package.json, package-lock.json, Dockerfile, .dockerignore
  notifications/
    src/server.js         consommateur Kafka et API Notifications
    src/kafka.js          configuration du client Kafka
    test/
    package.json, package-lock.json, Dockerfile, .dockerignore
  catalogue/
    src/server.js         démarrage du serveur
    src/app.js            routes Catalogue
    src/products.js       trois produits prédéfinis et leurs prix en XOF
    test/
    package.json, package-lock.json, Dockerfile, .dockerignore
infrastructure/kafka/create-topics.sh
scripts/setup.sh
scripts/test-resilience.py
compose.yaml
```

Les services sont dans un **monorepo** : un projet commun, mais des dépendances et
contextes de construction séparés. Aucun service n'importe du code depuis le dossier
d'un autre. Chaque image est construite à partir de son propre dossier.
Commandes et son relais utilisent la même image, avec deux programmes de démarrage.
Kafka est une infrastructure commune ; il n'est pas installé dans chaque microservice.

## Parcours

```text
Navigateur → Commandes ── HTTP ──→ Catalogue : produit et prix
                 ↓
       PostgreSQL : commande + outbox (transaction unique)
                 ↓
       Relais outbox ──→ Kafka : orders.created ──→ Notifications
                                                       ↓
                                             PostgreSQL Notifications
```

Commandes conserve le prix et le libellé au moment de la création. Consulter une
commande existante ne nécessite donc pas d'appeler Catalogue. Le catalogue est
encore une liste fixe détenue par le nouveau service, sans base ni route de modification.

## Démarrer

Ouvrir Docker Desktop. Dans le terminal :

```sh
cd ~/Documents/cloud-native-lab
./scripts/setup.sh
docker compose up --build -d --wait
```

Le script conserve le `.env` existant ou génère le mot de passe du laboratoire.
Node.js 24 et les dépendances sont installés dans les images ; pas de `npm install`
à faire sur le Mac. Il n'y a plus de `package.json` ou de `Dockerfile` à la racine.

Ouvrir **http://localhost:3100**, créer une commande puis cliquer sur **Consulter la
commande** après quelques secondes pour voir la confirmation simulée.

Seul le port de l'interface/API Commandes est publié, sur l'adresse locale du Mac.
Catalogue (`catalog:3002`), Notifications (`notifications:3001`), Kafka (`kafka:9092`)
et les bases sont accessibles sur le réseau interne Docker.

## Les services Compose

| Nom Compose | Rôle |
|---|---|
| `orders` | API Commandes et page de démonstration |
| `catalog` | API Catalogue, appelée en HTTP par Commandes |
| `notifications` | Consommateur Kafka et consultation des confirmations |
| `outbox-relay` | Processus du domaine Commandes : publier l'outbox |
| `db` | PostgreSQL Commandes : tables `orders` et `outbox` |
| `notifications-db` | PostgreSQL Notifications : confirmations et quarantaine |
| `kafka` | Broker et contrôleur KRaft, un seul nœud pour le TP |
| `kafka-init` | Crée le topic puis termine normalement (code 0) |

Les noms `db`, `orders-data` et `notifications-data` ainsi que le nom du projet Compose
sont conservés pour réutiliser les données existantes. Ne pas exécuter `down -v` :
cette option supprime les volumes et les données.

Commandes ne dépend pas du démarrage de Catalogue dans `depends_on` : ses routes de
lecture et de santé restent utilisables même si Catalogue ne démarre pas. Les appels
HTTP gèrent cette indisponibilité à l'exécution en renvoyant une erreur 503.

## API

| Service | Route | Fonction |
|---|---|---|
| Commandes | `POST /orders` | Vérifier le produit auprès de Catalogue puis enregistrer commande et outbox |
| Commandes | `GET /orders/:id` | Lire une commande depuis PostgreSQL |
| Commandes | `GET /products` | Relayer la liste du Catalogue vers la page existante |
| Commandes | `GET /orders/:id/confirmation` | Interroger l'API Notifications |
| Catalogue | `GET /products` | Liste des produits |
| Catalogue | `GET /products/:id` | Produit et prix ; 404 si inconnu |
| Notifications | `GET /notifications/:orderId` | Confirmation ou état `pending` |
| Chacun | `GET /health` | Santé locale du service ; les services avec PostgreSQL vérifient leur base |

Le corps de création est `{"productId":"carnet","quantity":2}`. Le serveur calcule
le prix ; un prix envoyé par le client est refusé. Quantité : entier de 1 à 100.
Les erreurs de Catalogue sont distinguées des produits inconnus : indisponibilité
ou réponse invalide → 503 ; produit inconnu → 400 sur la création de commande.

## Exercice principal : synchrone contre asynchrone

1. Créer une commande et conserver son identifiant.
2. Arrêter Catalogue : `docker compose stop catalog`.
3. Tenter une nouvelle commande depuis la page déjà chargée : erreur Catalogue indisponible.
   Si la page est rechargée pendant la panne, elle ne peut plus charger les produits,
   mais le formulaire de consultation reste disponible.
4. Consulter la commande existante : elle reste accessible.
5. Redémarrer Catalogue : `docker compose start catalog`, attendre quelques secondes,
   puis recharger la page. Les nouvelles commandes fonctionnent de nouveau.

À comparer avec `docker compose stop notifications` : une nouvelle commande peut
être créée et son événement attend dans Kafka. Après `docker compose start notifications`,
le consommateur reprend et enregistre sa confirmation.

Si Kafka est arrêté (`docker compose stop kafka`), les événements attendent dans l'outbox.
Après `docker compose start kafka`, le relais reprend la publication.

## Tests

```sh
docker compose exec -T catalog npm test
docker compose exec -T notifications npm test
docker compose exec -T orders npm test
python3 scripts/test-resilience.py
```

Les tests de Commandes utilisent les vraies bases et Kafka. Ils ajoutent des commandes
fictives sans effacer les anciennes. Le script de résilience arrête temporairement
Catalogue, Notifications et Kafka, vérifie le comportement, puis les redémarre même
en cas d'échec. Il doit être lancé sans création manuelle de commandes en parallèle.

## Travailler sur un seul service

```sh
# Reconstruire uniquement Catalogue après modification de ses produits ou routes
docker compose up --build -d --no-deps catalog

# Commandes et son relais partagent une image : les mettre à jour ensemble
docker compose up --build -d --no-deps orders outbox-relay

# Observer les échanges
docker compose logs -f orders catalog outbox-relay notifications

# Arrêter / reprendre le laboratoire (données conservées)
docker compose stop
docker compose up -d --wait
```

## Fiabilité et limites

- La commande et son événement sont enregistrés dans la même transaction PostgreSQL.
- Le relais peut republier après un arrêt ; Notifications déduplique par événement
  et par commande. L'offset n'est validé qu'après l'écriture durable de la confirmation.
- Les messages invalides sont conservés dans `rejected_events` pour ne pas bloquer les
  suivants. Aucun outil de rejeu ou topic de dead letters n'est encore développé.
- Les commandes de l'étape 1 restent accessibles sans notification rétroactive.
- Kafka conserve les événements environ 7 jours ou 100 Mio par partition, avec
  nettoyage par segments. Une panne prolongée au-delà de la rétention nécessite une reprise spécifique.
- Les confirmations sont simulées : aucun envoi réel de message.
- Le laboratoire reste sans authentification, sans haute disponibilité et sans clé
  d'idempotence HTTP. Ne pas l'exposer directement sur Internet.
- Les identifiants de corrélation sont transmis, mais OpenTelemetry reste à ajouter.
- Les schémas SQL sont initialisés au démarrage ; les migrations, la purge de l'outbox,
  la CI/CD et l'orchestration Kubernetes restent des étapes suivantes.
