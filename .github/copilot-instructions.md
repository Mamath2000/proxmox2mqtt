# Proxmox to MQTT Bridge for Home Assistant

Ce projet Node.js permet de gérer un cluster Proxmox depuis Home Assistant via MQTT auto-discovery.

## Fonctionnalités
- Surveillance des nœuds Proxmox (CPU, mémoire, état des disques, état d'alimentation)
- Contrôles via Home Assistant (redémarrage, arrêt, actualisation des capteurs)
- Intégration MQTT avec auto-discovery pour Home Assistant
- API Proxmox pour récupérer les données en temps réel

## Architecture
- **Node.js** : Application principale
- **Proxmox API** : Interface avec le cluster Proxmox
- **MQTT** : Communication avec Home Assistant
- **Home Assistant** : Interface utilisateur et automatisations

## Instructions de développement
- Utiliser les APIs REST de Proxmox VE
- Implémenter l'auto-discovery MQTT selon les spécifications Home Assistant
- Gérer l'authentification Proxmox (tokens API ou utilisateur/mot de passe)
- Configurer les topics MQTT selon les conventions Home Assistant