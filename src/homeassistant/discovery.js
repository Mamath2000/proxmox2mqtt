const logger = require('../utils/logger');

class HomeAssistantDiscovery {
    constructor(mqttClient) {
        this.mqtt = mqttClient;
        this.baseTopic = 'proxmox2mqtt';
    }

    /**
     * Publie la découverte Home Assistant pour un nœud Proxmox
     * @param {Object} node - Objet nœud Proxmox
     */
    async publishNodeDiscovery(node) {
        const nodeName = node.node;
        const deviceInfo = this.getDeviceInfo(nodeName);

        const device = {
            device: deviceInfo,
            origin: { 
                name: "Proxmox2MQTT"
            },
            state_topic: `${this.baseTopic}/nodes/${nodeName}`,
            components: {},
        };
        const availability = {
            topic: `${this.baseTopic}/nodes/${nodeName}/availability`,
            payload_available: 'online',
            payload_not_available: 'offline'
        };

        device.components = {
            // Capteur d'état du nœud
             [`${nodeName}_state`] : this.addBinarySensorDiscovery(nodeName, 'state', {
                                                    name: `State`,
                                                    icon: 'mdi:server',
                                                    device_class: 'connectivity',
                                                    payload_on: 'online',
                                                    payload_off: 'offline',
                                                    state_topic: `${this.baseTopic}/nodes/${nodeName}/availability`,
                                                    value_template: `{{ value }}`,
                                                }),
            // Capteur liste des conteneurs LXC
            [`${nodeName}_lxc_list`]: this.addSensorDiscovery(nodeName, 'lxc_list', {
                                                    name: `LXC Containers List`,
                                                    icon: 'mdi:format-list-bulleted',
                                                    device_class: null,
                                                    unit_of_measurement: null,
                                                    state_class: null,
                                                    availability: availability,
                                                    value_template: `{{ value_json.lxc_list }}`
                                                }),
            // Capteur CPU
            [`${nodeName}_cpu_usage`] : this.addSensorDiscovery(nodeName, 'cpu_usage', {
                                                    name: `CPU Usage`,
                                                    icon: 'mdi:cpu-64-bit',
                                                    device_class: null,
                                                    unit_of_measurement: '%',
                                                    state_class: 'measurement',
                                                    availability: availability
                                                }),
            [`${nodeName}_cpu_cores`] : this.addSensorDiscovery(nodeName, 'cpu_cores', {
                                                    name: `CPU Cores`,
                                                    icon: 'mdi:cpu-64-bit',
                                                    device_class: null,
                                                    unit_of_measurement: null,
                                                    state_class: 'measurement',
                                                    availability: availability
                                                }),
            // Capteur mémoire
            [`${nodeName}_mem_usage`] : this.addSensorDiscovery(nodeName, 'mem_usage', {
                                                    name: `Memory Usage`,
                                                    icon: 'mdi:memory',
                                                    device_class: null,
                                                    unit_of_measurement: '%',
                                                    state_class: 'measurement',
                                                    availability: availability
                                                }),
            [`${nodeName}_mem_total`] : this.addSensorDiscovery(nodeName, 'mem_total', {
                                                    name: `Memory Total`,
                                                    icon: 'mdi:memory',
                                                    device_class: 'data_size',
                                                    unit_of_measurement: 'Gbit',
                                                    value_template: `{{ (value_json.mem_total / 1024 / 1024 / 1024) | round(1) }}`,
                                                    state_class: 'measurement',
                                                    availability: availability
                                                }),
            [`${nodeName}_mem_used`] : this.addSensorDiscovery(nodeName, 'mem_used', {
                                                    name: `Memory Used`,
                                                    icon: 'mdi:memory',
                                                    device_class: 'data_size',
                                                    unit_of_measurement: 'Gbit',
                                                    value_template: `{{ (value_json.mem_used / 1024 / 1024 / 1024) | round(1) }}`,
                                                    state_class: 'measurement',
                                                    availability: availability
                                                }),

            // Capteur disque
            [`${nodeName}_disk_usage`] : this.addSensorDiscovery(nodeName, 'disk_usage', {
                                                    name: `Disk Usage`,
                                                    icon: 'mdi:harddisk',
                                                    device_class: null,
                                                    unit_of_measurement: '%',
                                                    state_class: 'measurement',
                                                    availability: availability
                                                }),
            [`${nodeName}_disk_total`] : this.addSensorDiscovery(nodeName, 'disk_total', {
                                                    name: `Disk Total`,
                                                    icon: 'mdi:harddisk',
                                                    device_class: 'data_size',
                                                    unit_of_measurement: 'Gbit',
                                                    value_template: `{{ (value_json.disk_total / 1024 / 1024 / 1024) | round(2) }}`,
                                                    state_class: 'measurement',
                                                    availability: availability
                                                }),
            [`${nodeName}_disk_used`] : this.addSensorDiscovery(nodeName, 'disk_used', {
                                                    name: `Disk Used`,
                                                    icon: 'mdi:harddisk',
                                                    device_class: 'data_size',
                                                    unit_of_measurement: 'Gbit',
                                                    value_template: `{{ (value_json.disk_used / 1024 / 1024 / 1024) | round(2) }}`,
                                                    state_class: 'measurement',
                                                    availability: availability
                                                }),

            // Capteur charge système
            [`${nodeName}_load1`] : this.addSensorDiscovery(nodeName, 'load1', {
                                                    name: `Load Average 1m`,
                                                    icon: 'mdi:chart-line',
                                                    device_class: null,
                                                    unit_of_measurement: null,
                                                    state_class: 'measurement',
                                                    availability: availability
                                                }),
            [`${nodeName}_load5`] : this.addSensorDiscovery(nodeName, 'load5', {
                                                    name: `Load Average 5m`,
                                                    icon: 'mdi:chart-line',
                                                    device_class: null,
                                                    unit_of_measurement: null,
                                                    state_class: 'measurement',
                                                    availability: availability
                                                }),
            [`${nodeName}_load15`] : this.addSensorDiscovery(nodeName, 'load15', {
                                                    name: `Load Average 15m`,
                                                    icon: 'mdi:chart-line',
                                                    device_class: null,
                                                    unit_of_measurement: null,
                                                    state_class: 'measurement',
                                                    availability: availability
                                                }),
            // Capteurs de stockage Ceph
            [`${nodeName}_ceph_status`] : this.addSensorDiscovery(nodeName, 'ceph_status', {
                                                    name: `Ceph Status`,
                                                    icon: 'mdi:database',
                                                    device_class: null,
                                                    unit_of_measurement: null,
                                                    availability: availability
                                                }),
            // Capteur d'utilisation Ceph
            [`${nodeName}_ceph_usage`] : this.addSensorDiscovery(nodeName, 'ceph_usage', {
                                                    name: `Ceph Usage`,
                                                    icon: 'mdi:database',
                                                    device_class: null,
                                                    unit_of_measurement: '%',
                                                    state_class: 'measurement',
                                                    availability: availability
                                                }),
            [`${nodeName}_ceph_total`] : this.addSensorDiscovery(nodeName, 'ceph_total', {
                                                    name: `Ceph Total`,
                                                    icon: 'mdi:database',
                                                    device_class: 'data_size',
                                                    unit_of_measurement: 'Gbit',
                                                    value_template: `{{ (value_json.ceph_total / 1024 / 1024 / 1024) | round(2) }}`,
                                                    state_class: 'measurement',
                                                    availability: availability
                                                }),
            [`${nodeName}_ceph_used`] : this.addSensorDiscovery(nodeName, 'ceph_used', {
                                                    name: `Ceph Used`,
                                                    icon: 'mdi:database',
                                                    device_class: 'data_size',
                                                    unit_of_measurement: 'Gbit',
                                                    value_template: `{{ (value_json.ceph_used / 1024 / 1024 / 1024) | round(2) }}`,
                                                    state_class: 'measurement',
                                                    availability: availability
                                                }),
            // Bouton redémarrage
            [`${nodeName}_restart`] : this.addButtonDiscovery(nodeName,"nodes", 'restart', {
                                                    name: `Restart`,
                                                    icon: 'mdi:restart',
                                                    device_class: 'restart',
                                                    availability: availability
                                                }),
            // Bouton arrêt
            [`${nodeName}_shutdown`] : this.addButtonDiscovery(nodeName,"nodes", 'shutdown', {
                                                    name: `Shutdown`,
                                                    icon: 'mdi:power',
                                                    device_class: null,
                                                    availability: availability
                                                }),
            // Bouton actualisation
            [`${nodeName}_refresh`] : this.addButtonDiscovery(nodeName,"nodes", 'refresh', {
                                                    name: `Refresh`,
                                                    icon: 'mdi:refresh',
                                                    device_class: null,
                                                    availability: availability
                                                })
        };

        try {
            await this.mqtt.publishDeviceDiscovery(`nodes/${nodeName}`, device);

            logger.info(`Configuration de découverte publiée pour le nœud ${nodeName}`);
        } catch (error) {
            logger.error(`Erreur lors de la publication de la découverte pour ${nodeName}:`, error);
        }
    }


