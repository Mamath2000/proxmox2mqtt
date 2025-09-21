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
                // Génération d'un client ID unique
                const randomSuffix = Math.random().toString(36).substring(7);
                const timestamp = Date.now();
                const clientId = `${this.config.clientId}_${timestamp}_${randomSuffix}`;

                const options = {
                    clientId: clientId,
                    clean: true,
                    connectTimeout: 4000,
                    reconnectPeriod: 1000
                };

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

                this.client.on('close', () => {
                    this.isConnected = false;
                    logger.warn('Connexion MQTT fermée');
                })
                ;

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
        const nodeCommandTopic = `${this.baseTopic}/nodes/+/command`;
        const containerCommandTopic = `${this.baseTopic}/lxc/+/command`;
        
        this.client.subscribe(nodeCommandTopic, (err) => {
            if (err) {
                logger.error('Erreur lors de l\'abonnement aux commandes des nœuds:', err);
            } else {
                logger.info(`Abonné aux commandes des nœuds: ${nodeCommandTopic}`);
            }
        });
        
        this.client.subscribe(containerCommandTopic, (err) => {
            if (err) {
                logger.error('Erreur lors de l\'abonnement aux commandes des conteneurs:', err);
            } else {
                logger.info(`Abonné aux commandes des conteneurs: ${containerCommandTopic}`);
            }
        });
    }

    handleMessage(topic, message) {
        try {
            const payload = message.toString();
            logger.debug(`Message reçu sur ${topic}: ${payload}`);
            
            // Émettre l'événement pour que l'application principale puisse traiter la commande
            this.emit('command', topic, payload);
        } catch (error) {
            logger.error('Erreur lors du traitement du message MQTT:', error);
        }
    }

    async publish(topic, message, options = {}) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected) {
                reject(new Error('Client MQTT non connecté'));
                return;
            }

            this.client.publish(topic, message, options, (err) => {
                if (err) {
                    logger.error(`Erreur lors de la publication sur ${topic}:`, err);
                    reject(err);
                } else {
                    logger.debug(`Message publié sur ${topic}`);
                    resolve();
                }
            });
        });
    }

    async publishNodeData(nodeName, data) {
        try {
            const baseTopic = `${this.baseTopic}/nodes/${nodeName}`;

            // Publication des données complètes en JSON
            await this.publish(baseTopic, JSON.stringify({
                cpu_usage: data.cpu.usage,
                cpu_cores: data.cpu.cores,
                mem_usage: data.memory.usage,
                mem_used: data.memory.used,
                mem_total: data.memory.total,
                disk_usage: data.disk.usage,
                disk_used: data.disk.used,
                disk_total: data.disk.total,
                load1: data.load1,
                load5: data.load5,
                load15: data.load15,
                ceph_status: data.ceph?.status || 'unknown',
                ceph_usage: data.ceph?.usage || 0,
                ceph_used: data.ceph?.used || 0,
                ceph_total: data.ceph?.total || 0,
                uptime: data.uptime,
                lxc_list: data.lxcList,
                last_update: data.lastUpdate
            }), { retain: true });

            logger.debug(`Données publiées pour le nœud ${nodeName}`);
        } catch (error) {
            logger.error(`Erreur lors de la publication des données du nœud ${nodeName}:`, error);
        }
    }

    async publishContainerData(containerName, data) {
        try {
            const containerKey = `${data.vmid}_${data.name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_')}`;
            const baseTopic = `${this.baseTopic}/lxc/${containerKey}`;

            // Publication des données complètes en JSON
            await this.publish(baseTopic, JSON.stringify({
                state: data.status,
                name: data.name,
                tags: data.tags,
                vmid: data.vmid,
                node: data.node,
                cpu_usage: data.cpu.usage,
                cpu_cores: data.cpu.cores,
                mem_usage: data.memory.usage,
                mem_used: data.memory.used,
                mem_total: data.memory.total,
                disk_usage: data.disk.usage,
                disk_used: data.disk.used,
                disk_total: data.disk.total,
                swap_usage: data.swap?.usage || 0,
                swap_used: data.swap?.used || 0,
                swap_total: data.swap?.total || 0,
                net_in: data.network.in,
                net_out: data.network.out,
                uptime: data.uptime,
                last_update: data.lastUpdate
            }), { retain: true });

            logger.debug(`Données publiées pour le conteneur ${containerName}`);
        } catch (error) {
            logger.error(`Erreur lors de la publication des données du conteneur ${containerName}:`, error);
        }
    }

    async publishDeviceDiscovery(entityName, discoveryConfig) {
        try {
            const discoveryTopic = `homeassistant/device/${entityName}/config`;
            const payload = JSON.stringify(discoveryConfig);
            
            await this.publish(discoveryTopic, payload, { retain: true });
            logger.debug(`Configuration découverte publiée: ${discoveryTopic}`);
        } catch (error) {
            logger.error(`Erreur lors de la publication de la découverte pour ${entityName}:`, error);
        }
    }
}

module.exports = MQTTClient;