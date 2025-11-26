const API_URL = window.location.origin;
let currentUser = null;
let currentServer = null;
let currentChannel = null;
let servers = [];
let channels = [];
let socket = null;
let localStream = null;
let screenStream = null;
let peerConnections = new Map();
let isMuted = false;
let isInVoice = false;
let isSharingScreen = false;

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupAuthListeners();
    initSocket();
});

function initSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('Connecté au serveur');
    });

    socket.on('newMessage', (message) => {
        if (currentChannel && message.channelId === currentChannel.id) {
            addMessageToUI(message);
        }
    });

    socket.on('userJoinedVoice', (data) => {
        console.log('Utilisateur a rejoint le vocal:', data);
        if (data.userId !== currentUser.id) {
            createPeerConnection(data.socketId, data.userId, data.username);
        }
    });

    socket.on('userLeftVoice', (data) => {
        console.log('Utilisateur a quitté le vocal:', data);
        if (peerConnections.has(data.socketId)) {
            peerConnections.get(data.socketId).close();
            peerConnections.delete(data.socketId);
        }
        removeRemoteVideo(data.socketId);
    });

    socket.on('usersInCall', (users) => {
        users.forEach(user => {
            if (user.userId !== currentUser.id && !peerConnections.has(user.socketId)) {
                createPeerConnection(user.socketId, user.userId, user.username);
            }
        });
    });

    socket.on('offer', async (data) => {
        const pc = await getOrCreatePeerConnection(data.sender, data.userId, data.username);
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', { answer, target: data.sender });
    });

    socket.on('answer', async (data) => {
        const pc = peerConnections.get(data.sender);
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
    });

    socket.on('ice-candidate', async (data) => {
        const pc = peerConnections.get(data.sender);
        if (pc) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    });

    socket.on('userStartedScreenShare', (data) => {
        console.log('Utilisateur a commencé le partage d\'écran:', data);
    });

    socket.on('userStoppedScreenShare', (data) => {
        console.log('Utilisateur a arrêté le partage d\'écran:', data);
    });
}

async function createPeerConnection(socketId, userId, username) {
    const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }

    pc.ontrack = (event) => {
        const remoteVideo = document.createElement('video');
        remoteVideo.id = `remote-${socketId}`;
        remoteVideo.autoplay = true;
        remoteVideo.playsinline = true;
        remoteVideo.srcObject = event.streams[0];
        document.getElementById('screenShareContainer').appendChild(remoteVideo);
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                candidate: event.candidate,
                target: socketId
            });
        }
    };

    peerConnections.set(socketId, pc);

    if (localStream) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', {
            offer,
            target: socketId
        });
    }

    return pc;
}

async function getOrCreatePeerConnection(socketId, userId, username) {
    if (peerConnections.has(socketId)) {
        return peerConnections.get(socketId);
    }
    return await createPeerConnection(socketId, userId, username);
}

function removeRemoteVideo(socketId) {
    const video = document.getElementById(`remote-${socketId}`);
    if (video) {
        video.remove();
    }
}

function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for(let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length, c.length));
    }
    return null;
}

function setCookie(name, value, days) {
    const expires = new Date();
    expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
}

function deleteCookie(name) {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
}

function checkAuth() {
    const token = getCookie('slayzcord_token') || localStorage.getItem('token');
    const userData = getCookie('slayzcord_user') || localStorage.getItem('user');

    if (token && userData) {
        try {
            currentUser = typeof userData === 'string' ? JSON.parse(userData) : userData;
            localStorage.setItem('token', token);
            localStorage.setItem('user', typeof userData === 'string' ? userData : JSON.stringify(userData));
            showApp();
            loadServers();
        } catch (error) {
            console.error('Erreur parsing user data:', error);
            showLogin();
        }
    } else {
        showLogin();
    }
}

function showLogin() {
    document.getElementById('loginScreen').classList.add('active');
    document.getElementById('appScreen').classList.remove('active');
    deleteCookie('slayzcord_token');
    deleteCookie('slayzcord_user');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
}

