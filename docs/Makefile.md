# Guide d'utilisation du Makefile

## Vue d'ensemble

Ce Makefile fournit une interface simple et colorée pour gérer le projet Proxmox2MQTT.

## Commandes principales

### Configuration initiale
```bash
make setup          # Configuration complète du projet
make install         # Installation des dépendances uniquement
make setup-env       # Configuration du fichier .env
```

### Développement
```bash
make dev            # Démarrage en mode développement (auto-reload)
make start          # Démarrage en mode production
make check          # Vérification du code
make lint           # Analyse de la qualité du code
make lint-fix       # Correction automatique
```

### Gestion de l'application
```bash
make restart        # Redémarre l'application
make stop           # Arrête l'application
make ps             # Affiche les processus actifs
```

### Logs et debugging
```bash
make logs           # Affiche les logs récents (20 dernières lignes)
make logs-error     # Affiche les logs d'erreur
make logs-live      # Suit les logs en temps réel
make clean-logs     # Supprime tous les logs
```

### Maintenance
```bash
make update         # Met à jour les dépendances
make audit          # Audit de sécurité
make clean          # Nettoyage complet
```

### Informations
```bash
make help          # Menu d'aide principal
make status        # Statut détaillé du projet
make info          # Informations sur le projet
```

## Codes couleur

- 🔵 **Bleu (CYAN)** : Messages d'information et titres
- 🟢 **Vert (GREEN)** : Succès et éléments présents
- 🟡 **Jaune (YELLOW)** : Avertissements et sections
- 🔴 **Rouge (RED)** : Erreurs et éléments manquants
- 🟣 **Violet (PURPLE)** : (Réservé pour usage futur)

## Exemples d'utilisation

### Premier démarrage
```bash
make setup    # Configuration complète
make dev      # Test en développement
```

### Workflow de développement
```bash
make dev           # Développement
# ... modifications du code ...
make check         # Vérification
make lint-fix      # Correction automatique
```

### Debugging
```bash
make status        # Vérifier l'état
make logs          # Voir les logs récents
make logs-live     # Suivre en temps réel
```

### Maintenance
```bash
make audit         # Vérifier la sécurité
make update        # Mettre à jour
make clean         # Nettoyer si nécessaire
```