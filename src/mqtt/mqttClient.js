const mqtt = require('mqtt');
const EventEmitter = require('events');
const logger = require('../utils/logger');

class MQTTClient extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.client = null;
        this.isConnected = false;
        this.baseTopic = 'proxmox2mqtt';
    }

    async connect() {
        return new Promise((resolve, reject) => {
            try {
                // Génération d'un clientId unique pour éviter les conflits
                const timestamp = Date.now();
                const random = Math.random().toString(36).substring(2, 8);
                const uniqueClientId = `${this.config.clientId}_${timestamp}_${random}`;
                
                const options = {
                    clientId: uniqueClientId,
                    clean: true,
                    connectTimeout: 30000,
                    reconnectPeriod: 5000
                };

                logger.info(`Connexion MQTT avec clientId: ${uniqueClientId}`);

                if (this.config.username && this.config.password) {
                    options.username = this.config.username;
                    options.password = this.config.password;
                }

                this.client = mqtt.connect(this.config.broker, options);

                this.client.on('connect', () => {
                    this.isConnected = true;
                    logger.info('Connexion MQTT établie');
                    
                    // S'abonner aux topics de commande
                    this.subscribeToCommands();
                    resolve();
                });

                this.client.on('error', (error) => {
                    logger.error('Erreur MQTT:', error.message);
                    reject(error);
                });

                this.client.on('offline', () => {
                    this.isConnected = false;
                    logger.warn('Connexion MQTT perdue');
                });

                this.client.on('reconnect', () => {
                    logger.info('Reconnexion MQTT en cours...');
                });

                this.client.on('message', (topic, message) => {
                    this.handleMessage(topic, message);
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    async disconnect() {
        if (this.client && this.isConnected) {
            this.client.end();
            this.isConnected = false;
            logger.info('Connexion MQTT fermée');
        }
    }

    subscribeToCommands() {
        const commandTopic = `${this.baseTopic}/+/command/+`;
        this.client.subscribe(commandTopic, (error) => {
            if (error) {
                logger.error('Erreur lors de l\'abonnement aux commandes:', error);
            } else {
                logger.info(`Abonné aux commandes: ${commandTopic}`);
            }
        });
    }

    handleMessage(topic, message) {
        try {
            const payload = message.toString();
            logger.debug(`Message reçu sur ${topic}: ${payload}`);
            
            if (topic.includes('/command/')) {
                this.emit('command', topic, payload);
            }
        } catch (error) {
            logger.error('Erreur lors du traitement du message:', error);
        }
    }

    async publishNodeData(nodeName, data) {
        if (!this.isConnected) {
            logger.warn('MQTT non connecté, impossible de publier les données');
            return;
        }

        const baseTopic = `${this.baseTopic}/${nodeName}`;
        
        try {
            // Publication des capteurs séparément pour Home Assistant
            await this.publish(`${baseTopic}/state`, JSON.stringify({
                state: data.status,
                attributes: {
                    uptime: data.uptime,
                    last_update: data.lastUpdate
                }
            }), { retain: true });

            await this.publish(`${baseTopic}/cpu/state`, data.cpu.usage.toString(), { retain: true });
            await this.publish(`${baseTopic}/cpu/attributes`, JSON.stringify({
                cores: data.cpu.cores,
                usage_percent: data.cpu.usage
            }), { retain: true });

            await this.publish(`${baseTopic}/memory/state`, (data.memory.usage || 0).toString(), { retain: true });
            await this.publish(`${baseTopic}/memory/attributes`, JSON.stringify({
                used_bytes: data.memory.used || 0,
                total_bytes: data.memory.total || 0,
                usage_percent: data.memory.usage || 0
            }), { retain: true });

            await this.publish(`${baseTopic}/disk/state`, (data.disk.usage || 0).toString(), { retain: true });
            await this.publish(`${baseTopic}/disk/attributes`, JSON.stringify({
                used_bytes: data.disk.used || 0,
                total_bytes: data.disk.total || 0,
                usage_percent: data.disk.usage || 0
            }), { retain: true });

            // Publication des métriques de charge système (load average)
            await this.publish(`${baseTopic}/load1/state`, (data.load1 || 0).toString(), { retain: true });
            await this.publish(`${baseTopic}/load5/state`, (data.load5 || 0).toString(), { retain: true });
            await this.publish(`${baseTopic}/load15/state`, (data.load15 || 0).toString(), { retain: true });
            
            // Compatibilité : publier load1 comme load pour les anciennes configurations
            await this.publish(`${baseTopic}/load/state`, (data.load1 || 0).toString(), { retain: true });

            // Publication des données de stockage Ceph
            if (data.ceph) {
                const cephData = data.ceph;
                await this.publish(`${baseTopic}/ceph/state`, cephData.status, { retain: true });
                await this.publish(`${baseTopic}/ceph/usage`, (cephData.usage || 0).toString(), { retain: true });
                await this.publish(`${baseTopic}/ceph/attributes`, JSON.stringify({
                    status: cephData.status,
                    usage_percent: cephData.usage || 0,
                    used_bytes: cephData.used || 0,
                    total_bytes: cephData.total || 0,
                    available_bytes: cephData.available || 0,
                    storage_type: cephData.type || 'unknown',
                    storage_id: cephData.storage_id || 'unknown'
                }), { retain: true });
            }

            logger.debug(`Données publiées pour le nœud ${nodeName}`);
        } catch (error) {
            logger.error(`Erreur lors de la publication des données pour ${nodeName}:`, error);
        }
    }

    async publish(topic, message, options = {}) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected) {
                reject(new Error('MQTT non connecté'));
                return;
            }

            this.client.publish(topic, message, options, (error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    async publishDiscovery(entityType, nodeName, entityName, config) {
        const discoveryTopic = `homeassistant/${entityType}/${nodeName}_${entityName}/config`;
        
        try {
            await this.publish(discoveryTopic, JSON.stringify(config), { retain: true });
            logger.debug(`Configuration découverte publiée: ${discoveryTopic}`);
        } catch (error) {
            logger.error(`Erreur lors de la publication de la découverte pour ${entityType}:`, error);
        }
    }
}

module.exports = MQTTClient;