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

    async updateNodeData() {
        try {
            logger.debug(`Mise à jour des données pour ${this.nodes.size} nœuds`);
            
            // // Récupérer les données de stockage Ceph une seule fois (partagées par tous les nœuds)
            // const storageData = await this.proxmox.getStorageStatus(nodeName);
            
            for (const [nodeName] of this.nodes) {
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
        } catch (error) {
            logger.error('Erreur générale lors de la mise à jour des données:', error);
        }
    }

    async handleCommand(topic, payload) {
        try {
            JSON.parse(payload); // Valider le JSON
            const [, , nodeName, action] = topic.split('/');

            logger.info(`Commande reçue: ${action} pour le nœud ${nodeName}`);

            switch (action) {
            case 'restart':
                await this.proxmox.restartNode(nodeName);
                break;
            case 'shutdown':
                await this.proxmox.shutdownNode(nodeName);
                break;
            case 'refresh':
                await this.updateNodeData();
                break;
            default:
                logger.warn(`Action inconnue: ${action}`);
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