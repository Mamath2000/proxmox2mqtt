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

            // Récupérer les informations avec gestion d'erreur individuelle
            let statusData = {};
            let resourcesData = {};

            try {
                const statusResponse = await this.client.get(`/nodes/${nodeName}/status`);
                statusData = statusResponse.data.data;
                logger.debug(`Statut récupéré pour ${nodeName}`);
            } catch (statusError) {
                logger.warn(`Impossible de récupérer le statut direct pour ${nodeName}: ${statusError.message}`);
            }

            try {
                const resourcesResponse = await this.client.get(`/cluster/resources?type=node&node=${nodeName}`);
                resourcesData = resourcesResponse.data.data[0] || {};
                logger.debug(`Ressources récupérées pour ${nodeName}`);
            } catch (resourcesError) {
                logger.warn(`Impossible de récupérer les ressources pour ${nodeName}: ${resourcesError.message}`);
                
                // Fallback: essayer sans filtrer par nœud
                try {
                    const allResourcesResponse = await this.client.get('/cluster/resources?type=node');
                    const allResources = allResourcesResponse.data.data;
                    resourcesData = allResources.find(resource => resource.node === nodeName) || {};
                    logger.debug(`Ressources trouvées via fallback pour ${nodeName}`);
                } catch (fallbackError) {
                    logger.warn(`Impossible de récupérer les ressources via fallback pour ${nodeName}: ${fallbackError.message}`);
                    
                    // Fallback final: utiliser les données du nœud simple
                    try {
                        const nodeResponse = await this.client.get(`/nodes/${nodeName}`);
                        const nodeData = nodeResponse.data.data || {};
                        resourcesData = {
                            status: nodeData.status || (statusData.uptime > 0 ? 'online' : 'offline'),
                            cpu: nodeData.cpu,
                            maxcpu: nodeData.maxcpu,
                            mem: nodeData.mem,
                            maxmem: nodeData.maxmem,
                            disk: nodeData.disk,
                            maxdisk: nodeData.maxdisk
                        };
                        logger.debug(`Ressources récupérées via nœud simple pour ${nodeName}`);
                    } catch (finalError) {
                        logger.error(`Impossible de récupérer les données par tous les moyens pour ${nodeName}: ${finalError.message}`);
                    }
                }
            }

            return {
                node: nodeName,
                status: resourcesData.status || statusData.status || 'unknown',
                uptime: statusData.uptime || 0,
                cpu: {
                    usage: Math.round((resourcesData.cpu || 0) * 100),
                    cores: resourcesData.maxcpu || 0
                },
                memory: {
                    used: resourcesData.mem || 0,
                    total: resourcesData.maxmem || 0,
                    usage: resourcesData.maxmem ? Math.round((resourcesData.mem / resourcesData.maxmem) * 100) : 0
                },
                disk: {
                    used: resourcesData.disk || 0,
                    total: resourcesData.maxdisk || 0,
                    usage: resourcesData.maxdisk ? Math.round((resourcesData.disk / resourcesData.maxdisk) * 100) : 0
                },
                load: statusData.loadavg ? statusData.loadavg[0] : 0,
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
            return {
                node: nodeName,
                status: 'error',
                uptime: 0,
                cpu: { usage: 0, cores: 0 },
                memory: { used: 0, total: 0, usage: 0 },
                disk: { used: 0, total: 0, usage: 0 },
                load: 0,
                lastUpdate: new Date().toISOString(),
                error: error.message
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