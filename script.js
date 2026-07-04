/* =============================================
   SMART HOME - APPLICATION COMPLÈTE v2.0
   Caméras fonctionnelles (téléphone + IP)
   ============================================= */

class SmartHomeApp {
    constructor() {
        // ========== CONFIGURATION ==========
        this.HOME_LATITUDE = 48.8566;    // ← REMPLACEZ PAR VOTRE LATITUDE
        this.HOME_LONGITUDE = 2.3522;    // ← REMPLACEZ PAR VOTRE LONGITUDE
        this.PROXIMITY_RADIUS = 2;       // 2 mètres
        this.VALID_USERNAME = 'admin';
        this.VALID_PASSWORD = 'admin123';

        // ========== ÉTAT DE L'APPLICATION ==========
        this.isLoggedIn = false;
        this.currentUser = null;
        this.isInProximity = false;
        this.geoWatchId = null;
        this.currentConfigCameraId = null;
        this.activeStreams = new Map(); // Pour tracker les flux actifs

        // ========== APPAREILS PAR DÉFAUT ==========
        this.devices = [
            { 
                id: 'door-1', name: 'Porte Principale', type: 'door', 
                room: 'Entrée', status: 'closed', icon: 'fa-door-closed' 
            },
            { 
                id: 'door-2', name: 'Porte Arrière', type: 'door', 
                room: 'Cuisine', status: 'closed', icon: 'fa-door-closed' 
            },
            { 
                id: 'window-1', name: 'Fenêtre Salon', type: 'window', 
                room: 'Salon', status: 'closed', icon: 'fa-window-maximize' 
            },
            { 
                id: 'window-2', name: 'Fenêtre Chambre', type: 'window', 
                room: 'Chambre', status: 'closed', icon: 'fa-window-maximize' 
            },
            { 
                id: 'light-1', name: 'Plafond Salon', type: 'light', 
                room: 'Salon', status: 'off', icon: 'fa-lightbulb' 
            },
            { 
                id: 'light-2', name: 'Lampe Cuisine', type: 'light', 
                room: 'Cuisine', status: 'off', icon: 'fa-lightbulb' 
            },
            { 
                id: 'light-3', name: 'Lumière Chambre', type: 'light', 
                room: 'Chambre', status: 'off', icon: 'fa-lightbulb' 
            },
            { 
                id: 'camera-1', name: 'Caméra Entrée', type: 'camera', 
                room: 'Entrée', status: 'online', icon: 'fa-video',
                cameraUrl: null, streamType: null // 'local' ou 'remote'
            },
            { 
                id: 'camera-2', name: 'Caméra Jardin', type: 'camera', 
                room: 'Jardin', status: 'online', icon: 'fa-video',
                cameraUrl: null, streamType: null
            },
        ];

        this.notifications = [];
        this.activityLog = [];

        // ========== DÉMARRAGE ==========
        this.init();
    }

    /* ==================== INITIALISATION ==================== */
    init() {
        console.log('🏠 Smart Home - Initialisation...');
        this.loadData();
        this.setupEventListeners();
        
        if (this.isLoggedIn && this.currentUser) {
            this.showDashboard();
            this.startProximityCheck();
        }
        
        console.log('✅ Prêt. Appareils:', this.devices.length);
    }

    loadData() {
        try {
            const saved = localStorage.getItem('smartHomeDataV2');
            if (saved) {
                const data = JSON.parse(saved);
                this.devices = data.devices || this.devices;
                this.notifications = data.notifications || [];
                this.activityLog = data.activityLog || [];
                this.isLoggedIn = data.isLoggedIn || false;
                this.currentUser = data.currentUser || null;
                
                // Nettoyer les streams (ne peuvent pas être sérialisés)
                this.devices.forEach(d => {
                    d.localStream = null;
                    if (d.type === 'camera' && d.status === 'recording') {
                        d.status = 'online';
                    }
                });
            }
        } catch (e) {
            console.error('❌ Erreur chargement:', e);
        }
    }

    saveData() {
        try {
            // Créer une copie sans les streams (non sérialisables)
            const devicesCopy = this.devices.map(d => {
                const { localStream, ...rest } = d;
                return rest;
            });

            const data = {
                devices: devicesCopy,
                notifications: this.notifications,
                activityLog: this.activityLog,
                isLoggedIn: this.isLoggedIn,
                currentUser: this.currentUser
            };
            localStorage.setItem('smartHomeDataV2', JSON.stringify(data));
        } catch (e) {
            console.error('❌ Erreur sauvegarde:', e);
        }
    }

