const https = require('https');
const axios = require('axios');
const logger = require('../utils/logger');

class ProxmoxAPI {
    constructor(config) {
        this.host = config.host;
        this.user = config.user;
        this.password = config.password;
        this.realm = config.realm;
        this.port = config.port;
        this.ticket = null;
        this.csrfToken = null;
        
        // Configuration d'axios pour Proxmox
        this.client = axios.create({
            baseURL: `https://${this.host}:${this.port}/api2/json`,
            httpsAgent: new https.Agent({
                rejectUnauthorized: false // Pour les certificats auto-signés
            }),
            timeout: 10000
        });
    }

    async connect() {
        try {
            const response = await this.client.post('/access/ticket', {
                username: `${this.user}@${this.realm}`,
                password: this.password
            });

            this.ticket = response.data.data.ticket;
            this.csrfToken = response.data.data.CSRFPreventionToken;

            // Configuration des headers pour les futures requêtes
            this.client.defaults.headers.common['Cookie'] = `PVEAuthCookie=${this.ticket}`;
            this.client.defaults.headers.common['CSRFPreventionToken'] = this.csrfToken;

            logger.info('Authentification Proxmox réussie');
        } catch (error) {
            logger.error('Erreur d\'authentification Proxmox:', error.message);
            throw error;
        }
    }

    async getNodes() {
        try {
            const response = await this.client.get('/nodes');
            return response.data.data;
        } catch (error) {
            logger.error('Erreur lors de la récupération des nœuds:', error.message);
            throw error;
        }
    }

    async getNodeStatus(nodeName) {
        try {
            logger.debug(`Récupération du statut pour le nœud: ${nodeName}`);
            
            // Vérifier d'abord si le nœud existe
            const nodesResponse = await this.client.get('/nodes');
            const availableNodes = nodesResponse.data.data.map(node => node.node);
            
            if (!availableNodes.includes(nodeName)) {
                logger.warn(`Le nœud ${nodeName} n'existe pas. Nœuds disponibles: ${availableNodes.join(', ')}`);
                return null;
            }

            // Utiliser uniquement l'endpoint /nodes/{node}/status qui est plus fiable
            const statusResponse = await this.client.get(`/nodes/${nodeName}/status`);
            const statusData = statusResponse.data.data;
            
            logger.debug(`Statut récupéré pour ${nodeName}:`, {
                uptime: statusData.uptime,
                cpu: statusData.cpu,
                memory: statusData.memory,
                rootfs: statusData.rootfs
            });

            // Calculer l'utilisation CPU en pourcentage
            const cpuUsage = statusData.cpu ? Math.round(statusData.cpu * 100) : 0;
            
            // Calculer l'utilisation mémoire
            const memoryUsage = statusData.memory && statusData.memory.total > 0 
                ? Math.round((statusData.memory.used / statusData.memory.total) * 100) 
                : 0;
            
            // Calculer l'utilisation disque (rootfs)
            const diskUsage = statusData.rootfs && statusData.rootfs.total > 0 
                ? Math.round((statusData.rootfs.used / statusData.rootfs.total) * 100) 
                : 0;

            // Récupère le statut des storages (ex: Ceph)
            const storageData = await this.getStorageStatus(nodeName);

            return {
                node: nodeName,
                state: statusData.uptime > 0 ? 'online' : 'offline',
                uptime: statusData.uptime || 0,
                cpu_usage: cpuUsage,
                cpu_cores: statusData.cpuinfo ? statusData.cpuinfo.cpus : 0,
                mem_used: statusData.memory ? statusData.memory.used : 0,
                mem_total: statusData.memory ? statusData.memory.total : 0,
                mem_usage: memoryUsage,
                disk_used: statusData.rootfs ? statusData.rootfs.used : 0,
                disk_total: statusData.rootfs ? statusData.rootfs.total : 0,
                disk_usage: diskUsage,
                load1: statusData.loadavg ? statusData.loadavg[0] : 0,
                load5: statusData.loadavg ? statusData.loadavg[1] : 0,
                load15: statusData.loadavg ? statusData.loadavg[2] : 0,
                ceph_used: storageData.ceph.used,
                ceph_total: storageData.ceph.total,
                ceph_usage: storageData.ceph.usage,
                ceph_status: storageData.ceph.status,
                lastUpdate: new Date().toISOString()
            };
        } catch (error) {
            logger.error(`Erreur lors de la récupération du statut du nœud ${nodeName}:`, {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            });
            
            // Retourner des données par défaut plutôt que de faire planter l'application
            return {};
        }
    }

