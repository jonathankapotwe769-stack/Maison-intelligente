/* =============================================
   ENREGISTREUR VIDÉO - SMART HOME PRO
   MediaRecorder API + IndexedDB
   ============================================= */

class VideoRecorder {
    constructor() {
        this.recorders = new Map();
        this.dbName = 'SmartHomeVideos';
        this.dbVersion = 1;
        this.db = null;
        this.initDatabase();
    }

    async initDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                console.error('❌ Erreur IndexedDB:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('✅ Base vidéo prête');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('recordings')) {
                    const store = db.createObjectStore('recordings', { keyPath: 'id' });
                    store.createIndex('deviceId', 'deviceId', { unique: false });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
                if (!db.objectStoreNames.contains('videoChunks')) {
                    db.createObjectStore('videoChunks', { keyPath: 'chunkId' });
                }
            };
        });
    }

    async startRecording(deviceId, stream, options = {}) {
        if (this.recorders.has(deviceId)) {
            console.warn('⚠️ Enregistrement déjà en cours:', deviceId);
            return false;
        }

        if (!MediaRecorder.isTypeSupported('video/webm')) {
            console.error('❌ Format video/webm non supporté');
            if (typeof app !== 'undefined') app.showToast('❌ Format non supporté', 'error');
            return false;
        }

        try {
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'video/webm;codecs=vp9',
                videoBitsPerSecond: 2500000
            });

            const chunks = [];
            const recordingId = 'rec-' + Date.now();
            const startTime = Date.now();

            mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    chunks.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                console.log('📹 Enregistrement terminé:', recordingId);
                const blob = new Blob(chunks, { type: 'video/webm' });
                const duration = (Date.now() - startTime) / 1000;

                await this.saveRecording(deviceId, blob, {
                    id: recordingId,
                    deviceId: deviceId,
                    startTime: new Date(startTime).toISOString(),
                    duration: duration,
                    size: blob.size,
                    type: options.type || 'manual'
                });

                this.recorders.delete(deviceId);

                if (typeof app !== 'undefined') {
                    const device = app.devices.find(d => d.id === deviceId);
                    app.addNotification(
                        `📹 Enregistrement terminé : ${device?.name || deviceId} (${duration.toFixed(1)}s)`,
                        'success'
                    );
                    app.addActivity(
                        `Enregistrement vidéo ${duration.toFixed(1)}s - ${device?.name || deviceId}`,
                        'camera', '📹'
                    );
                    app.renderAll();
                }
            };

            mediaRecorder.onerror = (event) => {
                console.error('❌ Erreur enregistrement:', event.error);
                if (typeof app !== 'undefined') app.showToast('❌ Erreur enregistrement', 'error');
                this.recorders.delete(deviceId);
            };

            mediaRecorder.start(1000);
            this.recorders.set(deviceId, {
                mediaRecorder, chunks, stream, recordingId, startTime,
                type: options.type || 'manual'
            });

            console.log('🔴 Enregistrement démarré:', deviceId);

            const maxDuration = options.maxDuration || 60;
            setTimeout(() => {
                if (this.recorders.has(deviceId)) {
                    console.log('⏱️ Arrêt automatique après', maxDuration, 's');
                    this.stopRecording(deviceId);
                }
            }, maxDuration * 1000);

            return true;

        } catch (error) {
            console.error('❌ Erreur démarrage:', error);
            if (typeof app !== 'undefined') app.showToast('❌ Impossible de démarrer', 'error');
            return false;
        }
    }

    stopRecording(deviceId) {
        const recorderData = this.recorders.get(deviceId);
        if (!recorderData) return;
        if (recorderData.mediaRecorder.state === 'recording') {
            recorderData.mediaRecorder.stop();
            console.log('⏹️ Arrêt enregistrement:', deviceId);
        }
    }

    isRecording(deviceId) {
        const recorderData = this.recorders.get(deviceId);
        return recorderData && recorderData.mediaRecorder.state === 'recording';
    }

    getRecordingDuration(deviceId) {
        const recorderData = this.recorders.get(deviceId);
        if (!recorderData) return 0;
        return (Date.now() - recorderData.startTime) / 1000;
    }

    async saveRecording(deviceId, blob, metadata) {
        await this.ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['recordings', 'videoChunks'], 'readwrite');
            const recordingsStore = transaction.objectStore('recordings');
            recordingsStore.add({ ...metadata, blobSize: blob.size, savedAt: new Date().toISOString() });

            const chunksStore = transaction.objectStore('videoChunks');
            const chunkSize = 1024 * 1024;
            const totalChunks = Math.ceil(blob.size / chunkSize);

            for (let i = 0; i < totalChunks; i++) {
                const start = i * chunkSize;
                const end = Math.min(start + chunkSize, blob.size);
                chunksStore.add({
                    chunkId: `${metadata.id}-${i}`,
                    recordingId: metadata.id,
                    chunkIndex: i,
                    totalChunks: totalChunks,
                    data: blob.slice(start, end)
                });
            }

            transaction.oncomplete = () => {
                console.log('✅ Vidéo sauvegardée:', metadata.id, `(${(blob.size/1024/1024).toFixed(2)} MB)`);
                resolve();
            };
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async getRecordings(deviceId = null) {
        await this.ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['recordings'], 'readonly');
            const store = transaction.objectStore('recordings');
            let request;
            if (deviceId) {
                const index = store.index('deviceId');
                request = index.getAll(deviceId);
            } else {
                request = store.getAll();
            }
            request.onsuccess = () => {
                const recordings = request.result;
                recordings.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
                resolve(recordings);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async getRecordingBlob(recordingId) {
        await this.ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['videoChunks'], 'readonly');
            const store = transaction.objectStore('videoChunks');
            const range = IDBKeyRange.bound(`${recordingId}-0`, `${recordingId}-999`);
            const request = store.getAll(range);
            request.onsuccess = () => {
                const chunks = request.result;
                if (chunks.length === 0) { reject(new Error('Aucun chunk')); return; }
                chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
                resolve(new Blob(chunks.map(c => c.data), { type: 'video/webm' }));
            };
            request.onerror = () => reject(request.error);
        });
    }

    async playRecording(recordingId) {
        try {
            const blob = await this.getRecordingBlob(recordingId);
            const url = URL.createObjectURL(blob);
            const modal = document.createElement('div');
            modal.className = 'video-player-modal';
            modal.innerHTML = `
                <div class="video-player-overlay" onclick="this.parentElement.remove(); URL.revokeObjectURL('${url}')"></div>
                <div class="video-player-content">
                    <button class="video-player-close" onclick="this.closest('.video-player-modal').remove(); URL.revokeObjectURL('${url}')"><i class="fas fa-times"></i></button>
                    <video controls autoplay style="max-width:100%;max-height:80vh;border-radius:12px;">
                        <source src="${url}" type="video/webm">
                    </video>
                </div>
            `;
            document.body.appendChild(modal);
            const escHandler = (e) => {
                if (e.key === 'Escape') { modal.remove(); URL.revokeObjectURL(url); document.removeEventListener('keydown', escHandler); }
            };
            document.addEventListener('keydown', escHandler);
        } catch (error) {
            console.error('❌ Erreur lecture:', error);
            if (typeof app !== 'undefined') app.showToast('❌ Impossible de lire la vidéo', 'error');
        }
    }

    async downloadRecording(recordingId) {
        try {
            const blob = await this.getRecordingBlob(recordingId);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `surveillance-${recordingId}.webm`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            if (typeof app !== 'undefined') app.showToast('💾 Vidéo téléchargée', 'success');
        } catch (error) {
            console.error('❌ Erreur téléchargement:', error);
            if (typeof app !== 'undefined') app.showToast('❌ Erreur téléchargement', 'error');
        }
    }

    async deleteRecording(recordingId) {
        await this.ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['recordings', 'videoChunks'], 'readwrite');
            transaction.objectStore('recordings').delete(recordingId);
            const chunksStore = transaction.objectStore('videoChunks');
            const range = IDBKeyRange.bound(`${recordingId}-0`, `${recordingId}-999`);
            const request = chunksStore.getAll(range);
            request.onsuccess = () => {
                request.result.forEach(chunk => chunksStore.delete(chunk.chunkId));
            };
            transaction.oncomplete = () => { console.log('🗑️ Supprimé:', recordingId); resolve(); };
            transaction.onerror = () => reject(transaction.error);
        });
    }

    async getStorageUsage() {
        await this.ensureDB();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['recordings'], 'readonly');
            const request = transaction.objectStore('recordings').getAll();
            request.onsuccess = () => {
                const recordings = request.result;
                const totalSize = recordings.reduce((sum, r) => sum + (r.blobSize || 0), 0);
                resolve({
                    count: recordings.length,
                    totalSizeBytes: totalSize,
                    totalSizeMB: (totalSize / 1024 / 1024).toFixed(2)
                });
            };
            request.onerror = () => reject(request.error);
        });
    }

    async cleanupOldRecordings(keepCount = 20) {
        await this.ensureDB();
        const allRecordings = await this.getRecordings();
        if (allRecordings.length <= keepCount) return;
        const toDelete = allRecordings.slice(keepCount);
        for (const recording of toDelete) {
            await this.deleteRecording(recording.id);
        }
        console.log(`🧹 Nettoyage: ${toDelete.length} enregistrements supprimés`);
    }

    async ensureDB() {
        if (!this.db) await this.initDatabase();
        if (!this.db) throw new Error('Base de données non disponible');
    }
}

const videoRecorder = new VideoRecorder();