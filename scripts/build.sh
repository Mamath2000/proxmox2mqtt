#!/bin/bash

# Script de build Docker pour Proxmox2MQTT
# Usage: ./scripts/build.sh [--push] [--no-increment]

set -e

# Vérifications des prérequis
command -v jq >/dev/null 2>&1 || { echo "❌ jq est requis mais non installé. Installez avec: apt-get install jq"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "❌ Docker est requis mais non installé. Abandon."; exit 1; }

# Configuration
DOCKER_USER="mathmath350"
APP_NAME="proxmox2mqtt"
DOCKERFILE_PATH="."
PACKAGE_JSON="package.json"

# Couleurs pour l'affichage
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🐳 Build Docker Proxmox2MQTT${NC}"
echo "================================="

# Récupère la version actuelle du package.json
if [ ! -f "$PACKAGE_JSON" ]; then
    echo -e "${RED}❌ Fichier $PACKAGE_JSON non trouvé${NC}"
    exit 1
fi

VERSION=$(jq -r '.version' $PACKAGE_JSON)
echo -e "${YELLOW}📦 Version actuelle : $VERSION${NC}"

# Parse des arguments
PUSH_TO_REGISTRY=false
INCREMENT_VERSION=true

for arg in "$@"; do
    case $arg in
        --push)
            PUSH_TO_REGISTRY=true
            shift
            ;;
        --no-increment)
            INCREMENT_VERSION=false
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --push          Pousse l'image vers Docker Hub"
            echo "  --no-increment  Ne pas incrémenter la version"
            echo "  --help, -h      Affiche cette aide"
            exit 0
            ;;
    esac
done

# Incrémente le numéro de version si demandé
if [ "$INCREMENT_VERSION" = true ]; then
    echo -e "${BLUE}🔢 Incrémentation de la version...${NC}"
    IFS='.' read -r MAJOR MINOR PATCH <<< "$VERSION"
    PATCH=$((PATCH + 1))
    NEW_VERSION="$MAJOR.$MINOR.$PATCH"
    
    # Met à jour la version dans package.json
    jq --arg new_version "$NEW_VERSION" '.version = $new_version' $PACKAGE_JSON > tmp.json && mv tmp.json $PACKAGE_JSON
    
    echo -e "${GREEN}✅ Version mise à jour : $VERSION → $NEW_VERSION${NC}"
    VERSION=$NEW_VERSION
fi

# Build de l'image Docker
echo -e "${BLUE}🔨 Construction de l'image Docker...${NC}"
docker build -t $APP_NAME:latest -t $APP_NAME:$VERSION $DOCKERFILE_PATH

# Taille de l'image
IMAGE_SIZE=$(docker images $APP_NAME:latest --format "{{.Size}}")
echo -e "${GREEN}✅ Image construite avec succès : $IMAGE_SIZE${NC}"

# Tags pour Docker Hub si nécessaire
if [ "$PUSH_TO_REGISTRY" = true ]; then
    echo -e "${BLUE}🏷️  Création des tags pour Docker Hub...${NC}"
    
    # Vérification de la connexion Docker Hub
    if ! docker info | grep -q Username; then
        echo -e "${YELLOW}⚠️  Non connecté à Docker Hub. Tentative de connexion...${NC}"
        echo -e "${YELLOW}💡 Si vous n'êtes pas connecté, lancez: docker login${NC}"
        
        # Demande interactive du nom d'utilisateur si non défini
        if [ -z "$DOCKER_USER" ]; then
            read -p "Entrez votre nom d'utilisateur Docker Hub : " DOCKER_USER
        fi
    fi
    
    # Création des tags
    docker tag $APP_NAME:latest $DOCKER_USER/$APP_NAME:latest
    docker tag $APP_NAME:$VERSION $DOCKER_USER/$APP_NAME:$VERSION
    
    echo -e "${BLUE}📤 Push vers Docker Hub...${NC}"
    docker push $DOCKER_USER/$APP_NAME:latest
    docker push $DOCKER_USER/$APP_NAME:$VERSION
    
    echo -e "${GREEN}✅ Images poussées sur Docker Hub :${NC}"
    echo -e "   • $DOCKER_USER/$APP_NAME:latest"
    echo -e "   • $DOCKER_USER/$APP_NAME:$VERSION"
fi

# Résumé final
echo ""
echo -e "${GREEN}🎉 Build terminé avec succès !${NC}"
echo "================================="
echo -e "${YELLOW}📋 Résumé :${NC}"
echo "   • Version : $VERSION"
echo "   • Image locale : $APP_NAME:latest, $APP_NAME:$VERSION"
echo "   • Taille : $IMAGE_SIZE"
if [ "$PUSH_TO_REGISTRY" = true ]; then
    echo "   • Registry : $DOCKER_USER/$APP_NAME"
fi
echo ""
echo -e "${BLUE}🚀 Commandes utiles :${NC}"
echo "   • Lancer : make docker-run"
echo "   • Logs : make docker-logs"
echo "   • Tests : ./test-docker.sh"