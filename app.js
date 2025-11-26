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

function checkAuth() {
    const token = localStorage.getItem('token');
    const userData = localStorage.getItem('user');

    if (token && userData) {
        currentUser = JSON.parse(userData);
        showApp();
        loadServers();
    } else {
        showLogin();
    }
}

function showLogin() {
    document.getElementById('loginScreen').classList.add('active');
    document.getElementById('appScreen').classList.remove('active');
}

function showApp() {
    document.getElementById('loginScreen').classList.remove('active');
    document.getElementById('appScreen').classList.add('active');
    updateUserInfo();
    setupAppListeners();
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
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
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
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
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
        document.getElementById('messagesContainer').innerHTML = '<div class="welcome-message"><h2>Bienvenue sur SlayzCord</h2><p>Sélectionnez un serveur pour commencer</p></div>';
        document.getElementById('messageInputContainer').style.display = 'none';
        document.getElementById('voiceControls').style.display = 'none';
        document.getElementById('screenShareContainer').style.display = 'none';
        document.getElementById('channelName').textContent = 'Sélectionnez un canal';
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
        const serverId = document.getElementById('serverIdInput').value.trim();

        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_URL}/api/servers/${serverId}/join`, {
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
    document.getElementById('screenShareContainer').style.display = 'block';

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
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });
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

    if (socket && currentChannel) {
        socket.emit('leaveVoice');
    }

    isInVoice = false;
    isMuted = false;
    document.getElementById('voiceControls').style.display = 'none';
    document.getElementById('screenShareContainer').style.display = 'none';
    document.getElementById('muteBtn').classList.remove('muted');
    document.getElementById('muteIcon').textContent = '🎤';

    const screenShareContainer = document.getElementById('screenShareContainer');
    screenShareContainer.innerHTML = '<video id="screenShareVideo" autoplay playsinline></video>';
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
