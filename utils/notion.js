const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_API_KEY });

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
    return response.results.map(page => ({
        id: page.id,
        name: page.properties['Nom du Stand'].title[0].text.content
    }));
};

const findStandByName = async (name) => {
    const response = await notion.databases.query({
        database_id: DB_STANDS,
        filter: { property: 'Nom du Stand', title: { equals: name } }
    });
    if (response.results.length === 0) return null;

    const page = response.results[0];
    const pinProperty = page.properties['PIN Sécurisé'];

    if (!pinProperty || !pinProperty.rich_text || pinProperty.rich_text.length === 0) {
        console.error(`Le stand "${name}" a été trouvé mais n'a pas de PIN configuré dans Notion.`);
        return null;
    }

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
            'ID': { title: [{ text: { content: `${new Date().toISOString()}-${teamId}` } }] },
            '# Points': { number: points },
            'Stands': { relation: [{ id: standId }] },
            'Equipes': { relation: [{ id: teamId }] }
        }
    });

    const teamPage = await notion.pages.retrieve({ page_id: teamId });
    const currentScore = teamPage.properties['Score Total'].number || 0;

    await notion.pages.update({
        page_id: teamId,
        properties: {
            'Score Total': { number: currentScore + points }
        }
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
        const teamRelation = page.properties['Equipes'].relation[0];
        const standRelation = page.properties['Stands'].relation[0];

        return {
            id: page.id,
            points: page.properties['# Points'].number,
            timestamp: page.properties.Timestamp.created_time,
            teamName: teamRelation ? teamMap.get(teamRelation.id) : 'N/A',
            standName: standRelation ? standMap.get(standRelation.id) : 'N/A'
        };
    });
};

module.exports = {
    getTeams,
    getStandsList,
    findStandByName,
    addScore,
    getScoreLogs
};