    addBinarySensorDiscovery(nodeName, sensorType, sensorConfig) {
        const entityId = `${nodeName}_${sensorType}`;

        return {
            platform: 'binary_sensor',
            unique_id: entityId,
            object_id: entityId,
            has_entity_name: true,
            force_update: true,
            name: sensorConfig.name,
            icon: sensorConfig.icon,
            availability_mode: "all",
            value_template: `{{ value_json.${sensorType} }}`,
            ...sensorConfig
        };
    }

    addSensorDiscovery(nodeName, sensorType, sensorConfig) {
        const entityId = `${nodeName}_${sensorType}`;
        
        return {
            platform: 'sensor',
            unique_id: entityId,
            object_id: entityId,
            has_entity_name: true,
            force_update: true,
            name: sensorConfig.name,
            icon: sensorConfig.icon,
            availability_mode: "all",
            value_template: `{{ value_json.${sensorType} }}`,
            ...sensorConfig
        };
    }

    addButtonDiscovery(nodeName, domain, buttonType, buttonConfig) {
        const entityId = `${nodeName}_${buttonType}`;
        const commandTopic = `${this.baseTopic}/${domain}/${nodeName}/command`;

        return {
            platform: 'button',
            unique_id: entityId,
            object_id: entityId,
            name: buttonConfig.name,
            command_topic: commandTopic,
            icon: buttonConfig.icon,
            availability_mode: "all",
            payload_press: JSON.stringify({ action: buttonType }),
            ...buttonConfig
        };
    }

