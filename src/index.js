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
        this.updateInterval = (parseInt(process.env.UPDATE_INTERVAL) || 30) * 1000;
        this.nodes = new Map();
        this.containers = new Map(); // Pour stocker les conteneurs découverts
        this.activeBackups = new Map(); // Pour suivre les backups en cours
        this.updateTimer = null;
        this.refreshTimer = null; // Timer pour le rafraîchissement de la liste des conteneurs
        this.backupTimer = null; // Timer pour le suivi des backups
        this.refreshInterval = (parseInt(process.env.REFRESH_INTERVAL) || 300) * 1000; // 5 minutes par défaut
        this.backupCheckInterval = (parseInt(process.env.PROXMOX_BACKUP_CHECK_INTERVAL) || 10) * 1000; // Vérifier les backups
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

            // Démarrage du rafraîchissement périodique de la liste des conteneurs
            this.startPeriodicRefresh();

            // Démarrage de la surveillance des backups
            this.startBackupMonitoring();

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

            // Arrêter le rafraîchissement périodique
            if (this.refreshTimer) {
                clearInterval(this.refreshTimer);
                this.refreshTimer = null;
                logger.debug('Timer de rafraîchissement arrêté');
            }

            // Arrêter la surveillance des backups
            if (this.backupTimer) {
                clearInterval(this.backupTimer);
                this.backupTimer = null;
                logger.debug('Timer de surveillance backups arrêté');
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
                                logger.info(`Nouveau conteneur découvert: ${containerDetails.key} sur ${nodeName}`);
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

            try {
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
                // Vérifier si c'est une erreur de migration
                if (error.message === 'CONTAINER_NOT_FOUND') {
                    logger.warn(`Conteneur ${containerKey} non trouvé sur ${containerInfo.node} - recherche sur les autres nœuds...`);
                    
                    const foundContainer = await this.proxmox.findContainer(containerInfo.vmid);
                    if (foundContainer) {
                        const oldNode = containerInfo.node;
                        logger.info(`🔄 Migration détectée: conteneur ${containerInfo.vmid} déplacé de ${oldNode} vers ${foundContainer.node}`);
                        
                        // Mettre à jour l'association nœud-conteneur
                        const updatedContainerInfo = {
                            ...containerInfo,
                            node: foundContainer.node
                        };
                        this.containers.set(containerKey, updatedContainerInfo);
                        
                        // Récupérer les nouvelles données du conteneur
                        const containerData = await this.proxmox.getContainerStatus(foundContainer.node, containerInfo.vmid);
                        if (containerData && !containerInfo.isIgnore) {
                            // Mettre à jour la configuration HA avec le nouveau nœud
                            await this.discovery.updateContainerDiscoveryAfterMigration(containerData, oldNode);
                            
                            // Publier les nouvelles données
                            await this.mqtt.publishContainerData(containerKey, containerData);
                            await this.discovery.publishContainerAvailability(containerKey, 'online');
                            
                            logger.info(`✅ Conteneur ${containerKey} mis à jour après migration vers ${foundContainer.node}`);
                        }
                    } else {
                        logger.error(`❌ Conteneur ${containerInfo.vmid} non trouvé sur aucun nœud du cluster`);
                        await this.discovery.publishContainerAvailability(containerKey, 'offline');
                    }
                } else {
                    throw error; // Relancer si ce n'est pas une erreur de migration
                }
            }
        } catch (error) {
            logger.error(`Erreur lors de la mise à jour du conteneur ${containerKey}:`, error.message);
            await this.discovery.publishContainerAvailability(containerKey, 'offline');
        }
    }

    async handleCommand(topic, payload) {
        if (!payload) {
            logger.warn(`Commande reçue sans payload: ${topic}`);
            return;
        }

        // Vérifier que le payload est un JSON valide
        let jpayload;
        try {
            jpayload = JSON.parse(payload);
        } catch (e) {
            logger.warn(`Payload JSON invalide pour la commande sur ${topic}: ${e.message}`);
            return;
        }

        try {
            const topicParts = topic.split('/');

            // Déterminer si c'est une commande pour un nœud ou un conteneur
            if (topicParts[1] === 'lxc') {
                // Commande pour un conteneur: proxmox2mqtt/lxc/{containerName}/command/{action}
                const containerKey = topicParts[2];
                if (!jpayload.action) {
                    logger.warn(`Payload de commande invalide pour le conteneur ${containerKey}: champ "action" manquant`);
                    return;
                }
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
                    case 'backup':
                        try {
                            const backupResult = await this.proxmox.startBackup(containerInfo.node, containerInfo.vmid);
                            
                            if (backupResult.success) {
                                // Enregistrer le backup pour le suivi
                                const backupKey = `${containerInfo.node}_${containerInfo.vmid}_${backupResult.taskId}`;
                                this.activeBackups.set(backupKey, {
                                    key: containerKey,
                                    node: containerInfo.node,
                                    vmid: containerInfo.vmid,
                                    taskId: backupResult.taskId,
                                    status: 'running',
                                    startTime: Date.now(),
                                    lastCheck: Date.now()
                                });
                                
                                logger.info(`📝 Backup enregistré pour suivi: ${containerKey} (task: ${backupResult.taskId})`);
                                
                                // Publier le statut initial
                                await this.publishBackupStatus(containerKey, {
                                    status: 'running',
                                    progress: 'started',
                                    task_id: backupResult.taskId,
                                    start_time: Date.now()
                                });
                            }
                        } catch (backupError) {
                            logger.error(`Erreur backup pour ${containerKey}:`, backupError.message);
                            
                            // Publier l'erreur avec la structure unifiée
                            await this.publishBackupStatus(containerKey, {
                                status: 'error',
                                progress: 'failed',
                                task_id: null,
                                start_time: Date.now(),
                                end_time: Date.now(),
                                result: null,
                                size: null,
                                duration: null,
                                speed: null,
                                compression: null,
                                error: backupError.message
                            });
                        }
                        break;
                    default:
                        logger.warn(`Action inconnue pour conteneur: ${action}`);
                }
            } else if (topicParts[1] === 'nodes') {
                // Commande pour un nœud: proxmox2mqtt/nodes/{nodeName}/command
                const nodeName = topicParts[2];
                if (!jpayload.action) {
                    logger.warn(`Payload de commande invalide pour le conteneur ${containerKey}: champ "action" manquant`);
                    return;
                }
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

        logger.info(`Mise à jour périodique configurée (${this.updateInterval / 1000}s)`);
    }

    startPeriodicRefresh() {
        this.refreshTimer = setInterval(async () => {
            await this.refreshAllContainers();
        }, this.refreshInterval);

        logger.info(`Rafraîchissement périodique des conteneurs configuré (${this.refreshInterval / 1000}s)`);
    }

    startBackupMonitoring() {
        this.backupTimer = setInterval(async () => {
            await this.scanForNewBackups(); // Nouveau: scanner les nouvelles sauvegardes
            await this.checkActiveBackups(); // Vérifier l'état des backups actifs
        }, this.backupCheckInterval);

        logger.info(`Surveillance des backups configurée (${this.backupCheckInterval / 1000}s)`);
    }

    /**
     * Scanne et détecte les nouvelles tâches vzdump actives depuis Proxmox
     */
    async scanForNewBackups() {
        try {
            // Récupérer uniquement les tâches vzdump actives
            const activeBackupTasks = await this.proxmox.getActiveBackupTasks();
            
            logger.debug(`Scan backup: ${activeBackupTasks.length} tâches vzdump actives trouvées`);
            
            for (const task of activeBackupTasks) {
                const taskKey = `${task.nodeName}_${task.upid}`;
                
                // Si cette tâche n'est pas encore suivie, l'ajouter
                if (!this.activeBackups.has(taskKey)) {
                    const vmid = task.id;

                    if (vmid) {
                        // Chercher la clé du conteneur correspondant dans this.containers
                        const containerEntry = Array.from(this.containers.entries()).find(
                            ([, info]) => info.vmid?.toString() === vmid.toString()
                        );
                        const containerKey = containerEntry ? containerEntry[0] : null;
                        if (!containerKey) {
                            logger.debug(`Aucune clé de conteneur trouvée pour vmid=${vmid}`);
                            return; // On sort de la méthode si non trouvé
                        }
                        
                        // Vérifier s'il y a une ancienne sauvegarde suivie pour ce conteneur
                        const existingBackupKeys = Array.from(this.activeBackups.keys()).filter(key => {
                            const backupInfo = this.activeBackups.get(key);
                            return backupInfo.key === containerKey;
                        });
                        
                        // Supprimer les anciennes sauvegardes de ce conteneur
                        for (const oldKey of existingBackupKeys) {
                            const oldBackup = this.activeBackups.get(oldKey);
                            logger.info(`🔄 Remplacement de l'ancienne sauvegarde ${oldBackup.taskId} par la nouvelle active ${task.upid} pour ${containerKey}`);
                            this.activeBackups.delete(oldKey);
                        }
                        
                        // Créer une entrée de suivi pour cette sauvegarde active
                        const backupInfo = {
                            key: containerKey,
                            node: task.nodeName,
                            vmid: vmid,
                            taskId: task.upid,
                            startTime: task.starttime,
                            status: task.status,
                            lastCheck: Date.now(),
                            detectedFromProxmox: true
                        };
                        
                        this.activeBackups.set(taskKey, backupInfo);
                        
                        logger.info(`⏳ Nouvelle sauvegarde active détectée: ${vmid} sur ${task.nodeName} (${task.status})`);
                        
                        // Publier le statut initial (forcément "running" puisque active)
                        await this.publishBackupStatus(backupInfo.key, {
                            status: 'running',
                            progress: 'in_progress',
                            task_id: task.upid,
                            start_time: task.starttime,
                            end_time: null,
                            result: null,
                            size: null,
                            duration: null,
                            duration_human: null,
                            speed: null,
                            compression: null,
                            compression_ratio: null
                        });
                    } else {
                        logger.debug(`Impossible d'extraire l'ID conteneur de la tâche active: ${task.upid}`);
                    }
                }
            }
            
        } catch (error) {
            logger.error('Erreur lors du scan des nouvelles sauvegardes actives:', error.message);
        }
    }

    // /**
    //  * Extrait l'ID du conteneur depuis une tâche vzdump
    //  */
    // extractContainerIdFromTask(task) {
    //     try {
    //         // L'UPID a le format: UPID:node:PID:starttime:type:id:user@realm:
    //         // Mais en réalité il semble être: UPID:node:PID:starttime:timestamp:type:id:user@realm:
    //         const upidParts = task.upid.split(':');
    //         if (upidParts.length >= 7 && upidParts[5] === 'vzdump') {
    //             return upidParts[6]; // ID du conteneur/VM
    //         }
            
    //         // Fallback: utiliser task.id si disponible
    //         if (task.id) {
    //             return task.id.toString();
    //         }
            
    //         return null;
    //     } catch (error) {
    //         logger.debug(`Impossible d'extraire l'ID du conteneur depuis la tâche:`, error.message);
    //         return null;
    //     }
    // }

    /**
     * Vérifie l'état des backups actifs et met à jour MQTT
     */
    async checkActiveBackups() {
        try {
            const now = Date.now();
            const backupsToRemove = [];

            for (const [backupKey, backupInfo] of this.activeBackups) {
                try {
                    const taskStatus = await this.proxmox.getTaskStatus(backupInfo.node, backupInfo.taskId);
                    
                    if (taskStatus) {
                        // Mettre à jour le statut
                        backupInfo.status = taskStatus.status;
                        backupInfo.lastCheck = now;

                        // Publier le statut sur MQTT
                        await this.publishBackupStatus(backupInfo.key, {
                            status: taskStatus.status,
                            progress: taskStatus.status === 'running' ? 'in_progress' : taskStatus.exitstatus || 'unknown',
                            // task_id: backupInfo.taskId,
                            start_time: taskStatus.starttime || backupInfo.startTime,
                            result: null,
                            initial_size: null,
                            size: null,
                            duration: null,
                            duration_seconds: null,
                            speed: null,
                            compression: null,
                            compression_ratio: null
                        });

                        // Si le backup est terminé
                        if (taskStatus.status === 'stopped') {
                            logger.info(`Backup terminé pour ${backupInfo.key} (${taskStatus.exitstatus})`);
                            
                            // Récupérer les logs finaux pour extraire les informations
                            const logs = await this.proxmox.getTaskLog(backupInfo.node, backupInfo.taskId);
                            const backupDetails = this.proxmox.parseBackupInfo(logs);
                            
                            // Publier les informations finales avec la méthode unifiée
                            await this.publishBackupStatus(backupInfo.key, {
                                status: 'completed',
                                progress: taskStatus.exitstatus === 'OK' ? 'success' : 'failed',
                                // task_id: backupInfo.taskId,
                                start_time: taskStatus.starttime || backupInfo.startTime,
                                result: taskStatus.exitstatus || null,
                                initial_size: backupDetails.total_size || null,
                                size: backupDetails.size || null,
                                duration: backupDetails.duration || null,
                                duration_seconds: backupDetails.duration_seconds || null,
                                speed: backupDetails.speed || null,
                                compression: backupDetails.compression || null,
                                compression_ratio: backupDetails.compression_ratio || null
                            });

                            // Marquer pour suppression
                            backupsToRemove.push(backupKey);
                        }
                    } else {
                        // Pas de statut trouvé, peut-être terminé
                        if (now - backupInfo.lastCheck > 60000) { // Plus de 1 minute sans statut
                            logger.warn(`Statut backup introuvable pour ${backupInfo.containerKey}, suppression du suivi`);
                            backupsToRemove.push(backupKey);
                        }
                    }
                } catch (error) {
                    logger.error(`Erreur lors de la vérification du backup ${backupKey}:`, error.message);
                    
                    // Si erreur persistante, supprimer après 5 minutes
                    if (now - backupInfo.lastCheck > 300000) {
                        backupsToRemove.push(backupKey);
                    }
                }
            }

            // Supprimer les backups terminés
            backupsToRemove.forEach(key => {
                this.activeBackups.delete(key);
                logger.debug(`Suppression du suivi backup: ${key}`);
            });

        } catch (error) {
            logger.error('Erreur lors de la vérification des backups actifs:', error.message);
        }
    }

    /**
     * Publie le statut d'un backup (en cours ou terminé)
     */
    async publishBackupStatus(containerKey, status) {
        try {
            const topic = `proxmox2mqtt/lxc/${containerKey}/backup_status`;
            
            // Structure JSON unifiée pour tous les états
            const backupStatus = {
                status: status.status,
                progress: status.progress,
                task_id: status.task_id,
                start_time: status.start_time,
                result: status.result || null,
                size: status.size || null,
                duration: status.duration || null,
                duration_seconds: status.duration_seconds || null,
                speed: status.speed || null,
                compression: status.compression || null,
                compression_ratio: status.compression_ratio || null,
                initial_size: status.initial_size || null,
                error: status.error || null,
                timestamp: new Date().toISOString()
            };

            await this.mqtt.publish(topic, JSON.stringify(backupStatus), { retain: true });

            // Log des informations de backup si c'est un backup terminé
            if (status.status === 'completed') {
                logger.info(`📊 Backup ${containerKey} terminé: ${status.result} | Taille: ${status.size}GB | Durée: ${status.duration}`);
            }

        } catch (error) {
            logger.error(`Erreur lors de la publication du statut backup pour ${containerKey}:`, error.message);
        }
    }

    /**
     * Rafraîchit la liste complète des conteneurs sur tous les nœuds
     * Utile pour détecter les migrations et les nouveaux/supprimés conteneurs
     */
    async refreshAllContainers() {
        logger.info('🔄 Rafraîchissement complet de la liste des conteneurs...');
        
        try {
            const allNodes = await this.proxmox.getNodes();
            const newContainerMap = new Map();
            let totalContainers = 0;

            // Parcourir tous les nœuds pour récupérer leurs conteneurs
            for (const node of allNodes) {
                try {
                    const containers = await this.proxmox.getContainers(node.node);

                    for (const container of containers) {
                        const containerWithNode = {
                            ...container,
                            node: node.node
                        };
                        
                        newContainerMap.set(container.key, containerWithNode);
                        totalContainers++;
                        
                        // Vérifier si c'est un nouveau conteneur ou une migration
                        const existingContainer = this.containers.get(container.key);
                        if (!existingContainer) {
                            logger.info(`➕ Nouveau conteneur détecté: ${container.name} (${container.vmid}) sur ${node.node}`);
                            // Publier la découverte pour le nouveau conteneur
                            await this.discovery.publishContainerDiscovery(containerWithNode);
                            await this.discovery.publishContainerAvailability(container.key, 'online');
                        } else if (existingContainer.node !== node.node) {
                            logger.info(`🔄 Migration détectée: ${container.name} (${container.vmid}) déplacé de ${existingContainer.node} vers ${node.node}`);
                            // Mettre à jour la découverte après migration
                            await this.discovery.updateContainerDiscoveryAfterMigration(containerWithNode, existingContainer.node);
                        } else {
                            // Conteneur existant sans changement de nœud - republier la découverte pour s'assurer de la cohérence
                            await this.discovery.publishContainerDiscovery(containerWithNode);
                        }
                    }
                } catch (error) {
                    logger.error(`Erreur lors de la récupération des conteneurs du nœud ${node.node}:`, error.message);
                }
            }

            // Détecter les conteneurs supprimés
            for (const [containerKey, container] of this.containers) {
                if (!newContainerMap.has(containerKey)) {
                    logger.info(`➖ Conteneur supprimé: ${container.name}`);
                    await this.discovery.removeContainerDiscovery(containerKey);
                }
            }

            // Mettre à jour la map des conteneurs
            this.containers = newContainerMap;
            
            logger.info(`✅ Rafraîchissement terminé: ${totalContainers} conteneurs trouvés sur ${allNodes.length} nœuds`);
            
            // Republier également la découverte des nœuds pour maintenir la cohérence
            for (const node of allNodes) {
                try {
                    await this.discovery.publishNodeDiscovery(node);
                    await this.discovery.publishAvailability(node.node, 'online');
                } catch (error) {
                    logger.error(`Erreur lors de la republication de la découverte du nœud ${node.node}:`, error.message);
                }
            }
            
        } catch (error) {
            logger.error('Erreur lors du rafraîchissement des conteneurs:', error);
        }
    }
}

// Démarrage de l'application
const app = new Proxmox2MQTT();
app.start().catch(error => {
    logger.error('Erreur fatale:', error);
    process.exit(1);
});

module.exports = Proxmox2MQTT;