function showApp() {
    document.getElementById('loginScreen').classList.remove('active');
    document.getElementById('appScreen').classList.add('active');
    updateUserInfo();
    setupAppListeners();
    loadFriends();
    setupFriendsListeners();
}

function updateUserInfo() {
    if (currentUser) {
        const initials = currentUser.username.substring(0, 2).toUpperCase();
        document.getElementById('userAvatarText').textContent = initials;
        document.getElementById('userUsername').textContent = currentUser.username;
    }
}

function setupAuthListeners() {
    const loginTab = document.querySelector('[data-tab="login"]');
    const registerTab = document.querySelector('[data-tab="register"]');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const loginFormElement = document.getElementById('loginFormElement');
    const registerFormElement = document.getElementById('registerFormElement');
    const loginError = document.getElementById('loginError');
    const registerError = document.getElementById('registerError');

    loginTab.addEventListener('click', () => {
        loginTab.classList.add('active');
        registerTab.classList.remove('active');
        loginForm.classList.add('active');
        registerForm.classList.remove('active');
        loginError.classList.remove('show');
        registerError.classList.remove('show');
    });

    registerTab.addEventListener('click', () => {
        registerTab.classList.add('active');
        loginTab.classList.remove('active');
        registerForm.classList.add('active');
        loginForm.classList.remove('active');
        loginError.classList.remove('show');
        registerError.classList.remove('show');
    });

    loginFormElement.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginError.classList.remove('show');

        const username = document.getElementById('loginUsername').value;
        const password = document.getElementById('loginPassword').value;

        try {
            const response = await fetch(`${API_URL}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok) {
                const rememberMe = document.getElementById('rememberMe')?.checked || false;
                
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
                
                if (rememberMe) {
                    setCookie('slayzcord_token', data.token, 30);
                    setCookie('slayzcord_user', JSON.stringify(data.user), 30);
                } else {
                    setCookie('slayzcord_token', data.token, 1);
                    setCookie('slayzcord_user', JSON.stringify(data.user), 1);
                }
                
                currentUser = data.user;
                showApp();
                loadServers();
            } else {
                loginError.textContent = data.error || 'Erreur de connexion';
                loginError.classList.add('show');
            }
        } catch (error) {
            loginError.textContent = 'Erreur de connexion au serveur';
            loginError.classList.add('show');
        }
    });

    registerFormElement.addEventListener('submit', async (e) => {
        e.preventDefault();
        registerError.classList.remove('show');

        const username = document.getElementById('registerUsername').value;
        const password = document.getElementById('registerPassword').value;

        if (password.length < 6) {
            registerError.textContent = 'Le mot de passe doit contenir au moins 6 caractères';
            registerError.classList.add('show');
            return;
        }

        try {
            const response = await fetch(`${API_URL}/api/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok) {
                const rememberMe = document.getElementById('rememberMeRegister')?.checked || false;
                
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
                
                if (rememberMe) {
                    setCookie('slayzcord_token', data.token, 30);
                    setCookie('slayzcord_user', JSON.stringify(data.user), 30);
                } else {
                    setCookie('slayzcord_token', data.token, 1);
                    setCookie('slayzcord_user', JSON.stringify(data.user), 1);
                }
                
                currentUser = data.user;
                showApp();
                loadServers();
            } else {
                registerError.textContent = data.error || 'Erreur d\'inscription';
                registerError.classList.add('show');
            }
        } catch (error) {
            registerError.textContent = 'Erreur de connexion au serveur';
            registerError.classList.add('show');
        }
    });
}

