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
PURPLE = \033[0;35m
CYAN = \033[0;36m
WHITE = \033[0;37m
NC = \033[0m # No Color

# Cible par défaut
.PHONY: help
help: ## Affiche ce menu d'aide
	@echo ""
	@echo "$(CYAN)╭─────────────────────────────────────────╮$(NC)"
	@echo "$(CYAN)│           $(WHITE)PROXMOX2MQTT$(CYAN)                │$(NC)"
	@echo "$(CYAN)│     Pont Proxmox ↔ Home Assistant      │$(NC)"
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

.PHONY: status
status: ## Affiche le statut du projet
	@echo "$(CYAN)📊 Statut du projet $(PROJECT_NAME)$(NC)"
	@echo ""
	@echo "$(YELLOW)🔧 Environnement:$(NC)"
	@echo "   Node.js: $(if $(shell which node),$(GREEN)✓$(NC) $(NODE_VERSION),$(RED)✗ Non installé$(NC))"
	@echo "   NPM:     $(if $(shell which npm),$(GREEN)✓$(NC) $(NPM_VERSION),$(RED)✗ Non installé$(NC))"
	@echo ""
	@echo "$(YELLOW)📁 Fichiers de configuration:$(NC)"
	@echo "   package.json: $(if $(wildcard package.json),$(GREEN)✓$(NC),$(RED)✗$(NC))"
	@echo "   $(ENV_FILE):        $(if $(wildcard $(ENV_FILE)),$(GREEN)✓$(NC),$(YELLOW)⚠ Manquant$(NC))"
	@echo "   eslint.config.js: $(if $(wildcard eslint.config.js),$(GREEN)✓$(NC),$(RED)✗$(NC))"
	@echo ""
	@echo "$(YELLOW)📂 Dossiers:$(NC)"
	@echo "   src/:     $(if $(wildcard src/),$(GREEN)✓$(NC),$(RED)✗$(NC))"
	@echo "   logs/:    $(if $(wildcard $(LOG_DIR)/),$(GREEN)✓$(NC),$(RED)✗$(NC))"
	@echo ""
	@echo "$(YELLOW)📦 Dépendances:$(NC)"
	@echo "   node_modules: $(if $(wildcard node_modules/),$(GREEN)✓ Installées$(NC),$(RED)✗ Non installées$(NC))"

.PHONY: install
install: ## Installe les dépendances NPM
	@echo "$(CYAN)📦 Installation des dépendances...$(NC)"
	npm install
	@echo "$(GREEN)✓ Dépendances installées avec succès$(NC)"

.PHONY: setup
setup: install setup-env setup-logs ## Configuration complète du projet
	@echo "$(GREEN)✅ Configuration du projet terminée !$(NC)"

.PHONY: setup-env
setup-env: ## Configure le fichier d'environnement
	@echo "$(CYAN)⚙️  Configuration de l'environnement...$(NC)"
	@if [ ! -f $(ENV_FILE) ]; then \
		cp .env.example $(ENV_FILE); \
		echo "$(YELLOW)⚠️  Fichier $(ENV_FILE) créé depuis .env.example$(NC)"; \
		echo "$(YELLOW)   Pensez à modifier les valeurs selon votre configuration !$(NC)"; \
	else \
		echo "$(GREEN)✓ Fichier $(ENV_FILE) déjà présent$(NC)"; \
	fi

.PHONY: setup-logs
setup-logs: ## Crée le dossier des logs
	@echo "$(CYAN)📋 Configuration des logs...$(NC)"
	@mkdir -p $(LOG_DIR)
	@echo "$(GREEN)✓ Dossier $(LOG_DIR)/ configuré$(NC)"

.PHONY: start
start: ## Démarre l'application en mode production
	@echo "$(CYAN)🚀 Démarrage de $(PROJECT_NAME)...$(NC)"
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "$(RED)❌ Fichier $(ENV_FILE) manquant !$(NC)"; \
		echo "$(YELLOW)   Utilisez 'make setup-env' pour le créer$(NC)"; \
		exit 1; \
	fi
	@if pgrep -f "node src/index.js" > /dev/null; then \
		echo "$(YELLOW)⚠️  Une instance est déjà en cours d'exécution$(NC)"; \
		echo "$(YELLOW)   Utilisez 'make stop' pour l'arrêter d'abord$(NC)"; \
		exit 1; \
	fi
	npm start

.PHONY: start-daemon
start-daemon: ## Démarre l'application en arrière-plan
	@echo "$(CYAN)🚀 Démarrage de $(PROJECT_NAME) en arrière-plan...$(NC)"
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "$(RED)❌ Fichier $(ENV_FILE) manquant !$(NC)"; \
		echo "$(YELLOW)   Utilisez 'make setup-env' pour le créer$(NC)"; \
		exit 1; \
	fi
	@nohup npm start > $(LOG_DIR)/proxmox2mqtt.log 2>&1 & echo $$! > $(LOG_DIR)/proxmox2mqtt.pid
	@echo "$(GREEN)✓ Application démarrée en arrière-plan (PID: $$(cat $(LOG_DIR)/proxmox2mqtt.pid))$(NC)"
	@echo "$(BLUE)   Utilisez 'make logs-live' pour suivre les logs$(NC)"

.PHONY: dev
dev: ## Démarre l'application en mode développement (avec auto-reload)
	@echo "$(CYAN)🔧 Démarrage en mode développement...$(NC)"
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "$(RED)❌ Fichier $(ENV_FILE) manquant !$(NC)"; \
		echo "$(YELLOW)   Utilisez 'make setup-env' pour le créer$(NC)"; \
		exit 1; \
	fi
	npm run dev

.PHONY: debug
debug: ## Démarre en mode debug avec logs détaillés
	@echo "$(CYAN)🐛 Démarrage en mode debug...$(NC)"
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "$(RED)❌ Fichier $(ENV_FILE) manquant !$(NC)"; \
		echo "$(YELLOW)   Utilisez 'make setup-env' pour le créer$(NC)"; \
		exit 1; \
	fi
	LOG_LEVEL=debug npm start

.PHONY: debug-dev
debug-dev: ## Démarre en mode développement avec logs détaillés
	@echo "$(CYAN)🐛 Démarrage en mode développement debug...$(NC)"
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "$(RED)❌ Fichier $(ENV_FILE) manquant !$(NC)"; \
		echo "$(YELLOW)   Utilisez 'make setup-env' pour le créer$(NC)"; \
		exit 1; \
	fi
	LOG_LEVEL=debug npm run dev

.PHONY: test-connection
test-connection: ## Teste la connexion Proxmox sans démarrer l'app
	@echo "$(CYAN)🔌 Test de connexion Proxmox...$(NC)"
	@node -e " \
		require('dotenv').config(); \
		const ProxmoxAPI = require('./src/proxmox/proxmoxAPI'); \
		const api = new ProxmoxAPI({ \
			host: process.env.PROXMOX_HOST, \
			user: process.env.PROXMOX_USER, \
			password: process.env.PROXMOX_PASSWORD, \
			realm: process.env.PROXMOX_REALM || 'pam', \
			port: process.env.PROXMOX_PORT || 8006 \
		}); \
		api.connect().then(() => { \
			console.log('✅ Connexion Proxmox réussie'); \
			return api.getNodes(); \
		}).then(nodes => { \
			console.log('📊 Nœuds disponibles:', nodes.map(n => n.node).join(', ')); \
			process.exit(0); \
		}).catch(err => { \
			console.error('❌ Erreur de connexion:', err.message); \
			process.exit(1); \
		}); \
	"

.PHONY: test-node
test-node: ## Teste l'API d'un nœud spécifique (usage: make test-node NODE=pve1)
	@echo "$(CYAN)🔍 Test du nœud $(or $(NODE),pve1)...$(NC)"
	@node -e " \
		require('dotenv').config(); \
		const ProxmoxAPI = require('./src/proxmox/proxmoxAPI'); \
		const api = new ProxmoxAPI({ \
			host: process.env.PROXMOX_HOST, \
			user: process.env.PROXMOX_USER, \
			password: process.env.PROXMOX_PASSWORD, \
			realm: process.env.PROXMOX_REALM || 'pam', \
			port: process.env.PROXMOX_PORT || 8006 \
		}); \
		const nodeName = '$(or $(NODE),pve1)'; \
		api.connect().then(() => { \
			console.log('✅ Connexion Proxmox réussie'); \
			return api.getNodeStatus(nodeName); \
		}).then(status => { \
			console.log('📊 Statut du nœud ' + nodeName + ':', JSON.stringify(status, null, 2)); \
			process.exit(0); \
		}).catch(err => { \
			console.error('❌ Erreur pour le nœud ' + nodeName + ':', err.message); \
			process.exit(1); \
		}); \
	"

.PHONY: test
test: ## Exécute les tests (placeholder)
	@echo "$(CYAN)🧪 Exécution des tests...$(NC)"
	npm test

.PHONY: lint
lint: ## Vérifie la qualité du code avec ESLint
	@echo "$(CYAN)🔍 Vérification du code avec ESLint...$(NC)"
	npm run lint

.PHONY: lint-fix
lint-fix: ## Corrige automatiquement les erreurs ESLint
	@echo "$(CYAN)🔧 Correction automatique du code...$(NC)"
	npm run lint:fix
	@echo "$(GREEN)✓ Code corrigé automatiquement$(NC)"

.PHONY: check
check: lint ## Vérifie la syntaxe et la qualité du code
	@echo "$(CYAN)✅ Vérification de la syntaxe Node.js...$(NC)"
	node --check src/index.js
	@echo "$(GREEN)✓ Syntaxe valide$(NC)"

.PHONY: logs
logs: ## Affiche les logs récents
	@echo "$(CYAN)📋 Logs récents de $(PROJECT_NAME):$(NC)"
	@if [ -f $(LOG_DIR)/proxmox2mqtt.log ]; then \
		tail -n 20 $(LOG_DIR)/proxmox2mqtt.log; \
	else \
		echo "$(YELLOW)⚠️  Aucun log trouvé dans $(LOG_DIR)/$(NC)"; \
	fi

.PHONY: logs-error
logs-error: ## Affiche les logs d'erreur récents
	@echo "$(CYAN)🚨 Logs d'erreur récents:$(NC)"
	@if [ -f $(LOG_DIR)/error.log ]; then \
		tail -n 10 $(LOG_DIR)/error.log; \
	else \
		echo "$(YELLOW)⚠️  Aucun log d'erreur trouvé$(NC)"; \
	fi

.PHONY: logs-live
logs-live: ## Suit les logs en temps réel
	@echo "$(CYAN)📺 Suivi des logs en temps réel (Ctrl+C pour arrêter):$(NC)"
	@if [ -f $(LOG_DIR)/proxmox2mqtt.log ]; then \
		tail -f $(LOG_DIR)/proxmox2mqtt.log; \
	else \
		echo "$(YELLOW)⚠️  Aucun log trouvé. Démarrez l'application d'abord.$(NC)"; \
	fi

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

.PHONY: restart
restart: ## Redémarre l'application (stop + start)
	@echo "$(CYAN)🔄 Redémarrage de $(PROJECT_NAME)...$(NC)"
	@pkill -f "node src/index.js" || true
	@sleep 2
	@make start

.PHONY: stop
stop: ## Arrête l'application
	@echo "$(CYAN)🛑 Arrêt de $(PROJECT_NAME)...$(NC)"
	@if pgrep -f "node src/index.js" > /dev/null; then \
		echo "$(YELLOW)   Envoi du signal SIGTERM...$(NC)"; \
		pkill -TERM -f "node src/index.js"; \
		sleep 3; \
		if pgrep -f "node src/index.js" > /dev/null; then \
			echo "$(YELLOW)   Arrêt forcé (SIGKILL)...$(NC)"; \
			pkill -KILL -f "node src/index.js"; \
		fi; \
		echo "$(GREEN)✓ Application arrêtée$(NC)"; \
	else \
		echo "$(YELLOW)⚠️  Aucun processus $(PROJECT_NAME) trouvé$(NC)"; \
	fi

.PHONY: stop-all
stop-all: ## Arrête toutes les instances Node.js liées au projet
	@echo "$(CYAN)🛑 Arrêt de toutes les instances...$(NC)"
	@pkill -f "proxmox2mqtt" || echo "$(YELLOW)⚠️  Aucun processus trouvé$(NC)"
	@echo "$(GREEN)✓ Toutes les instances arrêtées$(NC)"

.PHONY: ps
ps: ## Affiche les processus Node.js en cours
	@echo "$(CYAN)📊 Processus Node.js actifs:$(NC)"
	@ps aux | grep -E "(node|npm)" | grep -v grep || echo "$(YELLOW)⚠️  Aucun processus Node.js trouvé$(NC)"

.PHONY: update
update: ## Met à jour les dépendances NPM
	@echo "$(CYAN)📦 Mise à jour des dépendances...$(NC)"
	npm update
	@echo "$(GREEN)✓ Dépendances mises à jour$(NC)"

.PHONY: audit
audit: ## Vérifie les vulnérabilités de sécurité
	@echo "$(CYAN)🔒 Audit de sécurité...$(NC)"
	npm audit

.PHONY: info
info: ## Affiche les informations détaillées du projet
	@echo "$(CYAN)ℹ️  Informations détaillées:$(NC)"
	@echo ""
	@echo "$(YELLOW)📋 Projet:$(NC)"
	@echo "   Nom: $(PROJECT_NAME)"
	@echo "   Version: $(shell grep '"version"' package.json | cut -d'"' -f4)"
	@echo "   Description: $(shell grep '"description"' package.json | cut -d'"' -f4)"
	@echo ""
	@echo "$(YELLOW)🎯 Objectif:$(NC)"
	@echo "   Connecter un cluster Proxmox à Home Assistant"
	@echo "   via MQTT avec auto-discovery"
	@echo ""
	@echo "$(YELLOW)🏗️  Architecture:$(NC)"
	@echo "   Proxmox API ↔ Node.js Bridge ↔ MQTT Broker ↔ Home Assistant"

.PHONY: menu
menu: help ## Alias pour help

# Cible pour les développeurs
.PHONY: docker-build
docker-build: ## Construit l'image Docker (future fonctionnalité)
	@echo "$(YELLOW)🐳 Construction Docker non implémentée$(NC)"
	@echo "$(BLUE)   Cette fonctionnalité sera ajoutée prochainement$(NC)"

.PHONY: all
all: setup check ## Configuration complète + vérifications