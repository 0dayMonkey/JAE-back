const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DB_EQUIPES = process.env.NOTION_DB_EQUIPES;
const DB_STANDS = process.env.NOTION_DB_STANDS;
const DB_LOGS = process.env.NOTION_DB_LOGS;

// Récupère les équipes et leurs scores, triées par score
const getTeams = async () => {
    const response = await notion.databases.query({
        database_id: DB_EQUIPES,
        sorts: [{ property: 'Score Total', direction: 'descending' }]
    });
    return response.results.map(page => ({
        id: page.id,
        name: page.properties.Nom.title[0].text.content,
        score: page.properties['Score Total'].number
    }));
};

// Récupère la liste simple des stands
const getStandsList = async () => {
    const response = await notion.databases.query({ database_id: DB_STANDS });
    return response.results.map(page => ({
        id: page.id,
        name: page.properties['Nom du Stand'].title[0].text.content
    }));
};


// Trouve un stand par son nom pour l'authentification
const findStandByName = async (name) => {
    const response = await notion.databases.query({
        database_id: DB_STANDS,
        filter: { property: 'Nom du Stand', title: { equals: name } }
    });
    if (response.results.length === 0) return null;
    const page = response.results[0];
    return {
        id: page.id,
        name: page.properties['Nom du Stand'].title[0].text.content,
        pinHash: page.properties['PIN Sécurisé'].rich_text[0].text.content
    };
};

// Ajoute un log de score ET met à jour le total de l'équipe
const addScore = async (teamId, standId, points) => {
    // 1. Log l'événement
    await notion.pages.create({
        parent: { database_id: DB_LOGS },
        properties: {
            'ID': { title: [{ text: { content: `${new Date().toISOString()}-${teamId}` } }] },
            'Points': { number: points },
            'Relation Stand': { relation: [{ id: standId }] },
            'Relation Equipe': { relation: [{ id: teamId }] }
        }
    });

    // 2. Récupère le score actuel de l'équipe
    const teamPage = await notion.pages.retrieve({ page_id: teamId });
    const currentScore = teamPage.properties['Score Total'].number || 0;

    // 3. Met à jour le score total de l'équipe
    await notion.pages.update({
        page_id: teamId,
        properties: {
            'Score Total': { number: currentScore + points }
        }
    });
};

// Récupère tous les logs de scores
const getScoreLogs = async () => {
    const response = await notion.databases.query({
        database_id: DB_LOGS,
        sorts: [{ property: 'Timestamp', direction: 'descending' }]
    });

    // C'est un peu complexe car il faut "résoudre" les relations
    const logs = response.results.map(page => {
        return {
            id: page.id,
            points: page.properties.Points.number,
            timestamp: page.properties.Timestamp.created_time,
            // On stocke les IDs des relations pour les récupérer plus tard si besoin
            teamId: page.properties['Relation Equipe'].relation[0]?.id,
            standId: page.properties['Relation Stand'].relation[0]?.id
        };
    });
    return logs;
};


module.exports = {
    getTeams,
    getStandsList,
    findStandByName,
    addScore,
    getScoreLogs
};