function setupAppListeners() {
    document.getElementById('homeServer').addEventListener('click', () => {
        leaveVoice();
        currentServer = null;
        currentChannel = null;
        document.getElementById('serverName').textContent = 'SlayzCord';
        document.getElementById('channelsList').innerHTML = '';
        document.getElementById('membersList').innerHTML = '';
        document.getElementById('friendsSection').style.display = 'flex';
        document.getElementById('inviteServerBtn').style.display = 'none';
        document.getElementById('messagesContainer').innerHTML = '<div class="welcome-message"><h2>Bienvenue sur SlayzCord</h2><p>Sélectionnez un serveur ou un ami pour commencer</p></div>';
        document.getElementById('messageInputContainer').style.display = 'none';
        document.getElementById('voiceControls').style.display = 'none';
        document.getElementById('screenShareContainer').style.display = 'none';
        document.getElementById('channelName').textContent = 'SlayzCord';
        loadFriends();
    });

    document.getElementById('addServerBtn').addEventListener('click', () => {
        document.getElementById('createServerModal').style.display = 'flex';
    });

    document.getElementById('joinServerBtn').addEventListener('click', () => {
        document.getElementById('joinServerModal').style.display = 'flex';
    });

    document.getElementById('createServerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const serverName = document.getElementById('serverNameInput').value;

        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_URL}/api/servers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ name: serverName })
            });

            if (response.ok) {
                const newServer = await response.json();
                servers.push(newServer);
                renderServers();
                document.getElementById('createServerModal').style.display = 'none';
                document.getElementById('serverNameInput').value = '';
                selectServer(newServer);
            } else {
                alert('Erreur lors de la création du serveur');
            }
        } catch (error) {
            console.error('Erreur création serveur:', error);
            alert('Erreur lors de la création du serveur');
        }
    });

    document.getElementById('createChannelForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentServer) return;

        const channelName = document.getElementById('channelNameInput').value;
        const channelType = document.getElementById('channelTypeInput').value;

        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_URL}/api/servers/${currentServer.id}/channels`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ name: channelName, type: channelType })
            });

            if (response.ok) {
                const newChannel = await response.json();
                channels.push(newChannel);
                renderChannels();
                document.getElementById('createChannelModal').style.display = 'none';
                document.getElementById('channelNameInput').value = '';
                selectChannel(newChannel);
            } else {
                const data = await response.json();
                alert(data.error || 'Erreur lors de la création du canal');
            }
        } catch (error) {
            console.error('Erreur création canal:', error);
            alert('Erreur lors de la création du canal');
        }
    });

    document.getElementById('messageForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentChannel) return;

        const messageInput = document.getElementById('messageInput');
        const message = messageInput.value.trim();

        if (!message) return;

        if (socket) {
            const token = localStorage.getItem('token');
            socket.emit('sendMessage', {
                channelId: currentChannel.id,
                message: message,
                token: token
            });
            messageInput.value = '';
        }
    });

    document.getElementById('joinServerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const inviteLink = document.getElementById('serverIdInput').value.trim();
        const inviteCode = inviteLink.split('/').pop();

        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_URL}/api/invite/${inviteCode}/accept`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                const server = await response.json();
                if (!servers.find(s => s.id === server.id)) {
                    servers.push(server);
                    renderServers();
                }
                document.getElementById('joinServerModal').style.display = 'none';
                document.getElementById('serverIdInput').value = '';
                selectServer(server);
            } else {
                const data = await response.json();
                alert(data.error || 'Erreur lors de la jointure du serveur');
            }
        } catch (error) {
            console.error('Erreur jointure serveur:', error);
            alert('Erreur lors de la jointure du serveur');
        }
    });

    document.getElementById('muteBtn').addEventListener('click', toggleMute);
    document.getElementById('disconnectBtn').addEventListener('click', leaveVoice);
    document.getElementById('screenShareBtn').addEventListener('click', toggleScreenShare);

    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.target.closest('.modal').style.display = 'none';
        });
    });

    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    });
}

