# Tutoriel : importer des alertes dans une API d'annotation

Ce tutoriel explique comment récupérer les séquences d'une API d'alerte
Pyronear, garder seulement celles que le modèle temporel juge intéressantes, et
les importer dans une API d'annotation pyro-annotator (par exemple une instance
locale) pour les annoter.

## Ce que fait le script

Pour chaque jour de la période demandée, un jour après l'autre :

1. il récupère les séquences du jour sur l'API d'alerte ;
2. pour chaque séquence, il télécharge les **20 premières images** ;
3. il fait tourner le **modèle temporel** (`pyronear/temporal-model`) sur ces
   images et obtient un score entre 0 et 1 ;
4. il garde seulement les séquences avec un score **supérieur à 0.1** ;
5. il importe ces séquences dans l'API d'annotation et les prépare pour
   l'annotation ;
6. il passe au jour suivant.

Rien n'est téléchargé à l'avance : si on arrête le script au milieu, les jours
déjà terminés restent importés. Si un jour échoue, le script le signale et
continue avec le jour suivant.

## 1. Prérequis

- **Git**
- **Docker** (Docker Desktop sur Mac/Windows, Docker Engine sur Linux), lancé
- **uv**, le gestionnaire Python :
  ```bash
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```
- Environ **10 Go d'espace disque** (PyTorch et le modèle sont lourds)
- Un accès Internet (images Docker, modèle sur HuggingFace, API d'alerte)
- Des identifiants pour l'API d'alerte : **un compte utilisateur et un compte
  admin** (le compte admin sert à lister les organisations ; si votre compte
  est admin, mettez le même dans les deux)

Un GPU n'est pas nécessaire : le modèle tourne sur CPU (plus lentement).

## 2. Récupérer le code

```bash
git clone https://github.com/pyronear/pyro-annotator.git
cd pyro-annotator
```

## 3. Lancer l'API d'annotation locale

Si vous importez dans une API d'annotation déjà en ligne, passez cette étape.

Depuis la racine du repo :

```bash
docker compose up -d --build
```

Le premier lancement prend quelques minutes (construction des images). Ensuite :

- API : http://localhost:5050/status doit répondre `{"status":"ok"}`
- Interface d'annotation : http://localhost:3000
  (identifiant `admin`, mot de passe `admin12345`)

## 4. Configurer les identifiants

Créez le fichier `annotation_api/.env` (il n'est jamais commité) :

```bash
# Identifiants de l'API d'alerte
ALERT_API_LOGIN=votre_compte
ALERT_API_PASSWORD=votre_mot_de_passe
ALERT_API_ADMIN_LOGIN=votre_compte_admin
ALERT_API_ADMIN_PASSWORD=votre_mot_de_passe_admin

# API d'annotation locale (valeurs par défaut de docker compose)
LOCAL_ANNOTATION_LOGIN=admin
LOCAL_ANNOTATION_PASSWORD=admin12345

# API d'annotation distante (seulement si REMOTE_API n'est pas localhost)
# MAIN_ANNOTATION_LOGIN=...
# MAIN_ANNOTATION_PASSWORD=...

# Valeurs factices : le script en a besoin au démarrage mais ne s'en sert pas
POSTGRES_URL=postgresql://unused@localhost/unused
S3_ACCESS_KEY=unused
S3_SECRET_KEY=unused
S3_REGION=unused
S3_ENDPOINT_URL=http://localhost:1
```

Les anciens noms `PLATFORM_LOGIN`, `PLATFORM_ADMIN_LOGIN`, etc. marchent
encore mais sont dépréciés : utilisez les noms `ALERT_API_*`.

## 5. Installer les dépendances Python

```bash
cd annotation_api
uv sync --group temporal
```

Le premier `sync` télécharge PyTorch et prend plusieurs minutes.

## 6. Tester sur un jour, sans rien écrire

Le mode `--dry-run` récupère et score les séquences, mais n'importe rien.
C'est le bon moyen de vérifier que les identifiants et le modèle fonctionnent.
Remplacez l'URL par celle de votre API d'alerte :

```bash
uv run --group temporal python -m scripts.data_transfer.ingestion.alert_api.import \
  --date-from 2026-10-10 --date-end 2026-10-10 \
  --alert-api-url https://votre-api-alerte.exemple.org \
  --source-api api_cenia \
  --annotation-api-url http://localhost:5050 \
  --min-temporal-score 0.1 --dry-run
```

Au premier lancement, le modèle est téléchargé depuis HuggingFace. Vous devez
voir `✅ Target annotation auth OK`, puis une ligne comme :

```
🧠 Temporal filter (> 0.1): kept 2/3 sequence(s) (0 failed to score)
```

## 7. Lancer l'import sur une période

Toujours depuis `annotation_api/` :

```bash
make import-alert-api DATE_FROM=2026-10-05 DATE_END=2026-10-11 \
  ALERT_API_URL=https://votre-api-alerte.exemple.org SOURCE_API=api_cenia \
  REMOTE_API=http://localhost:5050
```

Le script affiche un bloc par jour (`📅 2026-10-05`, `📅 2026-10-06`, ...) avec :

- le nombre de séquences trouvées ;
- le nombre gardé par le modèle temporel (`kept X/Y`) ;
- le nombre de séquences importées et d'annotations créées.

À la fin, s'il y a eu des problèmes, il liste les jours en échec :

```
❌ 1 day(s) failed: 2026-10-08
```

Il suffit alors de relancer ce jour seul (`DATE_FROM=2026-10-08 DATE_END=2026-10-08`).
Relancer un jour déjà importé ne crée pas de doublons : les séquences déjà
présentes sont ignorées.

## 8. Annoter

Ouvrez l'interface d'annotation (http://localhost:3000 pour une instance
locale) et connectez-vous. Les séquences importées sont dans la file
d'annotation.

## Paramètres disponibles

Tous se passent à `make import-alert-api` sous la forme `NOM=valeur` :

| Paramètre | Rôle | Défaut |
|---|---|---|
| `DATE_FROM` | Premier jour (obligatoire) | – |
| `DATE_END` | Dernier jour (inclus) | `DATE_FROM` |
| `ALERT_API_URL` | API d'alerte source | `https://alertapi.pyronear.org` |
| `SOURCE_API` | Origine enregistrée sur les données : `pyronear_french`, `api_cenia` ou `alert_wildfire`. Déduite automatiquement pour `alertapi.pyronear.org` et `apicenia.pyronear.org`, obligatoire pour toute autre URL | déduit de l'URL |
| `REMOTE_API` | API d'annotation cible | `https://annotationapi.pyronear.org` |
| `IMAGE_TRANSFER` | Comment les images arrivent dans l'API d'annotation : `url` (l'API d'annotation télécharge les images) ou `bucket-copy` (copie directe entre buckets S3, seulement entre les serveurs de Pyronear France) | `bucket-copy` pour `alertapi.pyronear.org`, `url` sinon |
| `MIN_TEMPORAL_SCORE` | Seuil du modèle temporel. Vide = pas de filtre | `0.1` |
| `TEMPORAL_MODEL_VERSION` | Version du modèle sur HuggingFace | `v0.4.0` |
| `FRAMES_LIMIT` | Nombre d'images par séquence (les premières) | `20` |
| `MAX_SEQUENCES` | Nombre max de séquences par jour (0 = pas de limite) | `0` |

**Attention** : `REMOTE_API` pointe par défaut vers l'API d'annotation de
Pyronear France. Pour une instance locale, passez toujours
`REMOTE_API=http://localhost:5050`.

**Importer depuis l'API d'alerte de Pyronear France vers une instance
locale** : ajoutez `IMAGE_TRANSFER=url`, sinon l'API locale essaie de copier les
images depuis les buckets S3 de Pyronear, auxquels elle n'a pas accès.

## Dépannage

| Message | Cause | Solution |
|---|---|---|
| `KeyError: 'POSTGRES_URL'` | Le fichier `.env` manque ou n'est pas dans `annotation_api/` | Créer `annotation_api/.env` (étape 4) et lancer depuis `annotation_api/` |
| `Target annotation auth failed` | L'API d'annotation n'est pas lancée, ou mauvais identifiants | Vérifier http://localhost:5050/status et `LOCAL_ANNOTATION_*` |
| `ALERT_API_... is not set` | Il manque un des 4 identifiants de l'API d'alerte | Compléter `ALERT_API_*` dans `.env` |
| `Authentication failed` | Mauvais identifiants de l'API d'alerte | Vérifier `ALERT_API_*` dans `.env` |
| `--source-api is required for an unknown alert API URL` | URL d'API d'alerte non reconnue | Ajouter `SOURCE_API=...` |
| Toutes les détections échouent avec `IMAGE_TRANSFER=bucket-copy` | L'API d'annotation n'a pas accès aux buckets de l'API d'alerte | Ajouter `IMAGE_TRANSFER=url` |