    setupEventListeners() {
        // Login
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.login();
            });
        }

        // Onglets
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.addEventListener('click', () => {
                this.switchTab(btn.dataset.tab);
            });
        });

        // Overlay du panneau notifications
        const overlay = document.getElementById('panel-overlay');
        if (overlay) {
            overlay.addEventListener('click', () => this.toggleNotificationPanel());
        }

        // Fermer modals en cliquant dehors
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    this.closeAddDeviceModal();
                    this.closeConfigCameraModal();
                }
            });
        });

        // Raccourcis clavier
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAddDeviceModal();
                this.closeConfigCameraModal();
                if (document.getElementById('notification-panel')?.classList.contains('active')) {
                    this.toggleNotificationPanel();
                }
            }
            if (e.ctrlKey && e.key === 'p') {
                e.preventDefault();
                this.simulateProximity();
            }
        });

        // Nettoyer les flux en quittant la page
        window.addEventListener('beforeunload', () => {
            this.stopAllCameraStreams();
        });

        // Gérer la visibilité de la page
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                // Page cachée : on garde les flux mais on log
                console.log('📱 Page en arrière-plan');
            } else {
                // Page visible : rafraîchir les flux
                console.log('📱 Page visible - rafraîchissement flux');
                this.refreshAllVideoStreams();
            }
        });
    }

    /* ==================== AUTHENTIFICATION ==================== */
    login() {
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value.trim();
        const errorEl = document.getElementById('login-error');

        if (!username || !password) {
            this.showLoginError('Veuillez remplir tous les champs');
            return;
        }

        if (username === this.VALID_USERNAME && password === this.VALID_PASSWORD) {
            this.isLoggedIn = true;
            this.currentUser = {
                username: username,
                initial: username.charAt(0).toUpperCase(),
                loginTime: new Date().toISOString()
            };

            errorEl.classList.remove('show');
            this.saveData();
            this.showDashboard();
            this.startProximityCheck();
            this.addActivity('Connexion réussie', 'login', '🔑');
            this.showToast('Bienvenue ' + username + ' ! 🏠', 'success');
        } else {
            this.showLoginError('Nom d\'utilisateur ou mot de passe incorrect');
        }
    }

    showLoginError(message) {
        const errorEl = document.getElementById('login-error');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.classList.add('show');
            setTimeout(() => errorEl.classList.remove('show'), 3000);
        }
    }

    logout() {
        // Arrêter TOUS les flux vidéo
        this.stopAllCameraStreams();
        
        this.isLoggedIn = false;
        this.currentUser = null;
        this.stopProximityCheck();

        document.getElementById('dashboard-screen').classList.remove('active');
        document.getElementById('login-screen').classList.add('active');

        document.getElementById('login-username').value = '';
        document.getElementById('login-password').value = '';

        this.saveData();
    }

    showDashboard() {
        document.getElementById('login-screen').classList.remove('active');
        document.getElementById('dashboard-screen').classList.add('active');

        document.getElementById('user-avatar').textContent = this.currentUser.initial;
        document.getElementById('user-name').textContent = this.currentUser.username;

        this.updateConnectionUI();
        this.switchTab('dashboard');
        this.renderAll();
    }

    /* ==================== PROXIMITÉ GPS ==================== */
    startProximityCheck() {
        if (!navigator.geolocation) {
            this.isInProximity = false;
            this.updateConnectionUI();
            return;
        }

        this.geoWatchId = navigator.geolocation.watchPosition(
            (position) => this.handlePositionUpdate(position),
            (error) => this.handleGeoError(error),
            {
                enableHighAccuracy: true,
                maximumAge: 3000,
                timeout: 10000
            }
        );
    }

    handlePositionUpdate(position) {
        const distance = this.calculateDistance(
            position.coords.latitude,
            position.coords.longitude,
            this.HOME_LATITUDE,
            this.HOME_LONGITUDE
        );

        const wasInProximity = this.isInProximity;
        this.isInProximity = distance <= this.PROXIMITY_RADIUS;

        if (wasInProximity !== this.isInProximity) {
            this.updateConnectionUI();
            this.renderAll();

            if (this.isInProximity) {
                this.addNotification('📍 Vous êtes à proximité - Accès complet', 'info');
                this.addActivity('Entré dans la zone de proximité', 'location', '📍');
            } else {
                this.addNotification('📍 Vous êtes trop loin - Accès restreint', 'warning');
                this.addActivity('Sorti de la zone de proximité', 'location', '📍');
            }
        }

        const distanceText = document.getElementById('distance-text');
        if (distanceText) {
            const distFormatted = distance < 1 ? 
                `${(distance * 100).toFixed(0)} cm` : 
                `${distance.toFixed(1)} m`;
            distanceText.textContent = ` (${distFormatted})`;
        }
    }

    handleGeoError(error) {
        console.warn('⚠️ Géolocalisation:', error.message);
        this.isInProximity = false;
        this.updateConnectionUI();
        this.renderAll();
    }

    stopProximityCheck() {
        if (this.geoWatchId !== null) {
            navigator.geolocation.clearWatch(this.geoWatchId);
            this.geoWatchId = null;
        }
        this.isInProximity = false;
        this.updateConnectionUI();
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const dLat = this.toRad(lat2 - lat1);
        const dLon = this.toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    toRad(degrees) {
        return degrees * Math.PI / 180;
    }

    simulateProximity() {
        this.isInProximity = !this.isInProximity;
        this.updateConnectionUI();
        this.renderAll();

        const msg = this.isInProximity ? 
            '📍 Proximité simulée ACTIVÉE' : 
            '📍 Proximité simulée DÉSACTIVÉE';
        this.showToast(msg, this.isInProximity ? 'success' : 'warning');
    }

    /* ==================== CONTRÔLE DES APPAREILS ==================== */
    canControl() {
        if (!this.isInProximity) {
            this.showToast('❌ Vous devez être à moins de 2 mètres', 'error');
            return false;
        }
        return true;
    }

    toggleDevice(deviceId) {
        if (!this.canControl()) return;

        const device = this.devices.find(d => d.id === deviceId);
        if (!device || device.type === 'camera') return;

        switch(device.type) {
            case 'door':
            case 'window':
                device.status = device.status === 'open' ? 'closed' : 'open';
                break;
            case 'light':
                device.status = device.status === 'on' ? 'off' : 'on';
                break;
        }

        const actionText = this.getActionText(device);
        const emoji = this.getDeviceEmoji(device.type);
        
        this.addNotification(`${emoji} ${device.name} ${actionText}`, 'info');
        this.addActivity(`${device.name} ${actionText}`, device.type, emoji);
        this.showToast(`${device.name} ${actionText}`, 'success');
        
        this.saveData();
        this.renderAll();
    }

    toggleAllLights() {
        if (!this.canControl()) return;

        const lights = this.devices.filter(d => d.type === 'light');
        if (lights.length === 0) {
            this.showToast('Aucune lumière à contrôler', 'info');
            return;
        }

        const anyOn = lights.some(l => l.status === 'on');
        lights.forEach(light => {
            light.status = anyOn ? 'off' : 'on';
        });

        const action = anyOn ? 'éteintes' : 'allumées';
        this.addNotification(`💡 Toutes les lumières ${action}`, 'info');
        this.addActivity(`Toutes les lumières ${action}`, 'light', '💡');
        this.showToast(`Toutes les lumières sont ${action}`, 'success');
        
        this.saveData();
        this.renderAll();
    }

    closeAllDoorsWindows() {
        if (!this.canControl()) return;

        const items = this.devices.filter(d => d.type === 'door' || d.type === 'window');
        let closedCount = 0;

        items.forEach(item => {
            if (item.status === 'open') {
                item.status = 'closed';
                closedCount++;
            }
        });

        if (closedCount > 0) {
            this.addNotification(`🔒 ${closedCount} ouverture(s) fermée(s)`, 'info');
            this.addActivity(`${closedCount} ouverture(s) fermée(s)`, 'system', '🔒');
            this.showToast(`${closedCount} ouverture(s) fermée(s)`, 'success');
            this.saveData();
            this.renderAll();
        } else {
            this.showToast('Tout est déjà fermé', 'info');
        }
    }

    getActionText(device) {
        if (device.type === 'door' || device.type === 'window') {
            return device.status === 'open' ? 'ouverte' : 'fermée';
        }
        if (device.type === 'light') {
            return device.status === 'on' ? 'allumée' : 'éteinte';
        }
        return 'modifié(e)';
    }

    getDeviceEmoji(type) {
        return { door: '🚪', window: '🪟', light: '💡', camera: '📹' }[type] || '📦';
    }

    /* ==================== CAMÉRAS - GESTION COMPLÈTE ==================== */

    /**
     * Ouvre le modal de configuration d'une caméra
     */
    openConfigCameraModal(deviceId) {
        const device = this.devices.find(d => d.id === deviceId);
        if (!device || device.type !== 'camera') return;

        this.currentConfigCameraId = deviceId;
        
        const urlInput = document.getElementById('config-camera-url');
        if (urlInput) {
            urlInput.value = device.cameraUrl || '';
        }
        
        document.getElementById('modal-config-camera').classList.add('active');
        
        // Afficher l'état actuel
        const statusText = device.localStream ? 
            '📱 Caméra téléphone active' : 
            (device.cameraUrl ? '🌐 Caméra IP configurée' : '❌ Aucun flux configuré');
        console.log('Configuration caméra:', device.name, '-', statusText);
    }

    /**
     * Ferme le modal de configuration
     */
    closeConfigCameraModal() {
        document.getElementById('modal-config-camera').classList.remove('active');
        this.currentConfigCameraId = null;
    }

    /**
     * Sauvegarde la configuration de la caméra (URL IP)
     */
    saveCameraConfig() {
        if (!this.currentConfigCameraId) return;

        const device = this.devices.find(d => d.id === this.currentConfigCameraId);
        if (!device) return;

        const url = document.getElementById('config-camera-url').value.trim();

        // Arrêter le flux local si existant
        if (device.localStream) {
            this.stopDeviceStream(device);
        }

        device.cameraUrl = url || null;
        device.streamType = url ? 'remote' : null;
        
        this.saveData();
        this.renderAll();
        this.closeConfigCameraModal();
        
        this.showToast('✅ Caméra configurée', 'success');
        this.addActivity(`Caméra ${device.name} configurée`, 'camera', '📹');
    }

    /**
     * Active la caméra du téléphone/PC
     */
    async usePhoneCamera() {
        if (!this.currentConfigCameraId) {
            console.error('❌ Aucune caméra sélectionnée');
            return;
        }

        const device = this.devices.find(d => d.id === this.currentConfigCameraId);
        if (!device) return;

        // Fermer le modal immédiatement pour voir le résultat
        this.closeConfigCameraModal();

        try {
            // Arrêter l'ancien flux proprement
            this.stopDeviceStream(device);

            console.log('📱 Demande d\'accès à la caméra...');
            
            // Demander la caméra avec des paramètres optimaux
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment', // Caméra arrière sur mobile
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            });

            console.log('✅ Caméra obtenue:', stream.getVideoTracks()[0].label);

            // Sauvegarder le flux
            device.localStream = stream;
            device.cameraUrl = null;
            device.streamType = 'local';
            device.status = 'recording';

            // Suivre l'état du flux
            const videoTrack = stream.getVideoTracks()[0];
            
            videoTrack.addEventListener('ended', () => {
                console.log('📴 Flux vidéo terminé');
                device.localStream = null;
                device.status = 'online';
                device.streamType = null;
                this.saveData();
                this.renderAll();
            });

            this.saveData();
            this.renderAll();

            // Attacher le flux après rendu
            setTimeout(() => {
                this.attachStreamToVideo(device.id, stream);
            }, 200);

            this.showToast('📱 Caméra activée ! Vous voyez le direct', 'success');
            this.addActivity(`Caméra ${device.name} : flux local activé`, 'camera', '📱');

        } catch (error) {
            console.error('❌ Erreur caméra:', error);
            
            let errorMsg = 'Erreur d\'accès à la caméra';
            if (error.name === 'NotAllowedError') {
                errorMsg = 'Accès caméra refusé. Autorisez dans les paramètres.';
            } else if (error.name === 'NotFoundError') {
                errorMsg = 'Aucune caméra trouvée sur cet appareil.';
            } else if (error.name === 'NotReadableError') {
                errorMsg = 'Caméra déjà utilisée. Fermez les autres apps.';
            }
            
            this.showToast('❌ ' + errorMsg, 'error');
        }
    }

    /**
     * Arrête le flux d'un appareil spécifique
     */
    stopDeviceStream(device) {
        if (!device || !device.localStream) return;

        console.log('🛑 Arrêt du flux:', device.name);
        
        device.localStream.getTracks().forEach(track => {
            track.stop();
            console.log('  - Track arrêtée:', track.kind);
        });
        
        device.localStream = null;
        device.streamType = null;
        
        if (device.type === 'camera' && device.status === 'recording') {
            device.status = 'online';
        }
    }

    /**
     * Arrête TOUS les flux caméra
     */
    stopAllCameraStreams() {
        console.log('📴 Arrêt de tous les flux...');
        this.devices.forEach(device => {
            if (device.localStream) {
                this.stopDeviceStream(device);
            }
        });
        this.activeStreams.clear();
    }

    /**
     * Attache un flux vidéo à l'élément HTML
     */
    attachStreamToVideo(deviceId, stream) {
        const videoEl = document.getElementById(`video-${deviceId}`);
        if (videoEl && stream && stream.active) {
            videoEl.srcObject = stream;
            videoEl.muted = true;
            videoEl.playsInline = true;
            
            videoEl.play()
                .then(() => console.log('▶️ Lecture vidéo OK:', deviceId))
                .catch(e => console.warn('⚠️ Erreur lecture:', e));
        } else {
            console.warn('⚠️ Impossible d\'attacher le flux:', deviceId);
        }
    }

    /**
     * Rafraîchit tous les flux vidéo actifs
     */
    refreshAllVideoStreams() {
        let refreshed = 0;
        this.devices.forEach(device => {
            if (device.type === 'camera' && device.localStream && device.localStream.active) {
                setTimeout(() => {
                    this.attachStreamToVideo(device.id, device.localStream);
                    refreshed++;
                }, 100);
            }
        });
        if (refreshed > 0) {
            console.log('🔄 Flux rafraîchis:', refreshed);
        }
    }

    /* ==================== APPAREILS (AJOUTER/SUPPRIMER) ==================== */
    openAddDeviceModal() {
        document.getElementById('modal-add-device').classList.add('active');
        document.getElementById('new-device-name').focus();
        this.onDeviceTypeChange();
    }

    closeAddDeviceModal() {
        document.getElementById('modal-add-device').classList.remove('active');
        document.getElementById('new-device-name').value = '';
        document.getElementById('new-device-room').value = '';
        document.getElementById('new-camera-url').value = '';
        document.getElementById('camera-url-group').style.display = 'none';
    }

    onDeviceTypeChange() {
        const type = document.getElementById('new-device-type').value;
        const urlGroup = document.getElementById('camera-url-group');
        if (urlGroup) {
            urlGroup.style.display = type === 'camera' ? 'block' : 'none';
        }
    }

    addDevice() {
        const name = document.getElementById('new-device-name').value.trim();
        const type = document.getElementById('new-device-type').value;
        const room = document.getElementById('new-device-room').value.trim();
        const cameraUrl = document.getElementById('new-camera-url')?.value.trim() || null;

        if (!name) {
            this.showToast('Veuillez entrer un nom', 'error');
            return;
        }

        const icons = {
            door: 'fa-door-closed',
            window: 'fa-window-maximize',
            light: 'fa-lightbulb',
            camera: 'fa-video'
        };

        const newDevice = {
            id: type + '-' + Date.now(),
            name: name,
            type: type,
            room: room || 'Non spécifié',
            status: type === 'camera' ? 'online' : (type === 'light' ? 'off' : 'closed'),
            icon: icons[type],
            cameraUrl: type === 'camera' ? cameraUrl : null,
            streamType: type === 'camera' && cameraUrl ? 'remote' : null,
            localStream: null
        };

        this.devices.push(newDevice);
        
        this.addNotification(`✅ ${name} ajouté(e)`, 'success');
        this.addActivity(`${name} ajouté(e)`, 'system', this.getDeviceEmoji(type));
        
        this.saveData();
        this.renderAll();
        this.closeAddDeviceModal();
        this.showToast(`${name} ajouté !`, 'success');
    }

    deleteDevice(deviceId) {
        if (!this.canControl()) return;

        const device = this.devices.find(d => d.id === deviceId);
        if (!device) return;

        if (confirm(`Supprimer "${device.name}" ?`)) {
            // Arrêter le flux si caméra
            if (device.localStream) {
                this.stopDeviceStream(device);
            }

            this.devices = this.devices.filter(d => d.id !== deviceId);
            
            this.addNotification(`🗑️ ${device.name} supprimé(e)`, 'info');
            this.addActivity(`${device.name} supprimé(e)`, 'system', '🗑️');
            
            this.saveData();
            this.renderAll();
            this.showToast(`${device.name} supprimé(e)`, 'info');
        }
    }

    /* ==================== RENDU DE L'INTERFACE ==================== */
    renderAll() {
        this.renderDashboard();
        this.renderDoorsWindows();
        this.renderLights();
        this.renderCameras();
        this.renderActivity();
        this.renderNotifications();
        this.updateNotificationBadge();
        
        // Rafraîchir les flux vidéo
        setTimeout(() => this.refreshAllVideoStreams(), 300);
    }

    renderDashboard() {
        const doors = this.devices.filter(d => d.type === 'door');
        const windows = this.devices.filter(d => d.type === 'window');
        const lights = this.devices.filter(d => d.type === 'light');
        const cameras = this.devices.filter(d => d.type === 'camera');

        this.setElementText('summary-doors', `${doors.filter(d => d.status === 'open').length}/${doors.length}`);
        this.setElementText('summary-windows', `${windows.filter(d => d.status === 'open').length}/${windows.length}`);
        this.setElementText('summary-lights', `${lights.filter(l => l.status === 'on').length}/${lights.length}`);
        this.setElementText('summary-cameras', cameras.filter(c => c.status === 'online' || c.status === 'recording').length);

        const quickGrid = document.getElementById('quick-access-grid');
        if (quickGrid) {
            const allDevices = [...doors, ...windows, ...lights, ...cameras].slice(0, 6);
            quickGrid.innerHTML = allDevices.length > 0 ?
                allDevices.map(d => this.createDeviceCard(d)).join('') :
                '<div class="empty-state"><i class="fas fa-plug"></i><p>Aucun appareil</p></div>';
        }

        const recentActivity = document.getElementById('recent-activity');
        if (recentActivity) {
            recentActivity.innerHTML = this.activityLog.length > 0 ?
                this.activityLog.slice(0, 5).map(a => this.createActivityItem(a)).join('') :
                '<div class="empty-state"><i class="fas fa-history"></i><p>Aucune activité</p></div>';
        }
    }

    renderDoorsWindows() {
        const grid = document.getElementById('doors-windows-grid');
        if (!grid) return;

        const items = this.devices.filter(d => d.type === 'door' || d.type === 'window');
        grid.innerHTML = items.length > 0 ?
            items.map(d => this.createDeviceCard(d)).join('') :
            '<div class="empty-state"><i class="fas fa-door-closed"></i><p>Aucune porte ou fenêtre</p></div>';
    }

    renderLights() {
        const grid = document.getElementById('lights-grid');
        if (!grid) return;

        const lights = this.devices.filter(d => d.type === 'light');
        grid.innerHTML = lights.length > 0 ?
            lights.map(d => this.createDeviceCard(d)).join('') :
            '<div class="empty-state"><i class="fas fa-lightbulb"></i><p>Aucune lumière</p></div>';

        const btnAllLights = document.getElementById('btn-all-lights');
        if (btnAllLights && lights.length > 0) {
            const anyOn = lights.some(l => l.status === 'on');
            btnAllLights.innerHTML = anyOn ?
                '<i class="fas fa-power-off"></i> Tout éteindre' :
                '<i class="fas fa-power-off"></i> Tout allumer';
        }
    }

    renderCameras() {
        const grid = document.getElementById('cameras-grid');
        if (!grid) return;

        const cameras = this.devices.filter(d => d.type === 'camera');
        grid.innerHTML = cameras.length > 0 ?
            cameras.map(d => this.createDeviceCard(d)).join('') :
            '<div class="empty-state"><i class="fas fa-video-slash"></i><p>Aucune caméra</p></div>';
    }

    createDeviceCard(device) {
        const statusClass = this.getStatusClass(device);
        const statusText = this.getStatusText(device);
        const isControllable = device.type !== 'camera';
        const disabled = !this.isInProximity && isControllable ? 'disabled' : '';

        // Contrôles selon le type
        let controlsHtml = '';
        
        if (device.type === 'light') {
            controlsHtml = `
                <label class="toggle-switch">
                    <input type="checkbox" ${device.status === 'on' ? 'checked' : ''} 
                           onchange="app.toggleDevice('${device.id}')" ${disabled}>
                    <span class="toggle-slider"></span>
                </label>
            `;
        } else if (device.type === 'door' || device.type === 'window') {
            controlsHtml = `
                <button class="btn ${device.status === 'open' ? 'btn-danger' : 'btn-primary'} btn-sm" 
                        onclick="app.toggleDevice('${device.id}')" ${disabled}>
                    <i class="fas fa-${device.status === 'open' ? 'lock' : 'lock-open'}"></i>
                    ${device.status === 'open' ? 'Fermer' : 'Ouvrir'}
                </button>
            `;
        } else if (device.type === 'camera') {
            controlsHtml = `
                <button class="btn btn-outline btn-sm" 
                        onclick="app.openConfigCameraModal('${device.id}')" 
                        data-always-enabled="true">
                    <i class="fas fa-cog"></i> Configurer
                </button>
                ${device.localStream ? `
                    <button class="btn btn-danger btn-sm" 
                            onclick="app.stopDeviceStream(app.devices.find(d=>d.id==='${device.id}')); app.saveData(); app.renderAll();" 
                            data-always-enabled="true">
                        <i class="fas fa-stop"></i> Arrêter
                    </button>
                ` : ''}
            `;
        }

        // Affichage caméra
        let cameraHtml = '';
        if (device.type === 'camera') {
            if (device.localStream) {
                // Flux local (caméra du téléphone)
                cameraHtml = `
                    <div class="camera-container" style="background:#000;">
                        <video class="camera-feed-video" 
                               id="video-${device.id}" 
                               autoplay playsinline muted
                               style="width:100%;height:100%;object-fit:cover;">
                        </video>
                        <div class="camera-recording-badge">● DIRECT</div>
                    </div>
                `;
            } else if (device.cameraUrl) {
                // Flux distant (caméra IP)
                cameraHtml = `
                    <div class="camera-container">
                        <img class="camera-feed-img" 
                             id="img-${device.id}" 
                             src="${device.cameraUrl}" 
                             alt="Flux ${device.name}"
                             onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
                             onload="this.style.display='block';"
                             style="width:100%;height:100%;object-fit:cover;">
                        <div class="camera-error" style="display:none;">
                            <i class="fas fa-exclamation-triangle"></i>
                            <p>Flux inaccessible</p>
                            <small>Vérifiez l'URL ou le réseau</small>
                        </div>
                    </div>
                `;
            } else {
                // Aucun flux configuré
                cameraHtml = `
                    <div class="camera-container">
                        <div class="camera-placeholder">
                            <i class="fas fa-video-slash"></i>
                            <p>Aucun flux</p>
                            <small>Cliquez sur Configurer</small>
                        </div>
                    </div>
                `;
            }
        }

        return `
            <div class="device-card type-${device.type}">
                <div class="device-card-header">
                    <div class="device-card-icon">
                        <i class="fas ${device.icon}"></i>
                    </div>
                    <span class="device-status-badge ${statusClass}">${statusText}</span>
                </div>
                <div class="device-card-name">${device.name}</div>
                <div class="device-card-room">
                    <i class="fas fa-map-marker-alt"></i> ${device.room}
                </div>
                ${cameraHtml}
                <div class="device-card-actions">
                    ${controlsHtml}
                    <button class="btn btn-outline btn-sm" 
                            onclick="app.deleteDevice('${device.id}')"
                            ${!this.isInProximity ? 'disabled' : ''} 
                            title="Supprimer">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }

    getStatusClass(device) {
        const openStatuses = ['open', 'on', 'online', 'recording'];
        return openStatuses.includes(device.status) ? 'open' : 'closed';
    }

    getStatusText(device) {
        const texts = {
            door: { open: 'Ouverte', closed: 'Fermée' },
            window: { open: 'Ouverte', closed: 'Fermée' },
            light: { on: 'Allumée', off: 'Éteinte' },
            camera: { online: 'En ligne', offline: 'Hors ligne', recording: 'En direct' }
        };
        return texts[device.type]?.[device.status] || device.status;
    }

    /* ==================== ACTIVITÉ ==================== */
    renderActivity() {
        const fullActivity = document.getElementById('full-activity');
        if (!fullActivity) return;

        fullActivity.innerHTML = this.activityLog.length > 0 ?
            this.activityLog.map(a => this.createActivityItem(a)).join('') :
            '<div class="empty-state"><i class="fas fa-history"></i><p>Aucune activité</p></div>';
    }

    createActivityItem(activity) {
        return `
            <div class="activity-item">
                <span class="activity-icon">${activity.emoji || '📝'}</span>
                <span class="activity-message">${activity.message}</span>
                <span class="activity-time">${this.formatTime(activity.timestamp)}</span>
            </div>
        `;
    }

    addActivity(message, type, emoji = '📝') {
        this.activityLog.unshift({
            message, type, emoji,
            timestamp: new Date().toISOString()
        });

        if (this.activityLog.length > 200) {
            this.activityLog = this.activityLog.slice(0, 200);
        }

        this.renderActivity();
        this.saveData();
    }

    clearActivity() {
        if (confirm('Effacer tout l\'historique ?')) {
            this.activityLog = [];
            this.saveData();
            this.renderAll();
            this.showToast('Historique effacé', 'info');
        }
    }

    /* ==================== NOTIFICATIONS ==================== */
    addNotification(message, type = 'info') {
        this.notifications.unshift({
            message, type,
            timestamp: new Date().toISOString(),
            read: false
        });

        if (this.notifications.length > 100) {
            this.notifications = this.notifications.slice(0, 100);
        }

        this.updateNotificationBadge();
        this.renderNotifications();
        this.saveData();
    }

    renderNotifications() {
        const list = document.getElementById('notification-list');
        if (!list) return;

        list.innerHTML = this.notifications.length > 0 ?
            this.notifications.map((n, i) => `
                <div class="notification-item ${n.read ? '' : 'unread'}" 
                     onclick="app.markNotificationRead(${i})">
                    <span class="notif-icon">${this.getNotifIcon(n.type)}</span>
                    <div class="notif-content">
                        <div>${n.message}</div>
                        <div class="notif-time">${this.formatTime(n.timestamp)}</div>
                    </div>
                </div>
            `).join('') :
            '<div class="empty-state"><i class="fas fa-bell-slash"></i><p>Aucune notification</p></div>';
    }

    getNotifIcon(type) {
        return { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' }[type] || '📢';
    }

    markNotificationRead(index) {
        if (this.notifications[index]) {
            this.notifications[index].read = true;
            this.updateNotificationBadge();
            this.renderNotifications();
            this.saveData();
        }
    }

    clearNotifications() {
        this.notifications = [];
        this.updateNotificationBadge();
        this.renderNotifications();
        this.saveData();
        this.showToast('Notifications effacées', 'info');
    }

    updateNotificationBadge() {
        const badge = document.getElementById('notification-badge');
        if (!badge) return;

        const unread = this.notifications.filter(n => !n.read).length;
        badge.textContent = unread > 99 ? '99+' : unread;
        
        if (unread > 0) {
            badge.classList.add('show');
        } else {
            badge.classList.remove('show');
        }
    }

    toggleNotificationPanel() {
        const panel = document.getElementById('notification-panel');
        const overlay = document.getElementById('panel-overlay');
        
        if (!panel) return;
        
        const isActive = panel.classList.contains('active');
        
        if (isActive) {
            panel.classList.remove('active');
            if (overlay) overlay.classList.remove('active');
        } else {
            panel.classList.add('active');
            if (overlay) overlay.classList.add('active');
            this.renderNotifications();
        }
    }

    /* ==================== NAVIGATION ==================== */
    switchTab(tabName) {
        document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));

        const tabBtn = document.querySelector(`.tab-button[data-tab="${tabName}"]`);
        const tabPanel = document.getElementById(`panel-${tabName}`);

        if (tabBtn) tabBtn.classList.add('active');
        if (tabPanel) tabPanel.classList.add('active');

        switch(tabName) {
            case 'dashboard': this.renderDashboard(); break;
            case 'devices': this.renderDoorsWindows(); break;
            case 'lights': this.renderLights(); break;
            case 'cameras': this.renderCameras(); break;
            case 'activity': this.renderActivity(); break;
        }

        // Rafraîchir les flux vidéo après changement d'onglet
        setTimeout(() => this.refreshAllVideoStreams(), 200);
    }

    /* ==================== INTERFACE UTILISATEUR ==================== */
    updateConnectionUI() {
        const badge = document.getElementById('connection-badge');
        const text = document.getElementById('connection-text');
        const alert = document.getElementById('proximity-alert');

        if (!badge || !text) return;

        badge.className = 'connection-badge';
        
        if (this.isInProximity) {
            badge.classList.add('local');
            text.textContent = 'Connecté (Local)';
        } else if (this.isLoggedIn) {
            badge.classList.add('remote');
            text.textContent = 'Distant (Lecture seule)';
        } else {
            badge.classList.add('disconnected');
            text.textContent = 'Déconnecté';
        }

        if (alert) {
            alert.classList.toggle('show', !this.isInProximity && this.isLoggedIn);
        }
    }

    setElementText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    /* ==================== TOASTS ==================== */
    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const icons = {
            success: '<i class="fas fa-check-circle"></i>',
            error: '<i class="fas fa-times-circle"></i>',
            warning: '<i class="fas fa-exclamation-triangle"></i>',
            info: '<i class="fas fa-info-circle"></i>'
        };

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `${icons[type] || icons.info} ${message}`;
        container.appendChild(toast);

        setTimeout(() => toast.remove(), 3000);
    }

    /* ==================== UTILITAIRES ==================== */
    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffSec = Math.floor((now - date) / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHour = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHour / 24);

        if (diffSec < 10) return 'À l\'instant';
        if (diffSec < 60) return `Il y a ${diffSec}s`;
        if (diffMin < 60) return `Il y a ${diffMin}min`;
        if (diffHour < 24) return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        if (diffDay < 7) return `Il y a ${diffDay}j`;
        return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    }
}

/* ==================== INITIALISATION ==================== */
const app = new SmartHomeApp();
console.log('✅ Smart Home prêt !');
console.log('💡 Conseil : Ctrl+P pour simuler la proximité');
console.log('📹 Caméras : Configurer > Utiliser caméra téléphone');