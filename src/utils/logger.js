const winston = require('winston');

// Configuration du niveau de log depuis les variables d'environnement
const logLevel = process.env.LOG_LEVEL || 'info';

// Format personnalisé pour les logs
const logFormat = winston.format.combine(
    winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ level, message, timestamp, stack }) => {
        return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
    })
);

// Configuration du logger
const logger = winston.createLogger({
    level: logLevel,
    format: logFormat,
    transports: [
        // Console
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                logFormat
            )
        }),
        
        // Fichier pour tous les logs
        new winston.transports.File({
            filename: 'logs/proxmox2mqtt.log',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            format: logFormat
        }),
        
        // Fichier séparé pour les erreurs
        new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            format: logFormat
        })
    ],
    
    // Gestion des exceptions non capturées
    exceptionHandlers: [
        new winston.transports.File({ filename: 'logs/exceptions.log' })
    ],
    
    // Gestion des rejets de promesses non capturés
    rejectionHandlers: [
        new winston.transports.File({ filename: 'logs/rejections.log' })
    ]
});

// En mode production, on évite de logger à la console
if (process.env.NODE_ENV === 'production') {
    logger.remove(winston.transports.Console);
}

module.exports = logger;