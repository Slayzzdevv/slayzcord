# Guide d'hébergement SlayzCord sur Render

## 🚀 Déploiement sur Render

### Étape 1 : Préparer le code sur GitHub

1. **Créer un compte GitHub** (si vous n'en avez pas)
   - Allez sur https://github.com/signup

2. **Créer un nouveau repository**
   - Cliquez sur "New repository"
   - Nom : `slayzcord` (ou autre nom)
   - Visibilité : Public ou Private
   - Ne cochez PAS "Initialize with README"
   - Cliquez sur "Create repository"

3. **Pousser votre code sur GitHub**
   
   Ouvrez PowerShell/Terminal dans le dossier du projet et exécutez :
   
   ```bash
   git init
   git add .
   git commit -m "Initial commit - SlayzCord"
   git branch -M main
   git remote add origin https://github.com/VOTRE_USERNAME/slayzcord.git
   git push -u origin main
   ```
   
   Remplacez `VOTRE_USERNAME` par votre nom d'utilisateur GitHub.

### Étape 2 : Créer un compte Render

1. Allez sur https://render.com
2. Cliquez sur "Get Started for Free"
3. Connectez-vous avec votre compte GitHub

### Étape 3 : Déployer sur Render

1. **Créer un nouveau Web Service**
   - Dans le dashboard Render, cliquez sur "New +"
   - Sélectionnez "Web Service"

2. **Connecter votre repository**
   - Cliquez sur "Connect account" si nécessaire
   - Sélectionnez votre repository `slayzcord`
   - Cliquez sur "Connect"

3. **Configurer le service**
   
   Remplissez les champs suivants :
   
   - **Name** : `slayzcord` (ou autre nom)
   - **Environment** : `Node`
   - **Region** : Choisissez le plus proche (ex: Frankfurt)
   - **Branch** : `main`
   - **Root Directory** : `.` (laisser vide)
   - **Build Command** : `npm install`
   - **Start Command** : `node server.js`
   - **Plan** : **Free** (gratuit mais se met en veille après 15 min d'inactivité)

4. **Variables d'environnement**
   
   Cliquez sur "Advanced" et ajoutez :
   - **Key** : `PORT`
   - **Value** : `10000` (Render utilise le port défini dans PORT ou 10000 par défaut)
   
   Ou laissez Render gérer automatiquement (il définit PORT automatiquement).

5. **Créer le service**
   - Cliquez sur "Create Web Service"
   - Render va commencer à déployer votre application

6. **Attendre le déploiement**
   - Le déploiement prend 2-3 minutes
   - Vous verrez les logs en temps réel
   - Une fois terminé, vous obtiendrez une URL : `https://slayzcord.onrender.com`

### Étape 4 : Accéder à votre application

- Votre application sera accessible sur l'URL fournie par Render
- Exemple : `https://slayzcord.onrender.com`

### ⚠️ Notes importantes

- **Plan gratuit** : Render met le service en veille après 15 minutes d'inactivité
- **Premier démarrage** : Peut prendre 30-60 secondes après la mise en veille
- **WebSocket** : Fonctionne sur Render mais peut avoir des limitations
- **Données** : Les fichiers JSON dans `data/` seront persistants

## 🔧 Lancer le serveur localement

### Prérequis

- Node.js installé (version 14 ou supérieure)
- Téléchargez depuis https://nodejs.org/

### Installation

1. **Installer les dépendances**
   
   Ouvrez PowerShell/Terminal dans le dossier du projet :
   
   ```bash
   npm install
   ```

2. **Créer le dossier data** (si nécessaire)
   
   Le dossier `data/` doit contenir :
   - `users.json`
   - `servers.json`
   - `channels.json`
   - `messages.json`
   
   Si les fichiers n'existent pas, créez-les avec `[]` comme contenu.

3. **Lancer le serveur**
   
   ```bash
   npm start
   ```
   
   Ou directement :
   ```bash
   node server.js
   ```

4. **Accéder à l'application**
   
   Ouvrez votre navigateur et allez sur :
   ```
   http://localhost:3000
   ```

### Commandes utiles

```bash
# Installer les dépendances
npm install

# Lancer le serveur
npm start

# Lancer en mode développement (avec nodemon si installé)
npm run dev
```

## 📝 Structure des fichiers data/

Assurez-vous que le dossier `data/` contient ces fichiers :

- `users.json` - `[]`
- `servers.json` - `[]`
- `channels.json` - `[]`
- `messages.json` - `[]`

Ces fichiers seront créés automatiquement si ils n'existent pas.

## 🐛 Résolution de problèmes

### Le serveur ne démarre pas

- Vérifiez que Node.js est installé : `node --version`
- Vérifiez que les dépendances sont installées : `npm install`
- Vérifiez les logs d'erreur dans la console

### Erreur "Cannot find module"

- Exécutez `npm install` pour installer les dépendances
- Vérifiez que `package.json` contient toutes les dépendances

### Port déjà utilisé

- Changez le port dans `server.js` : `const PORT = process.env.PORT || 3001;`
- Ou arrêtez le processus qui utilise le port 3000

### Render - Service en veille

- Le plan gratuit met le service en veille après 15 min
- Le premier démarrage après la mise en veille prend 30-60 secondes
- Pour éviter cela, utilisez un plan payant ou un service qui ne se met pas en veille (comme Railway)

## ✅ Checklist de déploiement

- [ ] Code poussé sur GitHub
- [ ] Compte Render créé
- [ ] Web Service créé et connecté au repo
- [ ] Build Command : `npm install`
- [ ] Start Command : `node server.js`
- [ ] Déploiement réussi
- [ ] URL obtenue
- [ ] Application testée

## 🎯 Alternative : Railway (recommandé)

Railway ne met pas le service en veille et est plus simple à configurer :

1. Allez sur https://railway.app
2. Connectez-vous avec GitHub
3. Créez un nouveau projet depuis votre repo
4. Railway détecte automatiquement Node.js
5. C'est tout ! Votre app est en ligne

