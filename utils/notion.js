const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const bcrypt = require('bcryptjs');

const DB_EQUIPES = process.env.NOTION_DB_EQUIPES;
const DB_STANDS = process.env.NOTION_DB_STANDS;
const DB_LOGS = process.env.NOTION_DB_LOGS;

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

const getStandsList = async () => {
    const response = await notion.databases.query({ database_id: DB_STANDS });
    return response.results.map(page => {
        const etat = page.properties['ETAT']?.select?.name || 'INACTIF';
        return {
            id: page.id,
            name: page.properties['Nom du Stand'].title[0].text.content,
            status: etat
        };
    });
};

const findStandByName = async (name) => {
    const response = await notion.databases.query({
        database_id: DB_STANDS,
        filter: { property: 'Nom du Stand', title: { equals: name } }
    });
    if (response.results.length === 0) return null;
    const page = response.results[0];
    const pinProperty = page.properties['PIN Sécurisé'];
    const etat = page.properties['ETAT']?.select?.name || 'INACTIF';

    if (!pinProperty || !pinProperty.rich_text || pinProperty.rich_text.length === 0) return null;
    if (etat !== 'ACTIF') return { active: false };
    
    return {
        id: page.id,
        name: page.properties['Nom du Stand'].title[0].text.content,
        pinHash: pinProperty.rich_text[0].text.content
    };
};

const addScore = async (teamId, standId, points) => {
    await notion.pages.create({
        parent: { database_id: DB_LOGS },
        properties: {
            'ID': { title: [{ text: { content: `Log-${Date.now()}` } }] },
            'Points': { number: points },
            'Stands': { relation: [{ id: standId }] },
            'Equipes': { relation: [{ id: teamId }] }
        }
    });
    const teamPage = await notion.pages.retrieve({ page_id: teamId });
    const currentScore = teamPage.properties['Score Total'].number || 0;
    await notion.pages.update({
        page_id: teamId,
        properties: { 'Score Total': { number: currentScore + points } }
    });
};

const getScoreLogs = async () => {
    const [teams, stands] = await Promise.all([getTeams(), getStandsList()]);
    const teamMap = new Map(teams.map(t => [t.id, t.name]));
    const standMap = new Map(stands.map(s => [s.id, s.name]));
    const response = await notion.databases.query({
        database_id: DB_LOGS,
        sorts: [{ property: 'Timestamp', direction: 'descending' }]
    });
    return response.results.map(page => {
        const teamRelation = page.properties.Equipes.relation[0];
        const standRelation = page.properties.Stands.relation[0];
        return {
            logId: page.id,
            points: page.properties['Points'].number,
            timestamp: page.properties.Timestamp.created_time,
            teamName: teamRelation ? teamMap.get(teamRelation.id) : 'N/A',
            standName: standRelation ? standMap.get(standRelation.id) : 'N/A'
        };
    });
};

const updateScore = async (logId, newPoints) => {
    const logPage = await notion.pages.retrieve({ page_id: logId });
    const oldPoints = logPage.properties['Points'].number;
    const teamId = logPage.properties.Equipes.relation[0].id;
    const pointDifference = newPoints - oldPoints;
    const teamPage = await notion.pages.retrieve({ page_id: teamId });
    const currentTeamScore = teamPage.properties['Score Total'].number || 0;
    await notion.pages.update({ page_id: logId, properties: { 'Points': { number: newPoints } } });
    await notion.pages.update({ page_id: teamId, properties: { 'Score Total': { number: currentTeamScore + pointDifference } } });
};

const deleteScore = async (logId) => {
    const logPage = await notion.pages.retrieve({ page_id: logId });
    if (logPage.archived) return;
    const pointsToDelete = logPage.properties['Points'].number;
    const teamId = logPage.properties.Equipes.relation[0].id;
    const teamPage = await notion.pages.retrieve({ page_id: teamId });
    const currentTeamScore = teamPage.properties['Score Total'].number || 0;
    await notion.pages.update({ page_id: logId, archived: true });
    await notion.pages.update({ page_id: teamId, properties: { 'Score Total': { number: currentTeamScore - pointsToDelete } } });
};

const createStand = async (name, pin) => {
    const salt = await bcrypt.genSalt(10);
    const pinHash = await bcrypt.hash(pin, salt);
    await notion.pages.create({
        parent: { database_id: DB_STANDS },
        properties: {
            'Nom du Stand': { title: [{ text: { content: name } }] },
            'PIN Sécurisé': { rich_text: [{ text: { content: pinHash } }] },
            'ETAT': { select: { name: 'ACTIF' } }
        }
    });
};

const setStandStatus = async (standId, newStatus) => {
    await notion.pages.update({
        page_id: standId,
        properties: { 'ETAT': { select: { name: newStatus } } }
    });
};

const resetStandPin = async (standId, newPin) => {
    const salt = await bcrypt.genSalt(10);
    const pinHash = await bcrypt.hash(newPin, salt);
    await notion.pages.update({
        page_id: standId,
        properties: { 'PIN Sécurisé': { rich_text: [{ text: { content: pinHash } }] } }
    });
};

const setTeamScore = async (teamId, newScore) => {
    await notion.pages.update({ page_id: teamId, properties: { 'Score Total': { number: newScore } } });
};

const adjustTeamScore = async (teamId, pointsAdjustment) => {
    const adminStandResponse = await notion.databases.query({
        database_id: DB_STANDS,
        filter: { property: 'Nom du Stand', title: { equals: 'Admin' } }
    });
    if (adminStandResponse.results.length === 0) {
        throw new Error("Le stand 'Admin' est introuvable sur Notion.");
    }
    const adminStandId = adminStandResponse.results[0].id;
    await addScore(teamId, adminStandId, pointsAdjustment);
};

module.exports = {
    getTeams, getStandsList, findStandByName, addScore, getScoreLogs,
    updateScore, deleteScore, createStand, setStandStatus, resetStandPin,
    setTeamScore, adjustTeamScore
};