    getDeviceInfo(nodeName) {
        return {
            identifiers: [`proxmox_${nodeName}`],
            name: `Proxmox ${nodeName}`,
            model: 'Proxmox VE Node',
            manufacturer: 'Proxmox',
            sw_version: '1.0.0'
        };
    }

    async publishAvailability(nodeName, status = 'online') {
        const availabilityTopic = `${this.baseTopic}/nodes/${nodeName}/availability`;
        try {
            await this.mqtt.publish(availabilityTopic, status, { retain: true });
        } catch (error) {
            logger.error(`Erreur lors de la publication de la disponibilité pour ${nodeName}:`, error);
        }
    }

    async removeNodeDiscovery(nodeName) {
        try {
            // Publier un message vide pour supprimer la configuration de découverte
            const discoveryTopic = `homeassistant/device/nodes/${nodeName}/config`;
            await this.mqtt.publish(discoveryTopic, '', { retain: true });

            // Marquer comme hors ligne
            await this.publishAvailability(nodeName, 'offline');

            logger.info(`Configuration de découverte supprimée pour le nœud ${nodeName}`);
        } catch (error) {
            logger.error(`Erreur lors de la suppression de la découverte pour ${nodeName}:`, error);
        }
    }

    async publishContainerDiscovery(container) {
        const deviceInfo = this.getContainerDeviceInfo(container);

        const device = {
            device: deviceInfo,
            origin: { 
                name: "Proxmox2MQTT"
            },
            state_topic: `${this.baseTopic}/lxc/${container.key}`,
            components: {},
        };
        
        const lxcAvailability = {
            topic: `${this.baseTopic}/lxc/${container.key}/availability`,
            payload_available: 'online',
            payload_not_available: 'offline'
        };
        const nodeAvailability = {
            topic: `${this.baseTopic}/nodes/${container.node}/availability`,
            payload_available: 'online',
            payload_not_available: 'offline'
        };
        
        device.components = {
            // État du conteneur
            [`${container.key}_state`]: this.addSensorDiscovery(container.key, 'state', {
                name: `Status`,
                icon: 'mdi:cube',
                device_class: null,
                state_class: null,
                // availability: [lxcAvailability, nodeAvailability]
            }),
            
            // CPU Usage
            [`${container.key}_cpu_usage`]: this.addSensorDiscovery(container.key, 'cpu_usage', {
                name: `CPU Usage`,
                icon: 'mdi:cpu-64-bit',
                device_class: null,
                unit_of_measurement: '%',
                state_class: 'measurement',
                availability: [lxcAvailability, nodeAvailability]
            }),
            
            // CPU Cores
            [`${container.key}_cpu_cores`]: this.addSensorDiscovery(container.key, 'cpu_cores', {
                name: `CPU Cores`,
                icon: 'mdi:cpu-64-bit',
                device_class: null,
                unit_of_measurement: null,
                state_class: 'measurement',
                availability: [lxcAvailability, nodeAvailability]
            }),
            
            // Memory Usage
            [`${container.key}_mem_usage`]: this.addSensorDiscovery(container.key, 'mem_usage', {
                name: `Memory Usage`,
                icon: 'mdi:memory',
                device_class: null,
                unit_of_measurement: '%',
                state_class: 'measurement',
                availability: [lxcAvailability, nodeAvailability]
            }),
            
            // Memory Total
            [`${container.key}_mem_total`]: this.addSensorDiscovery(container.key, 'mem_total', {
                name: `Memory Total`,
                icon: 'mdi:memory',
                device_class: 'data_size',
                unit_of_measurement: 'Gbit',
                value_template: `{{ (value_json.mem_total / 1024 / 1024 / 1024) | round(2) }}`,
                state_class: 'measurement',
                availability: [lxcAvailability, nodeAvailability]
            }),
            
            // Memory Used
            [`${container.key}_mem_used`]: this.addSensorDiscovery(container.key, 'mem_used', {
                name: `Memory Used`,
                icon: 'mdi:memory',
                device_class: 'data_size',
                unit_of_measurement: 'Gbit',
                value_template: `{{ (value_json.mem_used / 1024 / 1024 / 1024) | round(2) }}`,
                state_class: 'measurement',
                availability: [lxcAvailability, nodeAvailability]
            }),
            
            // Disk Usage
            [`${container.key}_disk_usage`]: this.addSensorDiscovery(container.key, 'disk_usage', {
                name: `Disk Usage`,
                icon: 'mdi:harddisk',
                device_class: null,
                unit_of_measurement: '%',
                state_class: 'measurement',
                availability: [lxcAvailability, nodeAvailability]
            }),
            
            // Network In
            [`${container.key}_net_in`]: this.addSensorDiscovery(container.key, 'net_in', {
                name: `Network In`,
                icon: 'mdi:download',
                device_class: 'data_size',
                unit_of_measurement: 'Gbit',
                state_class: 'total_increasing',
                value_template: `{{ (value_json.net_in / 1024 / 1024 / 1024) | round(2) }}`,
                availability: [lxcAvailability, nodeAvailability]
            }),
            
            // Network Out
            [`${container.key}_net_out`]: this.addSensorDiscovery(container.key, 'net_out', {
                name: `Network Out`,
                icon: 'mdi:upload',
                device_class: 'data_size',
                unit_of_measurement: 'Gbit',
                state_class: 'total_increasing',
                value_template: `{{ (value_json.net_out / 1024 / 1024 / 1024) | round(2) }}`,
                availability: [lxcAvailability, nodeAvailability]
            }),
            
            // Uptime
            [`${container.key}_uptime`]: this.addSensorDiscovery(container.key, 'uptime', {
                name: `Uptime`,
                icon: 'mdi:clock',
                device_class: 'duration',
                unit_of_measurement: 's',
                state_class: 'measurement',
                availability: [lxcAvailability, nodeAvailability]
            }),
            
            // Boutons de contrôle
            [`${container.key}_start`]: this.addButtonDiscovery(container.key,"lxc", 'start', {
                name: `Start`,
                icon: 'mdi:play',
                device_class: null,
                availability: [lxcAvailability]
            }),

            [`${container.key}_stop`]: this.addButtonDiscovery(container.key,"lxc", 'stop', {
                name: `Stop`,
                icon: 'mdi:stop',
                device_class: null,
                availability: [lxcAvailability]
            }),
            
            [`${container.key}_reboot`]: this.addButtonDiscovery(container.key,"lxc", 'reboot', {
                name: `Reboot`,
                icon: 'mdi:restart',
                device_class: 'restart',
                availability: [lxcAvailability]
            }),
            [`${container.key}_refresh`]: this.addButtonDiscovery(container.key,"lxc", 'refresh', {
                name: `Refresh`,
                icon: 'mdi:refresh',
                device_class: null,
                availability: [lxcAvailability]
            })
        };

        try {
            await this.mqtt.publishDeviceDiscovery(`lxc/${container.key}`, device);
            logger.info(`Configuration de découverte publiée pour le conteneur ${container.name} (${container.vmid})`);
        } catch (error) {
            logger.error(`Erreur lors de la publication de la découverte pour le conteneur ${container.vmid}:`, error);
        }
    }

    getContainerDeviceInfo(container) {
        return {
            identifiers: [`proxmox_${container.key}`],
            name: `${container.name} (${container.vmid})`,
            model: 'Proxmox LXC Container',
            manufacturer: 'Proxmox',
            sw_version: '1.0.0',
            via_device: `proxmox_${container.node}`
        };
    }

    async publishContainerAvailability(containerKey, status = 'online') {
    const availabilityTopic = `${this.baseTopic}/lxc/${containerKey}/availability`;
        try {
            await this.mqtt.publish(availabilityTopic, status, { retain: true });
        } catch (error) {
            logger.error(`Erreur lors de la publication de la disponibilité pour le conteneur ${containerKey}:`, error);
        }
    }
}

module.exports = HomeAssistantDiscovery;