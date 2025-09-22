# Proxmox to MQTT Bridge for Home Assistant

Un pont Node.js qui connecte votre cluster Proxmox à Home Assistant via MQTT auto-discovery.

## Fonctionnalités

- **Surveillance des nœuds** : CPU, mémoire, stockage, état d'alimentation
- **Contrôles à distance** : Redémarrage, arrêt, actualisation des capteurs
- **Gestion des sauvegardes** : 
  - Déclenchement via Home Assistant
  - Suivi automatique des sauvegardes lancées depuis Proxmox
  - Surveillance en temps réel du progression et des résultats
- **Auto-discovery MQTT** : Intégration automatique avec Home Assistant
- **API Proxmox** : Communication temps réel avec le cluster

## 🚀 Démarrage rapide avec Make

### Installation et configuration automatique
```bash
make setup          # Configuration complète du projet
make status         # Vérifier l'état du projet
make dev            # Démarrer en mode développement
```

### Menu d'aide
```bash
make help           # Affiche toutes les commandes disponibles
```

## Installation manuelle

```bash
npm install
```

## Configuration

### Avec Make (recommandé)
```bash
make setup-env      # Crée le fichier .env depuis .env.example
# Puis éditez le fichier .env avec vos paramètres
```

### Manuelle
Créez un fichier `.env` à la racine du projet :

```env
# Configuration Proxmox
PROXMOX_HOST=your-proxmox-host
PROXMOX_USER=your-username
PROXMOX_PASSWORD=your-password
PROXMOX_REALM=pam

# Configuration MQTT
MQTT_BROKER=mqtt://your-mqtt-broker:1883
MQTT_USERNAME=your-mqtt-username
MQTT_PASSWORD=your-mqtt-password
MQTT_CLIENT_ID=proxmox2mqtt

# Configuration des sauvegardes
PROXMOX_BACKUP_STORAGE=local
PROXMOX_BACKUP_MODE=snapshot
PROXMOX_BACKUP_COMPRESS=gzip
PROXMOX_BACKUP_REMOVE=0

# Configuration générale
UPDATE_INTERVAL=30000
LOG_LEVEL=info
```

## Utilisation

### Avec Make (recommandé)
```bash
make start          # Mode production
make dev            # Mode développement avec auto-reload
make logs           # Voir les logs
make stop           # Arrêter l'application
```

### Manuelle
```bash
npm start           # Mode production
npm run dev         # Mode développement
```

## Configuration des sauvegardes

### Paramètres de sauvegarde
- **`PROXMOX_BACKUP_STORAGE`** : Stockage de destination (par défaut : `local`)
- **`PROXMOX_BACKUP_MODE`** : Mode de sauvegarde (`snapshot`, `suspend`, `stop`) (par défaut : `snapshot`)
- **`PROXMOX_BACKUP_COMPRESS`** : Compression (`0`, `1`, `gzip`, `lzo`, `zstd`) (par défaut : `gzip`)
- **`PROXMOX_BACKUP_REMOVE`** : Suppression des anciennes sauvegardes (`0` = garder toutes, `1+` = nombre à garder) (par défaut : `1`)

### Surveillance automatique
- **`PROXMOX_BACKUP_CHECK_INTERVAL`** : Fréquence de vérification des backups (par défaut : `10` secondes)

Le système surveille automatiquement :
- Les sauvegardes déclenchées via Home Assistant
- Les sauvegardes lancées directement depuis l'interface Proxmox (détection des tâches actives)
- Le progression et les résultats sont publiés en temps réel via MQTT

## Architecture

```
Proxmox VE API ←→ Node.js Bridge ←→ MQTT Broker ←→ Home Assistant
```

## Développement

### Avec Make
```bash
make dev            # Développement avec auto-reload
make check          # Vérification du code
make lint           # Analyse de qualité
make lint-fix       # Correction automatique
```

### Manuel

```bash
npm run dev
```

## Licence

ISC