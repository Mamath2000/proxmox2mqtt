const ProxmoxAPI = require('./proxmox/proxmoxAPI');
const MQTTClient = require('./mqtt/mqttClient');
const HomeAssistantDiscovery = require('./homeassistant/discovery');
const logger = require('./utils/logger');
require('dotenv').config();

class Proxmox2MQTT {
    constructor() {
        this.proxmox = new ProxmoxAPI({
            host: process.env.PROXMOX_HOST,
            user: process.env.PROXMOX_USER,
            password: process.env.PROXMOX_PASSWORD,
            realm: process.env.PROXMOX_REALM || 'pam',
            port: process.env.PROXMOX_PORT || 8006
        });

        this.mqtt = new MQTTClient({
            broker: process.env.MQTT_BROKER,
            username: process.env.MQTT_USERNAME,
            password: process.env.MQTT_PASSWORD,
            clientId: process.env.MQTT_CLIENT_ID || 'proxmox2mqtt'
        });

        this.discovery = new HomeAssistantDiscovery(this.mqtt);
        this.updateInterval = parseInt(process.env.UPDATE_INTERVAL) || 30000;
        this.nodes = new Map();
        this.containers = new Map(); // Pour stocker les conteneurs découverts
        this.updateTimer = null;
    }

    async start() {
        try {
            logger.info('Démarrage de Proxmox2MQTT...');

            // Connexion aux services
            await this.proxmox.connect();
            logger.info('Connexion à Proxmox établie');

            await this.mqtt.connect();
            logger.info('Connexion MQTT établie');

            // Configuration des gestionnaires d'événements
            this.setupEventHandlers();

            // Découverte initiale des nœuds
            await this.discoverNodes();

            // Découverte initiale des conteneurs
            await this.discoverContainers();

            // Démarrage de la mise à jour périodique
            this.startPeriodicUpdate();

            logger.info('Proxmox2MQTT démarré avec succès');
        } catch (error) {
            logger.error('Erreur lors du démarrage:', error);
            process.exit(1);
        }
    }

    async stop() {
        logger.info('Arrêt de Proxmox2MQTT...');

        try {
            // Arrêter la mise à jour périodique
            if (this.updateTimer) {
                clearInterval(this.updateTimer);
                this.updateTimer = null;
                logger.debug('Timer de mise à jour arrêté');
            }

            // Marquer tous les nœuds comme hors ligne
            for (const [nodeName] of this.nodes) {
                await this.discovery.publishAvailability(nodeName, 'offline');
            }

            // Déconnecter MQTT
            if (this.mqtt) {
                await this.mqtt.disconnect();
                logger.debug('Connexion MQTT fermée');
            }

            logger.info('Proxmox2MQTT arrêté proprement');
        } catch (error) {
            logger.error('Erreur lors de l\'arrêt:', error);
        }

        // Forcer l'arrêt si nécessaire
        setTimeout(() => {
            process.exit(0);
        }, 2000);
    }

    setupEventHandlers() {
        // Gestionnaire pour les commandes MQTT
        this.mqtt.on('command', async (topic, payload) => {
            await this.handleCommand(topic, payload);
        });

        // Gestionnaire d'arrêt propre
        process.on('SIGINT', () => this.stop());
        process.on('SIGTERM', () => this.stop());
    }

    async discoverNodes() {
        try {
            const nodes = await this.proxmox.getNodes();
            logger.info(`${nodes.length} nœuds découverts`);

            // Nettoyer les anciens nœuds qui n'existent plus
            const currentNodeNames = nodes.map(node => node.node);
            for (const [nodeName] of this.nodes) {
                if (!currentNodeNames.includes(nodeName)) {
                    logger.info(`Suppression du nœud obsolète: ${nodeName}`);
                    await this.discovery.removeNodeDiscovery(nodeName);
                    this.nodes.delete(nodeName);
                }
            }

            // Ajouter les nouveaux nœuds
            for (const node of nodes) {
                if (!this.nodes.has(node.node)) {
                    logger.info(`Nouveau nœud découvert: ${node.node}`);
                }
                this.nodes.set(node.node, node);
                await this.discovery.publishNodeDiscovery(node);
                await this.discovery.publishAvailability(node.node, 'online');
            }
        } catch (error) {
            logger.error('Erreur lors de la découverte des nœuds:', error);
        }
    }

    async discoverContainers() {
        try {
            logger.info('Découverte des conteneurs LXC...');
            let totalContainers = 0;

            for (const [nodeName] of this.nodes) {
                try {
                    const containers = await this.proxmox.getContainers(nodeName);

                    for (const container of containers) {
                        // Récupérer les détails complets du conteneur
                        const containerDetails = await this.proxmox.getContainerStatus(nodeName, container.vmid);

                        if (containerDetails.isIgnore) {
                            logger.info(`Conteneur ${containerDetails.key} ignoré par Home Assistant`);
                        } else {
                            if (!this.containers.has(containerDetails.key)) {
                                logger.info(`Nouveau conteneur découvert: ${containerDetails.name} (${container.vmid}) sur ${nodeName}`);
                            }

                            this.containers.set(containerDetails.key, {
                                ...containerDetails,
                                node: nodeName,
                                vmid: container.vmid
                            });

                            await this.discovery.publishContainerDiscovery(containerDetails);
                            await this.discovery.publishContainerAvailability(containerDetails.key, 'online');
                            totalContainers++;
                        }
                    }
                } catch (nodeError) {
                    logger.error(`Erreur lors de la découverte des conteneurs sur ${nodeName}:`, nodeError.message);
                }
            }

            logger.info(`${totalContainers} conteneurs découverts`);
        } catch (error) {
            logger.error('Erreur lors de la découverte des conteneurs:', error);
        }
    }

