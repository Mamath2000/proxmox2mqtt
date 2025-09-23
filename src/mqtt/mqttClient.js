const mqtt = require('mqtt');
const EventEmitter = require('events');
const logger = require('../utils/logger');

class MQTTClient extends EventEmitter {
    constructor(config) {
        super();
        this.config = {
            broker: config.broker,
            username: config.username || '',
            password: config.password || '',
            clientId: config.clientId || 'proxmox2mqtt',
            keepalive: parseInt(process.env.MQTT_KEEPALIVE) || 60,
            connectTimeout: (parseInt(process.env.MQTT_CONNECT_TIMEOUT) || 60) * 1000, // Convertir en ms
            reconnectPeriod: (parseInt(process.env.MQTT_RECONNECT_PERIOD) || 5) * 1000  // Convertir en ms
        };
        
        // Générer un clientId unique pour éviter les conflits
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        this.config.clientId = `${this.config.clientId}_${timestamp}_${random}`;
        
        this.client = null;
        this.isConnected = false;
        this.baseTopic = 'proxmox2mqtt';
    }

    async connect() {
        try {
            logger.info(`Connexion au broker MQTT: ${this.config.broker}`);
            
            const options = {
                clientId: this.config.clientId,
                clean: true,
                keepalive: this.config.keepalive,
                connectTimeout: this.config.connectTimeout,
                reconnectPeriod: this.config.reconnectPeriod,
                will: {
                    topic: 'proxmox2mqtt/status',
                    payload: 'offline',
                    qos: 1,
                    retain: true
                }
            };
            
            // Ajouter l'authentification si fournie
            if (this.config.username) {
                options.username = this.config.username;
                options.password = this.config.password;
            }
            
            this.client = mqtt.connect(this.config.broker, options);
            
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error(`Timeout de connexion MQTT après ${this.config.connectTimeout}ms`));
                }, this.config.connectTimeout);
                
                this.client.on('connect', () => {
                    clearTimeout(timeout);
                    this.isConnected = true;
                    logger.info(`Connecté au broker MQTT avec l'ID: ${this.config.clientId}`);
                    
                    // Publier le statut en ligne
                    this.client.publish('proxmox2mqtt/status', 'online', { qos: 1, retain: true });
                    
                    // S'abonner aux topics de commande
                    this.subscribeToCommands();
                    
                    resolve();
                });
                
                // Gestionnaire pour les messages reçus
                this.client.on('message', (topic, message) => {
                    this.handleMessage(topic, message);
                });
                
                this.client.on('error', (error) => {
                    clearTimeout(timeout);
                    logger.error('Erreur MQTT:', error);
                    reject(error);
                });
                
                this.client.on('disconnect', () => {
                    this.isConnected = false;
                    logger.warn('Déconnecté du broker MQTT');
                });
                
                this.client.on('reconnect', () => {
                    logger.info('Reconnexion au broker MQTT...');
                });
            });
        } catch (error) {
            logger.error('Erreur lors de la connexion MQTT:', error);
            throw error;
        }
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
            logger.info(`📨 Message MQTT reçu sur ${topic}: ${payload}`);
            
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
                cpu_usage: data.cpu?.usage || 0,
                cpu_cores: data.cpu?.cores || 0,
                mem_usage: data.memory?.usage || 0,
                mem_used: data.memory?.used || 0,
                mem_total: data.memory?.total || 0,
                disk_usage: data.disk?.usage || 0,
                disk_used: data.disk?.used || 0,
                disk_total: data.disk?.total || 0,
                load1: data.load1 || 0,
                load5: data.load5 || 0,
                load15: data.load15 || 0,
                ceph_status: data.ceph?.status || 'unknown',
                ceph_usage: data.ceph?.usage || 0,
                ceph_used: data.ceph?.used || 0,
                ceph_total: data.ceph?.total || 0,
                uptime: data.uptime || 0,
                lxc_count: data.lxcList?.length || 0,
                lxc_list: { containers: data.lxcList || [] },
                last_update: data.lastUpdate || 0
            }), { retain: true });

            logger.debug(`Données publiées pour le nœud ${nodeName}`);
        } catch (error) {
            logger.error(`Erreur lors de la publication des données du nœud ${nodeName}:`, error);
        }
    }

    async publishContainerData(containerName, data) {
        try {
            const baseTopic = `${this.baseTopic}/lxc/${data.key}`;

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