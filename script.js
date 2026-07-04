/* =============================================
   SMART HOME PRO - APPLICATION COMPLÈTE v3.0
   Inscription • Connexion • Profil • Multi-utilisateurs
   Portes • Fenêtres • Lumières • Caméras
   Captures • Enregistrements • Arduino
   ============================================= */

class SmartHomeApp {
    constructor() {
        // Configuration GPS
        this.HOME_LATITUDE = 48.8566;
        this.HOME_LONGITUDE = 2.3522;
        this.PROXIMITY_RADIUS = 2;

        // État
        this.isLoggedIn = false;
        this.currentUser = null;
        this.isInProximity = false;
        this.geoWatchId = null;
        this.currentConfigCameraId = null;
        this.recordingTimers = {};
        this.rememberMe = false;

        // Utilisateurs
        this.users = [];
        this.defaultAdmin = {
            username: 'admin',
            email: 'admin@smarthome.local',
            password: 'admin123',
            createdAt: new Date().toISOString(),
            isAdmin: true
        };

        // Appareils par défaut
        this.devices = [
            { id: 'door-1', name: 'Porte Principale', type: 'door', room: 'Entrée', status: 'closed', icon: 'fa-door-closed' },
            { id: 'door-2', name: 'Porte Arrière', type: 'door', room: 'Cuisine', status: 'closed', icon: 'fa-door-closed' },
            { id: 'window-1', name: 'Fenêtre Salon', type: 'window', room: 'Salon', status: 'closed', icon: 'fa-window-maximize' },
            { id: 'window-2', name: 'Fenêtre Chambre', type: 'window', room: 'Chambre', status: 'closed', icon: 'fa-window-maximize' },
            { id: 'light-1', name: 'Plafond Salon', type: 'light', room: 'Salon', status: 'off', icon: 'fa-lightbulb' },
            { id: 'light-2', name: 'Lampe Cuisine', type: 'light', room: 'Cuisine', status: 'off', icon: 'fa-lightbulb' },
            { id: 'light-3', name: 'Lumière Chambre', type: 'light', room: 'Chambre', status: 'off', icon: 'fa-lightbulb' },
            { id: 'camera-1', name: 'Caméra Entrée', type: 'camera', room: 'Entrée', status: 'online', icon: 'fa-video', cameraUrl: null, streamType: null, localStream: null, captures: [], motionDetection: false, motionInterval: null },
            { id: 'camera-2', name: 'Caméra Jardin', type: 'camera', room: 'Jardin', status: 'online', icon: 'fa-video', cameraUrl: null, streamType: null, localStream: null, captures: [], motionDetection: false, motionInterval: null },
        ];

        // Configuration Arduino
        this.arduinoDevices = {};

        this.notifications = [];
        this.activityLog = [];
        this.init();
    }

    /* ==================== INITIALISATION ==================== */
    init() {
        console.log('🏠 Smart Home Pro v3.0 - Initialisation...');
        this.loadData();
        this.loadUsers();
        this.loadArduinoConfig();
        this.setupEventListeners();

        if (this.users.length === 0) {
            this.createDefaultAdmin();
        }

        if (this.isLoggedIn && this.currentUser) {
            this.showDashboard();
            this.startProximityCheck();
        }
        console.log('✅ Prêt. Utilisateurs:', this.users.length, '| Appareils:', this.devices.length);
    }

    loadData() {
        try {
            const saved = localStorage.getItem('smartHomeProDataV3');
            if (saved) {
                const data = JSON.parse(saved);
                this.devices = data.devices || this.devices;
                this.notifications = data.notifications || [];
                this.activityLog = data.activityLog || [];
                this.isLoggedIn = data.isLoggedIn || false;
                this.currentUser = data.currentUser || null;
                this.devices.forEach(d => { d.localStream = null; d.motionInterval = null; if (d.type === 'camera' && d.status === 'recording') d.status = 'online'; });
            }
        } catch (e) { console.error('❌ Erreur chargement:', e); }
    }

    saveData() {
        try {
            const devicesCopy = this.devices.map(d => {
                const { localStream, motionInterval, ...rest } = d;
                return rest;
            });
            localStorage.setItem('smartHomeProDataV3', JSON.stringify({
                devices: devicesCopy,
                notifications: this.notifications,
                activityLog: this.activityLog,
                isLoggedIn: this.isLoggedIn,
                currentUser: this.currentUser
            }));
        } catch (e) { console.error('❌ Erreur sauvegarde:', e); }
    }