async function loadServers() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/api/servers`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            servers = await response.json();
            renderServers();
        } else if (response.status === 401) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            showLogin();
        }
    } catch (error) {
        console.error('Erreur chargement serveurs:', error);
    }
}

function renderServers() {
    const serversList = document.getElementById('serversList');
    serversList.innerHTML = '';

    servers.forEach(server => {
        const serverIcon = document.createElement('div');
        serverIcon.className = 'server-icon';
        serverIcon.dataset.serverId = server.id;
        serverIcon.title = server.name;
        
        const initials = server.name.substring(0, 2).toUpperCase();
        serverIcon.textContent = initials;
        
        serverIcon.addEventListener('click', () => selectServer(server));
        serversList.appendChild(serverIcon);
    });
}

async function selectServer(server) {
    leaveVoice();
    currentServer = server;
    currentChannel = null;

    document.querySelectorAll('.server-icon').forEach(icon => {
        icon.classList.remove('active');
    });
    document.querySelector(`[data-server-id="${server.id}"]`)?.classList.add('active');

    document.getElementById('serverName').textContent = server.name;
    const friendsSection = document.getElementById('friendsSection');
    if (friendsSection) {
        friendsSection.style.display = 'none';
    }
    document.getElementById('inviteServerBtn').style.display = 'block';
    await loadChannels();
    await loadMembers();
    
    document.getElementById('messagesContainer').innerHTML = '<div class="welcome-message"><h2>Bienvenue sur ' + server.name + '</h2><p>Sélectionnez un canal pour commencer à discuter</p></div>';
    document.getElementById('messageInputContainer').style.display = 'none';
    document.getElementById('voiceControls').style.display = 'none';
    document.getElementById('screenShareContainer').style.display = 'none';
    document.getElementById('channelName').textContent = 'Sélectionnez un canal';
}

async function loadChannels() {
    if (!currentServer) return;

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/api/servers/${currentServer.id}/channels`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            channels = await response.json();
            renderChannels();
        }
    } catch (error) {
        console.error('Erreur chargement canaux:', error);
    }
}

function renderChannels() {
    const channelsList = document.getElementById('channelsList');
    channelsList.innerHTML = '';

    const textCategory = document.createElement('div');
    textCategory.className = 'channel-category';
    textCategory.textContent = 'Canaux textuels';
    channelsList.appendChild(textCategory);

    const textChannels = channels.filter(c => c.type === 'text');
    textChannels.forEach(channel => {
        const channelItem = document.createElement('div');
        channelItem.className = 'channel-item';
        channelItem.dataset.channelId = channel.id;
        channelItem.textContent = channel.name;
        channelItem.addEventListener('click', () => selectChannel(channel));
        channelsList.appendChild(channelItem);
    });

    const voiceCategory = document.createElement('div');
    voiceCategory.className = 'channel-category';
    voiceCategory.textContent = 'Canaux vocaux';
    channelsList.appendChild(voiceCategory);

    const voiceChannels = channels.filter(c => c.type === 'voice');
    voiceChannels.forEach(channel => {
        const channelItem = document.createElement('div');
        channelItem.className = 'channel-item voice-channel';
        channelItem.dataset.channelId = channel.id;
        channelItem.textContent = channel.name;
        channelItem.addEventListener('click', () => joinVoiceChannel(channel));
        channelsList.appendChild(channelItem);
    });

    if (currentServer && currentServer.ownerId === currentUser.id) {
        const addChannelBtn = document.createElement('button');
        addChannelBtn.className = 'add-channel-btn';
        addChannelBtn.textContent = '+ Créer un canal';
        addChannelBtn.addEventListener('click', () => {
            document.getElementById('createChannelModal').style.display = 'flex';
        });
        channelsList.appendChild(addChannelBtn);
    }
}