    async updateNodeData(node = 'all') {
        try {
            logger.debug(`Mise à jour des données pour ${this.nodes.size} nœuds`);

            // // Récupérer les données de stockage Ceph une seule fois (partagées par tous les nœuds)
            // const storageData = await this.proxmox.getStorageStatus(nodeName);
            const nodesToUpdate = node === 'all' ? Array.from(this.nodes.keys()) : [node];

            for (const nodeName of nodesToUpdate) {
                try {
                    const nodeData = await this.proxmox.getNodeStatus(nodeName);

                    if (nodeData) {
                        // // Ajouter les données de stockage aux données du nœud
                        // nodeData.storage = storageData;

                        await this.mqtt.publishNodeData(nodeName, nodeData);

                        // Publier la disponibilité
                        const availability = nodeData.error ? 'offline' : 'online';
                        await this.discovery.publishAvailability(nodeName, availability);

                        logger.debug(`Données mises à jour pour le nœud ${nodeName} (${availability})`);
                    } else {
                        logger.warn(`Nœud ${nodeName} ignoré - non trouvé dans le cluster`);
                        await this.discovery.publishAvailability(nodeName, 'offline');
                    }
                } catch (nodeError) {
                    logger.error(`Erreur spécifique pour le nœud ${nodeName}:`, nodeError.message);
                    await this.discovery.publishAvailability(nodeName, 'offline');
                }
            }

            // Mise à jour des conteneurs
            if (node === 'all') await this.updateAllContainerData();
        } catch (error) {
            logger.error('Erreur générale lors de la mise à jour des données:', error);
        }
    }

    async updateAllContainerData() {
        try {
            logger.debug(`Mise à jour des données pour ${this.containers.size} conteneurs`);

            for (const [containerKey] of this.containers) {
                await this.updateContainerData(containerKey);
            }
        } catch (error) {
            logger.error('Erreur générale lors de la mise à jour des conteneurs:', error);
        }
    }

    async updateContainerData(containerKey) {
        try {
            logger.debug(`Mise à jour des données pour le conteneur ${containerKey}`);

            const containerInfo = this.containers.get(containerKey);
            if (!containerInfo) {
                logger.error(`Conteneur ${containerKey} non trouvé`);
                return;
            }

            const containerData = await this.proxmox.getContainerStatus(containerInfo.node, containerInfo.vmid);
            if (containerData && !containerInfo.isIgnore) {
                await this.mqtt.publishContainerData(containerKey, containerData);

                // Publier la disponibilité
                const availability = containerData.error ? 'offline' : 'online';
                await this.discovery.publishContainerAvailability(containerKey, availability);

                logger.debug(`Données mises à jour pour le conteneur ${containerData.name} (${availability})`);
            } else {
                logger.warn(`Conteneur ${containerKey} ignoré ou non trouvé`);
                await this.discovery.publishContainerAvailability(containerKey, 'offline');
            }
        } catch (error) {
            logger.error('Erreur générale lors de la mise à jour des conteneurs:', error);
        }
    }

    async handleCommand(topic, payload) {
        try {
            const jpayload = JSON.parse(payload); // Valider le JSON
            const topicParts = topic.split('/');

            // Déterminer si c'est une commande pour un nœud ou un conteneur
            if (topicParts[1] === 'lxc') {
                // Commande pour un conteneur: proxmox2mqtt/lxc/{containerName}/command/{action}
                const containerKey = topicParts[2];
                const action = jpayload.action;

                logger.info(`Commande reçue: ${action} pour le conteneur ${containerKey}`);

                // Récupérer les informations du conteneur
                const containerInfo = this.containers.get(containerKey);
                if (!containerInfo) {
                    logger.error(`Conteneur ${containerKey} non trouvé`);
                    return;
                }

                switch (action) {
                    case 'start':
                        await this.proxmox.startContainer(containerInfo.node, containerInfo.vmid);
                        break;
                    case 'stop':
                        await this.proxmox.stopContainer(containerInfo.node, containerInfo.vmid);
                        break;
                    case 'reboot':
                        await this.proxmox.rebootContainer(containerInfo.node, containerInfo.vmid);
                        break;
                    case 'refresh':
                        await this.updateContainerData(containerKey);
                        break;
                    default:
                        logger.warn(`Action inconnue pour conteneur: ${action}`);
                }
            } else if (topicParts[1] === 'nodes') {
                // Commande pour un nœud: proxmox2mqtt/nodes/{nodeName}/command
                const nodeName = topicParts[2];
                const action = jpayload.action;

                logger.info(`Commande reçue: ${action} pour le nœud ${nodeName}`);

                switch (action) {
                    case 'restart':
                        await this.proxmox.restartNode(nodeName);
                        break;
                    case 'shutdown':
                        await this.proxmox.shutdownNode(nodeName);
                        break;
                    case 'refresh':
                        await this.updateNodeData(nodeName);
                        break;
                    default:
                        logger.warn(`Action inconnue pour nœud: ${action}`);
                }
            }
        } catch (error) {
            logger.error('Erreur lors du traitement de la commande:', error);
        }
    }

    startPeriodicUpdate() {
        this.updateTimer = setInterval(async () => {
            await this.updateNodeData();
        }, this.updateInterval);

        logger.info(`Mise à jour périodique configurée (${this.updateInterval}ms)`);
    }
}

// Démarrage de l'application
const app = new Proxmox2MQTT();
app.start().catch(error => {
    logger.error('Erreur fatale:', error);
    process.exit(1);
});

module.exports = Proxmox2MQTT;