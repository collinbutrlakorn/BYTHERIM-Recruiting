window.SimEngine = {
  state: {
    year: 2028,
    week: 0,
    maxWeeks: 15,
    phase: 'Preseason',
    teams: [],
    recruits: [],
    activePlayers: [],
    simCompleted: false,
    statView: 'box', 
    sortCol: 'ppg',
    sortDir: 'desc',
    confFilter: 'ALL',   
    scopeFilter: 'full',
    selectedAwardConf: 'ACC'
  },
  
  async init() {
    await this.initDatabase();
  },

  async initDatabase() {
    try {
      if (typeof db !== 'undefined' && db.leagueState) {
        const savedState = await db.leagueState.get(1);
        
        if (savedState) {
          this.logNews("Loading save state from IndexedDB...");
          this.state.year = savedState.currentYear || 2028;
          this.state.week = savedState.currentWeek || 0;
          this.state.phase = savedState.currentPhase || 'Preseason';
          this.state.simCompleted = savedState.simCompleted || false;

          const savedTeams = await db.teams.toArray();
          const savedPlayers = await db.players.toArray();

          if (savedTeams.length > 0 && savedPlayers.length > 0) {
            this.state.teams = savedTeams;
            this.state.activePlayers = savedPlayers;
            this.syncUI();
            this.logNews(`Loaded Season ${this.state.year} (${this.state.teams.length} teams, ${this.state.activePlayers.length} players).`);
            return;
          }
        }
      }
      
      this.logNews("No active save file found. Initializing universe from Google Sheets...");
      await this.fetchData();
    } catch (err) {
      console.error("Database Init Error:", err);
      this.logNews("Error initializing database. Loading fresh data...");
      await this.fetchData();
    }
  },

  async saveStateToDB() {
    if (typeof db === 'undefined' || !db.leagueState) return;
    try {
      await db.transaction('rw', db.leagueState, db.teams, db.players, async () => {
        await db.leagueState.put({
          id: 1,
          currentYear: this.state.year,
          currentWeek: this.state.week,
          currentPhase: this.state.phase,
          simCompleted: this.state.simCompleted
        });
        await db.teams.clear();
        await db.teams.bulkAdd(this.state.teams);
        await db.players.clear();
        await db.players.bulkAdd(this.state.activePlayers);
      });
    } catch (err) {
      console.error("Failed to save state to IndexedDB:", err);
    }
  },

  getTeamLogo(schoolName) {
    if (!schoolName || schoolName === 'Free Agent' || schoolName === 'Uncommitted') return '';
    return `../schoollogos/${schoolName}.png`;
  },

  async fetchData() {
    try {
      const recruitsUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTWvXoqFJkVFqt36wbBBfgFYUvPKhWCZIztoLIB9sjpc55AiFTdFpJZHMztVgJHyFyy0mtO_MYGD76N/pub?gid=0&single=true&output=csv";
      const rostersUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS_KgPla_wVF3w_s8PGVIreieVKkfOuVuFqt1K25i3gHNa_NpL6MDPST1qnIw12V61COFsSkf2C03Q-/pub?gid=0&single=true&output=csv";

      const [recruitsRes, rostersRes] = await Promise.all([ fetch(recruitsUrl), fetch(rostersUrl) ]);
      
      if (!recruitsRes.ok || !rostersRes.ok) throw new Error("Could not load Google Sheets CSVs");
      
      const rawRecruits = this.parseCSV(await recruitsRes.text());
      const rawRosters = this.parseCSV(await rostersRes.text());
      
      this.state.recruits = rawRecruits.map(r => this.normalizePlayerObj(r, true));
      
      const teamsMap = {};
      rawRosters.forEach(rawPlayer => {
        const player = this.normalizePlayerObj(rawPlayer, false);
        if (!player.school) return;

        if (!teamsMap[player.school]) {
          teamsMap[player.school] = {
            school: player.school,
            conference: player.conference || 'NCAA',
            logo: this.getTeamLogo(player.school), 
            roster: [],
            // Prevent Week 0 UI crashes by guaranteeing simData exists
            simData: { teamOvr: 0, wins: 0, losses: 0, confWins: 0, confLosses: 0, rosterRef: [], winPct: '.000' }
          };
        } else if (player.conference && player.conference !== 'NCAA') {
          teamsMap[player.school].conference = player.conference;
        }
        teamsMap[player.school].roster.push(player);
      });
      
      this.state.teams = Object.values(teamsMap);
      
      if(this.state.teams.length === 0) throw new Error("No teams parsed from sheets.");

      this.filterActiveData();
      this.syncUI();
      await this.saveStateToDB();
      this.logNews(`Loaded ${this.state.teams.length} teams and ${this.state.activePlayers.length} players for ${this.state.year}.`);
    } catch(err) {
      console.error("Database Fetch Error:", err);
      this.logNews(`Failed to reach sheets. Generating Basketball GM Fallback Universe...`);
      this.generateMockUniverse(); 
    }
  },

  // HARDWOOD EMPIRE / BBGM FALLBACK - Creates a fake universe if links break
  generateMockUniverse() {
    const confs = ['ACC', 'Big Ten', 'SEC', 'Pac-12', 'Big 12', 'Big East'];
    const mockTeams = ['Duke', 'North Carolina', 'Kentucky', 'Kansas', 'Villanova', 'UCLA', 'Gonzaga', 'Michigan', 'Texas', 'Arizona', 'Baylor', 'Purdue', 'Virginia', 'Houston', 'UConn', 'Arkansas'];
    this.state.teams = [];
    this.state.activePlayers = [];
    
    mockTeams.forEach((school, i) => {
      let conf = confs[i % confs.length];
      let team = { 
        school, conference: conf, logo: this.getTeamLogo(school), roster: [],
        simData: { teamOvr: 0, wins: 0, losses: 0, confWins: 0, confLosses: 0, rosterRef: [], winPct: '.000' }
      };
      
      for(let j=0; j<12; j++) {
        let pos = ['PG', 'SG', 'SF', 'PF', 'C'][Math.floor(Math.random()*5)];
        let cls = ['FR', 'SO', 'JR', 'SR'][Math.floor(Math.random()*4)];
        let rating = Math.floor(Math.random()*25) + 70; // 70-95 rating
        let p = {
          id: `${school}_${j}`, name: `${school} Player ${j+1}`, school, conference: conf, 
          pos, class: cls, rating, ht: "6'5", wt: "200", hometown: "USA", 
          gameLog: [], accolades: [], stats: this.getZeroStats(), statsFull: this.getZeroStats(), statsConf: this.getZeroStats()
        };
        team.roster.push(p);
        this.state.activePlayers.push(p);
      }
      this.state.teams.push(team);
    });
    this.syncUI();
    this.saveStateToDB();
  },

  parseCSV(csvData) {
    const lines = csvData.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/(^"|"$)/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''));
    
    const result = [];
    for (let i = 1; i < lines.length; i++) {
      let rowValues = [];
      let inQuotes = false;
      let currentValue = '';
      for (let char of lines[i]) {
        if (char === '"') inQuotes = !inQuotes;
        else if (char === ',' && !inQuotes) { rowValues.push(currentValue.trim()); currentValue = ''; }
        else currentValue += char;
      }
      rowValues.push(currentValue.trim());
      
      let obj = {};
      headers.forEach((header, index) => {
        obj[header] = rowValues[index] ? rowValues[index].replace(/(^"|"$)/g, '') : '';
      });
      result.push(obj);
    }
    return result;
  },

  normalizePlayerObj(raw, isRecruit = false) {
    const getVal = (keys, fallback = '') => {
      for (let k of keys) if (raw[k] !== undefined && raw[k] !== '') return raw[k];
      return fallback;
    };
    const rating = parseFloat(getVal(['rating', 'ovr', 'grade', 'stars'], 75)) || 75;
    const school = getVal(['school', 'team', 'committedto', 'college'], 'Free Agent');
    
    return {
      id: getVal(['id', 'playerid'], `${getVal(['name', 'player'], 'unknown')}_${school}_${Math.random().toString(36).substr(2, 5)}`),
      name: getVal(['name', 'player', 'fullname'], 'Unknown Player'),
      school: school,
      conference: getVal(['conf', 'conference', 'league'], 'NCAA'),
      school_logo: this.getTeamLogo(school),
      pos: getVal(['pos', 'position'], 'G').toUpperCase(),
      class: getVal(['class', 'classyear', 'yr'], isRecruit ? 'FR' : 'SO').toUpperCase(),
      ht: getVal(['ht', 'height'], "6'4"),
      wt: getVal(['wt', 'weight'], "190"),
      hometown: getVal(['from', 'hometown', 'home'], 'N/A'),
      rating: rating,
      isRecruit: isRecruit,
      recClassYear: parseInt(getVal(['classyear', 'recclass'], this.state.year)),
      gameLog: [],
      accolades: [],
      stats: this.getZeroStats(),       
      statsFull: this.getZeroStats(),   
      statsConf: this.getZeroStats()    
    };
  },
  
  filterActiveData() {
    let players = [];
    this.state.teams.forEach(team => {
      if (team.roster) {
        team.roster.forEach(player => {
          if (player.class !== 'GRADUATED') players.push(player);
        });
      }
    });

    this.state.recruits.forEach(rec => {
      if (rec.recClassYear <= this.state.year && rec.school && rec.school !== 'Uncommitted') {
        const team = this.state.teams.find(t => t.school.toLowerCase() === rec.school.toLowerCase());
        if (team && !team.roster.some(p => p.name === rec.name)) {
          rec.school = team.school; rec.school_logo = this.getTeamLogo(team.school); rec.class = 'FR';
          team.roster.push(rec); players.push(rec);
        }
      }
    });
    this.state.activePlayers = players;
  },

  getZeroStats() {
    const z1 = "0.0", z3 = ".000";
    return {
      mpg: z1, ppg: z1, rpg: z1, apg: z1, stl: z1, blk: z1, tov: z1, pf: z1,
      fgm: z1, fga: z1, fgPct: z3, twoPm: z1, twoPa: z1, twoPPct: z3,
      threePm: z1, threePa: z1, threePPct: z3, ftm: z1, fta: z1, ftPct: z3,
      bpm: z1, obpm: z1, dbpm: z1, tsPct: z3, rTsPct: z1, eFgPct: z3,
      orebPct: '0.0%', drebPct: '0.0%', trbPct: '0.0%', astPct: '0.0%',
      tovPct: '0.0%', blkPct: '0.0%', usg: '0.0%', ftr: z3, threePar: z3,
      ortg: z1, drtg: z1, netRtg: z1
    };
  },

  initSeasonData() {
    this.state.teams.forEach(team => {
      let roster = this.state.activePlayers.filter(p => p.school === team.school);
      roster.sort((a, b) => parseFloat(b.rating) - parseFloat(a.rating)); // Fortified parsing

      const rawWeights = roster.map((p, idx) => Math.max(0.1, (parseFloat(p.rating) - 55) * Math.pow(0.78, idx)));
      const totalWeight = rawWeights.reduce((a, b) => a + b, 0) || 1;

      const top8 = roster.slice(0, 8);
      const teamOvr = top8.reduce((sum, p) => sum + parseFloat(p.rating), 0) / Math.max(1, Math.min(8, top8.length));
      const winPct = Math.min(0.94, Math.max(0.06, 0.50 + (teamOvr - 78) * 0.038));
      
      team.expectedWinPct = winPct;
      team.simData = { teamOvr, wins: 0, losses: 0, confWins: 0, confLosses: 0, rosterRef: roster, winPct: '.000' };

      roster.forEach((p, idx) => {
        let allocatedMpg = (rawWeights[idx] / totalWeight) * 200;
        if (idx > 9) allocatedMpg = 0; 
        p.isBench = idx >= 5;
        p.expectedStats = this.buildBaseStatExpectations(p, Math.min(35.5, allocatedMpg));
        p.gameLog = [];
        p.statsFull = this.getZeroStats();
        p.statsConf = this.getZeroStats();
        p.stats = p.statsFull;
        p.accolades = [];
      });
    });
  },

  buildBaseStatExpectations(player, mpg) {
    if (mpg <= 0.5) return this.getZeroStats();
    
    const r = parseFloat(player.rating); const pos = player.pos;
    const isBig = pos.includes('C') || (pos.includes('F') && !pos.includes('G'));
    
    const usageScale = (mpg / 28) * (r / 78);
    let ppg = Math.max(0.5, (r * 0.18) * usageScale);
    let rpg = Math.max(0.2, (isBig ? 6.5 : 2.5) * usageScale);
    let apg = Math.max(0.1, (!isBig ? 4.0 : 1.2) * usageScale);
    let stl = Math.max(0.1, (!isBig ? 1.2 : 0.5) * usageScale);
    let blk = Math.max(0.1, (isBig ? 1.6 : 0.3) * usageScale);
    let tov = Math.max(0.2, (apg * 0.4 + 0.8));
    let pf = Math.min(3.8, Math.max(0.8, (mpg / 8)));

    let bpm = ((r - 76) * 0.45);
    let obpm = bpm * (isBig ? 0.45 : 0.60);
    let dbpm = bpm - obpm;

    let ftPct = Math.min(0.92, Math.max(0.48, (isBig ? 0.64 : 0.78)));
    let fta = Math.max(0.2, (ppg * (isBig ? 0.35 : 0.22)));
    let threePar = isBig ? 0.12 : 0.38;
    let threePPct = Math.min(0.46, Math.max(0.20, (isBig ? 0.30 : 0.36)));
    let twoPPct = Math.min(0.68, Math.max(0.38, (isBig ? 0.56 : 0.46)));
    
    let ortg = 95 + (obpm * 3.2);
    let drtg = 105 - (dbpm * 3.2);

    return {
      mpg, ppg, rpg, apg, stl, blk, tov, pf, ftPct, fta,
      threePar, threePPct, twoPPct, bpm, obpm, dbpm, ortg, drtg,
      orebPct: (isBig ? 9.5 : 3.0) + '%', drebPct: (isBig ? 21.0 : 10.5) + '%', trbPct: (isBig ? 15.0 : 6.8) + '%',
    };
  },

  async simulateWeek() {
    if (this.state.teams.length === 0) {
      alert("No active teams detected. Please refresh or check data sources.");
      return;
    }
    if (this.state.simCompleted) {
      alert("Season already complete! Advance offseason to start a new year.");
      return;
    }
    
    if (this.state.week === 0) {
      this.initSeasonData();
    }

    this.state.week++;
    let isConf = this.state.week > 6;

    this.state.teams.forEach(team => {
       for(let i=0; i<2; i++) {
         let win = Math.random() < team.expectedWinPct;
         if (win) team.simData.wins++; else team.simData.losses++;
         if (isConf) {
           if (win) team.simData.confWins++; else team.simData.confLosses++;
         }
       }
    });

    this.state.activePlayers.forEach(p => {
       for(let i=0; i<2; i++) {
          p.gameLog.push(this.generateSingleGameBox(p, isConf, this.state.week, i+1));
       }
       this.recalculateAverages(p);
    });

    if (this.state.week >= this.state.maxWeeks) {
       this.finalizeSeason();
    } else {
       this.syncUI();
       this.logNews(`Week ${this.state.week} simulation complete.`);
    }

    await this.saveStateToDB();
  },

  generateSingleGameBox(player, isConf, week, gameNum) {
     const exp = player.expectedStats;
     const gameMin = Math.round(parseFloat(exp.mpg) * (0.8 + Math.random()*0.4));
     
     if (gameMin <= 0) {
       return { week, isConf, min:0, pts:0, reb:0, ast:0, stl:0, blk:0, tov:0, pf:0, fgm:0, fga:0, twoPm:0, twoPa:0, threePm:0, threePa:0, ftm:0, fta:0 };
     }

     const variance = () => 0.5 + (Math.random() * 1.0); 
     const scale = gameMin / Math.max(1, parseFloat(exp.mpg));
     
     let expected3PA = parseFloat(exp.fta) > 0 ? (parseFloat(exp.ppg) - (parseFloat(exp.fta)*parseFloat(exp.ftPct))) * parseFloat(exp.threePar) / 3 : 0;
     let expected2PA = parseFloat(exp.fta) > 0 ? ((parseFloat(exp.ppg) - (parseFloat(exp.fta)*parseFloat(exp.ftPct))) - (expected3PA*3)) / 2 : 0;
     if(expected2PA < 0) expected2PA = 1; if(expected3PA < 0) expected3PA = 1;

     const threePa = Math.round(expected3PA * scale * variance());
     let threePm = 0;
     for(let i=0; i<threePa; i++) if (Math.random() < parseFloat(exp.threePPct)) threePm++;
     
     const twoPa = Math.round(expected2PA * scale * variance());
     let twoPm = 0;
     for(let i=0; i<twoPa; i++) if (Math.random() < parseFloat(exp.twoPPct)) twoPm++;
     
     const fta = Math.round(parseFloat(exp.fta) * scale * variance());
     let ftm = 0;
     for(let i=0; i<fta; i++) if (Math.random() < parseFloat(exp.ftPct)) ftm++;
     
     const reb = Math.round(parseFloat(exp.rpg) * scale * variance());
     const ast = Math.round(parseFloat(exp.apg) * scale * variance());
     const stl = Math.round(parseFloat(exp.stl) * (0.3 + Math.random()*1.4));
     const blk = Math.round(parseFloat(exp.blk) * (0.3 + Math.random()*1.4));
     const tov = Math.round(parseFloat(exp.tov) * scale * variance());
     const pf = Math.min(5, Math.round(parseFloat(exp.pf) * scale * variance()));

     return {
       week, isConf, min: gameMin,
       pts: (threePm * 3) + (twoPm * 2) + ftm,
       reb, ast, stl, blk, tov, pf,
       fgm: twoPm + threePm, fga: twoPa + threePa,
       twoPm, twoPa, threePm, threePa, ftm, fta
     };
  },

  recalculateAverages(player) {
    if (!player.gameLog || player.gameLog.length === 0) return;
    
    const calc = (logs) => {
       if (logs.length === 0) return this.getZeroStats();
       let s = { min:0, pts:0, reb:0, ast:0, stl:0, blk:0, tov:0, pf:0, fgm:0, fga:0, twoPm:0, twoPa:0, threePm:0, threePa:0, ftm:0, fta:0 };
       logs.forEach(g => { for(let k in s) s[k] += g[k]; });
       
       const g = logs.length;
       const t1 = v => (v/g).toFixed(1);
       const t3 = (m,a) => a > 0 ? (m/a).toFixed(3).replace(/^0+/,'') : '.000';
       
       let mpg = s.min/g;
       let usg = ((s.fga + 0.44 * s.fta + s.tov) / Math.max(1, mpg)) * (40/Math.max(1, mpg)) * 100;
       
       return {
          mpg: t1(s.min), ppg: t1(s.pts), rpg: t1(s.reb), apg: t1(s.ast),
          stl: t1(s.stl), blk: t1(s.blk), tov: t1(s.tov), pf: t1(s.pf),
          fgm: t1(s.fgm), fga: t1(s.fga), fgPct: t3(s.fgm, s.fga),
          twoPm: t1(s.twoPm), twoPa: t1(s.twoPa), twoPPct: t3(s.twoPm, s.twoPa),
          threePm: t1(s.threePm), threePa: t1(s.threePa), threePPct: t3(s.threePm, s.threePa),
          ftm: t1(s.ftm), fta: t1(s.fta), ftPct: t3(s.ftm, s.fta),
          bpm: (player.expectedStats.bpm || 0).toFixed(1), 
          obpm: (player.expectedStats.obpm || 0).toFixed(1), 
          dbpm: (player.expectedStats.dbpm || 0).toFixed(1),
          tsPct: (2*(s.fga + 0.44*s.fta)) > 0 ? t3(s.pts, 2*(s.fga + 0.44*s.fta)) : '.000',
          rTsPct: ((player.expectedStats.tsPct || 0)*100 - 53.5).toFixed(1), 
          eFgPct: s.fga > 0 ? t3(s.fgm + 0.5*s.threePm, s.fga) : '.000',
          orebPct: player.expectedStats.orebPct, drebPct: player.expectedStats.drebPct, trbPct: player.expectedStats.trbPct,
          astPct: mpg>0 ? ((s.ast/g)/mpg * 60).toFixed(1) + '%' : '0.0%',
          tovPct: (s.fga + 0.44*s.fta + s.tov) > 0 ? ((s.tov/(s.fga + 0.44*s.fta + s.tov))*100).toFixed(1) + '%' : '0.0%',
          blkPct: mpg>0 ? ((s.blk/g)/mpg * 40).toFixed(1) + '%' : '0.0%',
          usg: Math.min(45.0, Math.max(5.0, usg)).toFixed(1) + '%', 
          ftr: t3(s.fta, s.fga), threePar: t3(s.threePa, s.fga),
          ortg: (player.expectedStats.ortg || 100).toFixed(1), 
          drtg: (player.expectedStats.drtg || 100).toFixed(1), 
          netRtg: ((player.expectedStats.ortg||100) - (player.expectedStats.drtg||100)).toFixed(1)
       };
    };

    player.statsFull = calc(player.gameLog);
    player.statsConf = calc(player.gameLog.filter(g => g.isConf));
    player.stats = this.state.scopeFilter === 'conf' ? player.statsConf : player.statsFull;
  },

  finalizeSeason() {
    this.state.phase = 'Regular Season Final';
    
    this.state.teams.forEach(t => {
       t.simData.winPct = (t.simData.wins / Math.max(1, t.simData.wins + t.simData.losses)).toFixed(3).replace(/^0+/, '');
    });

    this.state.teams.sort((a,b) => {
      if (b.simData.wins !== a.simData.wins) return b.simData.wins - a.simData.wins;
      return b.simData.teamOvr - a.simData.teamOvr;
    });

    this.state.teams.forEach((t, i) => t.apRank = (i < 25) ? (i + 1) : null);

    this.state.activePlayers.forEach(p => {
      const team = this.state.teams.find(t => t.school === p.school);
      const teamWinPct = team ? (team.simData.wins / Math.max(1, team.simData.wins + team.simData.losses)) : 0.5;
      const bpm = parseFloat(p.stats ? p.stats.bpm : 0);
      const ppg = parseFloat(p.stats ? p.stats.ppg : 0);
      const apg = parseFloat(p.stats ? p.stats.apg : 0);
      const rpg = parseFloat(p.stats ? p.stats.rpg : 0);
      const dbpm = parseFloat(p.stats ? p.stats.dbpm : 0);
      const stl = parseFloat(p.stats ? p.stats.stl : 0);
      const blk = parseFloat(p.stats ? p.stats.blk : 0);

      p.awardScore = (bpm * 2.5) + (ppg * 0.8) + (apg * 0.4) + (rpg * 0.4) + (teamWinPct * 15);
      p.defensiveScore = (dbpm * 3.5) + (stl * 2.5) + (blk * 2.5) + (teamWinPct * 10);
    });
    
    this.state.simCompleted = true;
    this.syncUI();
    this.logNews("Regular season complete. National and Conference awards calculated.");
  },

  async runOffseason() {
    if (this.state.phase === 'Preseason') {
      alert("Simulate the regular season first before advancing to the offseason.");
      return;
    }
    if (!this.state.simCompleted) {
      alert("Finish the current season before advancing.");
      return;
    }

    const classProgression = { 'FR': 'SO', 'SO': 'JR', 'JR': 'SR', 'SR': 'GRADUATED', 'GR': 'GRADUATED' };
    
    this.state.teams.forEach(team => {
      team.roster.forEach(p => {
        p.class = classProgression[p.class] || 'GRADUATED';
        p.rating = Math.min(99, parseFloat(p.rating) + Math.floor(Math.random() * 4)); 
      });
      team.roster = team.roster.filter(p => p.class !== 'GRADUATED');
      team.simData = { teamOvr: 0, wins: 0, losses: 0, confWins: 0, confLosses: 0, rosterRef: team.roster, winPct: '.000' };
    });

    this.state.year += 1;
    this.state.week = 0;
    this.state.phase = 'Preseason';
    this.state.simCompleted = false;
    
    this.filterActiveData();
    this.logNews(`Advanced to ${this.state.year} Offseason. Graduated seniors cleared; incoming recruits added.`);
    
    document.getElementById('statsBody').innerHTML = `<tr><td colspan="25" class="empty-table-msg">Simulate games to view leaderboards.</td></tr>`;
    document.getElementById('standingsContainer').innerHTML = `<p class="empty-table-msg">Simulate games to view standings.</p>`;
    
    this.syncUI();
    await this.saveStateToDB();
  },

  syncUI() {
    const yrElem = document.getElementById('currentYearDisplay');
    if (yrElem) yrElem.innerText = `${this.state.year}-${(this.state.year + 1).toString().slice(2)}`;

    const phaseElem = document.getElementById('currentPhaseDisplay');
    if (phaseElem) {
      phaseElem.innerText = this.state.simCompleted ? 'Regular Season Final' : (this.state.week === 0 ? 'Preseason' : `Week ${this.state.week}`);
    }

    const btn = document.getElementById('simWeekBtn');
    if (btn) {
      if (this.state.simCompleted) {
        btn.innerText = `Season Complete`;
        btn.disabled = true;
      } else {
        btn.innerText = `Simulate Week ${this.state.week + 1}`;
        btn.disabled = false;
      }
    }

    this.updateDashboard();
    this.sortAndRenderStatsTable();
    this.updateStandingsTab();
    this.updateAwardsTab();
  },

  setConfFilter(val) {
    this.state.confFilter = val;
    this.sortAndRenderStatsTable();
  },

  setStatScope(val) {
    this.state.scopeFilter = val;
    this.state.activePlayers.forEach(p => {
      p.stats = val === 'conf' ? p.statsConf : p.statsFull;
    });
    this.sortAndRenderStatsTable();
  },

  toggleStatView(view) {
    this.state.statView = view;
    this.sortAndRenderStatsTable();
  },

  handleSort(colId) {
    if (!this.state.simCompleted && this.state.week === 0) return;
    if (this.state.sortCol === colId) {
      this.state.sortDir = this.state.sortDir === 'desc' ? 'asc' : 'desc';
    } else {
      this.state.sortCol = colId;
      this.state.sortDir = 'desc';
    }
    this.sortAndRenderStatsTable();
  },

  sortAndRenderStatsTable() {
    const statsBody = document.getElementById('statsBody');
    const statsHeader = document.getElementById('statsHeader');
    if (!statsBody || !statsHeader || this.state.week === 0) return;
    
    let col = this.state.sortCol;
    let dir = this.state.sortDir === 'desc' ? -1 : 1;
    let pool = this.state.activePlayers.filter(p => {
      if (this.state.confFilter === 'ALL') return true;
      return (p.conference || '').toUpperCase() === this.state.confFilter.toUpperCase();
    });

    pool.sort((a, b) => {
      let valA = a.stats ? a.stats[col] : 0;
      let valB = b.stats ? b.stats[col] : 0;
      if (['name', 'school', 'pos', 'class'].includes(col)) {
        valA = a[col] || ''; valB = b[col] || '';
        return valA.toString().localeCompare(valB.toString()) * dir;
      }
      if (typeof valA === 'string') valA = parseFloat(valA.replace('%','')) || 0;
      if (typeof valB === 'string') valB = parseFloat(valB.replace('%','')) || 0;
      return (valA - valB) * dir;
    });

    const boxHeaders = [
      { id: 'name', label: 'Player' }, { id: 'school', label: 'School' }, { id: 'pos', label: 'Pos' }, { id: 'mpg', label: 'MPG' },
      { id: 'ppg', label: 'PPG' }, { id: 'rpg', label: 'RPG' }, { id: 'apg', label: 'APG' }, { id: 'stl', label: 'SPG' },
      { id: 'blk', label: 'BPG' }, { id: 'tov', label: 'TPG' }, { id: 'pf', label: 'PF' },
      { id: 'fgm', label: 'FGM' }, { id: 'fga', label: 'FGA' }, { id: 'fgPct', label: 'FG%' },
      { id: 'twoPm', label: '2P' }, { id: 'twoPa', label: '2PA' }, { id: 'twoPPct', label: '2P%' },
      { id: 'threePm', label: '3P' }, { id: 'threePa', label: '3PA' }, { id: 'threePPct', label: '3P%' },
      { id: 'ftm', label: 'FT' }, { id: 'fta', label: 'FTA' }, { id: 'ftPct', label: 'FT%' }
    ];

    const advHeaders = [
      { id: 'name', label: 'Player' }, { id: 'school', label: 'School' }, { id: 'mpg', label: 'MPG' },
      { id: 'bpm', label: 'BPM' }, { id: 'obpm', label: 'OBPM' }, { id: 'dbpm', label: 'DBPM' },
      { id: 'tsPct', label: 'TS%' }, { id: 'rTsPct', label: 'rTS%' }, { id: 'eFgPct', label: 'eFG%' },
      { id: 'orebPct', label: 'OREB%' }, { id: 'drebPct', label: 'DREB%' }, { id: 'trbPct', label: 'TRB%' },
      { id: 'astPct', label: 'AST%' }, { id: 'tovPct', label: 'TOV%' }, { id: 'blkPct', label: 'BLK%' },
      { id: 'usg', label: 'USG%' }, { id: 'ftr', label: 'FTr' }, { id: 'threePar', label: '3PAr' },
      { id: 'ortg', label: 'ORtg' }, { id: 'drtg', label: 'DRtg' }, { id: 'netRtg', label: 'Net' }
    ];

    let currentHeaders = this.state.statView === 'box' ? boxHeaders : advHeaders;
    let theadHtml = `<tr>`;
    currentHeaders.forEach(h => {
      let isSort = this.state.sortCol === h.id;
      let arrow = isSort ? (this.state.sortDir === 'desc' ? ' &darr;' : ' &uarr;') : '';
      let cls = isSort ? 'active-sort' : '';
      theadHtml += `<th class="${cls}" onclick="SimEngine.handleSort('${h.id}')">${h.label}${arrow}</th>`;
    });
    theadHtml += `</tr>`;
    statsHeader.innerHTML = theadHtml;

    let tbodyHtml = '';
    if (pool.length === 0) {
      tbodyHtml = `<tr><td colspan="25" class="empty-table-msg">No players found for conference: ${this.state.confFilter}</td></tr>`;
    } else {
      pool.forEach((p) => {
        tbodyHtml += `<tr>`;
        const safeName = p.name.replace(/'/g, "\\'");
        const safeSchool = p.school.replace(/'/g, "\\'");
        currentHeaders.forEach(h => {
          if (h.id === 'name') tbodyHtml += `<td class="clickable-player" onclick="SimEngine.openPlayerModal('${safeName}')">${p.name}</td>`;
          else if (h.id === 'school') tbodyHtml += `<td class="clickable-school" onclick="SimEngine.openTeamModal('${safeSchool}')">${p.school}</td>`;
          else if (h.id === 'pos') tbodyHtml += `<td>${p.pos}</td>`;
          else tbodyHtml += `<td>${p.stats ? p.stats[h.id] : '-'}</td>`;
        });
        tbodyHtml += `</tr>`;
      });
    }
    
    statsBody.innerHTML = tbodyHtml;
  },

  updateDashboard() {
    const dashTopTeams = document.getElementById('dashTopTeams');
    if (!dashTopTeams) return;

    let topTeamsHtml = '';
    for (let i = 0; i < 10; i++) {
      if (this.state.teams[i] && this.state.week > 0) {
        const safeSchool = this.state.teams[i].school.replace(/'/g, "\\'");
        topTeamsHtml += `
          <div class="team-badge clickable-school" onclick="SimEngine.openTeamModal('${safeSchool}')">
            <span class="team-rank">#${i+1}</span>
            <img src="${this.getTeamLogo(this.state.teams[i].school)}" class="sm-logo">
            ${this.state.teams[i].school}
          </div>
        `;
      }
    }
    dashTopTeams.innerHTML = topTeamsHtml || `<p class="sub-text">Simulate games to generate rankings.</p>`;
    
    if(this.state.week > 0) {
      this.populateDashList('dashPts', 'ppg');
      this.populateDashList('dashReb', 'rpg');
      this.populateDashList('dashAst', 'apg');
      this.populateDashList('dashStl', 'stl');
      this.populateDashList('dashBlk', 'blk');
    }
  },

  populateDashList(elementId, statKey) {
    const el = document.getElementById(elementId);
    if (!el) return;

    let sorted = [...this.state.activePlayers].sort((a,b) => parseFloat(b.stats[statKey]) - parseFloat(a.stats[statKey]));
    let html = '';
    for (let i = 0; i < 5; i++) {
      if (sorted[i]) {
        const safeName = sorted[i].name.replace(/'/g, "\\'");
        html += `<div class="leader-row">
          <span>${i+1}. <span class="clickable-player" onclick="SimEngine.openPlayerModal('${safeName}')">${sorted[i].name}</span> <span class="leader-school">(${sorted[i].school})</span></span>
          <span>${sorted[i].stats[statKey]}</span>
        </div>`;
      }
    }
    el.innerHTML = html;
  },

  updateStandingsTab() {
    const standingsContainer = document.getElementById('standingsContainer');
    if (!standingsContainer || this.state.week === 0) return;

    let apTop25 = this.state.teams.slice(0, 25);
    let apHtml = `
      <div class="standings-card">
        <div class="flex-between mb-1">
          <h3>AP TOP 25</h3>
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr><th>AP Rank</th><th>Team</th><th>Conf</th><th>Overall</th><th>Conf W-L</th><th>Team OVR</th></tr>
            </thead>
            <tbody>`;
    
    apTop25.forEach((t, idx) => {
      let isHidden = idx >= 10 ? 'class="ap-extra-row" style="display:none;"' : '';
      const safeSchool = t.school.replace(/'/g, "\\'");
      apHtml += `
        <tr ${isHidden}>
          <td class="rank-cell">#${idx + 1}</td>
          <td>
            <div class="team-cell-wrap clickable-school" onclick="SimEngine.openTeamModal('${safeSchool}')">
              <img src="${this.getTeamLogo(t.school)}" class="sm-logo">
              <span class="team-name-cell">${t.school}</span>
            </div>
          </td>
          <td class="sub-text">${t.conference || 'NCAA'}</td>
          <td>${t.simData.wins}-${t.simData.losses}</td>
          <td>${t.simData.confWins}-${t.simData.confLosses}</td>
          <td class="sub-text">${t.simData.teamOvr.toFixed(1)}</td>
        </tr>`;
    });

    apHtml += `
            </tbody>
          </table>
        </div>
        ${apTop25.length > 10 ? `<button class="sim-btn sim-btn-secondary w-100 mt-1" onclick="SimEngine.toggleApTop25(this)">See More (Top 25)</button>` : ''}
      </div>`;

    const confList = ['ACC', 'AAC', 'A10', 'Big 12', 'Big Ten', 'Big East', 'SEC', 'Pac-12', 'WCC', 'Mountain West'];
    let allConfsInState = [...new Set(this.state.teams.map(t => (t.conference || 'NCAA').trim()))].filter(Boolean);
    let displayConfs = [...confList];
    allConfsInState.forEach(c => {
      if (!displayConfs.some(existing => existing.toLowerCase() === c.toLowerCase()) && c !== 'NCAA') {
        displayConfs.push(c);
      }
    });

    let confsHtml = `<h3 class="standings-header">CONFERENCE STANDINGS</h3>`;
    confsHtml += `<div class="conf-standings-grid">`;

    displayConfs.forEach(confName => {
      let confTeams = this.state.teams.filter(t => (t.conference || '').toLowerCase() === confName.toLowerCase());
      if (confTeams.length === 0) return;

      confTeams.sort((a,b) => {
        if (b.simData.confWins !== a.simData.confWins) return b.simData.confWins - a.simData.confWins;
        if (b.simData.wins !== a.simData.wins) return b.simData.wins - a.simData.wins;
        return b.simData.teamOvr - a.simData.teamOvr;
      });

      let confSafeId = confName.replace(/[^a-zA-Z0-9]/g, '_');

      confsHtml += `
        <div class="conf-card">
          <h4 class="conf-card-title">${confName}</h4>
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr><th>Rank</th><th>Team</th><th>Conf W-L</th><th>Overall</th></tr>
              </thead>
              <tbody>`;

      confTeams.forEach((t, idx) => {
        let isHidden = idx >= 5 ? `class="conf-row-${confSafeId}" style="display:none;"` : '';
        let isApRanked = t.apRank !== null && t.apRank <= 25;
        let rowStyleClass = isApRanked ? 'ap-ranked-row' : '';
        let apTag = isApRanked ? ` <span class="ap-rank-tag">(#${t.apRank})</span>` : '';

        confsHtml += `
          <tr class="${isHidden} ${rowStyleClass}">
            <td class="bold-sub-text">${idx+1}</td>
            <td>
              <div class="team-cell-wrap clickable-school" onclick="SimEngine.openTeamModal('${t.school.replace(/'/g, "\\'")}')">
                <img src="${this.getTeamLogo(t.school)}" class="sm-logo">
                <span class="team-name-cell">${t.school}</span>${apTag}
              </div>
            </td>
            <td class="bold-text">${t.simData.confWins}-${t.simData.confLosses}</td>
            <td class="sub-text-sm">${t.simData.wins}-${t.simData.losses}</td>
          </tr>`;
      });

      confsHtml += `
              </tbody>
            </table>
          </div>`;
      if (confTeams.length > 5) {
        confsHtml += `<button class="sim-btn sim-btn-secondary btn-sm mt-1" onclick="SimEngine.toggleConfStandings('${confSafeId}', this)">See More (${confTeams.length - 5} Teams)</button>`;
      }
      confsHtml += `</div>`;
    });

    confsHtml += `</div>`;
    standingsContainer.innerHTML = apHtml + confsHtml;
  },

  toggleApTop25(btn) {
    const rows = document.querySelectorAll('.ap-extra-row');
    const isExpanded = rows[0] && rows[0].style.display !== 'none';
    rows.forEach(r => r.style.display = isExpanded ? 'none' : 'table-row');
    btn.innerText = isExpanded ? 'See More (Top 25)' : 'See Less';
  },

  toggleConfStandings(confSafeId, btn) {
    const rows = document.querySelectorAll(`.conf-row-${confSafeId}`);
    const isExpanded = rows[0] && rows[0].style.display !== 'none';
    rows.forEach(r => r.style.display = isExpanded ? 'none' : 'table-row');
    btn.innerText = isExpanded ? `See More (${rows.length} Teams)` : 'See Less';
  },

  updateAwardsTab() {
    if (!this.state.simCompleted) {
      document.getElementById('nationalAwardsGrid').innerHTML = `<p class="sub-text">Complete the season to calculate National Award winners.</p>`;
      document.getElementById('allAmericanContainer').innerHTML = `<p class="sub-text">Complete the season to view All-American teams.</p>`;
      document.getElementById('confAwardsContainer').innerHTML = `<p class="sub-text">Complete the season to view conference award winners.</p>`;
      return;
    }

    const players = [...this.state.activePlayers];
    const isPG = p => p.pos === 'PG' || (p.pos === 'G' && parseFloat(p.stats.apg) >= 3.5);
    const isSG = p => p.pos === 'SG' || (p.pos === 'G' && parseFloat(p.stats.apg) < 3.5);
    const isSF = p => p.pos === 'SF' || (p.pos === 'F' && parseFloat(p.stats.rpg) < 6.5);
    const isPF = p => p.pos === 'PF' || (p.pos === 'F' && parseFloat(p.stats.rpg) >= 6.5);
    const isC = p => p.pos === 'C' || (p.pos === 'F/C');

    const npoy = [...players].sort((a,b) => b.awardScore - a.awardScore)[0];
    const dpoy = [...players].sort((a,b) => b.defensiveScore - a.defensiveScore)[0];
    const froy = [...players].filter(p => p.class === 'FR').sort((a,b) => b.awardScore - a.awardScore)[0];
    
    const cousy = [...players].filter(isPG).sort((a,b) => b.awardScore - a.awardScore)[0] || npoy;
    const west = [...players].filter(isSG).sort((a,b) => b.awardScore - a.awardScore)[0] || npoy;
    const erving = [...players].filter(isSF).sort((a,b) => b.awardScore - a.awardScore)[0] || npoy;
    const malone = [...players].filter(isPF).sort((a,b) => b.awardScore - a.awardScore)[0] || npoy;
    const abdulJabbar = [...players].filter(isC).sort((a,b) => b.awardScore - a.awardScore)[0] || npoy;

    if(npoy && !npoy.accolades.includes("National POY")) npoy.accolades.push("National POY");
    if(dpoy && !dpoy.accolades.includes("National DPOY")) dpoy.accolades.push("National DPOY");

    const majorAwards = [
      { title: "National Player of the Year", sub: "Naismith / Wooden Trophy", winner: npoy, major: true },
      { title: "Defensive Player of the Year", sub: "NABC National DPOY", winner: dpoy, major: true },
      { title: "National Freshman of the Year", sub: "Wayman Tisdale Award", winner: froy, major: true },
      { title: "Bob Cousy Award", sub: "Best Point Guard", winner: cousy, major: false },
      { title: "Jerry West Award", sub: "Best Shooting Guard", winner: west, major: false },
      { title: "Julius Erving Award", sub: "Best Small Forward", winner: erving, major: false },
      { title: "Karl Malone Award", sub: "Best Power Forward", winner: malone, major: false },
      { title: "Kareem Abdul-Jabbar Award", sub: "Best Center", winner: abdulJabbar, major: false }
    ];

    let natHtml = '';
    majorAwards.forEach(a => {
      if (!a.winner) return;
      const safeName = a.winner.name.replace(/'/g, "\\'");
      natHtml += `
        <div class="award-card ${a.major ? 'major-award' : ''}">
          <div class="award-title">${a.title}</div>
          <div class="award-sub">${a.sub}</div>
          <div class="award-winner">
            <img src="${this.getTeamLogo(a.winner.school)}" class="award-logo">
            <div class="award-winner-info">
              <span class="award-winner-name clickable-player" onclick="SimEngine.openPlayerModal('${safeName}')">${a.winner.name}</span>
              <span class="award-winner-school">${a.winner.school} (${a.winner.pos} &bull; ${a.winner.class})</span>
              <span class="award-winner-stats">${a.winner.stats.ppg} PPG, ${a.winner.stats.rpg} RPG, ${a.winner.stats.apg} APG</span>
            </div>
          </div>
        </div>
      `;
    });
    document.getElementById('nationalAwardsGrid').innerHTML = natHtml;

    const sortedAll = [...players].sort((a,b) => b.awardScore - a.awardScore);
    const aa1 = sortedAll.slice(0, 5);
    const aa2 = sortedAll.slice(5, 10);
    const aa3 = sortedAll.slice(10, 15);

    aa1.forEach(p => { if(!p.accolades.includes("1st Team All-American")) p.accolades.push("1st Team All-American"); });

    const renderAaCard = (teamName, teamList) => {
      let rows = '';
      teamList.forEach((p, idx) => {
        const safeName = p.name.replace(/'/g, "\\'");
        rows += `
          <tr>
            <td class="highlight-text">${idx+1}</td>
            <td>
              <div class="team-cell-wrap">
                <img src="${this.getTeamLogo(p.school)}" class="xs-logo">
                <span class="clickable-player" onclick="SimEngine.openPlayerModal('${safeName}')">${p.name}</span>
              </div>
            </td>
            <td>${p.school}</td>
            <td class="sub-text">${p.pos}</td>
            <td class="bold-text">${p.stats.ppg} PPG</td>
          </tr>`;
      });
      return `
        <div class="award-table-card">
          <h5 class="award-table-title">${teamName}</h5>
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr><th>#</th><th>Player</th><th>School</th><th>Pos</th><th>PPG</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      `;
    };

    document.getElementById('allAmericanContainer').innerHTML = 
      renderAaCard("1st Team All-American", aa1) +
      renderAaCard("2nd Team All-American", aa2) +
      renderAaCard("3rd Team All-American", aa3);

    this.renderConferenceAwards(this.state.selectedAwardConf);
  },

  renderConferenceAwards(confName) {
    this.state.selectedAwardConf = confName;
    document.getElementById('confAwardsTitle').innerText = `${confName} Conference Honors`;
    
    if (!this.state.simCompleted) {
      document.getElementById('confAwardsContainer').innerHTML = `<p class="sub-text">Complete the season to view conference awards.</p>`;
      return;
    }

    const confPlayers = this.state.activePlayers.filter(p => (p.conference || '').toLowerCase() === confName.toLowerCase());
    if (confPlayers.length === 0) {
      document.getElementById('confAwardsContainer').innerHTML = `<p class="sub-text">No players found for conference: ${confName}</p>`;
      return;
    }

    const sortedConf = [...confPlayers].sort((a,b) => b.awardScore - a.awardScore);
    const sortedDef = [...confPlayers].sort((a,b) => b.defensiveScore - a.defensiveScore);
    const sortedFresh = [...confPlayers].filter(p => p.class === 'FR').sort((a,b) => b.awardScore - a.awardScore);
    const sorted6m = [...confPlayers].filter(p => p.isBench).sort((a,b) => b.awardScore - a.awardScore);

    const cpoy = sortedConf[0];
    const cdpoy = sortedDef[0];
    const croty = sortedFresh[0] || sortedConf[1];
    const c6moy = sorted6m[0] || sortedConf[4];

    if(cpoy && !cpoy.accolades.includes(`${confName} POY`)) cpoy.accolades.push(`${confName} POY`);
    
    const conf1st = sortedConf.slice(0, 5);
    const conf2nd = sortedConf.slice(5, 10);
    const confFreshTeam = sortedFresh.slice(0, 5);

    const safeN = p => p.name.replace(/'/g, "\\'");

    let html = `
      <div class="awards-grid">
        <div class="award-card major-award">
          <div class="award-title">Player of the Year</div>
          <div class="award-sub">${confName} POY</div>
          <div class="award-winner">
            <img src="${this.getTeamLogo(cpoy.school)}" class="award-logo">
            <div class="award-winner-info">
              <span class="award-winner-name clickable-player" onclick="SimEngine.openPlayerModal('${safeN(cpoy)}')">${cpoy.name}</span>
              <span class="award-winner-school">${cpoy.school} &bull; ${cpoy.stats.ppg} PPG, ${cpoy.stats.rpg} RPG</span>
            </div>
          </div>
        </div>

        <div class="award-card">
          <div class="award-title">Defensive Player of the Year</div>
          <div class="award-sub">${confName} DPOY</div>
          <div class="award-winner">
            <img src="${this.getTeamLogo(cdpoy.school)}" class="award-logo">
            <div class="award-winner-info">
              <span class="award-winner-name clickable-player" onclick="SimEngine.openPlayerModal('${safeN(cdpoy)}')">${cdpoy.name}</span>
              <span class="award-winner-school">${cdpoy.school} &bull; ${cdpoy.stats.stl} SPG, ${cdpoy.stats.blk} BPG</span>
            </div>
          </div>
        </div>

        <div class="award-card">
          <div class="award-title">Rookie of the Year</div>
          <div class="award-sub">${confName} ROTY / Freshman of Year</div>
          <div class="award-winner">
            <img src="${this.getTeamLogo(croty.school)}" class="award-logo">
            <div class="award-winner-info">
              <span class="award-winner-name clickable-player" onclick="SimEngine.openPlayerModal('${safeN(croty)}')">${croty.name}</span>
              <span class="award-winner-school">${croty.school} &bull; ${croty.stats.ppg} PPG</span>
            </div>
          </div>
        </div>

        <div class="award-card">
          <div class="award-title">Sixth Man of the Year</div>
          <div class="award-sub">${confName} 6MOY</div>
          <div class="award-winner">
            <img src="${this.getTeamLogo(c6moy.school)}" class="award-logo">
            <div class="award-winner-info">
              <span class="award-winner-name clickable-player" onclick="SimEngine.openPlayerModal('${safeN(c6moy)}')">${c6moy.name}</span>
              <span class="award-winner-school">${c6moy.school} &bull; ${c6moy.stats.ppg} PPG</span>
            </div>
          </div>
        </div>
      </div>

      <div class="all-american-container">
        ${this.renderConfTeamTable("1st Team All-" + confName, conf1st)}
        ${this.renderConfTeamTable("2nd Team All-" + confName, conf2nd)}
        ${this.renderConfTeamTable("All-Freshman Team", confFreshTeam)}
      </div>
    `;

    document.getElementById('confAwardsContainer').innerHTML = html;
  },

  renderConfTeamTable(title, playerList) {
    let rows = '';
    playerList.forEach((p, idx) => {
      const safeName = p.name.replace(/'/g, "\\'");
      rows += `
        <tr>
          <td class="bold-sub-text">${idx+1}</td>
          <td>
            <div class="team-cell-wrap">
              <img src="${this.getTeamLogo(p.school)}" class="xs-logo">
              <span class="clickable-player" onclick="SimEngine.openPlayerModal('${safeName}')">${p.name}</span>
            </div>
          </td>
          <td>${p.school}</td>
          <td class="sub-text">${p.pos}</td>
          <td class="bold-text">${p.stats ? p.stats.ppg : '0.0'} PPG</td>
        </tr>`;
    });

    return `
      <div class="award-table-card">
        <h5 class="award-table-title">${title}</h5>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>#</th><th>Player</th><th>School</th><th>Pos</th><th>PPG</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="5" class="empty-table-msg">No qualifying players</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `;
  },

  openTeamModal(schoolName) {
    let team = this.state.teams.find(t => t.school === schoolName);
    if (!team) return;

    let rank = team.apRank;
    document.getElementById('modalTeamLogo').src = this.getTeamLogo(team.school);
    document.getElementById('modalTeamName').innerText = team.school;
    document.getElementById('modalTeamYear').innerText = `${this.state.year}-${(this.state.year+1).toString().slice(2)}`;
    
    if (this.state.week > 0) {
      if (this.state.simCompleted && rank && rank <= 25) {
        document.getElementById('modalTeamRank').style.display = 'block';
        document.getElementById('modalTeamRank').innerText = `#${rank}`;
      } else {
        document.getElementById('modalTeamRank').style.display = 'none';
      }

      document.getElementById('modalTeamRecord').innerText = `${team.simData.wins}-${team.simData.losses}`;
      document.getElementById('modalConfRecord').innerText = `${team.simData.confWins}-${team.simData.confLosses}`;
      
      let teamPpg = team.simData.rosterRef.reduce((sum, p) => sum + parseFloat(p.stats.ppg), 0);
      document.getElementById('modalTeamPPG').innerText = teamPpg.toFixed(1);
      document.getElementById('modalOppPPG').innerText = (teamPpg + (team.simData.losses - team.simData.wins) * 0.4).toFixed(1);
    } else {
      document.getElementById('modalTeamRank').style.display = 'none';
      document.getElementById('modalTeamRecord').innerText = "0-0";
      document.getElementById('modalConfRecord').innerText = "0-0";
      document.getElementById('modalTeamPPG').innerText = "0.0";
      document.getElementById('modalOppPPG').innerText = "0.0";
    }

    let rPlayers = this.state.activePlayers.filter(p => p.school === schoolName);
    if (this.state.week > 0) {
      rPlayers.sort((a,b) => parseFloat(b.stats.mpg) - parseFloat(a.stats.mpg));
    }
    
    let rHtml = '';
    rPlayers.forEach((p, idx) => {
      let statsStr = this.state.week > 0 ? `<span class="player-modal-substat">${p.stats.ppg} PPG | ${p.stats.mpg} MPG</span>` : '';
      const safeName = p.name.replace(/'/g, "\\'");
      rHtml += `
        <tr>
          <td class="sub-text">${idx+1}</td>
          <td><span class="clickable-player" onclick="SimEngine.openPlayerModal('${safeName}')">${p.name}</span> ${statsStr}</td>
          <td>${p.pos}</td>
          <td>${p.class}</td>
          <td>${p.ht}</td>
          <td>${p.wt}</td>
          <td>${p.hometown}</td>
          <td><span class="draft-projection">Active</span></td>
        </tr>
      `;
    });
    
    document.getElementById('modalRosterBody').innerHTML = rHtml;
    document.getElementById('teamModal').classList.add('active');
  },

  closeTeamModal() {
    document.getElementById('teamModal').classList.remove('active');
  },

  openPlayerModal(playerName) {
    let player = this.state.activePlayers.find(p => p.name === playerName);
    if (!player) return;

    document.getElementById('modalPlayerLogo').src = this.getTeamLogo(player.school);
    document.getElementById('modalPlayerName').innerText = player.name;
    document.getElementById('modalPlayerBio').innerText = `${player.school} | ${player.pos} | ${player.class} | ${player.ht} | ${player.wt} | ${player.hometown}`;
    
    let accoladesText = (player.accolades && player.accolades.length > 0) ? player.accolades.join(' • ') : '';
    document.getElementById('modalPlayerAccolades').innerText = accoladesText;

    document.getElementById('modalPlayerPPG').innerText = player.stats.ppg;
    document.getElementById('modalPlayerRPG').innerText = player.stats.rpg;
    document.getElementById('modalPlayerAPG').innerText = player.stats.apg;
    document.getElementById('modalPlayerFG').innerText = player.stats.fgPct;

    let glHtml = '';
    if (!player.gameLog || player.gameLog.length === 0) {
      glHtml = `<tr><td colspan="12" class="empty-table-msg">No games played yet.</td></tr>`;
    } else {
      player.gameLog.forEach(g => {
        let type = g.isConf ? 'Conf' : 'Non-Conf';
        glHtml += `
          <tr>
            <td class="bold-text">Wk ${g.week}</td>
            <td class="sub-text-sm">${type}</td>
            <td>${g.min}</td>
            <td class="highlight-col">${g.pts}</td>
            <td>${g.reb}</td>
            <td>${g.ast}</td>
            <td>${g.stl}</td>
            <td>${g.blk}</td>
            <td>${g.tov}</td>
            <td>${g.fgm}-${g.fga}</td>
            <td>${g.threePm}-${g.threePa}</td>
            <td>${g.ftm}-${g.fta}</td>
          </tr>
        `;
      });
    }

    document.getElementById('modalPlayerGameLog').innerHTML = glHtml;
    document.getElementById('playerModal').classList.add('active');
  },

  closePlayerModal() {
    document.getElementById('playerModal').classList.remove('active');
  },

  logNews(msg) {
    const feed = document.getElementById('newsFeed');
    if (!feed) return;
    const item = document.createElement('div');
    item.className = 'news-item';
    item.innerText = msg;
    feed.prepend(item);
  }
};