async function selectChannel(channel) {
    if (channel.type === 'voice') {
        joinVoiceChannel(channel);
        return;
    }

    leaveVoice();
    currentChannel = channel;

    document.querySelectorAll('.channel-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`[data-channel-id="${channel.id}"]`)?.classList.add('active');

    document.getElementById('channelName').textContent = '#' + channel.name;
    document.getElementById('messageInputContainer').style.display = 'block';
    document.getElementById('voiceControls').style.display = 'none';
    document.getElementById('screenShareContainer').style.display = 'none';

    if (socket) {
        socket.emit('joinChannel', channel.id);
    }

    await loadMessages();
}

async function joinVoiceChannel(channel) {
    leaveVoice();
    currentChannel = channel;
    isInVoice = true;

    document.querySelectorAll('.channel-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`[data-channel-id="${channel.id}"]`)?.classList.add('active');

    document.getElementById('channelName').textContent = '🔊 ' + channel.name;
    document.getElementById('messageInputContainer').style.display = 'none';
    document.getElementById('voiceControls').style.display = 'block';
    document.getElementById('voiceChannelName').textContent = channel.name;
    
    const screenShareContainer = document.getElementById('screenShareContainer');
    screenShareContainer.style.display = 'block';
    screenShareContainer.innerHTML = '<video id="screenShareVideo" autoplay playsinline></video>';

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        
        if (socket) {
            socket.emit('joinVoice', {
                channelId: channel.id,
                userId: currentUser.id,
                username: currentUser.username
            });
        }

        peerConnections.forEach((pc, socketId) => {
            if (localStream) {
                localStream.getTracks().forEach(track => {
                    const sender = pc.getSenders().find(s => s.track && s.track.kind === track.kind);
                    if (!sender) {
                        pc.addTrack(track, localStream);
                    }
                });
            }
        });
    } catch (error) {
        console.error('Erreur accès microphone:', error);
        alert('Impossible d\'accéder au microphone');
        leaveVoice();
    }
}

function toggleMute() {
    isMuted = !isMuted;
    const muteBtn = document.getElementById('muteBtn');
    const muteIcon = document.getElementById('muteIcon');

    if (localStream) {
        localStream.getAudioTracks().forEach(track => {
            track.enabled = !isMuted;
        });
    }

    if (isMuted) {
        muteBtn.classList.add('muted');
        muteIcon.textContent = '🔇';
    } else {
        muteBtn.classList.remove('muted');
        muteIcon.textContent = '🎤';
    }
}

async function toggleScreenShare() {
    const screenBtn = document.getElementById('screenShareBtn');
    const screenVideo = document.getElementById('screenShareVideo');

    if (!isSharingScreen) {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            screenVideo.srcObject = screenStream;

            screenStream.getVideoTracks()[0].onended = () => {
                stopScreenShare();
            };

            peerConnections.forEach((pc) => {
                screenStream.getTracks().forEach(track => {
                    pc.addTrack(track, screenStream);
                });
            });

            if (socket && currentChannel) {
                socket.emit('startScreenShare', { channelId: currentChannel.id });
            }

            isSharingScreen = true;
            screenBtn.classList.add('active');
        } catch (error) {
            console.error('Erreur partage d\'écran:', error);
        }
    } else {
        stopScreenShare();
    }
}

function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }

    const screenVideo = document.getElementById('screenShareVideo');
    screenVideo.srcObject = null;

    if (socket && currentChannel) {
        socket.emit('stopScreenShare', { channelId: currentChannel.id });
    }

    isSharingScreen = false;
    document.getElementById('screenShareBtn').classList.remove('active');
}

function leaveVoice() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    stopScreenShare();

    peerConnections.forEach((pc) => {
        pc.close();
    });
    peerConnections.clear();

    if (socket && currentChannel && isInVoice) {
        socket.emit('leaveVoice');
    }

    isInVoice = false;
    isMuted = false;
    document.getElementById('voiceControls').style.display = 'none';
    const screenShareContainer = document.getElementById('screenShareContainer');
    if (screenShareContainer) {
        screenShareContainer.style.display = 'none';
        screenShareContainer.innerHTML = '<video id="screenShareVideo" autoplay playsinline></video>';
    }
    document.getElementById('muteBtn').classList.remove('muted');
    document.getElementById('muteIcon').textContent = '🎤';
}

