# Build and Release Automation

Le workflow `.github/workflows/build-release.yaml` automatise la préparation d'une version du TP. Il utilise un runner Linux temporaire fourni par GitHub Actions.

```text
Pull request → construction Docker → tests API/Kafka → tests de panne
Push sur main → mêmes vérifications → images testées → registre GHCR
```

## Ce qui est vérifié

Le laboratoire démarre avec PostgreSQL, Kafka, les trois services et le relais outbox. Les tests vérifient les API, la livraison des événements et le traitement des doublons. Les tests de résilience arrêtent successivement le catalogue, les notifications et Kafka pour vérifier la reprise. Le laboratoire temporaire et ses volumes sont supprimés à la fin du job ; ceux du Mac ne sont pas concernés.

## Ce qui est publié

Après un push sur `main` réussi, les images Commandes, Catalogue et Notifications sont transférées au job de publication puis envoyées dans GitHub Container Registry (GHCR). Le relais utilise la même image que Commandes, avec une commande de démarrage différente.

Exemple de nom : `ghcr.io/compte/depot/orders:sha-<commit>`.

Le tag correspond au commit Git. Le job publie les images déjà testées sans les reconstruire. Il ne publie pas de tag `latest`. Les images sont construites pour Linux AMD64, adapté à un futur serveur x86 ; une cible ARM nécessitera d'adapter le pipeline.

Une pull request exécute les tests mais ne publie rien. Le bouton « Run workflow » permet aussi un lancement manuel ; la publication n'a lieu que sur `main`.

## Première utilisation

1. Créer ou choisir un dépôt GitHub et y envoyer le projet avec une branche `main`.
2. Ouvrir l'onglet **Actions**, puis **Build and Release**.
3. Observer les étapes et les résultats des tests.
4. Après une réussite sur `main`, consulter les packages GHCR et les noms d'images dans le résumé du job de publication.

Le fichier `.env` local est ignoré par Git et ne doit pas être envoyé. Le runner génère sa propre configuration temporaire. L'accès à GHCR utilise le `GITHUB_TOKEN` éphémère fourni par GitHub, avec le droit d'écrire des packages limité au job de publication. Une politique du compte ou de l'organisation peut nécessiter d'autoriser Actions ou la publication de packages.

Les images publiées incluent le code source. Vérifier la visibilité du dépôt et des packages selon le partage souhaité.

## Limite de cette étape

Il s'agit de l'intégration continue et de la publication d'une version déployable. Aucun serveur AWS n'est créé et aucun déploiement distant n'est encore automatisé. Les trois images sont publiées successivement : si une publication échoue, ne pas considérer la version comme complète avant la réussite du job entier.
