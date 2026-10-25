/**
 * Voting Page Logic
 * Displays candidate rows with 3D physical dome buttons.
 * Uses localStorage for Day 1, will switch to API on Day 3.
 */

// ===== Mode Detection =====
const IS_SERVER = window.location.protocol.startsWith('http');

// ===== Button Color Variants =====
const BTN_COLORS = ['red', 'green', 'blue', 'orange'];

// ===== State =====
let candidates = [];
let selectedCandidate = null;

// ===== DOM Elements =====
const voteArea = document.getElementById('vote-area');
const noSetupMsg = document.getElementById('no-setup-msg');
const successScreen = document.getElementById('success-screen');
const confirmModal = document.getElementById('confirm-modal');
const confirmName = document.getElementById('confirm-name');
const confirmYesBtn = document.getElementById('confirm-yes-btn');
const confirmNoBtn = document.getElementById('confirm-no-btn');
const navLinks = document.getElementById('nav-links');
const machineFooter = document.getElementById('machine-footer');
const totalVotesDisplay = document.getElementById('total-votes');
const digitalDisplay = document.getElementById('digital-display');
const electionTitleEl = document.getElementById('election-title');

// ===== Initialize =====
document.addEventListener('DOMContentLoaded', () => {
  loadElectionTitle();
  loadCandidates();
  setupModalListeners();
});

// ===== Load Election Title =====
function loadElectionTitle() {
  const title = localStorage.getItem('electionTitle');
  if (title && electionTitleEl) {
    electionTitleEl.textContent = `⚡ ${title}`;
  } else if (electionTitleEl) {
    electionTitleEl.textContent = '⚡ Cast your vote';
  }
}

// ===== Load Candidates =====
async function loadCandidates() {
  try {
    if (IS_SERVER) {
      const response = await fetch('/candidates');
      if (!response.ok) throw new Error('API Error');
      const data = await response.json();
      if (data.active && data.candidates && data.candidates.length > 0) {
        candidates = data.candidates;
        if (data.title && electionTitleEl) {
          electionTitleEl.textContent = `⚡ ${data.title}`;
        }
        renderCandidateRows();
        if (typeof data.totalVotes === 'number') {
          updateTotalVotes(data.totalVotes);
        } else {
          updateTotalVotes();
        }
        return;
      } else {
        showNoSetup();
        return;
      }
    } else {
      const isActive = localStorage.getItem('votingActive');
      if (isActive !== 'true') {
        showNoSetup();
        return;
      }
      const stored = localStorage.getItem('votingCandidates');
      if (stored) {
        candidates = JSON.parse(stored);
      }
    }

    if (candidates.length > 0) {
      renderCandidateRows();
      updateTotalVotes();
    } else {
      showNoSetup();
    }
  } catch (error) {
    console.error('Load error:', error);
    showNoSetup();
  }
}

// ===== Render Candidate Rows with 3D Buttons =====
function renderCandidateRows() {
  voteArea.innerHTML = '';

  candidates.forEach((candidate, index) => {
    const color = BTN_COLORS[index % BTN_COLORS.length];

    const row = document.createElement('div');
    row.className = 'candidate-row';
    row.innerHTML = `
      <span class="candidate-row__number">#${index + 1}</span>
      <span class="candidate-row__name">${escapeHtml(candidate.name)}</span>
      <button class="vote-btn-3d vote-btn-3d--${color}" 
              id="vote-btn-${candidate.id}" 
              data-id="${candidate.id}" 
              data-name="${escapeHtml(candidate.name)}"
              title="Vote for ${escapeHtml(candidate.name)}">
        <div class="vote-btn-3d-ring"></div>
        <span>Vote</span>
      </button>
    `;
    voteArea.appendChild(row);
  });

  // Add click listeners to 3D buttons
  document.querySelectorAll('.vote-btn-3d').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedCandidate = {
        id: btn.dataset.id,
        name: btn.dataset.name
      };
      showConfirmation();
    });
  });
}

// ===== Update Total Votes Counter =====
function updateTotalVotes(explicitTotal) {
  let total;
  if (typeof explicitTotal === 'number') {
    total = explicitTotal;
  } else {
    total = candidates.reduce((sum, c) => sum + (Number(c.votes) || 0), 0);
  }
  totalVotesDisplay.textContent = String(total).padStart(4, '0');
}

// ===== Confirmation Modal =====
function showConfirmation() {
  confirmName.textContent = selectedCandidate.name;
  confirmModal.classList.add('active');
}

function hideConfirmation() {
  confirmModal.classList.remove('active');
  selectedCandidate = null;
}

// ===== Audio Feedback (Simulates Physical EVM Beep) =====
function playVoteBeep() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(820, ctx.currentTime);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (err) {
    // Audio context may be restricted before user interaction
  }
}

function setupModalListeners() {
  confirmNoBtn.addEventListener('click', hideConfirmation);
  confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) hideConfirmation();
  });

  confirmYesBtn.addEventListener('click', castVote);
}

// ===== Cast Vote =====
async function castVote() {
  if (!selectedCandidate) return;

  confirmYesBtn.disabled = true;
  confirmYesBtn.innerHTML = '⏳ Recording...';

  try {
    if (IS_SERVER) {
      const response = await fetch('/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId: selectedCandidate.id })
      });
      if (!response.ok) throw new Error('API Error');
    } else {
      const stored = localStorage.getItem('votingCandidates');
      if (stored) {
        const data = JSON.parse(stored);
        const candidate = data.find(c => c.id == selectedCandidate.id);
        if (candidate) {
          candidate.votes = (candidate.votes || 0) + 1;
          localStorage.setItem('votingCandidates', JSON.stringify(data));
        }
      }
    }

    // Success
    hideConfirmation();
    confirmYesBtn.disabled = false;
    confirmYesBtn.innerHTML = '✅ Confirm';

    // Play physical EVM beep sound
    playVoteBeep();

    // Show success screen
    voteArea.style.display = 'none';
    digitalDisplay.style.display = 'none';
    successScreen.classList.add('active');

    // Auto-countdown to reset for next voter
    let remaining = 2;
    const countdownEl = document.getElementById('countdown-timer');
    if (countdownEl) countdownEl.textContent = remaining;

    const timer = setInterval(() => {
      remaining--;
      if (countdownEl) countdownEl.textContent = remaining;
      if (remaining <= 0) {
        clearInterval(timer);
        // Automatically return to fresh voting screen
        successScreen.classList.remove('active');
        voteArea.style.display = '';
        digitalDisplay.style.display = '';
        loadCandidates();
      }
    }, 1000);

  } catch (error) {
    console.error('Vote error:', error);
    confirmYesBtn.disabled = false;
    confirmYesBtn.innerHTML = '✅ Confirm';
    alert('Something went wrong. Please try again.');
  }
}

// ===== Show No Setup =====
function showNoSetup() {
  voteArea.style.display = 'none';
  navLinks.style.display = 'none';
  machineFooter.style.display = 'none';
  digitalDisplay.style.display = 'none';
  noSetupMsg.style.display = '';
}

// ===== Utility =====
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