async function loadMessages() {
    if (!currentChannel || currentChannel.type === 'voice') return;

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/api/channels/${currentChannel.id}/messages`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            const messages = await response.json();
            renderMessages(messages);
        }
    } catch (error) {
        console.error('Erreur chargement messages:', error);
    }
}

function renderMessages(messages) {
    const messagesContainer = document.getElementById('messagesContainer');
    messagesContainer.innerHTML = '';

    if (messages.length === 0) {
        messagesContainer.innerHTML = '<div class="welcome-message"><p>Aucun message pour le moment. Soyez le premier à écrire !</p></div>';
        return;
    }

    messages.forEach(message => {
        const messageDiv = createMessageElement(message);
        messagesContainer.appendChild(messageDiv);
    });

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function addMessageToUI(message) {
    const messagesContainer = document.getElementById('messagesContainer');
    const welcomeMessage = messagesContainer.querySelector('.welcome-message');
    if (welcomeMessage) {
        welcomeMessage.remove();
    }

    const messageDiv = createMessageElement(message);
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function createMessageElement(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    const initials = message.username.substring(0, 2).toUpperCase();
    avatar.textContent = initials;

    const content = document.createElement('div');
    content.className = 'message-content';

    const header = document.createElement('div');
    header.className = 'message-header';

    const username = document.createElement('span');
    username.className = 'message-username';
    username.textContent = message.username;

    const time = document.createElement('span');
    time.className = 'message-time';
    const date = new Date(message.createdAt);
    time.textContent = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    header.appendChild(username);
    header.appendChild(time);

    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = message.content;

    content.appendChild(header);
    content.appendChild(text);

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);

    return messageDiv;
}

async function loadMembers() {
    if (!currentServer) return;

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/api/servers/${currentServer.id}/members`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            const members = await response.json();
            renderMembers(members);
        }
    } catch (error) {
        console.error('Erreur chargement membres:', error);
    }
}

function renderMembers(members) {
    const membersList = document.getElementById('membersList');
    membersList.innerHTML = '';

    members.forEach(member => {
        const memberItem = document.createElement('div');
        memberItem.className = 'member-item';

        const avatar = document.createElement('div');
        avatar.className = 'member-avatar';
        const initials = member.username.substring(0, 2).toUpperCase();
        avatar.textContent = initials;

        const username = document.createElement('span');
        username.className = 'member-username';
        if (member.isOwner) {
            username.classList.add('member-owner');
            username.textContent = member.username + ' (Propriétaire)';
        } else {
            username.textContent = member.username;
        }

        memberItem.appendChild(avatar);
        memberItem.appendChild(username);
        membersList.appendChild(memberItem);
    });
}

function setupFriendsListeners() {
    const addPmBtn = document.getElementById('addPmBtn');
    if (addPmBtn) {
        addPmBtn.onclick = () => {
            document.getElementById('addFriendModal').style.display = 'flex';
        };
    }

    document.querySelectorAll('.friends-nav-item').forEach(item => {
        item.onclick = () => {
            document.querySelectorAll('.friends-nav-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            const tab = item.dataset.tab;
            const friendsTab = document.getElementById('friendsTabContent');
            const requestsTab = document.getElementById('requestsTabContent');
            
            if (tab === 'friends') {
                if (friendsTab) {
                    friendsTab.classList.add('active');
                    friendsTab.style.display = 'flex';
                }
                if (requestsTab) {
                    requestsTab.classList.remove('active');
                    requestsTab.style.display = 'none';
                }
            } else if (tab === 'requests') {
                if (requestsTab) {
                    requestsTab.classList.add('active');
                    requestsTab.style.display = 'flex';
                }
                if (friendsTab) {
                    friendsTab.classList.remove('active');
                    friendsTab.style.display = 'none';
                }
                loadFriends();
            } else {
                if (friendsTab) friendsTab.style.display = 'none';
                if (requestsTab) requestsTab.style.display = 'none';
            }
        };
    });

    const addFriendForm = document.getElementById('addFriendForm');
    if (addFriendForm) {
        addFriendForm.onsubmit = async (e) => {
            e.preventDefault();
            const username = document.getElementById('friendUsernameInput').value.trim();

            if (!username) {
                alert('Veuillez entrer un nom d\'utilisateur');
                return;
            }

            try {
                const token = localStorage.getItem('token');
                const response = await fetch(`${API_URL}/api/friends/request`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ username })
                });

                const data = await response.json();

                if (response.ok) {
                    document.getElementById('addFriendModal').style.display = 'none';
                    document.getElementById('friendUsernameInput').value = '';
                    loadFriends();
                    alert('Demande d\'ami envoyée !');
                } else {
                    alert(data.error || 'Erreur lors de l\'envoi de la demande');
                }
            } catch (error) {
                console.error('Erreur envoi demande:', error);
                alert('Erreur lors de l\'envoi de la demande');
            }
        };
    }

    const inviteServerBtn = document.getElementById('inviteServerBtn');
    if (inviteServerBtn) {
        inviteServerBtn.onclick = async () => {
            if (!currentServer) return;

            try {
                const token = localStorage.getItem('token');
                const response = await fetch(`${API_URL}/api/servers/${currentServer.id}/invite`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (response.ok) {
                    const data = await response.json();
                    document.getElementById('inviteLinkInput').value = data.inviteLink;
                    document.getElementById('inviteServerModal').style.display = 'flex';
                } else {
                    alert('Erreur lors de la création du lien d\'invitation');
                }
            } catch (error) {
                console.error('Erreur création invitation:', error);
                alert('Erreur lors de la création du lien d\'invitation');
            }
        };
    }

    const copyInviteBtn = document.getElementById('copyInviteBtn');
    if (copyInviteBtn) {
        copyInviteBtn.onclick = () => {
            const input = document.getElementById('inviteLinkInput');
            input.select();
            document.execCommand('copy');
            alert('Lien copié !');
        };
    }

    const closeAddFriendModal = document.getElementById('closeAddFriendModal');
    if (closeAddFriendModal) {
        closeAddFriendModal.onclick = () => {
            document.getElementById('addFriendModal').style.display = 'none';
        };
    }

    const closeInviteModal = document.getElementById('closeInviteModal');
    if (closeInviteModal) {
        closeInviteModal.onclick = () => {
            document.getElementById('inviteServerModal').style.display = 'none';
        };
    }

    if (socket && currentUser) {
        socket.on('newFriendRequest', (data) => {
            if (currentUser && data.toId === currentUser.id) {
                loadFriends();
            }
        });

        socket.on('friendRequestAccepted', (data) => {
            if (currentUser) {
                loadFriends();
            }
        });
    }
}

