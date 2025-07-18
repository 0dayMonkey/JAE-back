require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const notionUtils = require('./utils/notion');

const app = express();
app.use(express.json());

// Configuration CORS stricte
const corsOptions = {
  origin: process.env.FRONTEND_URL, 
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// --- MIDDLEWARE D'AUTHENTIFICATION ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401); // Unauthorized

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403); // Forbidden
        req.user = user;
        next();
    });
};

// --- ROUTES PUBLIQUES ---

// [GET] /api/scores - Récupère le classement public
app.get('/api/scores', async (req, res) => {
    try {
        const teams = await notionUtils.getTeams();
        res.json(teams);
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur lors de la récupération des scores." });
    }
});

// [GET] /api/init-data - Fournit les données pour les formulaires
app.get('/api/init-data', async (req, res) => {
    try {
        const [teams, stands] = await Promise.all([
            notionUtils.getTeams(),
            notionUtils.getStandsList()
        ]);
        res.json({ teams, stands });
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur lors de l'initialisation." });
    }
});


// --- ROUTES D'AUTHENTIFICATION ---

// [POST] /api/auth/stand - Connexion pour un stand
app.post('/api/auth/stand', async (req, res) => {
    const { standName, pin } = req.body;
    if (!standName || !pin) return res.status(400).send('Nom du stand et PIN requis.');
    
    const stand = await notionUtils.findStandByName(standName);
    if (!stand) return res.status(404).send('Stand non trouvé.');

    const validPin = await bcrypt.compare(pin, stand.pinHash);
    if (!validPin) return res.status(403).send('PIN incorrect.');

    const accessToken = jwt.sign({ role: 'stand', standId: stand.id, standName: stand.name }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ accessToken });
});

// [POST] /api/auth/admin - Connexion pour l'admin
app.post('/api/auth/admin', async (req, res) => {
    const { password } = req.body;
    if (password === process.env.ADMIN_PASSWORD) { // Dans une vraie app, hasher ce mot de passe
        const accessToken = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '8h' });
        res.json({ accessToken });
    } else {
        res.status(403).send('Mot de passe incorrect.');
    }
});

// --- ROUTES PROTÉGÉES ---

// [POST] /api/scores - Ajoute un score
app.post('/api/scores', authenticateToken, async (req, res) => {
    if (req.user.role !== 'stand') return res.sendStatus(403);
    
    const { teamId, points } = req.body;
    const standId = req.user.standId;

    try {
        await notionUtils.addScore(teamId, standId, points);
        res.status(201).json({ message: 'Score ajouté avec succès.' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur lors de l\'ajout du score.' });
    }
});

// [GET] /api/admin/logs - Récupère tous les logs pour l'admin
app.get('/api/admin/logs', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);

    try {
        const logs = await notionUtils.getScoreLogs();
        res.json(logs);
    } catch (error) {
        res.status(500).json({ message: 'Erreur lors de la récupération des logs.' });
    }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur API démarré sur le port ${PORT}`));
