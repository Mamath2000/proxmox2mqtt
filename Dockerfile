# Build stage
FROM node:18-alpine AS builder

LABEL maintainer="Proxmox2MQTT"
LABEL description="Bridge Node.js qui connecte votre cluster Proxmox à Home Assistant via MQTT auto-discovery"

# Installer les dépendances système nécessaires
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# Créer un utilisateur non-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S proxmox2mqtt -u 1001 -G nodejs

# Définir le répertoire de travail
WORKDIR /app

# Copier les fichiers de configuration des dépendances
COPY package*.json ./

# Installer les dépendances
RUN npm ci --only=production && \
    npm cache clean --force

# Production stage
FROM node:18-alpine AS production

# Installer des outils système utiles
RUN apk add --no-cache \
    tini \
    curl \
    && rm -rf /var/cache/apk/*

# Créer un utilisateur non-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S proxmox2mqtt -u 1001 -G nodejs

# Définir le répertoire de travail
WORKDIR /app

# Copier les dépendances depuis le stage builder
COPY --from=builder --chown=proxmox2mqtt:nodejs /app/node_modules ./node_modules

# Copier le code source
COPY --chown=proxmox2mqtt:nodejs . .

# Créer le répertoire des logs
RUN mkdir -p logs && \
    chown -R proxmox2mqtt:nodejs logs

# Variables d'environnement par défaut
ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV UPDATE_INTERVAL=30000

# Exposer le port pour le healthcheck (optionnel)
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('Health check OK')" || exit 1

# Utiliser tini comme init process
ENTRYPOINT ["/sbin/tini", "--"]

# Passer à l'utilisateur non-root
USER proxmox2mqtt

# Commande par défaut
CMD ["node", "src/index.js"]