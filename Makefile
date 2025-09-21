# Makefile pour Proxmox2MQTT
# Projet Node.js pour connecter Proxmox à Home Assistant via MQTT

# Variables
PROJECT_NAME = proxmox2mqtt
NODE_VERSION = $(shell node --version 2>/dev/null || echo "non installé")
NPM_VERSION = $(shell npm --version 2>/dev/null || echo "non installé")
ENV_FILE = .env
LOG_DIR = logs

# Couleurs pour l'affichage
RED = \033[0;31m
GREEN = \033[0;32m
YELLOW = \033[0;33m
BLUE = \033[0;34m
CYAN = \033[0;36m
WHITE = \033[0;37m
NC = \033[0m # No Color

# Cible par défaut
.PHONY: help
help: ## Affiche ce menu d'aide
	@echo ""
	@echo "$(CYAN)╭─────────────────────────────────────────╮$(NC)"
	@echo "$(CYAN)│           $(WHITE)PROXMOX2MQTT$(CYAN)                  │$(NC)"
	@echo "$(CYAN)│     Pont Proxmox ↔ Home Assistant       │$(NC)"
	@echo "$(CYAN)╰─────────────────────────────────────────╯$(NC)"
	@echo ""
	@echo "$(YELLOW)📋 Commandes disponibles:$(NC)"
	@echo ""
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "$(GREEN)  %-15s$(NC) %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""
	@echo "$(BLUE)ℹ️  Informations système:$(NC)"
	@echo "   Node.js: $(GREEN)$(NODE_VERSION)$(NC)"
	@echo "   NPM:     $(GREEN)$(NPM_VERSION)$(NC)"
	@echo ""

.PHONY: build-push
build-push: ## Build et pousse l'image vers Docker Hub
	@echo "$(CYAN)🔨 Build et push vers Docker Hub...$(NC)"
	@./scripts/build.sh --push
	@echo "$(GREEN)✅ Build et push terminés !$(NC)"

.PHONY: build
build: ## Build l'image Docker avec incrément de version
	@echo "$(CYAN)🔨 Lancement du build Docker...$(NC)"
	@./scripts/build.sh
	@echo "$(GREEN)✅ Build terminé !$(NC)"

.PHONY: install
install: ## Installe les dépendances NPM
	@echo "$(CYAN)📦 Installation des dépendances...$(NC)"
	npm install
	@echo "$(GREEN)✓ Dépendances installées avec succès$(NC)"

.PHONY: start
start: ## Démarre l'application en mode production
	@echo "$(CYAN)🚀 Démarrage de $(PROJECT_NAME)...$(NC)"
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "$(RED)❌ Fichier $(ENV_FILE) manquant !$(NC)"; \
		echo "$(YELLOW)   Copiez .env.example vers .env et configurez$(NC)"; \
		exit 1; \
	fi
	@rm -f $(LOG_DIR)/proxmox2mqtt.pid
	npm start

.PHONY: dev
dev: ## Démarre l'application en mode développement (avec auto-reload)
	@echo "$(CYAN)🔧 Démarrage en mode développement...$(NC)"
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "$(RED)❌ Fichier $(ENV_FILE) manquant !$(NC)"; \
		echo "$(YELLOW)   Copiez .env.example vers .env et configurez$(NC)"; \
		exit 1; \
	fi
	npm run dev

.PHONY: logs
logs: ## Affiche les logs récents
	@echo "$(CYAN)📋 Logs récents de $(PROJECT_NAME):$(NC)"
	@if [ -f $(LOG_DIR)/proxmox2mqtt.log ]; then \
		tail -n 20 $(LOG_DIR)/proxmox2mqtt.log; \
	else \
		echo "$(YELLOW)⚠️  Aucun log trouvé dans $(LOG_DIR)/$(NC)"; \
	fi

.PHONY: check
check: ## Vérifie la syntaxe et la qualité du code
	@echo "$(CYAN)🔍 Vérification du code avec ESLint...$(NC)"
	npm run lint
	@echo "$(CYAN)✅ Vérification de la syntaxe Node.js...$(NC)"
	node --check src/index.js
	@echo "$(GREEN)✓ Code vérifié avec succès$(NC)"

.PHONY: clean-logs
clean-logs: ## Supprime tous les logs
	@echo "$(CYAN)🧹 Nettoyage des logs...$(NC)"
	@rm -f $(LOG_DIR)/*.log
	@echo "$(GREEN)✓ Logs supprimés$(NC)"

.PHONY: clean
clean: clean-logs ## Nettoyage complet (logs + node_modules)
	@echo "$(CYAN)🧹 Nettoyage complet...$(NC)"
	@rm -rf node_modules/
	@rm -f package-lock.json
	@echo "$(GREEN)✓ Nettoyage terminé$(NC)"

.PHONY: info
info: ## Affiche les informations détaillées du projet
	@echo "$(CYAN)ℹ️  Informations détaillées:$(NC)"
	@echo ""
	@echo "$(YELLOW)📋 Projet:$(NC)"
	@echo "   Nom: $(PROJECT_NAME)"
	@echo "   Version: $(shell grep '"version"' package.json | cut -d'"' -f4)"
	@echo "   Description: $(shell grep '"description"' package.json | cut -d'"' -f4)"
	@echo ""
	@echo "$(YELLOW)🔧 Environnement:$(NC)"
	@echo "   Node.js: $(if $(shell which node),$(GREEN)✓$(NC) $(NODE_VERSION),$(RED)✗ Non installé$(NC))"
	@echo "   NPM:     $(if $(shell which npm),$(GREEN)✓$(NC) $(NPM_VERSION),$(RED)✗ Non installé$(NC))"
	@echo ""
	@echo "$(YELLOW)📁 Fichiers de configuration:$(NC)"
	@echo "   package.json: $(if $(wildcard package.json),$(GREEN)✓$(NC),$(RED)✗$(NC))"
	@echo "   $(ENV_FILE):        $(if $(wildcard $(ENV_FILE)),$(GREEN)✓$(NC),$(YELLOW)⚠ Manquant$(NC))"
	@echo "   node_modules: $(if $(wildcard node_modules/),$(GREEN)✓ Installées$(NC),$(RED)✗ Non installées$(NC))"
	@echo ""
	@echo "$(YELLOW)🎯 Objectif:$(NC)"
	@echo "   Connecter un cluster Proxmox à Home Assistant"
	@echo "   via MQTT avec auto-discovery"
	@echo ""
	@echo "$(YELLOW)🏗️  Architecture:$(NC)"
	@echo "   Proxmox API ↔ Node.js Bridge ↔ MQTT Broker ↔ Home Assistant"