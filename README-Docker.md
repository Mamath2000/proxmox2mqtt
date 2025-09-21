## 🔨 Build et Publication

Le projet inclut un système de build automatisé avec gestion de versions :

### Commandes de Build

```bash
# Build local sans incrément de version
make build-local

# Build avec incrément automatique de version 
make build

# Build et publication sur Docker Hub
make build-push
```

### Gestion des versions

Le script de build incrémente automatiquement le patch version (1.0.0 → 1.0.1) et met à jour le `package.json`. 

**Options du script** (`./scripts/build.sh`) :
- `--no-increment` : Build sans changer la version
- `--push` : Pousse l'image vers Docker Hub
- `--help` : Affiche l'aide

## 🐳 Utilisation Docker 🐳 Proxmox2MQTT - Déploiement Docker

## 📦 Vue d'ensemble

Ce projet peut être déployé facilement avec Docker pour une installation et une maintenance simplifiées.

## 🚀 Démarrage rapide

### 1. Configuration

Copiez le fichier d'exemple et configurez vos paramètres :

```bash
cp .env.example .env
nano .env
```

Configurez au minimum :
- `PROXMOX_HOST` : L'URL de votre serveur Proxmox
- `PROXMOX_USER` et `PROXMOX_PASSWORD` : Vos identifiants Proxmox
- `MQTT_BROKER` : L'URL de votre broker MQTT
- `MQTT_USERNAME` et `MQTT_PASSWORD` : Vos identifiants MQTT

### 2. Construction et lancement

```bash
# Construction de l'image
make docker-build

# Lancement du conteneur
make docker-run
```

## 🛠️ Commandes disponibles

### Construction et déploiement
```bash
make docker-build          # Construit l'image Docker
make docker-build-no-cache  # Construit sans cache
make docker-run             # Lance le conteneur
make docker-stop            # Arrête le conteneur
make docker-restart         # Redémarre le conteneur
make docker-rebuild         # Reconstruction complète
```

### Monitoring et maintenance
```bash
make docker-logs            # Affiche les logs en temps réel
make docker-status          # Statut et utilisation des ressources
make docker-health          # Vérification de santé
make docker-shell           # Ouvre un shell dans le conteneur
```

### Nettoyage
```bash
make docker-clean           # Nettoie complètement Docker
```

## 📁 Structure des volumes

- `./logs:/app/logs` : Persistance des logs sur l'hôte

## 🔧 Configuration avancée

### Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|---------|
| `PROXMOX_HOST` | URL du serveur Proxmox | **obligatoire** |
| `PROXMOX_USER` | Utilisateur Proxmox | **obligatoire** |
| `PROXMOX_PASSWORD` | Mot de passe Proxmox | **obligatoire** |
| `PROXMOX_REALM` | Realm d'authentification | `pam` |
| `PROXMOX_PORT` | Port du serveur Proxmox | `8006` |
| `MQTT_BROKER` | URL du broker MQTT | **obligatoire** |
| `MQTT_USERNAME` | Utilisateur MQTT | **obligatoire** |
| `MQTT_PASSWORD` | Mot de passe MQTT | **obligatoire** |
| `MQTT_CLIENT_ID` | ID du client MQTT | `proxmox2mqtt` |
| `LOG_LEVEL` | Niveau de logs | `info` |
| `UPDATE_INTERVAL` | Intervalle de mise à jour (ms) | `30000` |

### Limites de ressources

Par défaut, le conteneur est limité à :
- **CPU** : 0.5 cœur (limite), 0.1 cœur (réservation)
- **Mémoire** : 256MB (limite), 128MB (réservation)

Vous pouvez modifier ces limites dans `docker-compose.yml`.

## 🩺 Monitoring

### Healthcheck

Le conteneur inclut un healthcheck automatique qui vérifie :
- Toutes les 30 secondes
- Timeout de 10 secondes
- 3 tentatives avant de marquer comme unhealthy

### Logs

Les logs sont disponibles via :
```bash
# Logs du conteneur
make docker-logs

# Logs de l'application (persistants)
tail -f logs/proxmox2mqtt.log
```

## 🔒 Sécurité

- Le conteneur utilise un utilisateur non-root (`proxmox2mqtt`)
- Image basée sur Alpine Linux (plus sécurisée et légère)
- Build multi-stage pour réduire la surface d'attaque
- Tini comme processus init pour une gestion propre des signaux

## 🐛 Dépannage

### Vérifier le statut
```bash
make docker-status
make docker-health
```

### Accéder aux logs
```bash
make docker-logs
```

### Shell de débogage
```bash
make docker-shell
```

### Reconstruction complète
```bash
make docker-rebuild
```

## 📝 Exemple de configuration complète

### .env
```bash
# Proxmox
PROXMOX_HOST=https://192.168.1.100:8006
PROXMOX_USER=root
PROXMOX_PASSWORD=monMotDePasse
PROXMOX_REALM=pam

# MQTT
MQTT_BROKER=mqtt://192.168.1.50:1883
MQTT_USERNAME=homeassistant
MQTT_PASSWORD=monMotDePasseMQTT

# Options
LOG_LEVEL=info
UPDATE_INTERVAL=30000
```

### Démarrage
```bash
# Construction et lancement
make docker-build && make docker-run

# Vérification
make docker-status
make docker-logs
```

## 🚀 Déploiement en production

Pour un déploiement en production, considérez :

1. **Utiliser Docker Swarm ou Kubernetes** pour la haute disponibilité
2. **Configurer un reverse proxy** (Traefik, Nginx) si nécessaire
3. **Mettre en place une sauvegarde** des logs
4. **Surveiller les ressources** et ajuster les limites
5. **Utiliser des secrets** pour les mots de passe sensibles

## 📞 Support

En cas de problème :
1. Vérifiez les logs : `make docker-logs`
2. Vérifiez la santé : `make docker-health`
3. Testez la connectivité réseau vers Proxmox et MQTT
4. Consultez la documentation principale du projet