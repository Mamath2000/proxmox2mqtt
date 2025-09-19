const logger = require('../utils/logger');

class HomeAssistantDiscovery {
    constructor(mqttClient) {
        this.mqtt = mqttClient;
        this.baseTopic = 'proxmox2mqtt';
    }

    async publishNodeDiscovery(node) {
        const nodeName = node.node;
        const deviceInfo = this.getDeviceInfo(nodeName);

        try {
            // Capteur d'état du nœud
            await this.publishSensorDiscovery(nodeName, 'state', {
                name: `${nodeName} State`,
                icon: 'mdi:server',
                device_class: null,
                unit_of_measurement: null
            }, deviceInfo);

            // Capteur CPU
            await this.publishSensorDiscovery(nodeName, 'cpu', {
                name: `${nodeName} CPU Usage`,
                icon: 'mdi:cpu-64-bit',
                device_class: null,
                unit_of_measurement: '%',
                state_class: 'measurement'
            }, deviceInfo);

            // Capteur mémoire
            await this.publishSensorDiscovery(nodeName, 'memory', {
                name: `${nodeName} Memory Usage`,
                icon: 'mdi:memory',
                device_class: null,
                unit_of_measurement: '%',
                state_class: 'measurement'
            }, deviceInfo);

            // Capteur disque
            await this.publishSensorDiscovery(nodeName, 'disk', {
                name: `${nodeName} Disk Usage`,
                icon: 'mdi:harddisk',
                device_class: null,
                unit_of_measurement: '%',
                state_class: 'measurement'
            }, deviceInfo);

            // Capteur charge système
            await this.publishSensorDiscovery(nodeName, 'load1', {
                name: `${nodeName} Load Average 1m`,
                icon: 'mdi:chart-line',
                device_class: null,
                unit_of_measurement: null,
                state_class: 'measurement'
            }, deviceInfo);
            // Capteur charge système
            await this.publishSensorDiscovery(nodeName, 'load5', {
                name: `${nodeName} Load Average 5m`,
                icon: 'mdi:chart-line',
                device_class: null,
                unit_of_measurement: null,
                state_class: 'measurement'
            }, deviceInfo);
            // Capteur charge système
            await this.publishSensorDiscovery(nodeName, 'load15', {
                name: `${nodeName} Load Average 15m`,
                icon: 'mdi:chart-line',
                device_class: null,
                unit_of_measurement: null,
                state_class: 'measurement'
            }, deviceInfo);

            // Capteurs de stockage Ceph
            await this.publishSensorDiscovery(nodeName, 'ceph', {
                name: `${nodeName} Ceph Status`,
                icon: 'mdi:database',
                device_class: null,
                unit_of_measurement: null
            }, deviceInfo);

            await this.publishSensorDiscovery(nodeName, 'ceph_usage', {
                name: `${nodeName} Ceph Usage`,
                icon: 'mdi:database',
                device_class: null,
                unit_of_measurement: '%',
                state_class: 'measurement',
                state_topic: `${this.baseTopic}/${nodeName}/ceph/usage`
            }, deviceInfo);

            // Bouton redémarrage
            await this.publishButtonDiscovery(nodeName, 'restart', {
                name: `${nodeName} Restart`,
                icon: 'mdi:restart',
                device_class: 'restart'
            }, deviceInfo);

            // Bouton arrêt
            await this.publishButtonDiscovery(nodeName, 'shutdown', {
                name: `${nodeName} Shutdown`,
                icon: 'mdi:power',
                device_class: null
            }, deviceInfo);

            // Bouton actualisation
            await this.publishButtonDiscovery(nodeName, 'refresh', {
                name: `${nodeName} Refresh`,
                icon: 'mdi:refresh',
                device_class: null
            }, deviceInfo);

            logger.info(`Configuration de découverte publiée pour le nœud ${nodeName}`);
        } catch (error) {
            logger.error(`Erreur lors de la publication de la découverte pour ${nodeName}:`, error);
        }
    }

    async publishSensorDiscovery(nodeName, sensorType, sensorConfig, deviceInfo) {
        const entityId = `${nodeName}_${sensorType}`;
        const stateTopic = `${this.baseTopic}/${nodeName}/${sensorType}/state`;
        const attributesTopic = `${this.baseTopic}/${nodeName}/${sensorType}/attributes`;

        const config = {
            unique_id: entityId,
            object_id: entityId,
            name: sensorConfig.name,
            state_topic: stateTopic,
            json_attributes_topic: attributesTopic,
            icon: sensorConfig.icon,
            device: deviceInfo,
            availability: {
                topic: `${this.baseTopic}/${nodeName}/availability`,
                payload_available: 'online',
                payload_not_available: 'offline'
            },
            ...sensorConfig
        };

        await this.mqtt.publishDiscovery('sensor', nodeName, sensorType, config);
    }

    async publishButtonDiscovery(nodeName, buttonType, buttonConfig, deviceInfo) {
        const entityId = `${nodeName}_${buttonType}`;
        const commandTopic = `${this.baseTopic}/${nodeName}/command/${buttonType}`;

        const config = {
            unique_id: entityId,
            object_id: entityId,
            name: buttonConfig.name,
            command_topic: commandTopic,
            icon: buttonConfig.icon,
            device: deviceInfo,
            availability: {
                topic: `${this.baseTopic}/${nodeName}/availability`,
                payload_available: 'online',
                payload_not_available: 'offline'
            },
            payload_press: JSON.stringify({ action: buttonType }),
            ...buttonConfig
        };

        await this.mqtt.publishDiscovery('button', nodeName, buttonType, config);
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
        const sensors = ['state', 'cpu', 'memory', 'disk', 'load'];
        const buttons = ['restart', 'shutdown', 'refresh'];

        try {
            // Suppression des capteurs
            for (const sensor of sensors) {
                const discoveryTopic = `homeassistant/sensor/${nodeName}_${sensor}/config`;
                await this.mqtt.publish(discoveryTopic, '', { retain: true });
            }

            // Suppression des boutons
            for (const button of buttons) {
                const discoveryTopic = `homeassistant/button/${nodeName}_${button}/config`;
                await this.mqtt.publish(discoveryTopic, '', { retain: true });
            }

            // Marquer comme hors ligne
            await this.publishAvailability(nodeName, 'offline');

            logger.info(`Configuration de découverte supprimée pour le nœud ${nodeName}`);
        } catch (error) {
            logger.error(`Erreur lors de la suppression de la découverte pour ${nodeName}:`, error);
        }
    }
}

module.exports = HomeAssistantDiscovery;