async function loadFriends() {
    if (!currentUser) return;
    
    try {
        const token = localStorage.getItem('token');
        if (!token) return;
        
        const response = await fetch(`${API_URL}/api/friends`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            const data = await response.json();
            renderFriends(data.friends || []);
            renderFriendRequests(data.receivedRequests || [], data.sentRequests || []);
            
            const friendsBadge = document.getElementById('friendsBadge');
            if (friendsBadge) {
                if (data.friends && data.friends.length > 0) {
                    friendsBadge.style.display = 'none';
                }
            }
        } else if (response.status === 401) {
            showLogin();
        }
    } catch (error) {
        console.error('Erreur chargement amis:', error);
    }
}

function renderFriends(friends) {
    const friendsList = document.getElementById('friendsList');
    if (!friendsList) return;
    friendsList.innerHTML = '';

    if (friends.length === 0) {
        friendsList.innerHTML = '<div style="padding: 16px; text-align: center; color: #8e9297;">Aucun ami. Cliquez sur + pour ajouter un ami.</div>';
        return;
    }

    friends.forEach(friend => {
        const friendItem = document.createElement('div');
        friendItem.className = 'friend-item';

        const avatar = document.createElement('div');
        avatar.className = 'friend-avatar';
        const initials = friend.username.substring(0, 2).toUpperCase();
        avatar.textContent = initials;

        const username = document.createElement('span');
        username.className = 'friend-username';
        username.textContent = friend.username;

        const status = document.createElement('div');
        status.className = 'friend-status';

        friendItem.appendChild(avatar);
        friendItem.appendChild(username);
        friendItem.appendChild(status);
        friendsList.appendChild(friendItem);
    });
}

