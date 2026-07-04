/* =============================================
   SMART HOME PRO - APPLICATION PRINCIPALE
   ============================================= */

class SmartHomeApp {
    constructor() {
        this.HOME_LATITUDE = 48.8566;
        this.HOME_LONGITUDE = 2.3522;
        this.PROXIMITY_RADIUS = 2;
        this.VALID_USERNAME = 'admin';
        this.VALID_PASSWORD = 'admin123';

        this.isLoggedIn = false;
        this.currentUser = null;
        this.isInProximity = false;
        this.geoWatchId = null;
        this.currentConfigCameraId = null;
        this.recordingTimers = {};

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

        this.notifications = [];
        this.activityLog = [];
        this.init();
    }

    init() {
        console.log('🏠 Smart Home Pro - Initialisation...');
        this.loadData();
        this.setupEventListeners();
        if (this.isLoggedIn && this.currentUser) {
            this.showDashboard();
            this.startProximityCheck();
        }
        this.cleanupOldData();
    }

    loadData() {
        try {
            const saved = localStorage.getItem('smartHomeProData');
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
            localStorage.setItem('smartHomeProData', JSON.stringify({
                devices: devicesCopy,
                notifications: this.notifications,
                activityLog: this.activityLog,
                isLoggedIn: this.isLoggedIn,
                currentUser: this.currentUser
            }));
        } catch (e) { console.error('❌ Erreur sauvegarde:', e); }
    }

    async cleanupOldData() {
        try { await videoRecorder.cleanupOldRecordings(20); } catch (e) {}
    }

