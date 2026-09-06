/**
 * UI Controller for NCAA Roleplay Simulator
 * Manages tab switching, controls, modal listeners, search, and user interactions.
 */

window.UIController = {
  init() {
    this.setupTabNavigation();
    this.setupActionButtons();
    this.setupFiltersAndToggles();
    this.setupModalListeners();
    this.setupSearchInput();
    this.setupSaveManagement();
    console.log("UI Controller initialized.");
  },

  /**
   * Tab Switching System
   */
  setupTabNavigation() {
    const tabButtons = document.querySelectorAll('.nav-tab, .tab-btn, [data-tab]');
    
    tabButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetTabId = btn.getAttribute('data-tab') || btn.getAttribute('href')?.replace('#', '');
        if (!targetTabId) return;

        // Deactivate all tabs and buttons
        document.querySelectorAll('.tab-btn, .nav-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content, .tab-pane').forEach(content => content.classList.remove('active'));

        // Activate clicked button and target tab
        btn.classList.add('active');
        const targetContent = document.getElementById(targetTabId);
        if (targetContent) {
          targetContent.classList.add('active');
        }

        // Trigger view-specific re-renders when switching tabs
        if (targetTabId === 'awardsTab' || targetTabId === 'awards') {
          if (window.SimEngine && typeof SimEngine.updateAwardsTab === 'function') {
            SimEngine.updateAwardsTab();
          }
        } else if (targetTabId === 'standingsTab' || targetTabId === 'standings') {
          if (window.SimEngine && typeof SimEngine.updateStandingsTab === 'function') {
            SimEngine.updateStandingsTab();
          }
        }
      });
    });
  },

  /**
   * Simulation & Offseason Buttons
   */
  setupActionButtons() {
    const simWeekBtn = document.getElementById('simWeekBtn');
    if (simWeekBtn) {
      simWeekBtn.addEventListener('click', () => {
        if (window.SimEngine) SimEngine.simulateWeek();
      });
    }

    const offseasonBtn = document.getElementById('advanceOffseasonBtn') || document.getElementById('offseasonBtn');
    if (offseasonBtn) {
      offseasonBtn.addEventListener('click', () => {
        if (confirm("Are you sure you want to advance to the next season? This will graduate seniors and progress rosters.")) {
          if (window.SimEngine) SimEngine.runOffseason();
        }
      });
    }
  },

  /**
   * Table Filters, View Toggles (Box/Adv), and Conference Selectors
   */
  setupFiltersAndToggles() {
    // Stat View Toggles (Box vs Advanced)
    const boxViewBtn = document.getElementById('statViewBox') || document.getElementById('btnViewBox');
    const advViewBtn = document.getElementById('statViewAdv') || document.getElementById('btnViewAdv');

    if (boxViewBtn) {
      boxViewBtn.addEventListener('click', () => {
        boxViewBtn.classList.add('active');
        if (advViewBtn) advViewBtn.classList.remove('active');
        if (window.SimEngine) SimEngine.toggleStatView('box');
      });
    }

    if (advViewBtn) {
      advViewBtn.addEventListener('click', () => {
        advViewBtn.classList.add('active');
        if (boxViewBtn) boxViewBtn.classList.remove('active');
        if (window.SimEngine) SimEngine.toggleStatView('adv');
      });
    }

    // Stat Scope Toggles (Full Season vs Conference Only)
    const scopeFullBtn = document.getElementById('scopeFullBtn');
    const scopeConfBtn = document.getElementById('scopeConfBtn');

    if (scopeFullBtn) {
      scopeFullBtn.addEventListener('click', () => {
        scopeFullBtn.classList.add('active');
        if (scopeConfBtn) scopeConfBtn.classList.remove('active');
        if (window.SimEngine) SimEngine.setStatScope('full');
      });
    }

    if (scopeConfBtn) {
      scopeConfBtn.addEventListener('click', () => {
        scopeConfBtn.classList.add('active');
        if (scopeFullBtn) scopeFullBtn.classList.remove('active');
        if (window.SimEngine) SimEngine.setStatScope('conf');
      });
    }

    // Conference Filter Dropdown (Leaderboards)
    const confFilterSelect = document.getElementById('confFilterSelect') || document.getElementById('confFilter');
    if (confFilterSelect) {
      confFilterSelect.addEventListener('change', (e) => {
        if (window.SimEngine) SimEngine.setConfFilter(e.target.value);
      });
    }

    // Award Conference Selector
    const awardConfSelect = document.getElementById('awardConfSelect');
    if (awardConfSelect) {
      awardConfSelect.addEventListener('change', (e) => {
        if (window.SimEngine) SimEngine.renderConferenceAwards(e.target.value);
      });
    }
  },

  /**
   * Modals & Backdrop Click Handlers
   */
  setupModalListeners() {
    // Close buttons
    const closeBtns = document.querySelectorAll('.close-modal, .modal-close, .close-btn');
    closeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.SimEngine) {
          SimEngine.closeTeamModal();
          SimEngine.closePlayerModal();
        }
      });
    });

    // Close on overlay backdrop click
    const teamModal = document.getElementById('teamModal');
    if (teamModal) {
      teamModal.addEventListener('click', (e) => {
        if (e.target === teamModal) SimEngine.closeTeamModal();
      });
    }

    const playerModal = document.getElementById('playerModal');
    if (playerModal) {
      playerModal.addEventListener('click', (e) => {
        if (e.target === playerModal) SimEngine.closePlayerModal();
      });
    }

    // Close on ESC key press
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (window.SimEngine) {
          SimEngine.closeTeamModal();
          SimEngine.closePlayerModal();
        }
      }
    });
  },

  /**
   * Player & Team Live Search Filter
   */
  setupSearchInput() {
    const searchInput = document.getElementById('playerSearchInput') || document.getElementById('tableSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        const rows = document.querySelectorAll('#statsBody tr');

        rows.forEach(row => {
          const text = row.innerText.toLowerCase();
          row.style.display = text.includes(query) ? '' : 'none';
        });
      });
    }
  },

  /**
   * Save File JSON Export and Import
   */
  setupSaveManagement() {
    const exportBtn = document.getElementById('exportSaveBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', async () => {
        if (!window.SimEngine) return;
        const saveData = {
          year: SimEngine.state.year,
          week: SimEngine.state.week,
          phase: SimEngine.state.phase,
          teams: SimEngine.state.teams,
          activePlayers: SimEngine.state.activePlayers,
          recruits: SimEngine.state.recruits
        };

        const blob = new Blob([JSON.stringify(saveData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `NCAA_RP_Save_${SimEngine.state.year}_Wk${SimEngine.state.week}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    const importInput = document.getElementById('importSaveInput');
    if (importInput) {
      importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const importedData = JSON.parse(event.target.result);
            if (importedData.teams && importedData.activePlayers && window.SimEngine) {
              SimEngine.state.year = importedData.year || 2028;
              SimEngine.state.week = importedData.week || 0;
              SimEngine.state.phase = importedData.phase || 'Preseason';
              SimEngine.state.teams = importedData.teams;
              SimEngine.state.activePlayers = importedData.activePlayers;
              SimEngine.state.recruits = importedData.recruits || [];

              await SimEngine.saveStateToDB();
              SimEngine.syncUI();
              alert("Save file imported successfully!");
            }
          } catch (err) {
            alert("Invalid save file format.");
            console.error(err);
          }
        };
        reader.readAsText(file);
      });
    }
  }
};

// Initialize UI listeners when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
  UIController.init();
});
