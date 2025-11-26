const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcrypt');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const readData = async (filename) => {
  try {
    const filePath = path.join(DATA_DIR, filename);
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
};

const writeData = async (filename, data) => {
  try {
    const filePath = path.join(DATA_DIR, filename);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`Erreur écriture ${filename}:`, error);
    return false;
  }
};

const generateId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

const findUserByToken = async (token) => {
  const users = await readData('users.json');
  return users.find(u => u.token === token);
};

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis' });
    }

    const users = await readData('users.json');
    
    if (users.find(u => u.username === username)) {
      return res.status(400).json({ error: 'Nom d\'utilisateur déjà utilisé' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const token = generateId();
    
    const newUser = {
      id: generateId(),
      username,
      password: hashedPassword,
      token,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    await writeData('users.json', users);

    res.json({ 
      success: true, 
      token,
      user: {
        id: newUser.id,
        username: newUser.username
      }
    });
  } catch (error) {
    console.error('Erreur inscription:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis' });
    }

    const users = await readData('users.json');
    const user = users.find(u => u.username === username);
    
    if (!user) {
      return res.status(401).json({ error: 'Nom d\'utilisateur ou mot de passe incorrect' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Nom d\'utilisateur ou mot de passe incorrect' });
    }

    const token = generateId();
    user.token = token;
    await writeData('users.json', users);

    res.json({ 
      success: true, 
      token,
      user: {
        id: user.id,
        username: user.username
      }
    });
  } catch (error) {
    console.error('Erreur connexion:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/user', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Token manquant' });
    }

    const user = await findUserByToken(token);
    
    if (!user) {
      return res.status(401).json({ error: 'Token invalide' });
    }

    res.json({
      id: user.id,
      username: user.username
    });
  } catch (error) {
    console.error('Erreur récupération utilisateur:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/servers', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Token manquant' });
    }

    const user = await findUserByToken(token);
    
    if (!user) {
      return res.status(401).json({ error: 'Token invalide' });
    }

    const servers = await readData('servers.json');
    const userServers = servers.filter(s => 
      s.members.includes(user.id) || s.ownerId === user.id
    );

    res.json(userServers);
  } catch (error) {
    console.error('Erreur récupération serveurs:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/servers', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Token manquant' });
    }

    const user = await findUserByToken(token);
    
    if (!user) {
      return res.status(401).json({ error: 'Token invalide' });
    }

    const { name } = req.body;
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Nom du serveur requis' });
    }

    const servers = await readData('servers.json');
    const channels = await readData('channels.json');
    
    const serverId = generateId();
    const newServer = {
      id: serverId,
      name: name.trim(),
      ownerId: user.id,
      members: [user.id],
      createdAt: new Date().toISOString()
    };

    servers.push(newServer);
    await writeData('servers.json', servers);

    const generalChannel = {
      id: generateId(),
      serverId: serverId,
      name: 'général',
      type: 'text',
      createdAt: new Date().toISOString()
    };

    channels.push(generalChannel);
    await writeData('channels.json', channels);

    res.json(newServer);
  } catch (error) {
    console.error('Erreur création serveur:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/servers/:id/join', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Token manquant' });
    }

    const user = await findUserByToken(token);
    
    if (!user) {
      return res.status(401).json({ error: 'Token invalide' });
    }

    const { id } = req.params;
    const servers = await readData('servers.json');
    const server = servers.find(s => s.id === id);
    
    if (!server) {
      return res.status(404).json({ error: 'Serveur introuvable' });
    }

    if (server.members.includes(user.id)) {
      return res.json(server);
    }

    server.members.push(user.id);
    await writeData('servers.json', servers);

    res.json(server);
  } catch (error) {
    console.error('Erreur rejoindre serveur:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/servers/:id/channels', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Token manquant' });
    }

    const user = await findUserByToken(token);
    
    if (!user) {
      return res.status(401).json({ error: 'Token invalide' });
    }

    const { id } = req.params;
    const servers = await readData('servers.json');
    const server = servers.find(s => s.id === id);
    
    if (!server) {
      return res.status(404).json({ error: 'Serveur introuvable' });
    }

    if (!server.members.includes(user.id) && server.ownerId !== user.id) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const channels = await readData('channels.json');
    const serverChannels = channels.filter(c => c.serverId === id);

    res.json(serverChannels);
  } catch (error) {
    console.error('Erreur récupération canaux:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/servers/:id/channels', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Token manquant' });
    }

    const user = await findUserByToken(token);
    
    if (!user) {
      return res.status(401).json({ error: 'Token invalide' });
    }

    const { id } = req.params;
    const { name, type } = req.body;
    
    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Nom du canal requis' });
    }

    const servers = await readData('servers.json');
    const server = servers.find(s => s.id === id);
    
    if (!server) {
      return res.status(404).json({ error: 'Serveur introuvable' });
    }

    if (server.ownerId !== user.id) {
      return res.status(403).json({ error: 'Seul le propriétaire peut créer des canaux' });
    }

    const channels = await readData('channels.json');
    
    const newChannel = {
      id: generateId(),
      serverId: id,
      name: name.trim().toLowerCase(),
      type: type || 'text',
      createdAt: new Date().toISOString()
    };

    channels.push(newChannel);
    await writeData('channels.json', channels);

    res.json(newChannel);
  } catch (error) {
    console.error('Erreur création canal:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/channels/:id/messages', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Token manquant' });
    }

    const user = await findUserByToken(token);
    
    if (!user) {
      return res.status(401).json({ error: 'Token invalide' });
    }

    const { id } = req.params;
    const channels = await readData('channels.json');
    const channel = channels.find(c => c.id === id);
    
    if (!channel) {
      return res.status(404).json({ error: 'Canal introuvable' });
    }

    const servers = await readData('servers.json');
    const server = servers.find(s => s.id === channel.serverId);
    
    if (!server || (!server.members.includes(user.id) && server.ownerId !== user.id)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const messages = await readData('messages.json');
    const channelMessages = messages.filter(m => m.channelId === id);

    const users = await readData('users.json');
    const messagesWithUsers = channelMessages.map(msg => {
      const msgUser = users.find(u => u.id === msg.userId);
      return {
        ...msg,
        username: msgUser ? msgUser.username : 'Utilisateur inconnu'
      };
    });

    res.json(messagesWithUsers);
  } catch (error) {
    console.error('Erreur récupération messages:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/channels/:id/messages', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Token manquant' });
    }

    const user = await findUserByToken(token);
    
    if (!user) {
      return res.status(401).json({ error: 'Token invalide' });
    }

    const { id } = req.params;
    const { message } = req.body;
    
    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message requis' });
    }

    const channels = await readData('channels.json');
    const channel = channels.find(c => c.id === id);
    
    if (!channel) {
      return res.status(404).json({ error: 'Canal introuvable' });
    }

    const servers = await readData('servers.json');
    const server = servers.find(s => s.id === channel.serverId);
    
    if (!server || (!server.members.includes(user.id) && server.ownerId !== user.id)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const messages = await readData('messages.json');
    
    const newMessage = {
      id: generateId(),
      channelId: id,
      userId: user.id,
      username: user.username,
      content: message.trim(),
      createdAt: new Date().toISOString()
    };

    messages.push(newMessage);
    await writeData('messages.json', messages);

    io.emit('newMessage', newMessage);

    res.json(newMessage);
  } catch (error) {
    console.error('Erreur envoi message:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/servers/:id/members', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Token manquant' });
    }

    const user = await findUserByToken(token);
    
    if (!user) {
      return res.status(401).json({ error: 'Token invalide' });
    }

    const { id } = req.params;
    const servers = await readData('servers.json');
    const server = servers.find(s => s.id === id);
    
    if (!server) {
      return res.status(404).json({ error: 'Serveur introuvable' });
    }

    if (!server.members.includes(user.id) && server.ownerId !== user.id) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    const users = await readData('users.json');
    const members = users.filter(u => 
      server.members.includes(u.id) || u.id === server.ownerId
    ).map(u => ({
      id: u.id,
      username: u.username,
      isOwner: u.id === server.ownerId
    }));

    res.json(members);
  } catch (error) {
    console.error('Erreur récupération membres:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

const activeCalls = new Map();

io.on('connection', (socket) => {
  console.log('Utilisateur connecté:', socket.id);

  socket.on('joinChannel', async (channelId) => {
    socket.join(`channel:${channelId}`);
    console.log(`Utilisateur ${socket.id} a rejoint le canal ${channelId}`);
  });

  socket.on('joinVoice', async (data) => {
    const { channelId, userId, username } = data;
    socket.join(`voice:${channelId}`);
    socket.voiceChannel = channelId;
    socket.userId = userId;
    socket.username = username;

    if (!activeCalls.has(channelId)) {
      activeCalls.set(channelId, new Set());
    }
    activeCalls.get(channelId).add(socket.id);

    io.to(`voice:${channelId}`).emit('userJoinedVoice', {
      userId,
      username,
      socketId: socket.id
    });

    const usersInCall = Array.from(activeCalls.get(channelId)).map(sid => {
      const s = io.sockets.sockets.get(sid);
      return s ? { userId: s.userId, username: s.username, socketId: sid } : null;
    }).filter(Boolean);

    socket.emit('usersInCall', usersInCall);
  });

  socket.on('leaveVoice', () => {
    if (socket.voiceChannel) {
      const channelId = socket.voiceChannel;
      socket.leave(`voice:${channelId}`);
      
      if (activeCalls.has(channelId)) {
        activeCalls.get(channelId).delete(socket.id);
        if (activeCalls.get(channelId).size === 0) {
          activeCalls.delete(channelId);
        }
      }

      io.to(`voice:${channelId}`).emit('userLeftVoice', {
        userId: socket.userId,
        username: socket.username,
        socketId: socket.id
      });
    }
  });

  socket.on('offer', (data) => {
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id,
      userId: socket.userId,
      username: socket.username
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  socket.on('startScreenShare', (data) => {
    socket.to(`voice:${data.channelId}`).emit('userStartedScreenShare', {
      userId: socket.userId,
      username: socket.username,
      socketId: socket.id
    });
  });

  socket.on('stopScreenShare', (data) => {
    socket.to(`voice:${data.channelId}`).emit('userStoppedScreenShare', {
      userId: socket.userId,
      socketId: socket.id
    });
  });

  socket.on('sendMessage', async (data) => {
    try {
      const { channelId, message, token } = data;
      
      if (!channelId || !message || !token) {
        return socket.emit('error', { message: 'Données incomplètes' });
      }

      const user = await findUserByToken(token);
      
      if (!user) {
        return socket.emit('error', { message: 'Token invalide' });
      }

      const channels = await readData('channels.json');
      const channel = channels.find(c => c.id === channelId);
      
      if (!channel) {
        return socket.emit('error', { message: 'Canal introuvable' });
      }

      const servers = await readData('servers.json');
      const server = servers.find(s => s.id === channel.serverId);
      
      if (!server || (!server.members.includes(user.id) && server.ownerId !== user.id)) {
        return socket.emit('error', { message: 'Accès refusé' });
      }

      const messages = await readData('messages.json');
      
      const newMessage = {
        id: generateId(),
        channelId,
        userId: user.id,
        username: user.username,
        content: message.trim(),
        createdAt: new Date().toISOString()
      };

      messages.push(newMessage);
      await writeData('messages.json', messages);

      io.to(`channel:${channelId}`).emit('newMessage', newMessage);
    } catch (error) {
      console.error('Erreur envoi message:', error);
      socket.emit('error', { message: 'Erreur serveur' });
    }
  });

  socket.on('disconnect', () => {
    if (socket.voiceChannel) {
      const channelId = socket.voiceChannel;
      if (activeCalls.has(channelId)) {
        activeCalls.get(channelId).delete(socket.id);
        if (activeCalls.get(channelId).size === 0) {
          activeCalls.delete(channelId);
        }
      }

      io.to(`voice:${channelId}`).emit('userLeftVoice', {
        userId: socket.userId,
        username: socket.username,
        socketId: socket.id
      });
    }
    console.log('Utilisateur déconnecté:', socket.id);
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(PORT, () => {
  console.log(`SlayzCord serveur démarré sur le port ${PORT}`);
});
