const logger = require('../utils/logger');

class HomeAssistantDiscovery {
    constructor(mqttClient) {
        this.mqtt = mqttClient;
        this.baseTopic = 'proxmox2mqtt';
    }

    async publishNodeDiscovery(node) {
        const nodeName = node.node;
        const deviceInfo = this.getDeviceInfo(nodeName);

        const device = {
            device: deviceInfo,
            origin: { 
                name: "Proxmox2MQTT"
            },
            state_topic: `${this.baseTopic}/${nodeName}`,
            components: {},
        };
        const availability = {
            topic: `${this.baseTopic}/${nodeName}/availability`,
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
                                                    payload_off: 'offline'
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
            [`${nodeName}_restart`] : this.addButtonDiscovery(nodeName, 'restart', {
                                                    name: `Restart`,
                                                    icon: 'mdi:restart',
                                                    device_class: 'restart',
                                                    availability: availability
                                                }),
            // Bouton arrêt
            [`${nodeName}_shutdown`] : this.addButtonDiscovery(nodeName, 'shutdown', {
                                                    name: `Shutdown`,
                                                    icon: 'mdi:power',
                                                    device_class: null,
                                                    availability: availability
                                                }),
            // Bouton actualisation
            [`${nodeName}_refresh`] : this.addButtonDiscovery(nodeName, 'refresh', {
                                                    name: `Refresh`,
                                                    icon: 'mdi:refresh',
                                                    device_class: null,
                                                    availability: availability
                                                })
        };

        try {
            await this.mqtt.publishDiscovery('device', nodeName, 'node', device);

            logger.info(`Configuration de découverte publiée pour le nœud ${nodeName}`);
        } catch (error) {
            logger.error(`Erreur lors de la publication de la découverte pour ${nodeName}:`, error);
        }
    }


    addBinarySensorDiscovery(nodeName, sensorType, sensorConfig) {
        const entityId = `${nodeName}_${sensorType}`;
        // const stateTopic = `${this.baseTopic}/${nodeName}/${sensorType}/state`;
        // const attributesTopic = `${this.baseTopic}/${nodeName}/${sensorType}/attributes`;

        return {
            platform: 'binary_sensor',
            unique_id: entityId,
            object_id: entityId,
            has_entity_name: true,
            force_update: true,
            name: sensorConfig.name,
            // state_topic: stateTopic,
            // json_attributes_topic: attributesTopic,
            icon: sensorConfig.icon,
            value_template: `{{ value_json.${sensorType} }}`,
            ...sensorConfig
        };
    }

    addSensorDiscovery(nodeName, sensorType, sensorConfig) {
        const entityId = `${nodeName}_${sensorType}`;
        // const stateTopic = `${this.baseTopic}/${nodeName}/${sensorType}/state`;
        // const attributesTopic = `${this.baseTopic}/${nodeName}/${sensorType}/attributes`;

        return {
            platform: 'sensor',
            unique_id: entityId,
            object_id: entityId,
            has_entity_name: true,
            force_update: true,
            name: sensorConfig.name,
            // state_topic: stateTopic,
            // json_attributes_topic: attributesTopic,
            icon: sensorConfig.icon,
            value_template: `{{ value_json.${sensorType} }}`,
            ...sensorConfig
        };
    }

    addButtonDiscovery(nodeName, buttonType, buttonConfig) {
        const entityId = `${nodeName}_${buttonType}`;
        const commandTopic = `${this.baseTopic}/${nodeName}/command/${buttonType}`;

        return {
            platform: 'button',
            unique_id: entityId,
            object_id: entityId,
            name: buttonConfig.name,
            command_topic: commandTopic,
            icon: buttonConfig.icon,
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
            sw_version: '1.0.0',
            via_device: 'proxmox2mqtt_bridge'
        };
    }

    async publishAvailability(nodeName, status = 'online') {
        const availabilityTopic = `${this.baseTopic}/${nodeName}/availability`;
        try {
            await this.mqtt.publish(availabilityTopic, status, { retain: true });
        } catch (error) {
            logger.error(`Erreur lors de la publication de la disponibilité pour ${nodeName}:`, error);
        }
    }

    async removeNodeDiscovery(nodeName) {
        try {
            // Publier un message vide pour supprimer la configuration de découverte
            const discoveryTopic = `homeassistant/device/${nodeName}_node/config`;
            await this.mqtt.publish(discoveryTopic, '', { retain: true });

            // Marquer comme hors ligne
            await this.publishAvailability(nodeName, 'offline');

            logger.info(`Configuration de découverte supprimée pour le nœud ${nodeName}`);
        } catch (error) {
            logger.error(`Erreur lors de la suppression de la découverte pour ${nodeName}:`, error);
        }
    }
}

module.exports = HomeAssistantDiscovery;