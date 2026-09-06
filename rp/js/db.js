// Initialize IndexedDB database for persistent saves
const db = new Dexie("ByTheRimUniverse");

// Define tables and indexed keys for fast searching
db.version(1).stores({
    leagueState: 'id, currentSeason, currentPhase, currentWeek',
    teams: 'schoolName, conference, wins, losses, prestige',
    players: 'id, schoolName, name, classStanding, position, ovr, isRedshirt',
    gameLogs: '++id, season, week, playerId, teamId, points, assists, rebounds'
});

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
db