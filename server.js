require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const notionUtils = require('./utils/notion');

const app = express();
app.use(express.json());

const corsOptions = {
  origin: process.env.FRONTEND_URL,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// --- ROUTES PUBLIQUES ---
app.get('/api/scores', async (req, res) => {
    try {
        const teams = await notionUtils.getTeams();
        res.json(teams);
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur: récupération des scores." });
    }
});

app.get('/api/init-data', async (req, res) => {
    try {
        const [teams, stands] = await Promise.all([
            notionUtils.getTeams(),
            notionUtils.getStandsList()
        ]);
        res.json({ teams, stands });
    } catch (error) {
        res.status(500).json({ message: "Erreur serveur: initialisation." });
    }
});

// --- ROUTES D'AUTHENTIFICATION ---
app.post('/api/auth/stand', async (req, res) => {
    const { standName, pin } = req.body;
    try {
        const stand = await notionUtils.findStandByName(standName);
        if (!stand) return res.status(404).send('Stand non trouvé ou PIN non configuré.');
        if (stand.active === false) return res.status(403).send('Ce stand est désactivé.');
        const validPin = await bcrypt.compare(pin, stand.pinHash);
        if (!validPin) return res.status(403).send('PIN incorrect.');
        const accessToken = jwt.sign({ role: 'stand', standId: stand.id, standName: stand.name }, process.env.JWT_SECRET, { expiresIn: '8h' });
        res.json({ accessToken });
    } catch (error) {
        res.status(500).send("Erreur serveur lors de la vérification du stand.");
    }
});

const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
app.post('/api/auth/admin', async (req, res) => {
    const { password } = req.body;
    try {
        const validPassword = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
        if (validPassword) {
            const accessToken = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '8h' });
            res.json({ accessToken });
        } else {
            res.status(403).send('Mot de passe incorrect.');
        }
    } catch (error) {
        res.status(500).send('Erreur lors de la connexion admin.');
    }
});


// --- ROUTES PROTÉGÉES (STAND) ---
app.post('/api/scores', authenticateToken, async (req, res) => {
    if (req.user.role !== 'stand') return res.sendStatus(403);
    const { teamId, points } = req.body;
    try {
        await notionUtils.addScore(teamId, req.user.standId, points);
        res.status(201).json({ message: 'Score ajouté avec succès.' });
    } catch (error) {
        res.status(500).json({ message: 'Erreur lors de l\'ajout du score.' });
    }
});

// --- ROUTES PROTÉGÉES (ADMIN) ---
app.get('/api/admin/logs', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    try {
        const logs = await notionUtils.getScoreLogs();
        res.json(logs);
    } catch (error) {
        res.status(500).json({ message: 'Erreur récupération des logs.' });
    }
});

app.put('/api/scores/:logId', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    try {
        await notionUtils.updateScore(req.params.logId, req.body.points);
        res.json({ message: 'Score mis à jour.' });
    } catch (error) {
        res.status(500).json({ message: 'Erreur mise à jour du score.' });
    }
});

app.delete('/api/scores/:logId', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    try {
        await notionUtils.deleteScore(req.params.logId);
        res.json({ message: 'Score supprimé.' });
    } catch (error) {
        res.status(500).json({ message: 'Erreur suppression du score.' });
    }
});

app.get('/api/admin/stands', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    try {
        const stands = await notionUtils.getStandsList();
        res.json(stands);
    } catch(error) {
        res.status(500).json({ message: 'Erreur récupération des stands.' });
    }
});

app.post('/api/admin/stands', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    try {
        const { name, pin } = req.body;
        await notionUtils.createStand(name, pin);
        res.status(201).json({ message: 'Stand créé avec succès.' });
    } catch(error) {
        res.status(500).json({ message: 'Erreur création du stand.' });
    }
});

app.put('/api/admin/teams/:teamId/set', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    try {
        await notionUtils.setTeamScore(req.params.teamId, req.body.score);
        res.json({ message: 'Score de l\'équipe mis à jour.' });
    } catch(error) {
        res.status(500).json({ message: 'Erreur lors de la définition du score.' });
    }
});

app.post('/api/admin/teams/:teamId/adjust', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    try {
        await notionUtils.adjustTeamScore(req.params.teamId, req.body.points);
        res.status(201).json({ message: 'Score de l\'équipe ajusté.' });
    } catch(error) {
        res.status(500).json({ message: 'Erreur lors de l\'ajustement du score.' });
    }
});


app.put('/api/admin/stands/:standId/toggle', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    try {
        await notionUtils.toggleStandActive(req.params.standId, req.body.isActive);
        res.json({ message: 'Statut du stand mis à jour.' });
    } catch(error) {
        res.status(500).json({ message: 'Erreur mise à jour du statut.' });
    }
});

app.put('/api/admin/stands/:standId/pin', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    try {
        await notionUtils.resetStandPin(req.params.standId, req.body.pin);
        res.json({ message: 'PIN du stand mis à jour.' });
    } catch(error) {
        res.status(500).json({ message: 'Erreur mise à jour du PIN.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur API démarré sur le port ${PORT}`));