    setupEventListeners() {
        const loginForm = document.getElementById('login-form');
        if (loginForm) loginForm.addEventListener('submit', (e) => { e.preventDefault(); this.login(); });

        const registerForm = document.getElementById('register-form');
        if (registerForm) registerForm.addEventListener('submit', (e) => { e.preventDefault(); this.register(); });

        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });

        const overlay = document.getElementById('panel-overlay');
        if (overlay) overlay.addEventListener('click', () => this.toggleNotificationPanel());

        document.querySelectorAll('.modal-overlay').forEach(ov => {
            ov.addEventListener('click', (e) => { if (e.target === ov) { this.closeAddDeviceModal(); this.closeConfigCameraModal(); this.closeProfileModal(); } });
        });

        const regPassword = document.getElementById('reg-password');
        if (regPassword) regPassword.addEventListener('input', () => this.checkPasswordStrength(regPassword.value));

        const regConfirm = document.getElementById('reg-confirm-password');
        if (regConfirm) regConfirm.addEventListener('input', () => this.checkPasswordMatch());

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAddDeviceModal(); this.closeConfigCameraModal(); this.closeProfileModal();
                if (document.getElementById('notification-panel')?.classList.contains('active')) this.toggleNotificationPanel();
            }
            if (e.ctrlKey && e.key === 'p') { e.preventDefault(); this.simulateProximity(); }
        });

        window.addEventListener('beforeunload', () => this.cleanup());
        document.addEventListener('visibilitychange', () => { if (!document.hidden) this.refreshAllVideoStreams(); });
    }

    cleanup() {
        this.stopAllCameraStreams();
        Object.keys(this.recordingTimers).forEach(id => clearInterval(this.recordingTimers[id]));
        this.devices.forEach(d => { if (d.motionInterval) clearInterval(d.motionInterval); });
    }

    /* ==================== AUTHENTIFICATION & INSCRIPTION ==================== */
    switchAuthTab(tab) {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        document.querySelector(`.auth-tab[onclick*="${tab}"]`)?.classList.add('active');
        document.getElementById('login-form').classList.toggle('active', tab === 'login');
        document.getElementById('register-form').classList.toggle('active', tab === 'register');
        document.getElementById('login-error').classList.remove('show');
        document.getElementById('login-success').classList.remove('show');
    }

    register() {
        const username = document.getElementById('reg-username').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;
        const confirmPassword = document.getElementById('reg-confirm-password').value;
        const errorEl = document.getElementById('login-error');
        const successEl = document.getElementById('login-success');

        if (!username || !email || !password) { this.showAuthError('Tous les champs sont requis'); return; }
        if (username.length < 3) { this.showAuthError('Nom d\'utilisateur : 3 caractères minimum'); return; }
        if (!this.isValidEmail(email)) { this.showAuthError('Adresse email invalide'); return; }
        if (password.length < 6) { this.showAuthError('Mot de passe : 6 caractères minimum'); return; }
        if (password !== confirmPassword) { this.showAuthError('Les mots de passe ne correspondent pas'); return; }
        if (this.users.find(u => u.username.toLowerCase() === username.toLowerCase())) { this.showAuthError('Ce nom d\'utilisateur est déjà pris'); return; }
        if (this.users.find(u => u.email.toLowerCase() === email.toLowerCase())) { this.showAuthError('Cet email est déjà utilisé'); return; }

        const newUser = {
            id: 'user-' + Date.now(),
            username, email: email.toLowerCase(),
            password: this.hashPassword(password),
            createdAt: new Date().toISOString(),
            lastLogin: null, isAdmin: false,
            settings: { theme: 'dark', notifications: true }
        };

        this.users.push(newUser);
        this.saveUsers();

        successEl.textContent = '✅ Compte créé ! Vous pouvez vous connecter.';
        successEl.classList.add('show');
        errorEl.classList.remove('show');

        document.getElementById('reg-username').value = '';
        document.getElementById('reg-email').value = '';
        document.getElementById('reg-password').value = '';
        document.getElementById('reg-confirm-password').value = '';

        setTimeout(() => {
            this.switchAuthTab('login');
            document.getElementById('login-username').value = username;
            document.getElementById('login-password').focus();
            successEl.classList.remove('show');
        }, 2000);

        this.addActivity(`Nouvel utilisateur : ${username}`, 'system', '👤');
        console.log('✅ Inscription:', username);
    }

    login() {
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;
        const rememberMe = document.getElementById('remember-me')?.checked || false;
        const errorEl = document.getElementById('login-error');
        const successEl = document.getElementById('login-success');

        successEl.classList.remove('show');
        if (!username || !password) { this.showAuthError('Champs requis'); return; }

        const user = this.users.find(u => u.username.toLowerCase() === username.toLowerCase() || u.email.toLowerCase() === username.toLowerCase());
        if (!user) { this.showAuthError('Utilisateur introuvable'); return; }
        if (!this.verifyPassword(password, user.password)) { this.showAuthError('Mot de passe incorrect'); return; }

        this.isLoggedIn = true;
        this.currentUser = {
            id: user.id, username: user.username, email: user.email,
            initial: user.username.charAt(0).toUpperCase(),
            loginTime: new Date().toISOString(), isAdmin: user.isAdmin || false
        };
        this.rememberMe = rememberMe;
        user.lastLogin = new Date().toISOString();
        this.saveUsers();

        errorEl.classList.remove('show');
        this.saveData();
        this.showDashboard();
        this.startProximityCheck();
        this.addActivity('Connexion', 'login', '🔑');
        this.showToast('Bienvenue ' + user.username + ' ! 🏠', 'success');
    }

    logout() {
        this.cleanup();
        this.isLoggedIn = false;
        if (!this.rememberMe) this.currentUser = null;
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

    openProfileModal() {
        if (!this.currentUser) return;
        document.getElementById('profile-avatar').textContent = this.currentUser.initial;
        document.getElementById('profile-name').textContent = this.currentUser.username;
        document.getElementById('profile-email').textContent = this.currentUser.email;
        const user = this.users.find(u => u.id === this.currentUser.id);
        if (user) document.getElementById('profile-date').textContent = 'Membre depuis le ' + new Date(user.createdAt).toLocaleDateString('fr-FR');
        document.getElementById('modal-profile').classList.add('active');
    }

    closeProfileModal() {
        document.getElementById('modal-profile').classList.remove('active');
        ['current-password', 'new-password', 'confirm-new-password'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    }

    changePassword() {
        const cp = document.getElementById('current-password').value;
        const np = document.getElementById('new-password').value;
        const conf = document.getElementById('confirm-new-password').value;
        if (!cp || !np || !conf) { this.showToast('Tous les champs requis', 'error'); return; }
        if (np.length < 6) { this.showToast('6 caractères minimum', 'error'); return; }
        if (np !== conf) { this.showToast('Les mots de passe ne correspondent pas', 'error'); return; }
        const user = this.users.find(u => u.id === this.currentUser.id);
        if (!user) { this.showToast('Utilisateur introuvable', 'error'); return; }
        if (!this.verifyPassword(cp, user.password)) { this.showToast('Mot de passe actuel incorrect', 'error'); return; }
        user.password = this.hashPassword(np);
        this.saveUsers();
        this.closeProfileModal();
        this.showToast('✅ Mot de passe mis à jour !', 'success');
        this.addActivity('Mot de passe modifié', 'system', '🔒');
    }

    deleteAccount() {
        if (!confirm('⚠️ Supprimer votre compte ? Action IRRÉVERSIBLE.')) return;
        if (!confirm('Confirmer la suppression de "' + this.currentUser.username + '" ?')) return;
        this.users = this.users.filter(u => u.id !== this.currentUser.id);
        this.saveUsers();
        this.cleanup();
        this.isLoggedIn = false; this.currentUser = null; this.rememberMe = false;
        document.getElementById('dashboard-screen').classList.remove('active');
        document.getElementById('login-screen').classList.add('active');
        this.saveData();
        this.showToast('Compte supprimé', 'info');
    }

    /* ==================== GESTION UTILISATEURS (ADMIN) ==================== */
    getAllUsers() { return this.users.map(u => ({ id: u.id, username: u.username, email: u.email, createdAt: u.createdAt, lastLogin: u.lastLogin, isAdmin: u.isAdmin })); }
    deleteUser(userId) {
        if (!this.currentUser?.isAdmin) { this.showToast('Permission refusée', 'error'); return; }
        if (userId === this.currentUser.id) { this.showToast('Utilisez "Supprimer mon compte"', 'error'); return; }
        const user = this.users.find(u => u.id === userId);
        if (!user) return;
        if (confirm(`Supprimer "${user.username}" ?`)) { this.users = this.users.filter(u => u.id !== userId); this.saveUsers(); this.showToast(`${user.username} supprimé`, 'info'); }
    }

    /* ==================== SÉCURITÉ MOTS DE PASSE ==================== */
    hashPassword(password) {
        let hash = password;
        for (let i = 0; i < 1000; i++) hash = this.simpleHash(hash + 'SmartHomeSalt' + i);
        return hash;
    }
    simpleHash(str) { let hash = 0; for (let i = 0; i < str.length; i++) { const char = str.charCodeAt(i); hash = ((hash << 5) - hash) + char; hash = hash & hash; } return hash.toString(36); }
    verifyPassword(password, hash) { return this.hashPassword(password) === hash; }
    isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

    checkPasswordStrength(password) {
        const fill = document.getElementById('strength-fill'), text = document.getElementById('strength-text');
        if (!fill) return;
        let s = 0;
        if (password.length >= 6) s++; if (password.length >= 10) s++;
        if (/[A-Z]/.test(password)) s++; if (/[0-9]/.test(password)) s++; if (/[^A-Za-z0-9]/.test(password)) s++;
        fill.className = 'strength-fill';
        if (s <= 1) { fill.classList.add('weak'); text.textContent = 'Faible'; }
        else if (s === 2) { fill.classList.add('fair'); text.textContent = 'Moyen'; }
        else if (s === 3) { fill.classList.add('good'); text.textContent = 'Bon'; }
        else { fill.classList.add('strong'); text.textContent = '💪 Fort !'; }
    }

    checkPasswordMatch() {
        const pw = document.getElementById('reg-password').value, cp = document.getElementById('reg-confirm-password');
        if (cp && cp.value) cp.style.borderColor = pw === cp.value ? 'var(--accent)' : 'var(--danger)';
    }

    saveUsers() {
        try { localStorage.setItem('smartHomeUsersV3', JSON.stringify(this.users)); localStorage.setItem('smartHomeRememberV3', JSON.stringify({ rememberMe: this.rememberMe, userId: this.rememberMe ? this.currentUser?.id : null })); } catch (e) {}
    }

    loadUsers() {
        try {
            const saved = localStorage.getItem('smartHomeUsersV3'); if (saved) this.users = JSON.parse(saved);
            const rem = localStorage.getItem('smartHomeRememberV3');
            if (rem) { const data = JSON.parse(rem); this.rememberMe = data.rememberMe; if (data.rememberMe && data.userId) { const user = this.users.find(u => u.id === data.userId); if (user) { this.currentUser = { id: user.id, username: user.username, email: user.email, initial: user.username.charAt(0).toUpperCase(), loginTime: new Date().toISOString(), isAdmin: user.isAdmin || false }; this.isLoggedIn = true; } } }
        } catch (e) {}
    }

    createDefaultAdmin() {
        this.users.push({ id: 'user-admin-default', username: this.defaultAdmin.username, email: this.defaultAdmin.email, password: this.hashPassword(this.defaultAdmin.password), createdAt: this.defaultAdmin.createdAt, lastLogin: null, isAdmin: true, settings: { theme: 'dark', notifications: true } });
        this.saveUsers(); console.log('✅ Admin créé: admin / admin123');
    }

    showAuthError(msg) { const el = document.getElementById('login-error'), s = document.getElementById('login-success'); if (el) { el.textContent = msg; el.classList.add('show'); if (s) s.classList.remove('show'); setTimeout(() => el.classList.remove('show'), 4000); } }

    /* ==================== PROXIMITÉ GPS ==================== */
    startProximityCheck() {
        if (!navigator.geolocation) { this.isInProximity = false; this.updateConnectionUI(); return; }
        this.geoWatchId = navigator.geolocation.watchPosition(p => this.handlePositionUpdate(p), e => this.handleGeoError(e), { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 });
    }
    handlePositionUpdate(pos) { const d = this.calcDist(pos.coords.latitude, pos.coords.longitude); const w = this.isInProximity; this.isInProximity = d <= this.PROXIMITY_RADIUS; if (w !== this.isInProximity) { this.updateConnectionUI(); this.renderAll(); } const dt = document.getElementById('distance-text'); if (dt) dt.textContent = ` (${d < 1 ? (d*100).toFixed(0)+' cm' : d.toFixed(1)+' m'})`; }
    handleGeoError(e) { this.isInProximity = false; this.updateConnectionUI(); this.renderAll(); }
    stopProximityCheck() { if (this.geoWatchId !== null) { navigator.geolocation.clearWatch(this.geoWatchId); this.geoWatchId = null; } this.isInProximity = false; this.updateConnectionUI(); }
    calcDist(lat1, lon1, lat2, lon2) { const R=6371000,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180,a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2; return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)); }
    simulateProximity() { this.isInProximity=!this.isInProximity; this.updateConnectionUI(); this.renderAll(); this.showToast(this.isInProximity?'📍 Proximité simulée ACTIVÉE':'📍 Proximité simulée DÉSACTIVÉE',this.isInProximity?'success':'/* ==================== CONTRÔLE APPAREILS ==================== */
    canControl() { if(!this.isInProximity){this.showToast('❌ Vous devez être à moins de 2 mètres','error');return false;} return true; }
    
    toggleDevice(deviceId) {
        if(!this.canControl())return;
        const d=this.devices.find(x=>x.id===deviceId);
        if(!d||d.type==='camera')return;
        
        // Vérifier Arduino
        if(this.arduinoDevices[deviceId]?.ip){
            const cmd = d.type==='light' ? (d.status==='on'?'off':'on') : 'toggle';
            this.sendArduinoCommand(deviceId, cmd);
        } else {
            if(d.type==='door'||d.type==='window')d.status=d.status==='open'?'closed':'open';
            else if(d.type==='light')d.status=d.status==='on'?'off':'on';
            const t=this.getActionText(d),e=this.getDeviceEmoji(d.type);
            this.addNotification(`${e} ${d.name} ${t}`,'info');
            this.addActivity(`${d.name} ${t}`,d.type,e);
            this.showToast(`${d.name} ${t}`,'success');
            this.saveData(); this.renderAll();
        }
    }

    toggleAllLights(){if(!this.canControl())return;const lights=this.devices.filter(d=>d.type==='light');if(!lights.length){this.showToast('Aucune lumière','info');return;}const anyOn=lights.some(l=>l.status==='on');lights.forEach(l=>l.status=anyOn?'off':'on');const a=anyOn?'éteintes':'allumées';this.addNotification(`💡 Lumières ${a}`,'info');this.addActivity(`Lumières ${a}`,'light','💡');this.showToast(`Lumières ${a}`,'success');this.saveData();this.renderAll();}
    closeAllDoorsWindows(){if(!this.canControl())return;const items=this.devices.filter(d=>(d.type==='door'||d.type==='window')&&d.status==='open');if(!items.length){this.showToast('Tout fermé','info');return;}items.forEach(i=>i.status='closed');this.addNotification(`🔒 ${items.length} fermeture(s)`,'info');this.showToast(`${items.length} fermeture(s)`,'success');this.saveData();this.renderAll();}
    getActionText(d){return{door:d.status==='open'?'ouverte':'fermée',window:d.status==='open'?'ouverte':'fermée',light:d.status==='on'?'allumée':'éteinte'}[d.type]||'modifié(e)';}
    getDeviceEmoji(t){return{door:'🚪',window:'🪟',light:'💡',camera:'📹'}[t]||'📦';}

    /* ==================== CAMÉRAS ==================== */
    openConfigCameraModal(deviceId){const d=this.devices.find(x=>x.id===deviceId);if(!d||d.type!=='camera')return;this.currentConfigCameraId=deviceId;document.getElementById('config-camera-url').value=d.cameraUrl||'';document.getElementById('modal-config-camera').classList.add('active');}
    closeConfigCameraModal(){document.getElementById('modal-config-camera').classList.remove('active');this.currentConfigCameraId=null;}
    
    saveCameraConfig(){
        if(!this.currentConfigCameraId)return;
        const d=this.devices.find(x=>x.id===this.currentConfigCameraId);if(!d)return;
        if(d.localStream)this.stopDeviceStream(d);
        d.cameraUrl=document.getElementById('config-camera-url').value.trim()||null;
        d.streamType=d.cameraUrl?'remote':null;
        this.saveData();this.renderAll();this.closeConfigCameraModal();
        this.showToast('✅ Caméra configurée','success');
    }

    async usePhoneCamera(){
        if(!this.currentConfigCameraId)return;
        const d=this.devices.find(x=>x.id===this.currentConfigCameraId);if(!d)return;
        this.closeConfigCameraModal();
        try{
            this.stopDeviceStream(d);
            const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1280},height:{ideal:720}},audio:false});
            d.localStream=stream;d.cameraUrl=null;d.streamType='local';d.status='recording';
            stream.getVideoTracks()[0].addEventListener('ended',()=>{d.localStream=null;d.status='online';d.streamType=null;this.saveData();this.renderAll();});
            this.saveData();this.renderAll();
            setTimeout(()=>this.attachStreamToVideo(d.id,stream),200);
            this.showToast('📱 Caméra activée !','success');
        }catch(e){
            let m='Erreur caméra';if(e.name==='NotAllowedError')m='Accès refusé';else if(e.name==='NotFoundError')m='Pas de caméra';
            this.showToast('❌ '+m,'error');
        }
    }

    stopDeviceStream(d){if(!d?.localStream)return;d.localStream.getTracks().forEach(t=>t.stop());d.localStream=null;d.streamType=null;if(d.type==='camera'&&d.status==='recording')d.status='online';}
    stopAllCameraStreams(){this.devices.forEach(d=>{if(d.localStream)this.stopDeviceStream(d);});}
    attachStreamToVideo(deviceId,stream){const v=document.getElementById(`video-${deviceId}`);if(v&&stream?.active){v.srcObject=stream;v.muted=true;v.playsInline=true;v.play().catch(()=>{});}}
    refreshAllVideoStreams(){this.devices.forEach(d=>{if(d.type==='camera'&&d.localStream?.active)setTimeout(()=>this.attachStreamToVideo(d.id,d.localStream),100);});}

    /* ==================== CAPTURES IMAGES ==================== */
    captureImage(deviceId){
        const d=this.devices.find(x=>x.id===deviceId);
        if(!d||d.type!=='camera'){this.showToast('❌ Caméra non trouvée','error');return;}
        if(d.localStream?.active)this.captureFromVideo(d);
        else if(d.cameraUrl)this.captureFromUrl(d);
        else this.showToast('❌ Aucun flux','error');
    }

    captureFromVideo(d){
        try{
            const v=document.getElementById(`video-${d.id}`);
            if(!v||!v.srcObject){this.showToast('❌ Flux non disponible','error');return;}
            const c=document.createElement('canvas');c.width=v.videoWidth||640;c.height=v.videoHeight||480;
            const ctx=c.getContext('2d');ctx.drawImage(v,0,0,c.width,c.height);
            ctx.fillStyle='rgba(0,0,0,0.6)';ctx.fillRect(0,c.height-40,c.width,40);
            ctx.fillStyle='#fff';ctx.font='16px monospace';ctx.fillText(new Date().toLocaleString('fr-FR'),10,c.height-12);
            this.saveCapture(d,c.toDataURL('image/jpeg',0.85),c.width,c.height);
            this.flashEffect(d.id);
        }catch(e){this.showToast('❌ Erreur capture','error');}
    }

    captureFromUrl(d){
        const img=document.getElementById(`img-${d.id}`);
        if(!img||!img.complete||img.naturalWidth===0){this.showToast('❌ Image non chargée','error');return;}
        const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;
        const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
        ctx.fillStyle='rgba(0,0,0,0.6)';ctx.fillRect(0,c.height-40,c.width,40);
        ctx.fillStyle='#fff';ctx.font='16px monospace';ctx.fillText(new Date().toLocaleString('fr-FR'),10,c.height-12);
        this.saveCapture(d,c.toDataURL('image/jpeg',0.85),c.width,c.height);
        this.flashEffect(d.id);
    }

    saveCapture(d,data,w,h){
        if(!d.captures)d.captures=[];
        const cap={id:'cap-'+Date.now(),timestamp:new Date().toISOString(),imageData:data,width:w,height:h,size:(data.length/1024).toFixed(1)+' KB',deviceId:d.id,deviceName:d.name,type:'manual'};
        d.captures.unshift(cap);if(d.captures.length>50)d.captures=d.captures.slice(0,50);
        this.saveData();this.addActivity(`📸 Capture: ${d.name}`,'camera','📸');
        this.showToast('📸 Capture enregistrée !','success');
        if(document.getElementById(`gallery-${d.id}`)?.classList.contains('active'))this.renderCapturesGallery(d.id);
    }

    flashEffect(id){const c=document.querySelector(`#video-${id}`)?.parentElement||document.querySelector(`#img-${id}`)?.parentElement;if(c){c.style.filter='brightness(2)';setTimeout(()=>c.style.filter='brightness(1)',150);}}
    toggleCapturesGallery(deviceId){const g=document.getElementById(`gallery-${deviceId}`);if(!g)return;g.classList.toggle('active');if(g.classList.contains('active'))this.renderCapturesGallery(deviceId);}

    renderCapturesGallery(deviceId){
        const d=this.devices.find(x=>x.id===deviceId);if(!d)return;
        const c=document.getElementById(`gallery-content-${deviceId}`);if(!c)return;
        if(!d.captures?.length){c.innerHTML='<div class="empty-state"><i class="fas fa-camera-retro"></i><p>Aucune capture</p></div>';return;}
        c.innerHTML=d.captures.map(cap=>`
            <div class="capture-thumbnail" onclick="app.viewCaptureFullscreen('${deviceId}','${cap.id}')">
                <img src="${cap.imageData}" loading="lazy"><div class="capture-info"><span>${new Date(cap.timestamp).toLocaleString('fr-FR')}</span><span>${cap.size}</span></div>
                <div class="capture-actions"><button class="btn btn-sm btn-outline" onclick="event.stopPropagation();app.downloadCapture('${deviceId}','${cap.id}')"><i class="fas fa-download"></i></button><button class="btn btn-sm btn-outline" onclick="event.stopPropagation();app.deleteCapture('${deviceId}','${cap.id}')"><i class="fas fa-trash"></i></button></div>
            </div>`).join('');
    }

    viewCaptureFullscreen(did,cid){
        const d=this.devices.find(x=>x.id===did),cap=d?.captures?.find(x=>x.id===cid);if(!cap)return;
        const m=document.createElement('div');m.className='fullscreen-modal';
        m.innerHTML=`<div class="fullscreen-overlay" onclick="this.parentElement.remove()"></div><div class="fullscreen-content"><button class="fullscreen-close" onclick="this.parentElement.parentElement.remove()"><i class="fas fa-times"></i></button><img src="${cap.imageData}"><div class="fullscreen-info"><span>${d.name} - ${new Date(cap.timestamp).toLocaleString('fr-FR')}</span><span>${cap.size}</span><div style="margin-top:8px"><button class="btn btn-primary btn-sm" onclick="app.downloadCapture('${did}','${cid}')"><i class="fas fa-download"></i></button><button class="btn btn-outline btn-sm" onclick="app.deleteCapture('${did}','${cid}');this.closest('.fullscreen-modal').remove()"><i class="fas fa-trash"></i></button></div></div></div>`;
        document.body.appendChild(m);
    }

    downloadCapture(did,cid){const d=this.devices.find(x=>x.id===did),cap=d?.captures?.find(x=>x.id===cid);if(!cap)return;const a=document.createElement('a');a.href=cap.imageData;a.download=`capture-${d.name}-${cap.id}.jpg`;document.body.appendChild(a);a.click();document.body.removeChild(a);this.showToast('💾 Téléchargée','success');}
    deleteCapture(did,cid){const d=this.devices.find(x=>x.id===did);if(!d)return;if(confirm('Supprimer ?')){d.captures=d.captures.filter(c=>c.id!==cid);this.saveData();this.renderCapturesGallery(did);this.showToast('🗑️ Supprimée','info');}}
    clearAllCaptures(did){const d=this.devices.find(x=>x.id===did);if(!d?.captures?.length){this.showToast('Aucune','info');return;}if(confirm(`Supprimer ${d.captures.length} captures ?`)){d.captures=[];this.saveData();this.renderCapturesGallery(did);this.renderAll();this.showToast('Supprimées','info');}}

    /* ==================== ENREGISTREMENT VIDÉO ==================== */
    async toggleRecording(deviceId){
        const d=this.devices.find(x=>x.id===deviceId);if(!d||d.type!=='camera')return;
        if(this.isRecording(deviceId)){this.stopRecording(deviceId);this.showToast('⏹️ Arrêté','info');if(this.recordingTimers[deviceId]){clearInterval(this.recordingTimers[deviceId]);delete this.recordingTimers[deviceId];}}
        else{if(!d.localStream?.active){this.showToast('❌ Activez la caméra','error');return;}
            const started=await this.startRecording(deviceId,d.localStream);
            if(started){this.showToast('🔴 Enregistrement (60s)','success');this.startRecordingTimer(deviceId);}
        }
        this.renderAll();
    }

    isRecording(deviceId){return this._recorders?.has(deviceId)||false;}
    
    async startRecording(deviceId,stream){
        if(!this._recorders)this._recorders=new Map();
        if(this._recorders.has(deviceId))return false;
        if(!MediaRecorder.isTypeSupported('video/webm')){this.showToast('❌ Format non supporté','error');return false;}
        try{
            const mr=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9'});
            const chunks=[],rid='rec-'+Date.now(),st=Date.now();
            mr.ondataavailable=e=>{if(e.data?.size>0)chunks.push(e.data);};
            mr.onstop=async()=>{
                const blob=new Blob(chunks,{type:'video/webm'}),dur=(Date.now()-st)/1000;
                await this.saveVideoRecording(deviceId,blob,{id:rid,deviceId,startTime:new Date(st).toISOString(),duration:dur,size:blob.size,type:'manual'});
                this._recorders.delete(deviceId);
                const dev=this.devices.find(x=>x.id===deviceId);
                this.addNotification(`📹 Enregistrement: ${dev?.name||deviceId} (${dur.toFixed(1)}s)`,'success');
                this.addActivity(`Vidéo ${dur.toFixed(1)}s`,'camera','📹');
                this.renderAll();
            };
            mr.start(1000);this._recorders.set(deviceId,{mediaRecorder:mr,chunks,stream,recordingId:rid,startTime:st});
            setTimeout(()=>{if(this._recorders.has(deviceId))this.stopRecording(deviceId);},60000);
            return true;
        }catch(e){console.error(e);return false;}
    }

    stopRecording(deviceId){const r=this._recorders?.get(deviceId);if(r?.mediaRecorder.state==='recording')r.mediaRecorder.stop();}

    async saveVideoRecording(deviceId,blob,meta){
        try{
            const dbName='SmartHomeVideos',ver=1;
            const db=await new Promise((res,rej)=>{const r=indexedDB.open(dbName,ver);r.onupgradeneeded=e=>{const d=e.target.result;if(!d.objectStoreNames.contains('recordings')){const s=d.createObjectStore('recordings',{keyPath:'id'});s.createIndex('deviceId','deviceId');}if(!d.objectStoreNames.contains('videoChunks'))d.createObjectStore('videoChunks',{keyPath:'chunkId'});};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
            const tx=db.transaction(['recordings','videoChunks'],'readwrite');
            tx.objectStore('recordings').add({...meta,blobSize:blob.size,savedAt:new Date().toISOString()});
            const cs=tx.objectStore('videoChunks'),chunkSize=1024*1024,total=Math.ceil(blob.size/chunkSize);
            for(let i=0;i<total;i++){const s=i*chunkSize,e=Math.min(s+chunkSize,blob.size);cs.add({chunkId:`${meta.id}-${i}`,recordingId:meta.id,chunkIndex:i,totalChunks:total,data:blob.slice(s,e)});}
        }catch(e){console.error('Sauvegarde vidéo:',e);}
    }

    startRecordingTimer(deviceId){
        if(this.recordingTimers[deviceId])clearInterval(this.recordingTimers[deviceId]);
        this.recordingTimers[deviceId]=setInterval(()=>{
            if(!this.isRecording(deviceId)){clearInterval(this.recordingTimers[deviceId]);delete this.recordingTimers[deviceId];this.renderAll();return;}
            const t=document.getElementById(`recording-timer-${deviceId}`),r=this._recorders?.get(deviceId);
            if(t&&r){const d=(Date.now()-r.startTime)/1000,m=Math.floor(d/60),s=Math.floor(d%60);t.textContent=`🔴 ${m}:${s.toString().padStart(2,'0')}`;}
        },1000);
    }

    toggleMotionDetection(deviceId){
        const d=this.devices.find(x=>x.id===deviceId);if(!d||d.type!=='camera')return;
        if(d.motionInterval){clearInterval(d.motionInterval);d.motionInterval=null;d.motionDetection=false;this.showToast('🔍 Détection désactivée','info');}
        else{if(!d.localStream?.active){this.showToast('❌ Activez la caméra','error');return;}d.motionDetection=true;
            d.motionInterval=setInterval(async()=>{if(Math.random()<0.3&&!this.isRecording(deviceId)){this.addNotification(`🏃 Mouvement: ${d.name}`,'warning');
                const s=await this.startRecording(deviceId,d.localStream);if(s){this.addActivity(`Enregistrement auto`,'camera','🏃');this.renderAll();this.startRecordingTimer(deviceId);}}},10000);
            this.showToast('🔍 Détection activée','success');}
        this.saveData();this.renderAll();
    }

    async getRecordings(deviceId=null){
        try{
            const db=await new Promise((res,rej)=>{const r=indexedDB.open('SmartHomeVideos',1);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
            return new Promise((res,rej)=>{
                const tx=db.transaction(['recordings'],'readonly'),s=tx.objectStore('recordings');
                const req=deviceId?s.index('deviceId').getAll(deviceId):s.getAll();
                req.onsuccess=()=>{const recs=req.result;recs.sort((a,b)=>new Date(b.startTime)-new Date(a.startTime));res(recs);};
                req.onerror=()=>rej(req.error);
            });
        }catch(e){return[];}
    }

    async getRecordingBlob(recordingId){
        const db=await new Promise((res,rej)=>{const r=indexedDB.open('SmartHomeVideos',1);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
        return new Promise((res,rej)=>{
            const tx=db.transaction(['videoChunks'],'readonly'),s=tx.objectStore('videoChunks');
            const rng=IDBKeyRange.bound(`${recordingId}-0`,`${recordingId}-999`);
            const req=s.getAll(rng);
            req.onsuccess=()=>{const chunks=req.result;chunks.sort((a,b)=>a.chunkIndex-b.chunkIndex);res(new Blob(chunks.map(c=>c.data),{type:'video/webm'}));};
            req.onerror=()=>rej(req.error);
        });
    }

    async playRecording(recordingId){
        try{
            const blob=await this.getRecordingBlob(recordingId),url=URL.createObjectURL(blob);
            const m=document.createElement('div');m.className='video-player-modal';
            m.innerHTML=`<div class="video-player-overlay" onclick="this.parentElement.remove();URL.revokeObjectURL('${url}')"></div><div class="video-player-content"><button class="video-player-close" onclick="this.closest('.video-player-modal').remove();URL.revokeObjectURL('${url}')"><i class="fas fa-times"></i></button><video controls autoplay style="max-width:100%;max-height:80vh;border-radius:12px"><source src="${url}" type="video/webm"></video></div>`;
            document.body.appendChild(m);
        }catch(e){this.showToast('❌ Erreur lecture','error');}
    }

    async downloadRecording(recordingId){
        try{const blob=await this.getRecordingBlob(recordingId),url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`video-${recordingId}.webm`;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);this.showToast('💾 Téléchargée','success');}catch(e){this.showToast('❌ Erreur','error');}
    }

    async deleteRecording(recordingId){
        try{
            const db=await new Promise((res,rej)=>{const r=indexedDB.open('SmartHomeVideos',1);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
            const tx=db.transaction(['recordings','videoChunks'],'readwrite');tx.objectStore('recordings').delete(recordingId);
            const s=tx.objectStore('videoChunks'),rng=IDBKeyRange.bound(`${recordingId}-0`,`${recordingId}-999`);
            const req=s.getAll(rng);req.onsuccess=()=>req.result.forEach(c=>s.delete(c.chunkId));
            this.showToast('🗑️ Supprimé','info');
        }catch(e){}
    }

    async showVideoGallery(deviceId){
        const d=this.devices.find(x=>x.id===deviceId);if(!d)return;
        const recs=await this.getRecordings(deviceId);
        const m=document.createElement('div');m.className='modal-overlay active';
        m.innerHTML=`<div class="modal" style="max-width:600px"><div class="modal-header"><h2>📹 ${d.name}</h2><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button></div><div class="modal-body">${recs.length===0?'<div class="empty-state"><i class="fas fa-video-slash"></i><p>Aucun enregistrement</p></div>':`<div class="recordings-list">${recs.map(r=>`<div class="recording-item"><div class="recording-item-info"><i class="fas fa-video"></i><div><strong>${new Date(r.startTime).toLocaleString('fr-FR')}</strong><small>${r.duration.toFixed(1)}s • ${(r.blobSize/1024/1024).toFixed(2)} MB • ${r.type==='motion'?'🏃 Auto':'👤 Manuel'}</small></div></div><div class="recording-item-actions"><button class="btn btn-primary btn-sm" onclick="app.playRecording('${r.id}')"><i class="fas fa-play"></i></button><button class="btn btn-outline btn-sm" onclick="app.downloadRecording('${r.id}')"><i class="fas fa-download"></i></button><button class="btn btn-outline btn-sm" onclick="app.deleteRecording('${r.id}');this.closest('.modal-overlay').remove();app.showVideoGallery('${deviceId}')"><i class="fas fa-trash"></i></button></div></div>`).join('')}</div>`}</div></div>`;
        document.body.appendChild(m);m.addEventListener('click',e=>{if(e.target===m)m.remove();});
    }

    async renderAllRecordings(){
        const c=document.getElementById('all-recordings-container');if(!c)return;
        try{
            const recs=await this.getRecordings();
            if(!recs.length){c.innerHTML='<div class="empty-state"><i class="fas fa-film"></i><p>Aucun enregistrement</p></div>';return;}
            let totalSize=0;recs.forEach(r=>totalSize+=r.blobSize||0);
            c.innerHTML=`<p style="margin-bottom:15px;color:var(--text-secondary)">${recs.length} vidéos • ${(totalSize/1024/1024).toFixed(2)} MB</p><div class="recordings-list">${recs.map(r=>{const d=this.devices.find(x=>x.id===r.deviceId);return`<div class="recording-item"><div class="recording-item-info"><i class="fas fa-video"></i><div><strong>${d?.name||r.deviceId}</strong><small>${new Date(r.startTime).toLocaleString('fr-FR')} • ${r.duration.toFixed(1)}s</small></div></div><div class="recording-item-actions"><button class="btn btn-primary btn-sm" onclick="app.playRecording('${r.id}')"><i class="fas fa-play"></i></button><button class="btn btn-outline btn-sm" onclick="app.downloadRecording('${r.id}')"><i class="fas fa-download"></i></button><button class="btn btn-outline btn-sm" onclick="app.deleteRecording('${r.id}');app.renderAllRecordings()"><i class="fas fa-trash"></i></button></div></div>`}).join('')}</div>`;
        }catch(e){c.innerHTML='<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Erreur</p></div>';}
    }

    /* ==================== ARDUINO ==================== */
    loadArduinoConfig(){try{const s=localStorage.getItem('arduinoConfigV3');if(s)this.arduinoDevices=JSON.parse(s);}catch(e){}}
    saveArduinoConfig(){try{localStorage.setItem('arduinoConfigV3',JSON.stringify(this.arduinoDevices));}catch(e){}}

    configureArduinoIP(deviceId){
        const d=this.devices.find(x=>x.id===deviceId);if(!d)return;
        const cur=this.arduinoDevices[deviceId]?.ip||'';
        const ip=prompt(`IP Arduino pour "${d.name}":\n(Ex: 192.168.1.100)\nActuelle: ${cur||'Aucune'}`,cur);
        if(ip?.trim()){this.arduinoDevices[deviceId]={ip:ip.trim(),type:'esp8266'};this.saveArduinoConfig();this.showToast(`✅ IP: ${ip}`,'success');this.testArduino(deviceId);}
    }

    async testArduino(deviceId){
        const cfg=this.arduinoDevices[deviceId];if(!cfg?.ip)return;
        try{const r=await fetch(`http://${cfg.ip}/status`);if(r.ok){const d=await r.json();this.showToast(`✅ ${d.name||'Arduino'} connecté`,'success');}}catch(e){this.showToast('❌ Arduino inaccessible','error');}
    }

    async sendArduinoCommand(deviceId,cmd){
        const cfg=this.arduinoDevices[deviceId];if(!cfg?.ip){this.toggleDeviceLocal(deviceId);return;}
        try{
            const r=await fetch(`http://${cfg.ip}/${cmd}`);const d=await r.json();
            if(d.success){const dev=this.devices.find(x=>x.id===deviceId);if(dev){dev.status=d.status;this.saveData();this.renderAll();}this.showToast(`✅ ${d.message}`,'success');}
        }catch(e){this.showToast('❌ Arduino HS - Mode local','error');this.toggleDeviceLocal(deviceId);}
    }

    toggleDeviceLocal(deviceId){
        const d=this.devices.find(x=>x.id===deviceId);if(!d)return;
        if(d.type==='door'||d.type==='window')d.status=d.status==='open'?'closed':'open';
        else if(d.type==='light')d.status=d.status==='on'?'off':'on';
        const t=this.getActionText(d);this.addActivity(`${d.name} ${t} (local)`,d.type,'💻');
        this.saveData();this.renderAll();
    }

    /* ==================== APPAREILS CRUD ==================== */
    openAddDeviceModal(){document.getElementById('modal-add-device').classList.add('active');document.getElementById('new-device-name').focus();this.onDeviceTypeChange();}
    closeAddDeviceModal(){document.getElementById('modal-add-device').classList.remove('active');['new-device-name','new-device-room','new-camera-url'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});document.getElementById('camera-url-group').style.display='none';}
    onDeviceTypeChange(){document.getElementById('camera-url-group').style.display=document.getElementById('new-device-type').value==='camera'?'block':'none';}

    addDevice(){
        const name=document.getElementById('new-device-name').value.trim(),type=document.getElementById('new-device-type').value,room=document.getElementById('new-device-room').value.trim(),curl=document.getElementById('new-camera-url')?.value.trim()||null;
        if(!name){this.showToast('Nom requis','error');return;}
        const icons={door:'fa-door-closed',window:'fa-window-maximize',light:'fa-lightbulb',camera:'fa-video'};
        const nd={id:type+'-'+Date.now(),name,type,room:room||'Non spécifié',status:type==='camera'?'online':(type==='light'?'off':'closed'),icon:icons[type],cameraUrl:type==='camera'?curl:null,streamType:type==='camera'&&curl?'remote':null,localStream:null,captures:[],motionDetection:false,motionInterval:null};
        this.devices.push(nd);this.addNotification(`✅ ${name} ajouté(e)`,'success');this.addActivity(`${name} ajouté(e)`,'system',this.getDeviceEmoji(type));
        this.saveData();this.renderAll();this.closeAddDeviceModal();this.showToast(`${name} ajouté !`,'success');
    }

    deleteDevice(deviceId){
        if(!this.canControl())return;
        const d=this.devices.find(x=>x.id===deviceId);if(!d)return;
        if(confirm(`Supprimer "${d.name}" ?`)){
            if(d.localStream)this.stopDeviceStream(d);if(d.motionInterval)clearInterval(d.motionInterval);
            this.devices=this.devices.filter(x=>x.id!==deviceId);
            this.addNotification(`🗑️ ${d.name} supprimé(e)`,'info');this.saveData();this.renderAll();this.showToast(`${d.name} supprimé(e)`,'info');
        }
    }

    /* ==================== RENDU ==================== */
    renderAll(){this.renderDashboard();this.renderDoorsWindows();this.renderLights();this.renderCameras();this.renderActivity();this.renderNotifications();this.updateNotificationBadge();setTimeout(()=>this.refreshAllVideoStreams(),300);}

    renderDashboard(){
        const doors=this.devices.filter(d=>d.type==='door'),windows=this.devices.filter(d=>d.type==='window'),lights=this.devices.filter(d=>d.type==='light'),cameras=this.devices.filter(d=>d.type==='camera');
        this.setText('summary-doors',`${doors.filter(d=>d.status==='open').length}/${doors.length}`);
        this.setText('summary-windows',`${windows.filter(d=>d.status==='open').length}/${windows.length}`);
        this.setText('summary-lights',`${lights.filter(l=>l.status==='on').length}/${lights.length}`);
        this.setText('summary-cameras',cameras.filter(c=>c.status==='online'||c.status==='recording').length);
        const qg=document.getElementById('quick-access-grid');if(qg)qg.innerHTML=[...doors,...windows,...lights,...cameras].slice(0,6).map(d=>this.createDeviceCard(d)).join('')||'<div class="empty-state"><i class="fas fa-plug"></i><p>Aucun appareil</p></div>';
        const ra=document.getElementById('recent-activity');if(ra)ra.innerHTML=this.activityLog.slice(0,5).map(a=>this.createActivityItem(a)).join('')||'<div class="empty-state"><i class="fas fa-history"></i><p>Aucune activité</p></div>';
    }

    renderDoorsWindows(){const g=document.getElementById('doors-windows-grid');if(!g)return;const items=this.devices.filter(d=>d.type==='door'||d.type==='window');g.innerHTML=items.length?items.map(d=>this.createDeviceCard(d)).join(''):'<div class="empty-state"><i class="fas fa-door-closed"></i><p>Aucune</p></div>';}
    renderLights(){const g=document.getElementById('lights-grid');if(!g)return;const lights=this.devices.filter(d=>d.type==='light');g.innerHTML=lights.length?lights.map(d=>this.createDeviceCard(d)).join(''):'<div class="empty-state"><i class="fas fa-lightbulb"></i><p>Aucune</p></div>';const btn=document.getElementById('btn-all-lights');if(btn&&lights.length){const anyOn=lights.some(l=>l.status==='on');btn.innerHTML=anyOn?'<i class="fas fa-power-off"></i> Tout éteindre':'<i class="fas fa-power-off"></i> Tout allumer';}}
    renderCameras(){const g=document.getElementById('cameras-grid');if(!g)return;const cameras=this.devices.filter(d=>d.type==='camera');g.innerHTML=cameras.length?cameras.map(d=>this.createDeviceCard(d)).join(''):'<div class="empty-state"><i class="fas fa-video-slash"></i><p>Aucune</p></div>';}

    createDeviceCard(d){
        const sc=this.getStatusClass(d),st=this.getStatusText(d),ic=d.type!=='camera',dis=!this.isInProximity&&ic?'disabled':'';
        let ch='';
        if(d.type==='light')ch=`<label class="toggle-switch"><input type="checkbox" ${d.status==='on'?'checked':''} onchange="app.toggleDevice('${d.id}')" ${dis}><span class="toggle-slider"></span></label>`;
        else if(d.type==='door'||d.type==='window')ch=`<button class="btn ${d.status==='open'?'btn-danger':'btn-primary'} btn-sm" onclick="app.toggleDevice('${d.id}')" ${dis}><i class="fas fa-${d.status==='open'?'lock':'lock-open'}"></i> ${d.status==='open'?'Fermer':'Ouvrir'}</button>`;
        else if(d.type==='camera'){
            const isRec=this.isRecording(d.id);
            ch=`<button class="btn btn-outline btn-sm" onclick="app.openConfigCameraModal('${d.id}')" data-always-enabled="true"><i class="fas fa-cog"></i></button>`;
            if(d.localStream)ch+=`<button class="btn ${isRec?'btn-danger':'btn-outline'} btn-sm" onclick="app.toggleRecording('${d.id}')" data-always-enabled="true"><i class="fas fa-${isRec?'stop':'record-vinyl'}"></i></button><button class="btn btn-outline btn-sm" onclick="app.toggleMotionDetection('${d.id}')" data-always-enabled="true"><i class="fas fa-${d.motionDetection?'running':'walking'}"></i></button>`;
            ch+=`<button class="btn btn-outline btn-sm" onclick="app.configureArduinoIP('${d.id}')" title="Configurer Arduino"><i class="fas fa-microchip"></i></button><button class="btn btn-outline btn-sm" onclick="app.showVideoGallery('${d.id}')" data-always-enabled="true"><i class="fas fa-folder-open"></i></button>`;
        }

        let camHtml='';
        if(d.type==='camera'){
            if(d.localStream)camHtml+=`<div class="camera-container"><video class="camera-feed-video" id="video-${d.id}" autoplay playsinline muted></video><div class="camera-recording-badge">● DIRECT</div></div>`;
            else if(d.cameraUrl)camHtml+=`<div class="camera-container"><img class="camera-feed-img" id="img-${d.id}" src="${d.cameraUrl}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="camera-error" style="display:none"><i class="fas fa-exclamation-triangle"></i><p>Inaccessible</p></div></div>`;
            else camHtml+=`<div class="camera-container"><div class="camera-placeholder"><i class="fas fa-video-slash"></i><p>Aucun flux</p></div></div>`;
            if(isRec){const dur=this._recorders?.get(d.id)?(Date.now()-this._recorders.get(d.id).startTime)/1000:0;camHtml+=`<div class="recording-timer" id="recording-timer-${d.id}">🔴 ${Math.floor(dur/60)}:${Math.floor(dur%60).toString().padStart(2,'0')}</div>`;}
            camHtml+=`<div class="camera-actions-bar"><button class="btn btn-primary btn-sm" onclick="app.captureImage('${d.id}')" ${!d.localStream&&!d.cameraUrl?'disabled':''}><i class="fas fa-camera"></i> Capturer</button><button class="btn btn-outline btn-sm" onclick="app.toggleCapturesGallery('${d.id}')"><i class="fas fa-images"></i> ${d.captures?.length||0}</button></div><div class="captures-gallery" id="gallery-${d.id}"><div class="gallery-header"><h4>📸 Captures (${d.captures?.length||0})</h4>${d.captures?.length?`<button class="btn btn-outline btn-sm" onclick="app.clearAllCaptures('${d.id}')"><i class="fas fa-trash"></i></button>`:''}</div><div class="gallery-grid" id="gallery-content-${d.id}"></div></div>`;
        }

        return `<div class="device-card type-${d.type}"><div class="device-card-header"><div class="device-card-icon"><i class="fas ${d.icon}"></i></div><span class="device-status-badge ${sc}">${st}</span></div><div class="device-card-name">${d.name}</div><div class="device-card-room"><i class="fas fa-map-marker-alt"></i> ${d.room}</div>${camHtml}<div class="device-card-actions">${ch}<button class="btn btn-outline btn-sm" onclick="app.deleteDevice('${d.id}')" ${!this.isInProximity?'disabled':''}><i class="fas fa-trash"></i></button></div></div>`;
    }

    getStatusClass(d){return['open','on','online','recording'].includes(d.status)?'open':'closed';}
    getStatusText(d){return{door:{open:'Ouverte',closed:'Fermée'},window:{open:'Ouverte',closed:'Fermée'},light:{on:'Allumée',off:'Éteinte'},camera:{online:'En ligne',recording:'En direct'}}[d.type]?.[d.status]||d.status;}

    /* ==================== ACTIVITÉ & NOTIFICATIONS ==================== */
    renderActivity(){const fa=document.getElementById('full-activity');if(fa)fa.innerHTML=this.activityLog.length?this.activityLog.map(a=>this.createActivityItem(a)).join(''):'<div class="empty-state"><i class="fas fa-history"></i><p>Aucune</p></div>';}
    createActivityItem(a){return`<div class="activity-item"><span class="activity-icon">${a.emoji||'📝'}</span><span class="activity-message">${a.message}</span><span class="activity-time">${this.formatTime(a.timestamp)}</span></div>`;}
    addActivity(m,t,e='📝'){this.activityLog.unshift({message:m,type:t,emoji:e,timestamp:new Date().toISOString()});if(this.activityLog.length>200)this.activityLog=this.activityLog.slice(0,200);this.renderActivity();this.saveData();}
    clearActivity(){if(confirm('Effacer ?')){this.activityLog=[];this.saveData();this.renderAll();this.showToast('Effacé','info');}}

    addNotification(m,t='info'){this.notifications.unshift({message:m,type:t,timestamp:new Date().toISOString(),read:false});if(this.notifications.length>100)this.notifications=this.notifications.slice(0,100);this.updateNotificationBadge();this.renderNotifications();this.saveData();}
    renderNotifications(){const l=document.getElementById('notification-list');if(l)l.innerHTML=this.notifications.length?this.notifications.map((n,i)=>`<div class="notification-item ${n.read?'':'unread'}" onclick="app.markNotificationRead(${i})"><span class="notif-icon">${{success:'✅',error:'❌',warning:'⚠️',info:'ℹ️'}[n.type]||'📢'}</span><div class="notif-content"><div>${n.message}</div><div class="notif-time">${this.formatTime(n.timestamp)}</div></div></div>`).join(''):'<div class="empty-state"><i class="fas fa-bell-slash"></i><p>Aucune</p></div>';}
    markNotificationRead(i){if(this.notifications[i]){this.notifications[i].read=true;this.updateNotificationBadge();this.renderNotifications();this.saveData();}}
    clearNotifications(){this.notifications=[];this.updateNotificationBadge();this.renderNotifications();this.saveData();this.showToast('Effacées','info');}
    updateNotificationBadge(){const b=document.getElementById('notification-badge');if(!b)return;const u=this.notifications.filter(n=>!n.read).length;b.textContent=u>99?'99+':u;u>0?b.classList.add('show'):b.classList.remove('show');}
    toggleNotificationPanel(){const p=document.getElementById('notification-panel'),o=document.getElementById('panel-overlay');if(!p)return;const a=p.classList.contains('active');if(a){p.classList.remove('active');if(o)o.classList.remove('active');}else{p.classList.add('active');if(o)o.classList.add('active');this.renderNotifications();}}

    /* ==================== NAVIGATION ==================== */
    switchTab(tabName){
        document.querySelectorAll('.tab-button').forEach(b=>b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
        const btn=document.querySelector(`.tab-button[data-tab="${tabName}"]`),panel=document.getElementById(`panel-${tabName}`);
        if(btn)btn.classList.add('active');if(panel)panel.classList.add('active');
        if(tabName==='dashboard')this.renderDashboard();
        else if(tabName==='devices')this.renderDoorsWindows();
        else if(tabName==='lights')this.renderLights();
        else if(tabName==='cameras')this.renderCameras();
        else if(tabName==='recordings')this.renderAllRecordings();
        else if(tabName==='activity')this.renderActivity();
        setTimeout(()=>this.refreshAllVideoStreams(),200);
    }

    /* ==================== UI UTILS ==================== */
    updateConnectionUI(){
        const badge=document.getElementById('connection-badge'),text=document.getElementById('connection-text'),alert=document.getElementById('proximity-alert');
        if(!badge||!text)return;badge.className='connection-badge';
        if(this.isInProximity){badge.classList.add('local');text.textContent='Connecté (Local)';}
        else if(this.isLoggedIn){badge.classList.add('remote');text.textContent='Distant (Lecture seule)';}
        else{badge.classList.add('disconnected');text.textContent='Déconnecté';}
        if(alert)alert.classList.toggle('show',!this.isInProximity&&this.isLoggedIn);
    }
    setText(id,text){const el=document.getElementById(id);if(el)el.textContent=text;}

    showToast(m,t='info'){
        const c=document.getElementById('toast-container');if(!c)return;
        const icons={success:'<i class="fas fa-check-circle"></i>',error:'<i class="fas fa-times-circle"></i>',warning:'<i class="fas fa-exclamation-triangle"></i>',info:'<i class="fas fa-info-circle"></i>'};
        const toast=document.createElement('div');toast.className=`toast ${t}`;toast.innerHTML=`${icons[t]||icons.info} ${m}`;
        c.appendChild(toast);setTimeout(()=>toast.remove(),3000);
    }

    formatTime(ts){
        const d=new Date(ts),n=new Date(),s=Math.floor((n-d)/1000),mn=Math.floor(s/60),h=Math.floor(mn/60),j=Math.floor(h/24);
        if(s<10)return'À l\'instant';if(s<60)return`Il y a ${s}s`;if(mn<60)return`Il y a ${mn}min`;
        if(h<24)return d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
        if(j<7)return`Il y a ${j}j`;return d.toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
    }
}

/* ==================== INIT ==================== */
const app = new SmartHomeApp();
console.log('✅ Smart Home Pro v3.0 prêt !');
console.log('👤 Compte admin: admin / admin123');
console.log('💡 Ctrl+P = simuler proximité');
console.log('📹 Caméras: Configurer > Utiliser caméra téléphone');
