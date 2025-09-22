const https = require('https');
const axios = require('axios');
const logger = require('../utils/logger');

class ProxmoxAPI {
    constructor(config) {
        this.config = config;
        this.client = null;
        this.ticket = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.baseReconnectInterval = parseInt(process.env.PROXMOX_RECONNECT_INTERVAL) || 30; // secondes
        this.maxReconnectInterval = parseInt(process.env.PROXMOX_MAX_RECONNECT_INTERVAL) || 300; // 5 minutes max
        this.reconnectTimer = null;
    }

    async connect() {
        try {
            logger.info(`Connexion à Proxmox: ${this.config.host}:${this.config.port} (tentative #${this.reconnectAttempts + 1})`);
            
            this.client = axios.create({
                baseURL: `https://${this.config.host}:${this.config.port}/api2/json`,
                httpsAgent: new https.Agent({
                    rejectUnauthorized: false
                }),
                timeout: 30000,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            await this.authenticate();
            this.isConnected = true;
            this.reconnectAttempts = 0; // Reset du compteur après succès
            
            // Arrêter le timer de reconnexion s'il est actif
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
            
            logger.info('✅ Connexion à Proxmox rétablie avec succès');
            return true;
            
        } catch (error) {
            this.isConnected = false;
            logger.error('❌ Erreur de connexion Proxmox:', error.message);
            
            // Déclencher la reconnexion automatique (sans limite)
            this.scheduleReconnect();
            throw error;
        }
    }

    async authenticate() {
        try {
            const authData = new URLSearchParams({
                username: `${this.config.user}@${this.config.realm}`,
                password: this.config.password
            });

            const response = await this.client.post('/access/ticket', authData);
            
            if (response.data && response.data.data) {
                this.ticket = response.data.data.ticket;
                this.csrfToken = response.data.data.CSRFPreventionToken;
                
                // Configurer les headers d'authentification
                this.client.defaults.headers.Cookie = `PVEAuthCookie=${this.ticket}`;
                if (this.csrfToken) {
                    this.client.defaults.headers['CSRFPreventionToken'] = this.csrfToken;
                }
                
                logger.info('🔑 Authentification Proxmox réussie');
            } else {
                throw new Error('Format de réponse d\'authentification invalide');
            }
        } catch (error) {
            logger.error('❌ Erreur d\'authentification Proxmox:', error.message);
            throw error;
        }
    }

    scheduleReconnect() {
        if (this.reconnectTimer) {
            return; // Un timer de reconnexion est déjà actif
        }

        this.reconnectAttempts++;
        
        // Backoff exponentiel avec maximum
        const delay = Math.min(
            this.baseReconnectInterval * Math.pow(2, Math.min(this.reconnectAttempts - 1, 5)),
            this.maxReconnectInterval
        );
        
        logger.warn(`🔄 Tentative de reconnexion Proxmox #${this.reconnectAttempts} dans ${delay}s...`);
        
        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            try {
                await this.connect();
            } catch (error) {
                logger.error('❌ Échec de la reconnexion Proxmox:', error.message);
                // Programmer automatiquement la prochaine tentative
                this.scheduleReconnect();
            }
        }, delay * 1000);
    }