    async getStorageStatus(nodeName) {
        try {
            logger.debug('Récupération du statut des storages...');

            const response = await this.client.get(`/nodes/${nodeName}/storage`);
            const storages = response.data.data;
            
            const result = {
                ceph: { status: 'not_found', usage: 0, used: 0, total: 0 }
            };

            // Chercher les storages Ceph
            const cephStorages = storages.filter(storage => 
                storage.type === 'cephfs' || storage.type === 'rbd'
            );

            if (cephStorages.length > 0) {
                // Récupérer les détails du premier storage Ceph trouvé
                const cephStorage = cephStorages[0];
                try {
                    const storageResponse = await this.client.get(`/nodes/${nodeName}/storage/${cephStorage.storage}/status`);
                    
                    if (storageResponse.data.data) {
                        const storageData = storageResponse.data.data;
                        const usage = storageData.total > 0 
                            ? Math.round((storageData.used / storageData.total) * 100) 
                            : 0;

                        result.ceph = {
                            status: storageData.enabled !== false ? 'healthy' : 'disabled',
                            usage: usage,
                            used: storageData.used || 0,
                            total: storageData.total || 0,
                            available: storageData.avail || 0,
                            type: cephStorage.type,
                            storage_id: cephStorage.storage
                        };
                    }
                } catch (storageError) {
                    logger.warn(`Impossible de récupérer le statut du storage ${cephStorage.storage}:`, storageError.message);
                    result.ceph = {
                        status: 'unavailable',
                        usage: 0,
                        used: 0,
                        total: 0,
                        storage_id: cephStorage.storage,
                        error: storageError.message
                    };
                }
            }

            return result;
        } catch (error) {
            logger.error('Erreur lors de la récupération du statut des storages:', {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText
            });
            
            return {
                ceph: { status: 'error', usage: 0, used: 0, total: 0, error: error.message }
            };
        }
    }

    async restartNode(nodeName) {
        try {
            const response = await this.client.post(`/nodes/${nodeName}/status`, {
                command: 'reboot'
            });
            logger.info(`Redémarrage du nœud ${nodeName} initié`);
            return response.data;
        } catch (error) {
            logger.error(`Erreur lors du redémarrage du nœud ${nodeName}:`, error.message);
            throw error;
        }
    }

    async shutdownNode(nodeName) {
        try {
            const response = await this.client.post(`/nodes/${nodeName}/status`, {
                command: 'shutdown'
            });
            logger.info(`Arrêt du nœud ${nodeName} initié`);
            return response.data;
        } catch (error) {
            logger.error(`Erreur lors de l'arrêt du nœud ${nodeName}:`, error.message);
            throw error;
        }
    }

    async getVMs(nodeName) {
        try {
            const response = await this.client.get(`/nodes/${nodeName}/qemu`);
            return response.data.data;
        } catch (error) {
            logger.error(`Erreur lors de la récupération des VMs du nœud ${nodeName}:`, error.message);
            throw error;
        }
    }

    async getContainers(nodeName) {
        try {
            const response = await this.client.get(`/nodes/${nodeName}/lxc`);
            return response.data.data;
        } catch (error) {
            logger.error(`Erreur lors de la récupération des conteneurs du nœud ${nodeName}:`, error.message);
            throw error;
        }
    }
}

module.exports = ProxmoxAPI;