function renderFriendRequests(receivedRequests, sentRequests) {
    const requestsList = document.getElementById('friendRequestsList');
    if (!requestsList) return;
    requestsList.innerHTML = '';

    const requestsBadge = document.getElementById('requestsBadge');
    if (requestsBadge) {
        const total = receivedRequests.length;
        if (total > 0) {
            requestsBadge.textContent = total;
            requestsBadge.style.display = 'block';
        } else {
            requestsBadge.style.display = 'none';
        }
    }

    if (receivedRequests.length === 0 && sentRequests.length === 0) {
        requestsList.innerHTML = '<div style="padding: 16px; text-align: center; color: #8e9297;">Aucune demande de message</div>';
        return;
    }

    if (receivedRequests.length > 0) {
        const title = document.createElement('div');
        title.style.padding = '8px';
        title.style.fontSize = '12px';
        title.style.fontWeight = '600';
        title.style.color = '#8e9297';
        title.style.textTransform = 'uppercase';
        title.textContent = 'Reçues';
        requestsList.appendChild(title);

        receivedRequests.forEach(request => {
            const requestItem = document.createElement('div');
            requestItem.className = 'friend-request-item';

            const info = document.createElement('div');
            info.className = 'friend-request-info';

            const avatar = document.createElement('div');
            avatar.className = 'friend-avatar';
            const initials = request.username.substring(0, 2).toUpperCase();
            avatar.textContent = initials;

            const username = document.createElement('span');
            username.className = 'friend-username';
            username.textContent = request.username;

            info.appendChild(avatar);
            info.appendChild(username);

            const actions = document.createElement('div');
            actions.className = 'friend-request-actions';

            const acceptBtn = document.createElement('button');
            acceptBtn.className = 'friend-request-btn accept-btn';
            acceptBtn.textContent = '✓';
            acceptBtn.title = 'Accepter';
            acceptBtn.addEventListener('click', () => acceptFriendRequest(request.requestId));

            const declineBtn = document.createElement('button');
            declineBtn.className = 'friend-request-btn decline-btn';
            declineBtn.textContent = '✕';
            declineBtn.title = 'Refuser';
            declineBtn.addEventListener('click', () => declineFriendRequest(request.requestId));

            actions.appendChild(acceptBtn);
            actions.appendChild(declineBtn);

            requestItem.appendChild(info);
            requestItem.appendChild(actions);
            requestsList.appendChild(requestItem);
        });
    }

    if (sentRequests.length > 0) {
        const title = document.createElement('div');
        title.style.padding = '8px';
        title.style.fontSize = '12px';
        title.style.fontWeight = '600';
        title.style.color = '#8e9297';
        title.style.textTransform = 'uppercase';
        title.textContent = 'Envoyées';
        requestsList.appendChild(title);

        sentRequests.forEach(request => {
            const requestItem = document.createElement('div');
            requestItem.className = 'friend-request-item';

            const info = document.createElement('div');
            info.className = 'friend-request-info';

            const avatar = document.createElement('div');
            avatar.className = 'friend-avatar';
            const initials = request.username.substring(0, 2).toUpperCase();
            avatar.textContent = initials;

            const username = document.createElement('span');
            username.className = 'friend-username';
            username.textContent = request.username + ' (en attente)';

            info.appendChild(avatar);
            info.appendChild(username);

            requestItem.appendChild(info);
            requestsList.appendChild(requestItem);
        });
    }
}

async function acceptFriendRequest(requestId) {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/api/friends/accept`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ requestId })
        });

        if (response.ok) {
            loadFriends();
        } else {
            const data = await response.json();
            alert(data.error || 'Erreur');
        }
    } catch (error) {
        console.error('Erreur acceptation:', error);
        alert('Erreur');
    }
}

async function declineFriendRequest(requestId) {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/api/friends/decline`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ requestId })
        });

        if (response.ok) {
            loadFriends();
        } else {
            const data = await response.json();
            alert(data.error || 'Erreur');
        }
    } catch (error) {
        console.error('Erreur refus:', error);
        alert('Erreur');
    }
}

async function handleInviteLink(inviteCode) {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/api/invite/${inviteCode}/accept`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            const server = await response.json();
            if (!servers.find(s => s.id === server.id)) {
                servers.push(server);
                renderServers();
            }
            selectServer(server);
            window.history.replaceState({}, document.title, window.location.pathname);
        } else {
            const data = await response.json();
            alert(data.error || 'Lien d\'invitation invalide');
        }
    } catch (error) {
        console.error('Erreur acceptation invitation:', error);
    }
}