    async makeRequest(endpoint, method = 'GET', data = null, retryCount = 0) {
        const maxRetries = 1; // Maximum 1 retry en cas d'erreur 401
        
        // Vérifier la connexion avant chaque requête
        if (!this.isConnected) {
            logger.warn('⚠️  Proxmox non connecté, tentative de reconnexion...');
            await this.connect();
        }

        try {
            const config = { method, url: endpoint };
            
            if (data && method !== 'GET') {
                config.data = new URLSearchParams(data);
            }

            const response = await this.client.request(config);
            return response.data;
            
        } catch (error) {
            this.isConnected = false;
            
            if (error.response?.status === 401 && retryCount < maxRetries) {
                logger.warn(`🔄 Erreur 401 détectée, tentative de reconnexion et retry...`);
                try {
                    await this.connect();
                    logger.info(`✅ Reconnexion réussie, retry de la requête ${endpoint}`);
                    return await this.makeRequest(endpoint, method, data, retryCount + 1);
                } catch (reconnectError) {
                    logger.error(`❌ Échec de la reconnexion:`, reconnectError.message);
                    this.scheduleReconnect();
                    throw error;
                }
            } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                logger.warn(`⚠️  Connexion Proxmox perdue (${error.message}), reconnexion automatique...`);
                this.scheduleReconnect();
                throw error;
            } else {
                logger.error(`❌ Erreur API Proxmox sur ${endpoint}:`, error.message);
                throw error;
            }
        }
    }

    async disconnect() {
        this.isConnected = false;
        
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        logger.info('🔌 Déconnexion de Proxmox');
    }

    // Méthode pour forcer une reconnexion immédiate
    async forceReconnect() {
        logger.info('🔄 Reconnexion forcée à Proxmox...');
        
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        this.reconnectAttempts = 0;
        await this.connect();
    }

    async getNodes() {
        try {
            const response = await this.makeRequest('/nodes');
            return response.data;
        } catch (error) {
            logger.error('Erreur lors de la récupération des nœuds:', error.message);
            throw error;
        }
    }

    async getNodeStatus(nodeName) {
        try {
            logger.debug(`Récupération du statut pour le nœud: ${nodeName}`);
            
            // Vérifier d'abord si le nœud existe
            const nodesResponse = await this.getNodes();
            const availableNodes = nodesResponse.map(node => node.node);

            if (!availableNodes.includes(nodeName)) {
                logger.warn(`Le nœud ${nodeName} n'existe pas. Nœuds disponibles: ${availableNodes.join(', ')}`);
                return null;
            }

            // Utiliser uniquement l'endpoint /nodes/{node}/status qui est plus fiable
            const statusResponse = await this.makeRequest(`/nodes/${nodeName}/status`);
            const statusData = statusResponse.data;
            
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
                cpu: {
                    usage: cpuUsage,
                    cores: statusData.cpuinfo ? statusData.cpuinfo.cpus : 0,
                },
                memory: {
                    usage: memoryUsage,
                    used: statusData.memory ? statusData.memory.used : 0,
                    total: statusData.memory ? statusData.memory.total : 0,
                },
                disk: {
                    used: statusData.rootfs ? statusData.rootfs.used : 0,
                    total: statusData.rootfs ? statusData.rootfs.total : 0,
                    usage: diskUsage,
                },
                load1: statusData.loadavg ? statusData.loadavg[0] : 0,
                load5: statusData.loadavg ? statusData.loadavg[1] : 0,
                load15: statusData.loadavg ? statusData.loadavg[2] : 0,
                ceph: {
                    used: storageData.ceph.used,
                    total: storageData.ceph.total,
                    usage: storageData.ceph.usage,
                    status: storageData.ceph.status
                },
                lxcList: await this.getContainersList(nodeName),
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

            const response = await this.makeRequest(`/nodes/${nodeName}/storage`);
            const storages = response.data;
            
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
                    const storageResponse = await this.makeRequest(`/nodes/${nodeName}/storage/${cephStorage.storage}/status`);
                    
                    if (storageResponse.data) {
                        const storageData = storageResponse.data;
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
            const response = await this.makeRequest(`/nodes/${nodeName}/status`, "POST", {
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
            const response = await this.makeRequest(`/nodes/${nodeName}/status`, 'POST', {
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
            const response = await this.makeRequest(`/nodes/${nodeName}/qemu`, 'POST');
            return response.data;
        } catch (error) {
            logger.error(`Erreur lors de la récupération des VMs du nœud ${nodeName}:`, error.message);
            throw error;
        }
    }

    async getContainers(nodeName) {
        try {
            const response = await this.makeRequest(`/nodes/${nodeName}/lxc`);
            // filter ignored containers and add container Key on each container
            const filteredList = response.data.filter(container => {
                const tagsArray = container.tags ? container.tags.split(';') : [];
                return !tagsArray.find(tag => tag.trim() === 'ha-ignore');
            });
            filteredList.forEach(container => {
                    container.key = this.createContainerKey(container);
            });
            return filteredList;
        } catch (error) {
            logger.error(`Erreur lors de la récupération des conteneurs du nœud ${nodeName}:`, error.message);
            throw error;
        }
    }

    createContainerKey(containerData) {
        const { vmid, name } = containerData;
        return `${vmid}_${name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_')}`;
    }

    async getContainersList(nodeName) {
        try {
            const response = await this.makeRequest(`/nodes/${nodeName}/lxc`);
            let lxcList = [];
            // add container Key on each container
            response.data.forEach(container => {

                // recherche le tag "ha-ignore"
                const tagsArray = container.tags ? container.tags.split(';') : [];
                if (!tagsArray.find(tag => tag.trim() === 'ha-ignore')) {
                    lxcList.push(this.createContainerKey(container));
                }
            });

            return lxcList;
        } catch (error) {
            logger.error(`Erreur lors de la récupération de la liste des conteneurs du nœud ${nodeName}:`, error.message);
            throw error;
        }
    }

    async getContainerStatus(nodeName, containerId) {
        try {
            logger.debug(`Récupération du statut pour le conteneur: ${containerId} sur ${nodeName}`);
            
            const response = await this.makeRequest(`/nodes/${nodeName}/lxc/${containerId}/status/current`);
            const statusData = response.data;

            logger.debug(`Statut récupéré pour ${containerId}:`, statusData);

            // Calculer l'utilisation CPU en pourcentage
            const cpuUsage = statusData.cpu ? Math.round(statusData.cpu * 100) : 0;
            
            // Calculer l'utilisation mémoire
            const memoryUsage = statusData.maxmem && statusData.maxmem > 0 
                ? Math.round((statusData.mem / statusData.maxmem) * 100) 
                : 0;

            // recherche le tag "ha-ignore"
            const tagsArray = statusData.tags ? statusData.tags.split(';') : [];
            const haIgnoreTag = tagsArray.find(tag => tag.trim() === 'ha-ignore');
            if (haIgnoreTag) {
                logger.info(`Le conteneur ${containerId} sur ${nodeName} est ignoré par Home Assistant`);
            }

            return {
                key: this.createContainerKey(statusData),
                node: nodeName,
                vmid: containerId,
                name: statusData.name,
                isIgnore: haIgnoreTag ? true : false,
                tags: tagsArray,
                status: statusData.status || 'unknown',
                uptime: statusData.uptime || 0,
                cpu: {
                    usage: cpuUsage,
                    cores: statusData.cpus || 0
                },
                memory: {
                    used: statusData.mem || 0,
                    total: statusData.maxmem || 0,
                    usage: memoryUsage
                },
                disk: {
                    used: statusData.disk || 0,
                    total: statusData.maxdisk || 0,
                    usage: statusData.maxdisk > 0 ? Math.round((statusData.disk / statusData.maxdisk) * 100) : 0
                },
                swap: {
                    used: statusData.swap || 0,
                    total: statusData.maxswap || 0,
                    usage: statusData.maxswap > 0 ? Math.round((statusData.swap / statusData.maxswap) * 100) : 0
                },
                network: {
                    in: statusData.netin || 0,
                    out: statusData.netout || 0
                },
                lastUpdate: new Date().toISOString()
            };
        } catch (error) {
            // Si erreur 500/404, le conteneur n'est probablement plus sur ce nœud
            if (error.response?.status === 500 || error.response?.status === 404) {
                logger.warn(`Conteneur ${containerId} non trouvé sur ${nodeName} - possible migration détectée`);
                throw new Error('CONTAINER_NOT_FOUND');
            }
            
            logger.error(`Erreur lors de la récupération du statut du conteneur ${containerId} sur ${nodeName}:`, {
                message: error.message,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data
            });
            
            return {
                node: nodeName,
                vmid: containerId,
                name: `CT-${containerId}`,
                status: 'error',
                uptime: 0,
                cpu: { usage: 0, cores: 0 },
                memory: { used: 0, total: 0, usage: 0 },
                disk: { used: 0, total: 0, usage: 0 },
                network: { in: 0, out: 0 },
                lastUpdate: new Date().toISOString(),
                error: error.message
            };
        }
    }

    async startContainer(nodeName, containerId) {
        try {
            const response = await this.makeRequest(`/nodes/${nodeName}/lxc/${containerId}/status/start`, 'POST');
            logger.info(`Démarrage du conteneur ${containerId} sur ${nodeName} initié`);
            return response.data;
        } catch (error) {
            logger.error(`Erreur lors du démarrage du conteneur ${containerId} sur ${nodeName}:`, error.message);
            throw error;
        }
    }

    async stopContainer(nodeName, containerId) {
        try {
            const response = await this.makeRequest(`/nodes/${nodeName}/lxc/${containerId}/status/stop`, 'POST');
            logger.info(`Arrêt du conteneur ${containerId} sur ${nodeName} initié`);
            return response.data;
        } catch (error) {
            logger.error(`Erreur lors de l'arrêt du conteneur ${containerId} sur ${nodeName}:`, error.message);
            throw error;
        }
    }

    async rebootContainer(nodeName, containerId) {
        try {
            const response = await this.makeRequest(`/nodes/${nodeName}/lxc/${containerId}/status/reboot`, 'POST');
            logger.info(`Redémarrage du conteneur ${containerId} sur ${nodeName} initié`);
            return response.data;
        } catch (error) {
            logger.error(`Erreur lors du redémarrage du conteneur ${containerId} sur ${nodeName}:`, error.message);
            throw error;
        }
    }

    /**
     * Recherche un conteneur sur tous les nœuds du cluster
     * Utile pour détecter les migrations de conteneurs
     */
    async findContainer(containerId) {
        try {
            logger.debug(`Recherche du conteneur ${containerId} sur tous les nœuds...`);
            
            // Récupérer la liste de tous les nœuds
            const nodes = await this.getNodes();
            
            for (const node of nodes) {
                try {
                    // Vérifier si le conteneur existe sur ce nœud
                    const containers = await this.getContainers(node.node);
                    const container = containers.find(c => c.vmid == containerId);
                    
                    if (container) {
                        logger.info(`Conteneur ${containerId} trouvé sur le nœud ${node.node}`);
                        return {
                            node: node.node,
                            container: container
                        };
                    }
                } catch (nodeError) {
                    logger.debug(`Erreur lors de la recherche sur ${node.node}:`, nodeError.message);
                    continue;
                }
            }
            
            logger.warn(`Conteneur ${containerId} non trouvé sur aucun nœud`);
            return null;
            
        } catch (error) {
            logger.error(`Erreur lors de la recherche du conteneur ${containerId}:`, error.message);
            throw error;
        }
    }

    /**
     * Récupère la liste complète de tous les conteneurs du cluster
     * avec leur nœud associé
     */
    async getAllContainers() {
        try {
            logger.debug('Récupération de tous les conteneurs du cluster...');
            
            const nodes = await this.getNodes();
            const allContainers = [];
            
            for (const node of nodes) {
                try {
                    const containers = await this.getContainers(node.node);
                    containers.forEach(container => {
                        allContainers.push({
                            ...container,
                            node: node.node,
                            key: `${container.vmid}_${container.name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_')}`
                        });
                    });
                } catch (nodeError) {
                    logger.warn(`Erreur lors de la récupération des conteneurs sur ${node.node}:`, nodeError.message);
                    continue;
                }
            }
            
            logger.debug(`${allContainers.length} conteneurs trouvés dans le cluster`);
            return allContainers;
            
        } catch (error) {
            logger.error('Erreur lors de la récupération de tous les conteneurs:', error.message);
            throw error;
        }
    }

    /**
     * Déclenche un backup pour un conteneur ou VM
     * @param {string} nodeName - Nom du nœud
     * @param {string} vmid - ID du conteneur/VM
     * @param {Object} options - Options de backup
     */
    async startBackup(nodeName, vmid, options = {}) {
        try {
            const backupData = {
                vmid: String(vmid), // S'assurer que vmid est une string
                storage: options.storage || process.env.PROXMOX_BACKUP_STORAGE || 'local',
                mode: options.mode || process.env.PROXMOX_BACKUP_MODE || 'stop',
                compress: options.compress || process.env.PROXMOX_BACKUP_COMPRESS || 'zstd',
                remove: options.remove !== undefined ? options.remove : (process.env.PROXMOX_BACKUP_REMOVE || '0'),
                ...options
            };

            logger.info(`🔄 Démarrage du backup pour ${vmid} sur ${nodeName} (storage: ${backupData.storage})`);
            logger.info(`📋 Paramètres de backup: ${JSON.stringify(backupData)}`);
            
            const response = await this.makeRequest(`/nodes/${nodeName}/vzdump`, 'POST', backupData);
            
            if (response && (response.data || response)) {
                const taskId = response.data || response;
                logger.info(`✅ Backup démarré avec l'ID de tâche: ${taskId}`);
                return {
                    success: true,
                    taskId: taskId,
                    vmid: vmid,
                    node: nodeName
                };
            }
            
            throw new Error('Réponse API invalide pour le démarrage du backup');
            
        } catch (error) {
            logger.error(`❌ Erreur lors du démarrage du backup pour ${vmid}:`, error.message);
            throw error;
        }
    }

    /**
     * Récupère l'état d'une tâche de backup
     * @param {string} nodeName - Nom du nœud
     * @param {string} taskId - ID de la tâche
     */
    async getTaskStatus(nodeName, taskId) {
        try {
            const response = await this.makeRequest(`/nodes/${nodeName}/tasks/${taskId}/status`);
            
            if (response.data) {
                const task = response.data;
                return {
                    status: task.status, // running, stopped
                    exitstatus: task.exitstatus, // OK, ERROR
                    type: task.type,
                    id: task.id,
                    pid: task.pid,
                    pstart: task.pstart,
                    starttime: task.starttime,
                    endtime: task.endtime,
                    user: task.user
                };
            }
            
            return null;
        } catch (error) {
            logger.error(`Erreur lors de la récupération du statut de la tâche ${taskId}:`, error.message);
            throw error;
        }
    }

    /**
     * Récupère les logs d'une tâche de backup
     * @param {string} nodeName - Nom du nœud  
     * @param {string} taskId - ID de la tâche
     * @param {number} start - Ligne de début (optionnel)
     * @param {number} limit - Nombre de lignes (optionnel)
     */
    async getTaskLog(nodeName, taskId, start = 0, limit = 500) {
        try {
            const params = start ? `?start=${start}&limit=${limit}` : '';
            const response = await this.makeRequest(`/nodes/${nodeName}/tasks/${taskId}/log${params}`);
            
            if (response.data) {
                return response.data.map(log => ({
                    line: log.n,
                    text: log.t
                }));
            }
            
            return [];
        } catch (error) {
            logger.error(`Erreur lors de la récupération des logs de la tâche ${taskId}:`, error.message);
            return [];
        }
    }

    /**
     * Liste toutes les tâches actives ou récentes
     * @param {string} nodeName - Nom du nœud
     * @param {string} typefilter - Filtre par type (vzdump, etc.)
     * @param {string} source - Source des tâches (active, archive, all)
     */
    async getTasks(nodeName, typefilter = null, source = null) {
        try {
            let endpoint = `/nodes/${nodeName}/tasks`;
            const params = [];
            
            if (typefilter) {
                params.push(`typefilter=${typefilter}`);
            }
            
            if (source) {
                params.push(`source=${source}`);
            }
            
            if (params.length > 0) {
                endpoint += `?${params.join('&')}`;
            }
            
            const response = await this.makeRequest(endpoint);
            
            if (response.data) {
                return response.data.map(task => ({
                    upid: task.upid,
                    type: task.type,
                    id: task.id,
                    user: task.user,
                    status: task.status,
                    starttime: task.starttime,
                    endtime: task.endtime,
                    exitstatus: task.exitstatus,
                    pid: task.pid
                }));
            }
            
            return [];
        } catch (error) {
            logger.error(`Erreur lors de la récupération des tâches pour ${nodeName}:`, error.message);
            return [];
        }
    }

    /**
     * Récupère toutes les tâches vzdump actives de tous les nœuds
     */
    async getActiveBackupTasks() {
        try {
            const nodes = await this.getNodes();
            const activeBackupTasks = [];
            
            for (const node of nodes) {
                try {
                    // Récupérer uniquement les tâches actives de type vzdump
                    const tasks = await this.getTasks(node.node, 'vzdump', 'active');
                    
                    // Ajouter le nom du nœud à chaque tâche
                    const tasksWithNode = tasks.map(task => ({
                        ...task,
                        nodeName: node.node
                    }));
                    
                    activeBackupTasks.push(...tasksWithNode);
                    
                } catch (nodeError) {
                    logger.warn(`Impossible de récupérer les tâches vzdump actives du nœud ${node.node}:`, nodeError.message);
                }
            }
            
            logger.debug(`Trouvé ${activeBackupTasks.length} tâches vzdump actives sur ${nodes.length} nœuds`);
            return activeBackupTasks;
            
        } catch (error) {
            logger.error('Erreur lors du scan des tâches vzdump actives:', error.message);
            return [];
        }
    }

    // /**
    //  * Liste les backups existants
    //  * @param {string} nodeName - Nom du nœud
    //  * @param {string} storage - Nom du stockage
    //  */
    // async getBackups(nodeName, storage = 'local') {
    //     try {
    //         const response = await this.makeRequest(`/nodes/${nodeName}/storage/${storage}/content?content=backup`);
            
    //         if (response.data) {
    //             return response.data.map(backup => ({
    //                 volid: backup.volid,
    //                 vmid: backup.vmid,
    //                 size: backup.size,
    //                 ctime: backup.ctime, // Date de création
    //                 format: backup.format,
    //                 notes: backup.notes
    //             }));
    //         }
            
    //         return [];
    //     } catch (error) {
    //         logger.error(`Erreur lors de la récupération des backups sur ${storage}:`, error.message);
    //         return [];
    //     }
    // }

    /**
     * Parse les informations d'un backup depuis les logs
     * @param {Array} logs - Logs de la tâche
     */
    parseBackupInfo(logs) {
        const info = {
            size: null,
            duration: null,
            speed: null,
            compression: null
        };

        for (const log of logs) {
            const text = log.text.toLowerCase();
            
            // Taille du backup
            if (text.includes('archive file size:')) {
                const sizeMatch = text.match(/archive file size:\s*([\d.,]+)\s*([A-Za-z]+)/);
                if (sizeMatch) {
                    // Convertir la taille en octets pour normaliser (optionnel)
                    const value = parseFloat(sizeMatch[1].replace(',', '.'));
                    const unit = sizeMatch[2].toUpperCase();
                    let gigabytes = 0;
                    if (unit === 'MB') gigabytes = value / 1024;
                    else if (unit === 'GB') gigabytes = value;
                    else if (unit === 'TB') gigabytes = value * 1024;
                    else if (unit === 'KB') gigabytes = value / 1024 / 1024;
                    info.size = gigabytes.toFixed(2); // en GiB
                }
            }

            // Durée
            if (text.includes('finished backup of vm') && text.includes('(')) {
                const durationMatch = text.match(/\((\d+:\d+:\d+)\)/);
                if (durationMatch) {
                    info.duration = durationMatch[1];
                    info.duration_seconds = durationMatch[1].split(':').reduce((acc, time) => (60 * acc) + parseInt(time, 10), 0);
                }
            }
            
            // Vitesse moyenne - text: "INFO: Total bytes written: 2116208640 (2.0GiB, 24MiB/s)"
            if (text.includes('total bytes written')) {
                const match = text.match(/total bytes written:\s*(\d+)\s*\(([\d.]+)\s*([A-Za-z]+),\s*([\d.]+)\s*([A-Za-z]+\/s)\)/i);
                if (match) info.total_size = (parseInt(match[1], 10) / (1024 * 1024 * 1024)).toFixed(2); // en GiB
            }
        }

        info.compression = info.size && info.total_size ? ((info.total_size - info.size) / info.total_size).toFixed(2) : null;
        info.compression_ratio = info.size && info.total_size ? (info.total_size / info.size).toFixed(2) : null;
        info.speed = info.duration_seconds && info.total_size ? (info.total_size*1024 / info.duration_seconds).toFixed(2) + ' MiB/s' : null;

        return info;
    }
}

module.exports = ProxmoxAPI;