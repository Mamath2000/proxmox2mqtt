const logger = require('../utils/logger');

class BackupManager {
    constructor(proxmoxAPI, mqttClient) {
        this.proxmox = proxmoxAPI;
        this.mqtt = mqttClient;
        this.activeBackups = new Map();      // taskKey => { node, taskId, startTime, status, lastCheck, publishedVMs, lastStatus }
        this.containers = new Map();         // Injecté depuis l’orchestrateur (index.js)
        this.checkInterval = (parseInt(process.env.PROXMOX_BACKUP_CHECK_INTERVAL) || 10) * 1000;
        this.timer = null;
    }

    /**
     * Démarre la surveillance des tâches de backup Proxmox.
     * @param {Map<string, Object>} containersMap - Map des conteneurs suivis (key => info)
     */
    start(containersMap) {
        this.containers = containersMap;
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(async () => {
            await this.scanForNewBackups();
            await this.checkActiveBackups();
        }, this.checkInterval);
        logger.info(`Surveillance des backups démarrée (${this.checkInterval / 1000}s)`);
    }

    /**
     * Arrête la surveillance des backups (timer d’analyse).
     */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            logger.debug('Surveillance des backups arrêtée');
        }
    }

    /**
     * Récupère les tâches vzdump actives (source=active) et initialise le suivi
     * pour chaque nouvelle tâche détectée.
     */
    async scanForNewBackups() {
        try {
            const activeBackupTasks = await this.proxmox.getActiveBackupTasks();
            logger.debug(`Scan backup: ${activeBackupTasks.length} tâches vzdump actives`);

            for (const task of activeBackupTasks) {
                const taskKey = `${task.nodeName}_${task.upid}`;
                if (this.activeBackups.has(taskKey)) continue;

                logger.info(`⏳ Nouvelle tâche backup active: ${task.upid} (${task.nodeName})`);
                this.activeBackups.set(taskKey, {
                    node: task.nodeName,
                    taskId: task.upid,
                    startTime: task.starttime,
                    status: task.status,
                    lastCheck: Date.now(),
                    publishedVMs: new Set(),
                    lastStatus: {}          // vmid => 'running' | 'completed' | 'error'
                });

                // Analyse immédiate
                await this.analyzeBackupLogs(this.activeBackups.get(taskKey));
            }
        } catch (error) {
            logger.error('Erreur scan sauvegardes actives:', error.message);
        }
    }

    /**
     * Analyse les logs d'une tâche de backup et publie l'état des VM impliquées.
     * @param {Object} backupInfo - Métadonnées internes de la tâche suivie
     */
    async analyzeBackupLogs(backupInfo) {
        try {
            const logs = await this.proxmox.getTaskLog(backupInfo.node, backupInfo.taskId);
            if (!logs || logs.length === 0) {
                logger.debug(`Aucun log pour ${backupInfo.taskId} (encore vide)`);
                return;
            }

            const vmLogPortions = this.splitLogsByVM(logs);
            for (const [vmid, vmLogs] of vmLogPortions) {
                await this.processVmLogs(vmid, vmLogs, backupInfo);
            }

            backupInfo.lastCheck = Date.now();
        } catch (error) {
            logger.error(`Analyse logs backup ${backupInfo.taskId} échouée: ${error.message}`);
        }
    }

    /**
     * Découpe les logs en blocs par VM sans fermer prématurément
     * - Un bloc commence à "Starting Backup of VM X"
     * - Il se termine juste avant le prochain "Starting Backup..." ou à la fin
     * - On n’arrête plus sur "Finished" ou "ERROR", on garde aussi les lignes suivantes ("Failed at", "Backup finished at")
     */
    splitLogsByVM(logs) {
        const vmLogPortions = new Map();
        let currentVmid = null;
        let currentVmLogs = [];

        for (const log of logs) {
            const line = (log && typeof log.text === 'string') ? log.text : '';
            if (!line) continue;

            const startMatch = line.match(/INFO:\s+Starting Backup of VM (\d+)/i);
            if (startMatch) {
                // Flush précédent
                if (currentVmid && currentVmLogs.length) {
                    vmLogPortions.set(currentVmid, [...currentVmLogs]);
                }
                currentVmid = startMatch[1];
                currentVmLogs = [log];
                continue;
            }

            if (currentVmid) {
                currentVmLogs.push(log);
            }
        }

        // Flush final
        if (currentVmid && currentVmLogs.length) {
            vmLogPortions.set(currentVmid, [...currentVmLogs]);
        }

        return vmLogPortions;
    }

    /**
     * Traite un bloc de logs pour une VM :
     * - Appelle parseBackupInfo (qui retourne déjà status/result/error)
     * - Anti-doublon de publication
     */
    async processVmLogs(vmid, vmLogs, backupInfo) {
        try {
            const vmBackupInfo = this.parseBackupInfo(vmLogs);

            // Injecter contexte
            vmBackupInfo.vmid = vmid;
            vmBackupInfo.taskId = backupInfo.taskId;
            vmBackupInfo.node = backupInfo.node;

            const publicationKey = `${backupInfo.taskId}_${vmid}`;
            const changed =
                !backupInfo.publishedVMs.has(publicationKey) ||
                backupInfo.lastStatus[vmid] !== vmBackupInfo.status;

            if (!changed) return;

            // Résolution du container
            const containerEntry = Array.from(this.containers.entries()).find(
                ([, info]) => info.vmid?.toString() === vmid.toString()
            );
            if (!containerEntry) {
                logger.info(`(Backup) VM/CT ${vmid} ignorée (introuvable dans containers, statut=${vmBackupInfo.status})`);
                return;
            }

            const containerKey = containerEntry[0];
            await this.publishVmBackupStatus(vmid, vmBackupInfo, backupInfo, containerKey);

            backupInfo.publishedVMs.add(publicationKey);
            backupInfo.lastStatus[vmid] = vmBackupInfo.status;

        } catch (error) {
            logger.error(`processVmLogs(${vmid}) échec: ${error.message}`);
        }
    }

    /**
     * Analyse complète d’un segment de log d’une VM.
     * Rassemble:
     *  - status: running | completed | error
     *  - result: OK | ERROR | null
     *  - error: message brut si échec
     *  - size / total_size / compression / durée / vitesse / startTime / endTime
     */
    parseBackupInfo(logs) {
        const info = {
            status: 'running',
            result: null,
            error: null,
            size: null,
            total_size: null,
            duration: null,
            duration_seconds: null,
            speed: null,
            compression: null,
            compression_ratio: null,
            startTime: null,
            endTime: null
        };

        if (!Array.isArray(logs) || logs.length === 0) return info;

        let sawFinished = false;
        let sawError = false;
        let errorLine = null;
        let finishedDuration = null;

        for (const log of logs) {
            const line = (log && typeof log.text === 'string') ? log.text : '';
            if (!line) continue;
            const lower = line.toLowerCase();

            // Détection statut
            // ERROR
            const errMatch = line.match(/ERROR:\s+Backup of VM\s+(\d+)\s+failed/i);
            if (errMatch) {
                sawError = true;
                errorLine = line;
            }

            // Finished (avec durée)
            const finMatch = line.match(/INFO:\s+Finished Backup of VM\s+(\d+).*?\((\d+:\d+:\d+)\)/i);
            if (finMatch) {
                sawFinished = true;
                finishedDuration = finMatch[2];
            }

            // Archive size
            if (lower.includes('archive file size:')) {
                const m = line.match(/archive file size:\s*([\d.,]+)\s*([A-Za-z]+)/i);
                if (m) {
                    const num = parseFloat(m[1].replace(',', '.'));
                    if (isFinite(num)) {
                        const unit = m[2].toUpperCase();
                        let gib = null;
                        switch (unit) {
                            case 'GB': gib = num; break;
                            case 'MB': gib = num / 1024; break;
                            case 'TB': gib = num * 1024; break;
                            case 'KB': gib = num / 1024 / 1024; break;
                        }
                        if (gib !== null) info.size = gib.toFixed(2);
                    }
                }
            }

            // Start time
            if (lower.includes('backup started at')) {
                const m = line.match(/backup started at (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/i);
                if (m) {
                    // Parse en tant qu'heure locale (sans 'Z' qui force UTC)
                    const ts = Date.parse(m[1].replace(' ', 'T'));
                    if (!isNaN(ts)) info.startTime = ts / 1000;
                }
            }

            // End time
            if (lower.includes('backup finished at')) {
                const m = line.match(/backup finished at (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/i);
                if (m) {
                    const ts = Date.parse(m[1].replace(' ', 'T'));
                    if (!isNaN(ts)) info.endTime = ts / 1000;
                }
            }

            // Total bytes written
            if (lower.includes('total bytes written:')) {
                const m = line.match(/total bytes written:\s*(\d+)\s*\(([\d.]+)\s*([A-Za-z]+),\s*([\d.]+)\s*([A-Za-z/]+)\)/i);
                if (m) {
                    const bytes = parseInt(m[1], 10);
                    if (isFinite(bytes) && bytes > 0) {
                        info.total_size = (bytes / (1024 ** 3)).toFixed(2);
                    }
                }
            }
        }

        // Durée (si vue dans la ligne Finished)
        if (finishedDuration) {
            info.duration = finishedDuration;
            const parts = finishedDuration.split(':').map(p => parseInt(p, 10));
            if (parts.length === 3 && parts.every(n => Number.isInteger(n))) {
                info.duration_seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
            }
        }

        // Statut final
        if (sawError) {
            info.status = 'error';
            info.result = 'ERROR';
            info.error = errorLine;
        } else if (sawFinished) {
            info.status = 'completed';
            info.result = 'OK';
        } else {
            info.status = 'running';
        }

        // Post‑calculs compression & vitesse
        if (info.size && info.total_size) {
            const size = parseFloat(info.size);
            const total = parseFloat(info.total_size);
            if (isFinite(size) && isFinite(total) && total > 0 && size > 0) {
                info.compression = ((total - size) / total * 100).toFixed(0); // %
                info.compression_ratio = (total / size).toFixed(2);
            }
        }

        if (info.duration_seconds && info.total_size) {
            const totalGiB = parseFloat(info.total_size);
            if (isFinite(totalGiB) && totalGiB >= 0) {
                const speedMiBs = (totalGiB * 1024) / info.duration_seconds;
                if (isFinite(speedMiBs)) info.speed = speedMiBs.toFixed(2);  // MiB/s
            }
        }

        return info;
    }

    /**
     * Vérifie périodiquement l’état de toutes les tâches actives (refresh + nettoyage).
     */
    async checkActiveBackups() {
        try {
            const now = Date.now();
            const toRemove = [];

            for (const [backupKey, backupInfo] of this.activeBackups) {
                try {
                    await this.checkSingleBackupTask(backupKey, backupInfo, now, toRemove);
                } catch (e) {
                    logger.error(`Vérification backup ${backupKey} échouée: ${e.message}`);
                    if (now - backupInfo.lastCheck > 300000) toRemove.push(backupKey);
                }
            }

            this.removeCompletedBackups(toRemove);
        } catch (error) {
            logger.error('Erreur checkActiveBackups:', error.message);
        }
    }

    /**
     * Vérifie une tâche spécifique : statut, dernière analyse, fin éventuelle.
     * @param {string} backupKey
     * @param {Object} backupInfo
     * @param {number} now - Timestamp courant (ms)
     * @param {Array<string>} toRemove - Accumulateur des tâches à retirer
     */
    async checkSingleBackupTask(backupKey, backupInfo, now, toRemove) {
        const taskStatus = await this.proxmox.getTaskStatus(backupInfo.node, backupInfo.taskId);
        if (taskStatus) {
            backupInfo.status = taskStatus.status;
            backupInfo.lastCheck = now;
            await this.analyzeBackupLogs(backupInfo);

            if (taskStatus.status === 'stopped') {
                logger.info(`Tâche terminée: ${backupInfo.taskId} (${taskStatus.exitstatus})`);
                
                // Vérifier si la tâche s'est terminée en erreur (arrêt prématuré)
                if (taskStatus.exitstatus && taskStatus.exitstatus !== 'OK') {
                    logger.warn(`Tâche terminée avec erreur: ${backupInfo.taskId} (${taskStatus.exitstatus})`);
                    await this.handleTaskInterruption(backupInfo, taskStatus.exitstatus);
                }
                
                await this.analyzeBackupLogs(backupInfo); // Dernière passe
                toRemove.push(backupKey);
            }
        } else if (now - backupInfo.lastCheck > 60000) {
            logger.warn(`Statut absent >60s: suppression ${backupInfo.taskId}`);
            toRemove.push(backupKey);
        }
    }

    /**
     * Gère une tâche de backup qui s'est terminée en erreur (interruption)
     * Met à jour le statut des VMs concernées à 'error'
     * @param {Object} backupInfo - Informations de la tâche backup
     * @param {string} exitstatus - Code de sortie de la tâche
     */
    async handleTaskInterruption(backupInfo, exitstatus) {
        try {
            logger.info(`🚨 Gestion de l'interruption de la tâche ${backupInfo.taskId} (${exitstatus})`);
            
            // Récupérer les logs pour identifier les VMs concernées
            const logs = await this.proxmox.getTaskLog(backupInfo.node, backupInfo.taskId);
            const vmLogPortions = this.splitLogsByVM(logs);
            
            // Pour chaque VM détectée dans les logs
            for (const [vmid, vmLogs] of vmLogPortions) {
                const containerEntry = Array.from(this.containers.entries()).find(
                    ([, info]) => info.vmid?.toString() === vmid.toString()
                );
                
                if (!containerEntry) {
                    logger.debug(`VM ${vmid} ignorée lors de l'interruption (introuvable dans containers)`);
                    continue;
                }
                
                const containerKey = containerEntry[0];
                const vmBackupInfo = this.parseBackupInfo(vmLogs);
                
                // Forcer le statut à 'error' si pas déjà terminé avec succès
                if (vmBackupInfo.status !== 'completed') {
                    vmBackupInfo.status = 'error';
                    vmBackupInfo.result = 'ERROR';
                    vmBackupInfo.error = `Tâche interrompue (${exitstatus})`;
                }
                
                // Injecter contexte
                vmBackupInfo.vmid = vmid;
                vmBackupInfo.taskId = backupInfo.taskId;
                vmBackupInfo.node = backupInfo.node;
                
                // Publier le statut d'erreur
                await this.publishVmBackupStatus(vmid, vmBackupInfo, backupInfo, containerKey);
                
                logger.info(`❌ Backup VM ${vmid} (${containerKey}) marqué en erreur suite à l'interruption`);
            }
            
        } catch (error) {
            logger.error(`Erreur lors de la gestion de l'interruption ${backupInfo.taskId}:`, error.message);
        }
    }

    /**
     * Retire les tâches terminées ou invalides de la map activeBackups.
     * @param {Array<string>} list
     */
    removeCompletedBackups(list) {
        for (const key of list) {
            this.activeBackups.delete(key);
            logger.debug(`Suppression suivi backup ${key}`);
        }
    }

    /**
     * Démarre un backup manuel d’un conteneur/VM via l’API Proxmox.
     * @param {{node:string, vmid:number|string}} containerInfo
     * @returns {Promise<{success:boolean, taskId:string, vmid:string|number, node:string}>}
     */
    async startBackup(containerInfo) {
        try {
            const res = await this.proxmox.startBackup(containerInfo.node, containerInfo.vmid);
            if (res.success) {
                logger.info(`📝 Backup manuel démarré VMID ${containerInfo.vmid} (${res.taskId})`);
                // La tâche sera détectée automatiquement
                return res;
            }
            throw new Error('Réponse démarrage backup invalide');
        } catch (e) {
            logger.error(`Échec démarrage backup ${containerInfo.vmid}: ${e.message}`);
            throw e;
        }
    }

    /**
     * Publie l’état d’un backup pour une VM (JSON unifié) si changement détecté.
     * @param {string} vmid
     * @param {Object} vmBackupInfo  // Résultat de parseBackupInfo + contexte injecté
     * @param {Object} backupInfo    // Métadonnées de la tâche vzdump
     * @param {string} containerKey  // Clé interne (ex: 170_node_xxx)
     */
    async publishVmBackupStatus(vmid, vmBackupInfo, backupInfo, containerKey) {
        try {
            const mqttPayload = {
                status: vmBackupInfo.status,
                progress: (vmBackupInfo.status === 'running' ? 'in progress' : (vmBackupInfo.status === 'completed' ? 'success' : (vmBackupInfo.status === 'error' ? 'failed' : 'unknown'))),
                task_id: backupInfo.taskId,
                vmid,
                node: vmBackupInfo.node,
                start_time: vmBackupInfo.startTime || null,
                end_time: vmBackupInfo.endTime || null,
                result: vmBackupInfo.result || null,
                size_gib: vmBackupInfo.size || null,
                total_size_gib: vmBackupInfo.total_size || null,
                duration: vmBackupInfo.duration || null,
                duration_seconds: vmBackupInfo.duration_seconds || null,
                speed: vmBackupInfo.speed || null,
                compression: vmBackupInfo.compression || null,
                compression_ratio: vmBackupInfo.compression_ratio || null,
                error: vmBackupInfo.error || null,
                timestamp: new Date().toISOString()
            };

            const topic = `proxmox2mqtt/lxc/${containerKey}/backup_status`;
            await this.mqtt.publish(topic, JSON.stringify(mqttPayload), { retain: true });

            const icon = vmBackupInfo.status === 'running'
                ? '⏳'
                : vmBackupInfo.status === 'completed'
                    ? '✅'
                    : vmBackupInfo.status === 'error'
                        ? '❌'
                        : '🔍';

            logger.info(`${icon} Backup ${vmid} (${containerKey}) => ${vmBackupInfo.status}` +
                (vmBackupInfo.duration ? ` (${vmBackupInfo.duration})` : ''));

        } catch (err) {
            logger.error(`publishVmBackupStatus(${vmid}) échec: ${err.message}`);
        }
    }

}

module.exports = BackupManager;