    setupEventListeners() {
        const loginForm = document.getElementById('login-form');
        if (loginForm) loginForm.addEventListener('submit', (e) => { e.preventDefault(); this.login(); });
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });
        const overlay = document.getElementById('panel-overlay');
        if (overlay) overlay.addEventListener('click', () => this.toggleNotificationPanel());
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => { if (e.target === overlay) { this.closeAddDeviceModal(); this.closeConfigCameraModal(); } });
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { this.closeAddDeviceModal(); this.closeConfigCameraModal(); if (document.getElementById('notification-panel')?.classList.contains('active')) this.toggleNotificationPanel(); }
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

    /* ==================== AUTH ==================== */
    login() {
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value.trim();
        const errorEl = document.getElementById('login-error');
        if (!username || !password) { this.showLoginError('Champs requis'); return; }
        if (username === this.VALID_USERNAME && password === this.VALID_PASSWORD) {
            this.isLoggedIn = true;
            this.currentUser = { username, initial: username.charAt(0).toUpperCase(), loginTime: new Date().toISOString() };
            errorEl.classList.remove('show');
            this.saveData();
            this.showDashboard();
            this.startProximityCheck();
            this.addActivity('Connexion réussie', 'login', '🔑');
            this.showToast('Bienvenue ' + username + ' ! 🏠', 'success');
        } else {
            this.showLoginError('Identifiants incorrects');
        }
    }

    showLoginError(msg) {
        const el = document.getElementById('login-error');
        if (el) { el.textContent = msg; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3000); }
    }

    logout() {
        this.cleanup();
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

    /* ==================== PROXIMITÉ ==================== */
    startProximityCheck() {
        if (!navigator.geolocation) { this.isInProximity = false; this.updateConnectionUI(); return; }
        this.geoWatchId = navigator.geolocation.watchPosition(
            (p) => this.handlePositionUpdate(p),
            (e) => this.handleGeoError(e),
            { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
        );
    }

    handlePositionUpdate(pos) {
        const d = this.calculateDistance(pos.coords.latitude, pos.coords.longitude, this.HOME_LATITUDE, this.HOME_LONGITUDE);
        const was = this.isInProximity;
        this.isInProximity = d <= this.PROXIMITY_RADIUS;
        if (was !== this.isInProximity) { this.updateConnectionUI(); this.renderAll(); }
        const dt = document.getElementById('distance-text');
        if (dt) dt.textContent = ` (${d < 1 ? (d*100).toFixed(0)+' cm' : d.toFixed(1)+' m'})`;
    }

    handleGeoError(e) { this.isInProximity = false; this.updateConnectionUI(); this.renderAll(); }
    stopProximityCheck() { if (this.geoWatchId !== null) { navigator.geolocation.clearWatch(this.geoWatchId); this.geoWatchId = null; } this.isInProximity = false; this.updateConnectionUI(); }
    calculateDistance(lat1, lon1, lat2, lon2) { const R=6371000, dLat=(lat2-lat1)*Math.PI/180, dLon=(lon2-lon1)*Math.PI/180, a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2; return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)); }
    simulateProximity() { this.isInProximity=!this.isInProximity; this.updateConnectionUI(); this.renderAll(); this.showToast(this.isInProximity?'📍 Proximité simulée ACTIVÉE':'📍 Proximité simulée DÉSACTIVÉE',this.isInProximity?'success':'warning'); }

    /* ==================== CONTRÔLE APPAREILS ==================== */
    canControl() { if(!this.isInProximity){this.showToast('❌ Vous devez être à moins de 2 mètres','error');return false;} return true; }
    
    toggleDevice(deviceId) {
        if(!this.canControl())return;
        const d=this.devices.find(x=>x.id===deviceId);
        if(!d||d.type==='camera')return;
        if(d.type==='door'||d.type==='window')d.status=d.status==='open'?'closed':'open';
        else if(d.type==='light')d.status=d.status==='on'?'off':'on';
        const t=this.getActionText(d),e=this.getDeviceEmoji(d.type);
        this.addNotification(`${e} ${d.name} ${t}`,'info');
        this.addActivity(`${d.name} ${t}`,d.type,e);
        this.showToast(`${d.name} ${t}`,'success');
        this.saveData(); this.renderAll();
    }

    toggleAllLights() {
        if(!this.canControl())return;
        const lights=this.devices.filter(d=>d.type==='light');
        if(!lights.length){this.showToast('Aucune lumière','info');return;}
        const anyOn=lights.some(l=>l.status==='on');
        lights.forEach(l=>l.status=anyOn?'off':'on');
        const a=anyOn?'éteintes':'allumées';
        this.addNotification(`💡 Toutes les lumières ${a}`,'info');
        this.addActivity(`Toutes les lumières ${a}`,'light','💡');
        this.showToast(`Lumières ${a}`,'success');
        this.saveData(); this.renderAll();
    }

    closeAllDoorsWindows() {
        if(!this.canControl())return;
        const items=this.devices.filter(d=>(d.type==='door'||d.type==='window')&&d.status==='open');
        if(!items.length){this.showToast('Tout est fermé','info');return;}
        items.forEach(i=>i.status='closed');
        this.addNotification(`🔒 ${items.length} ouverture(s) fermée(s)`,'info');
        this.addActivity(`${items.length} fermeture(s)`,'system','🔒');
        this.showToast(`${items.length} fermeture(s)`,'success');
        this.saveData(); this.renderAll();
    }

    getActionText(d){return{door:d.status==='open'?'ouverte':'fermée',window:d.status==='open'?'ouverte':'fermée',light:d.status==='on'?'allumée':'éteinte'}[d.type]||'modifié(e)';}
    getDeviceEmoji(t){return{door:'🚪',window:'🪟',light:'💡',camera:'📹'}[t]||'📦';}

    /* ==================== CAMÉRAS ==================== */
    openConfigCameraModal(deviceId) {
        const d=this.devices.find(x=>x.id===deviceId);
        if(!d||d.type!=='camera')return;
        this.currentConfigCameraId=deviceId;
        document.getElementById('config-camera-url').value=d.cameraUrl||'';
        document.getElementById('modal-config-camera').classList.add('active');
    }
    closeConfigCameraModal() { document.getElementById('modal-config-camera').classList.remove('active'); this.currentConfigCameraId=null; }
    
    saveCameraConfig() {
        if(!this.currentConfigCameraId)return;
        const d=this.devices.find(x=>x.id===this.currentConfigCameraId);
        if(!d)return;
        if(d.localStream)this.stopDeviceStream(d);
        d.cameraUrl=document.getElementById('config-camera-url').value.trim()||null;
        d.streamType=d.cameraUrl?'remote':null;
        this.saveData(); this.renderAll(); this.closeConfigCameraModal();
        this.showToast('✅ Caméra configurée','success');
        this.addActivity(`Caméra ${d.name} configurée`,'camera','📹');
    }

    async usePhoneCamera() {
        if(!this.currentConfigCameraId)return;
        const d=this.devices.find(x=>x.id===this.currentConfigCameraId);
        if(!d)return;
        this.closeConfigCameraModal();
        try {
            this.stopDeviceStream(d);
            const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1280},height:{ideal:720}},audio:false});
            d.localStream=stream; d.cameraUrl=null; d.streamType='local'; d.status='recording';
            stream.getVideoTracks()[0].addEventListener('ended',()=>{d.localStream=null;d.status='online';d.streamType=null;this.saveData();this.renderAll();});
            this.saveData(); this.renderAll();
            setTimeout(()=>this.attachStreamToVideo(d.id,stream),200);
            this.showToast('📱 Caméra activée !','success');
            this.addActivity(`Caméra ${d.name} activée`,'camera','📱');
        }catch(e){
            let m='Erreur caméra';
            if(e.name==='NotAllowedError')m='Accès refusé';
            else if(e.name==='NotFoundError')m='Pas de caméra';
            this.showToast('❌ '+m,'error');
        }
    }

    stopDeviceStream(d) {
        if(!d?.localStream)return;
        d.localStream.getTracks().forEach(t=>t.stop());
        d.localStream=null; d.streamType=null;
        if(d.type==='camera'&&d.status==='recording')d.status='online';
    }

    stopAllCameraStreams() { this.devices.forEach(d=>{if(d.localStream)this.stopDeviceStream(d);}); }
    attachStreamToVideo(deviceId,stream){const v=document.getElementById(`video-${deviceId}`);if(v&&stream?.active){v.srcObject=stream;v.muted=true;v.playsInline=true;v.play().catch(()=>{});}}
    refreshAllVideoStreams(){this.devices.forEach(d=>{if(d.type==='camera'&&d.localStream?.active)setTimeout(()=>this.attachStreamToVideo(d.id,d.localStream),100);});}

    /* ==================== CAPTURE IMAGES ==================== */
    captureImage(deviceId) {
        const d=this.devices.find(x=>x.id===deviceId);
        if(!d||d.type!=='camera'){this.showToast('❌ Caméra non trouvée','error');return;}
        if(d.localStream?.active)this.captureFromStream(d,d.localStream,true);
        else if(d.cameraUrl)this.captureFromUrl(d);
        else this.showToast('❌ Aucun flux disponible','error');
    }

    captureFromStream(d,stream,isVideo) {
        try {
            const el=isVideo?document.getElementById(`video-${d.id}`):document.getElementById(`img-${d.id}`);
            if(!el||(isVideo&&!el.srcObject)){this.showToast('❌ Flux non disponible','error');return;}
            const canvas=document.createElement('canvas');
            canvas.width=isVideo?(el.videoWidth||640):(el.naturalWidth||640);
            canvas.height=isVideo?(el.videoHeight||480):(el.naturalHeight||480);
            const ctx=canvas.getContext('2d'); ctx.drawImage(el,0,0,canvas.width,canvas.height);
            ctx.fillStyle='rgba(0,0,0,0.6)';ctx.fillRect(0,canvas.height-40,canvas.width,40);
            ctx.fillStyle='#fff';ctx.font='16px monospace';ctx.fillText(new Date().toLocaleString('fr-FR'),10,canvas.height-12);
            this.saveCapture(d,canvas.toDataURL('image/jpeg',0.85),canvas.width,canvas.height);
            this.flashEffect(d.id);
        }catch(e){console.error('Erreur capture:',e);this.showToast('❌ Erreur capture','error');}
    }

    captureFromUrl(d) {
        const img=document.getElementById(`img-${d.id}`);
        if(!img||!img.complete||img.naturalWidth===0){this.showToast('❌ Image non chargée','error');return;}
        this.captureFromStream(d,null,false);
    }

    saveCapture(d,data,w,h) {
        const cap={id:'cap-'+Date.now(),timestamp:new Date().toISOString(),imageData:data,width:w,height:h,size:(data.length/1024).toFixed(1)+' KB',deviceId:d.id,deviceName:d.name,type:'manual'};
        if(!d.captures)d.captures=[];
        d.captures.unshift(cap);
        if(d.captures.length>50)d.captures=d.captures.slice(0,50);
        this.saveData();
        this.addActivity(`📸 Capture: ${d.name}`,'camera','📸');
        this.addNotification(`📸 Image capturée: ${d.name}`,'success');
        this.showToast('📸 Capture enregistrée !','success');
        if(document.getElementById(`gallery-${d.id}`)?.classList.contains('active'))this.renderCapturesGallery(d.id);
    }

    flashEffect(id){const c=document.querySelector(`#video-${id}`)?.parentElement||document.querySelector(`#img-${id}`)?.parentElement;if(c){c.style.filter='brightness(2)';setTimeout(()=>c.style.filter='brightness(1)',150);}}

    toggleCapturesGallery(deviceId){const g=document.getElementById(`gallery-${deviceId}`);if(!g)return;g.classList.toggle('active');if(g.classList.contains('active'))this.renderCapturesGallery(deviceId);}

    renderCapturesGallery(deviceId) {
        const d=this.devices.find(x=>x.id===deviceId);
        if(!d)return;
        const c=document.getElementById(`gallery-content-${deviceId}`);
        if(!c)return;
        if(!d.captures?.length){c.innerHTML='<div class="empty-state"><i class="fas fa-camera-retro"></i><p>Aucune capture</p></div>';return;}
        c.innerHTML=d.captures.map(cap=>`
            <div class="capture-thumbnail" onclick="app.viewCaptureFullscreen('${deviceId}','${cap.id}')">
                <img src="${cap.imageData}" alt="Capture" loading="lazy">
                <div class="capture-info"><span>${new Date(cap.timestamp).toLocaleString('fr-FR')}</span><span>${cap.size}</span></div>
                <div class="capture-actions">
                    <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();app.downloadCapture('${deviceId}','${cap.id}')"><i class="fas fa-download"></i></button>
                    <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();app.deleteCapture('${deviceId}','${cap.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `).join('');
    }

    viewCaptureFullscreen(deviceId,captureId){
        const d=this.devices.find(x=>x.id===deviceId);if(!d)return;
        const cap=d.captures?.find(x=>x.id===captureId);if(!cap)return;
        const m=document.createElement('div');m.className='fullscreen-modal';
        m.innerHTML=`<div class="fullscreen-overlay" onclick="this.parentElement.remove()"></div><div class="fullscreen-content"><button class="fullscreen-close" onclick="this.parentElement.parentElement.remove()"><i class="fas fa-times"></i></button><img src="${cap.imageData}" alt="Capture"><div class="fullscreen-info"><span>${d.name} - ${new Date(cap.timestamp).toLocaleString('fr-FR')}</span><span>${cap.size}</span><div style="margin-top:10px"><button class="btn btn-primary btn-sm" onclick="app.downloadCapture('${deviceId}','${captureId}')"><i class="fas fa-download"></i> Télécharger</button><button class="btn btn-outline btn-sm" onclick="app.deleteCapture('${deviceId}','${captureId}');this.closest('.fullscreen-modal').remove()"><i class="fas fa-trash"></i> Supprimer</button></div></div></div>`;
        document.body.appendChild(m);
    }

    downloadCapture(deviceId,captureId){
        const d=this.devices.find(x=>x.id===deviceId);if(!d)return;
        const cap=d.captures?.find(x=>x.id===captureId);if(!cap)return;
        const a=document.createElement('a');a.href=cap.imageData;a.download=`capture-${d.name}-${cap.id}.jpg`;document.body.appendChild(a);a.click();document.body.removeChild(a);
        this.showToast('💾 Image téléchargée','success');
    }

    deleteCapture(deviceId,captureId){
        const d=this.devices.find(x=>x.id===deviceId);if(!d)return;
        if(confirm('Supprimer cette capture ?')){d.captures=d.captures.filter(c=>c.id!==captureId);this.saveData();this.renderCapturesGallery(deviceId);this.showToast('🗑️ Supprimée','info');}
    }

    clearAllCaptures(deviceId){
        const d=this.devices.find(x=>x.id===deviceId);if(!d?.captures?.length){this.showToast('Aucune capture','info');return;}
        if(confirm(`Supprimer ${d.captures.length} captures ?`)){d.captures=[];this.saveData();this.renderCapturesGallery(deviceId);this.renderAll();this.showToast('Captures supprimées','info');}
    }

    /* ==================== ENREGISTREMENT VIDÉO ==================== */
    async toggleRecording(deviceId) {
        const d=this.devices.find(x=>x.id===deviceId);
        if(!d||d.type!=='camera')return;
        if(videoRecorder.isRecording(deviceId)){
            videoRecorder.stopRecording(deviceId);
            this.showToast('⏹️ Enregistrement arrêté','info');
            if(this.recordingTimers[deviceId]){clearInterval(this.recordingTimers[deviceId]);delete this.recordingTimers[deviceId];}
        }else{
            if(!d.localStream?.active){this.showToast('❌ Activez d\'abord la caméra','error');return;}
            const started=await videoRecorder.startRecording(deviceId,d.localStream,{maxDuration:60,type:'manual'});
            if(started){
                this.showToast('🔴 Enregistrement (60s max)','success');
                this.addActivity(`Enregistrement: ${d.name}`,'camera','🔴');
                this.startRecordingTimer(deviceId);
            }
        }
        this.renderAll();
    }

    startRecordingTimer(deviceId) {
        if(this.recordingTimers[deviceId])clearInterval(this.recordingTimers[deviceId]);
        this.recordingTimers[deviceId]=setInterval(()=>{
            if(!videoRecorder.isRecording(deviceId)){clearInterval(this.recordingTimers[deviceId]);delete this.recordingTimers[deviceId];this.renderAll();return;}
            const timer=document.getElementById(`recording-timer-${deviceId}`);
            if(timer){const d=videoRecorder.getRecordingDuration(deviceId);const m=Math.floor(d/60),s=Math.floor(d%60);timer.textContent=`🔴 ENREGISTREMENT ${m}:${s.toString().padStart(2,'0')}`;}
        },1000);
    }

    toggleMotionDetection(deviceId) {
        const d=this.devices.find(x=>x.id===deviceId);
        if(!d||d.type!=='camera')return;
        if(d.motionInterval){clearInterval(d.motionInterval);d.motionInterval=null;d.motionDetection=false;this.showToast('🔍 Détection désactivée','info');}
        else{
            if(!d.localStream?.active){this.showToast('❌ Activez la caméra','error');return;}
            d.motionDetection=true;
            d.motionInterval=setInterval(async()=>{
                if(Math.random()<0.3&&!videoRecorder.isRecording(deviceId)){
                    this.addNotification(`🏃 Mouvement: ${d.name}`,'warning');
                    const started=await videoRecorder.startRecording(deviceId,d.localStream,{maxDuration:30,type:'motion'});
                    if(started){this.addActivity(`Enregistrement auto: ${d.name}`,'camera','🏃');this.renderAll();this.startRecordingTimer(deviceId);}
                }
            },10000);
            this.showToast('🔍 Détection activée','success');
        }
        this.saveData();this.renderAll();
    }

    async showVideoGallery(deviceId) {
        const d=this.devices.find(x=>x.id===deviceId);if(!d)return;
        const recordings=await videoRecorder.getRecordings(deviceId);
        const modal=document.createElement('div');modal.className='modal-overlay active';
        modal.innerHTML=`<div class="modal" style="max-width:600px"><div class="modal-header"><h2>📹 ${d.name}</h2><button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button></div><div class="modal-body">${recordings.length===0?'<div class="empty-state"><i class="fas fa-video-slash"></i><p>Aucun enregistrement</p></div>':`<div class="recordings-list">${recordings.map(r=>`<div class="recording-item"><div class="recording-item-info"><i class="fas fa-video"></i><div><strong>${new Date(r.startTime).toLocaleString('fr-FR')}</strong><small>${r.duration.toFixed(1)}s • ${(r.blobSize/1024/1024).toFixed(2)} MB • ${r.type==='motion'?'🏃 Mouvement':'👤 Manuel'}</small></div></div><div class="recording-item-actions"><button class="btn btn-primary btn-sm" onclick="videoRecorder.playRecording('${r.id}')"><i class="fas fa-play"></i> Lire</button><button class="btn btn-outline btn-sm" onclick="videoRecorder.downloadRecording('${r.id}')"><i class="fas fa-download"></i></button><button class="btn btn-outline btn-sm" onclick="videoRecorder.deleteRecording('${r.id}');this.closest('.modal-overlay').remove();app.showVideoGallery('${deviceId}')"><i class="fas fa-trash"></i></button></div></div>`).join('')}</div>`}</div></div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click',(e)=>{if(e.target===modal)modal.remove();});
    }

    async renderAllRecordings() {
        const container=document.getElementById('all-recordings-container');
        if(!container)return;
        try {
            const recordings=await videoRecorder.getRecordings();
            const usage=await videoRecorder.getStorageUsage();
            if(recordings.length===0){container.innerHTML='<div class="empty-state"><i class="fas fa-film"></i><p>Aucun enregistrement</p><small>Enregistrez des vidéos depuis l\'onglet Caméras</small></div>';return;}
            container.innerHTML=`<p style="margin-bottom:15px;color:var(--text-secondary);">${usage.count} vidéos • ${usage.totalSizeMB} MB utilisés</p><div class="recordings-list">${recordings.map(r=>{const d=this.devices.find(x=>x.id===r.deviceId);return`<div class="recording-item"><div class="recording-item-info"><i class="fas fa-video"></i><div><strong>${d?.name||r.deviceId}</strong><small>${new Date(r.startTime).toLocaleString('fr-FR')} • ${r.duration.toFixed(1)}s • ${(r.blobSize/1024/1024).toFixed(2)} MB</small></div></div><div class="recording-item-actions"><button class="btn btn-primary btn-sm" onclick="videoRecorder.playRecording('${r.id}')"><i class="fas fa-play"></i></button><button class="btn btn-outline btn-sm" onclick="videoRecorder.downloadRecording('${r.id}')"><i class="fas fa-download"></i></button><button class="btn btn-outline btn-sm" onclick="videoRecorder.deleteRecording('${r.id}');app.renderAllRecordings()"><i class="fas fa-trash"></i></button></div></div>`}).join('')}</div>`;
        }catch(e){container.innerHTML='<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Erreur chargement</p></div>';}
    }

    /* ==================== APPAREILS CRUD ==================== */
    openAddDeviceModal(){document.getElementById('modal-add-device').classList.add('active');document.getElementById('new-device-name').focus();this.onDeviceTypeChange();}
    closeAddDeviceModal(){document.getElementById('modal-add-device').classList.remove('active');['new-device-name','new-device-room','new-camera-url'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});document.getElementById('camera-url-group').style.display='none';}
    onDeviceTypeChange(){document.getElementById('camera-url-group').style.display=document.getElementById('new-device-type').value==='camera'?'block':'none';}

    addDevice(){
        const name=document.getElementById('new-device-name').value.trim();
        const type=document.getElementById('new-device-type').value;
        const room=document.getElementById('new-device-room').value.trim();
        const cameraUrl=document.getElementById('new-camera-url')?.value.trim()||null;
        if(!name){this.showToast('Nom requis','error');return;}
        const icons={door:'fa-door-closed',window:'fa-window-maximize',light:'fa-lightbulb',camera:'fa-video'};
        const nd={id:type+'-'+Date.now(),name,type,room:room||'Non spécifié',status:type==='camera'?'online':(type==='light'?'off':'closed'),icon:icons[type],cameraUrl:type==='camera'?cameraUrl:null,streamType:type==='camera'&&cameraUrl?'remote':null,localStream:null,captures:[],motionDetection:false,motionInterval:null};
        this.devices.push(nd);
        this.addNotification(`✅ ${name} ajouté(e)`,'success');
        this.addActivity(`${name} ajouté(e)`,'system',this.getDeviceEmoji(type));
        this.saveData();this.renderAll();this.closeAddDeviceModal();
        this.showToast(`${name} ajouté !`,'success');
    }

    deleteDevice(deviceId){
        if(!this.canControl())return;
        const d=this.devices.find(x=>x.id===deviceId);if(!d)return;
        if(confirm(`Supprimer "${d.name}" ?`)){
            if(d.localStream)this.stopDeviceStream(d);
            if(d.motionInterval)clearInterval(d.motionInterval);
            this.devices=this.devices.filter(x=>x.id!==deviceId);
            this.addNotification(`🗑️ ${d.name} supprimé(e)`,'info');
            this.addActivity(`${d.name} supprimé(e)`,'system','🗑️');
            this.saveData();this.renderAll();
            this.showToast(`${d.name} supprimé(e)`,'info');
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

    renderDoorsWindows(){const g=document.getElementById('doors-windows-grid');if(!g)return;const items=this.devices.filter(d=>d.type==='door'||d.type==='window');g.innerHTML=items.length?items.map(d=>this.createDeviceCard(d)).join(''):'<div class="empty-state"><i class="fas fa-door-closed"></i><p>Aucune porte/fenêtre</p></div>';}
    renderLights(){const g=document.getElementById('lights-grid');if(!g)return;const lights=this.devices.filter(d=>d.type==='light');g.innerHTML=lights.length?lights.map(d=>this.createDeviceCard(d)).join(''):'<div class="empty-state"><i class="fas fa-lightbulb"></i><p>Aucune lumière</p></div>';const btn=document.getElementById('btn-all-lights');if(btn&&lights.length){const anyOn=lights.some(l=>l.status==='on');btn.innerHTML=anyOn?'<i class="fas fa-power-off"></i> Tout éteindre':'<i class="fas fa-power-off"></i> Tout allumer';}}
    renderCameras(){const g=document.getElementById('cameras-grid');if(!g)return;const cameras=this.devices.filter(d=>d.type==='camera');g.innerHTML=cameras.length?cameras.map(d=>this.createDeviceCard(d)).join(''):'<div class="empty-state"><i class="fas fa-video-slash"></i><p>Aucune caméra</p></div>';}

    createDeviceCard(d){
        const sc=this.getStatusClass(d),st=this.getStatusText(d),ic=d.type!=='camera',dis=!this.isInProximity&&ic?'disabled':'';
        let ch='';
        if(d.type==='light')ch=`<label class="toggle-switch"><input type="checkbox" ${d.status==='on'?'checked':''} onchange="app.toggleDevice('${d.id}')" ${dis}><span class="toggle-slider"></span></label>`;
        else if(d.type==='door'||d.type==='window')ch=`<button class="btn ${d.status==='open'?'btn-danger':'btn-primary'} btn-sm" onclick="app.toggleDevice('${d.id}')" ${dis}><i class="fas fa-${d.status==='open'?'lock':'lock-open'}"></i> ${d.status==='open'?'Fermer':'Ouvrir'}</button>`;
        else if(d.type==='camera'){
            const isRec=videoRecorder.isRecording(d.id),hasStream=d.localStream||d.cameraUrl;
            ch=`<button class="btn btn-outline btn-sm" onclick="app.openConfigCameraModal('${d.id}')" data-always-enabled="true"><i class="fas fa-cog"></i></button>`;
            if(d.localStream)ch+=`<button class="btn ${isRec?'btn-danger':'btn-outline'} btn-sm" onclick="app.toggleRecording('${d.id}')" data-always-enabled="true"><i class="fas fa-${isRec?'stop':'record-vinyl'}"></i></button><button class="btn btn-outline btn-sm" onclick="app.toggleMotionDetection('${d.id}')" data-always-enabled="true"><i class="fas fa-${d.motionDetection?'running':'walking'}"></i></button>`;
            ch+=`<button class="btn btn-outline btn-sm" onclick="app.showVideoGallery('${d.id}')" data-always-enabled="true"><i class="fas fa-folder-open"></i></button>`;
        }

        let camHtml='';
        if(d.type==='camera'){
            if(d.localStream)camHtml+=`<div class="camera-container"><video class="camera-feed-video" id="video-${d.id}" autoplay playsinline muted></video><div class="camera-recording-badge">● DIRECT</div></div>`;
            else if(d.cameraUrl)camHtml+=`<div class="camera-container"><img class="camera-feed-img" id="img-${d.id}" src="${d.cameraUrl}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="camera-error" style="display:none"><i class="fas fa-exclamation-triangle"></i><p>Flux inaccessible</p></div></div>`;
            else camHtml+=`<div class="camera-container"><div class="camera-placeholder"><i class="fas fa-video-slash"></i><p>Aucun flux</p></div></div>`;
            if(videoRecorder.isRecording(d.id)){const dur=videoRecorder.getRecordingDuration(d.id);camHtml+=`<div class="recording-timer" id="recording-timer-${d.id}">🔴 ENREGISTREMENT ${Math.floor(dur/60)}:${Math.floor(dur%60).toString().padStart(2,'0')}</div>`;}
            camHtml+=`<div class="camera-actions-bar"><button class="btn btn-primary btn-sm" onclick="app.captureImage('${d.id}')" ${!d.localStream&&!d.cameraUrl?'disabled':''}><i class="fas fa-camera"></i> Capturer</button><button class="btn btn-outline btn-sm" onclick="app.toggleCapturesGallery('${d.id}')"><i class="fas fa-images"></i> ${d.captures?.length||0}</button></div><div class="captures-gallery" id="gallery-${d.id}"><div class="gallery-header"><h4>📸 Captures (${d.captures?.length||0})</h4>${d.captures?.length?`<button class="btn btn-outline btn-sm" onclick="app.clearAllCaptures('${d.id}')"><i class="fas fa-trash"></i></button>`:''}</div><div class="gallery-grid" id="gallery-content-${d.id}"></div></div>`;
        }

        return `<div class="device-card type-${d.type}"><div class="device-card-header"><div class="device-card-icon"><i class="fas ${d.icon}"></i></div><span class="device-status-badge ${sc}">${st}</span></div><div class="device-card-name">${d.name}</div><div class="device-card-room"><i class="fas fa-map-marker-alt"></i> ${d.room}</div>${camHtml}<div class="device-card-actions">${ch}<button class="btn btn-outline btn-sm" onclick="app.deleteDevice('${d.id}')" ${!this.isInProximity?'disabled':''}><i class="fas fa-trash"></i></button></div></div>`;
    }

    getStatusClass(d){return['open','on','online','recording'].includes(d.status)?'open':'closed';}
    getStatusText(d){return{door:{open:'Ouverte',closed:'Fermée'},window:{open:'Ouverte',closed:'Fermée'},light:{on:'Allumée',off:'Éteinte'},camera:{online:'En ligne',offline:'Hors ligne',recording:'En direct'}}[d.type]?.[d.status]||d.status;}

    /* ==================== ACTIVITÉ ==================== */
    renderActivity(){const fa=document.getElementById('full-activity');if(fa)fa.innerHTML=this.activityLog.length?this.activityLog.map(a=>this.createActivityItem(a)).join(''):'<div class="empty-state"><i class="fas fa-history"></i><p>Aucune activité</p></div>';}
    createActivityItem(a){return`<div class="activity-item"><span class="activity-icon">${a.emoji||'📝'}</span><span class="activity-message">${a.message}</span><span class="activity-time">${this.formatTime(a.timestamp)}</span></div>`;}
    addActivity(m,t,e='📝'){this.activityLog.unshift({message:m,type:t,emoji:e,timestamp:new Date().toISOString()});if(this.activityLog.length>200)this.activityLog=this.activityLog.slice(0,200);this.renderActivity();this.saveData();}
    clearActivity(){if(confirm('Effacer l\'historique ?')){this.activityLog=[];this.saveData();this.renderAll();this.showToast('Historique effacé','info');}}

    /* ==================== NOTIFICATIONS ==================== */
    addNotification(m,t='info'){this.notifications.unshift({message:m,type:t,timestamp:new Date().toISOString(),read:false});if(this.notifications.length>100)this.notifications=this.notifications.slice(0,100);this.updateNotificationBadge();this.renderNotifications();this.saveData();}
    renderNotifications(){const l=document.getElementById('notification-list');if(l)l.innerHTML=this.notifications.length?this.notifications.map((n,i)=>`<div class="notification-item ${n.read?'':'unread'}" onclick="app.markNotificationRead(${i})"><span class="notif-icon">${{success:'✅',error:'❌',warning:'⚠️',info:'ℹ️'}[n.type]||'📢'}</span><div class="notif-content"><div>${n.message}</div><div class="notif-time">${this.formatTime(n.timestamp)}</div></div></div>`).join(''):'<div class="empty-state"><i class="fas fa-bell-slash"></i><p>Aucune notification</p></div>';}
    markNotificationRead(i){if(this.notifications[i]){this.notifications[i].read=true;this.updateNotificationBadge();this.renderNotifications();this.saveData();}}
    clearNotifications(){this.notifications=[];this.updateNotificationBadge();this.renderNotifications();this.saveData();this.showToast('Notifications effacées','info');}
    updateNotificationBadge(){const b=document.getElementById('notification-badge');if(!b)return;const u=this.notifications.filter(n=>!n.read).length;b.textContent=u>99?'99+':u;u>0?b.classList.add('show'):b.classList.remove('show');}
    toggleNotificationPanel(){const p=document.getElementById('notification-panel'),o=document.getElementById('panel-overlay');if(!p)return;const a=p.classList.contains('active');if(a){p.classList.remove('active');if(o)o.classList.remove('active');}else{p.classList.add('active');if(o)o.classList.add('active');this.renderNotifications();}}

    /* ==================== NAVIGATION ==================== */
    switchTab(tabName){
        document.querySelectorAll('.tab-button').forEach(b=>b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
        const btn=document.querySelector(`.tab-button[data-tab="${tabName}"]`),panel=document.getElementById(`panel-${tabName}`);
        if(btn)btn.classList.add('active');if(panel)panel.classList.add('active');
        switch(tabName){case'dashboard':this.renderDashboard();break;case'devices':this.renderDoorsWindows();break;case'lights':this.renderLights();break;case'cameras':this.renderCameras();break;case'recordings':this.renderAllRecordings();break;case'activity':this.renderActivity();break;}
        setTimeout(()=>this.refreshAllVideoStreams(),200);
    }

    /* ==================== UI ==================== */
    updateConnectionUI(){
        const badge=document.getElementById('connection-badge'),text=document.getElementById('connection-text'),alert=document.getElementById('proximity-alert');
        if(!badge||!text)return;
        badge.className='connection-badge';
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

    formatTime(ts){const d=new Date(ts),n=new Date(),s=Math.floor((n-d)/1000),mn=Math.floor(s/60),h=Math.floor(mn/60),j=Math.floor(h/24);if(s<10)return'À l\'instant';if(s<60)return`Il y a ${s}s`;if(mn<60)return`Il y a ${mn}min`;if(h<24)return d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});if(j<7)return`Il y a ${j}j`;return d.toLocaleDateString('fr-FR',{day:'numeric',month:'short'});}
}

const app = new SmartHomeApp();
console.log('✅ Smart Home Pro prêt !');