// Published Google Sheets CSV URLs
const DATA_SOURCES = {
    recruiting: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTWvXoqFJkVFqt36wbBBfgFYUvPKhWCZIztoLIB9sjpc55AiFTdFpJZHMztVgJHyFyy0mtO_MYGD76N/pub?gid=0&single=true&output=csv",
    rosters: "https://docs.google.com/spreadsheets/d/e/2PACX-1vS_KgPla_wVF3w_s8PGVIreieVKkfOuVuFqt1K25i3gHNa_NpL6MDPST1qnIw12V61COFsSkf2C03Q-/pub?gid=0&single=true&output=csv"
};

// Initialize IndexedDB database for persistent saves
const db = new Dexie("ByTheRimUniverse");

// Define tables and indexed keys for fast searching
db.version(1).stores({
    leagueState: 'id, currentSeason, currentPhase, currentWeek',
    teams: 'schoolName, conference, wins, losses, prestige',
    players: 'id, schoolName, name, classStanding, position, ovr, isRedshirt',
    recruits: 'id, name, position, ovr, targetSchool',
    gameLogs: '++id, season, week, playerId, teamId, points, assists, rebounds'
});

// Helper function to parse raw CSV string into JS objects
function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    return lines.slice(1).map(line => {
        // Split by comma while respecting quotes
        const values = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        const row = {};
        headers.forEach((header, index) => {
            let val = values[index] ? values[index].trim() : '';
            val = val.replace(/^"|"$/g, '');
            row[header] = !isNaN(val) && val !== '' ? Number(val) : val;
        });
        return row;
    });
}

// Fetch CSV from Google Sheets and return parsed array
async function fetchCSVData(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP fetch error: ${response.status}`);
        const text = await response.text();
        return parseCSV(text);
    } catch (error) {
        console.error("Failed to fetch Google Sheets CSV:", error);
        return [];
    }
}

// Populate database on fresh universe setup
async function setupNewUniverse() {
    console.log("Fetching live roster and recruiting data from Google Sheets...");

    const [rosterData, recruitingData] = await Promise.all([
        fetchCSVData(DATA_SOURCES.rosters),
        fetchCSVData(DATA_SOURCES.recruiting)
    ]);

    // Build unique team entities from roster rows
    const teamMap = new Map();
    rosterData.forEach(p => {
        const school = p.schoolName || p.School || p.Team || 'Unknown';
        if (!teamMap.has(school)) {
            teamMap.set(school, {
                schoolName: school,
                conference: p.conference || p.Conference || 'Independent',
                wins: 0,
                losses: 0,
                prestige: p.prestige || p.Prestige || 70
            });
        }
    });

    // Format player roster items with property fallbacks
    const players = rosterData.map((p, idx) => ({
        id: p.id || `player_${idx + 1}`,
        schoolName: p.schoolName || p.School || p.Team || '',
        name: p.name || p.Name || p.Player || `Player ${idx + 1}`,
        classStanding: p.classStanding || p.Class || 'Fr',
        position: p.position || p.Pos || 'G',
        ovr: p.ovr || p.OVR || 70,
        isRedshirt: Boolean(p.isRedshirt)
    }));

    // Format recruiting database items
    const recruits = recruitingData.map((r, idx) => ({
        id: r.id || `recruit_${idx + 1}`,
        name: r.name || r.Name || r.Player || `Recruit ${idx + 1}`,
        position: r.position || r.Pos || 'G',
        ovr: r.ovr || r.OVR || 65,
        targetSchool: r.targetSchool || r.School || ''
    }));

    // Bulk save everything inside an IndexedDB transaction
    await db.transaction('rw', db.leagueState, db.teams, db.players, db.recruits, async () => {
        await db.teams.bulkPut(Array.from(teamMap.values()));
        await db.players.bulkPut(players);
        await db.recruits.bulkPut(recruits);
        await db.leagueState.put({
            id: 1,
            currentSeason: 1,
            currentPhase: 'Preseason',
            currentWeek: 1
        });
    });

    console.log("Universe setup complete! Google Sheets data loaded into IndexedDB.");
}

async function initDatabase() {
    const state = await db.leagueState.get(1);

    if (!state) {
        console.log("No save file found. Initializing new universe...");
        await setupNewUniverse();
    } else {
        console.log(`Loaded save: Season ${state.currentSeason}`);
        // Trigger UI render functions here
    }
}
