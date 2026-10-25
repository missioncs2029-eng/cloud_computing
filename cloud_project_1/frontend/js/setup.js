/**
 * Setup Page Logic
 * Handles election title, candidate count selection, and name input.
 * Blocks re-initialization if voting is already active.
 */

// ===== Mode Detection =====
// Automatically uses API when served over HTTP (EC2/server), falls back to localStorage for offline file preview
const IS_SERVER = window.location.protocol.startsWith('http');

// ===== State =====
let candidateCount = 4;

// ===== DOM Elements =====
const countSelector = document.getElementById('count-selector');
const candidatesForm = document.getElementById('candidates-form');
const startVotingBtn = document.getElementById('start-voting-btn');
const setupForm = document.getElementById('setup-form');
const alreadyActiveMsg = document.getElementById('already-active-msg');
const activeElectionName = document.getElementById('active-election-name');
const forceResetBtn = document.getElementById('force-reset-btn');
const electionTitleInput = document.getElementById('election-title-input');
const resetModal = document.getElementById('reset-modal');
const resetConfirmBtn = document.getElementById('reset-confirm-btn');
const resetCancelBtn = document.getElementById('reset-cancel-btn');

// ===== Initialize =====
document.addEventListener('DOMContentLoaded', () => {
  checkIfVotingActive();
  renderCandidateInputs();
  setupCountSelector();
  setupStartButton();
  setupForceReset();
});

// ===== Check if voting is already active =====
async function checkIfVotingActive() {
  if (IS_SERVER) {
    try {
      const response = await fetch('/api/status');
      if (response.ok) {
        const data = await response.json();
        if (data.active) {
          setupForm.style.display = 'none';
          alreadyActiveMsg.style.display = '';
          activeElectionName.textContent = data.title ? `"${data.title}"` : 'Active Election';
          return;
        }
      }
    } catch (e) {
      console.warn('API status check fallback to local storage:', e);
    }
  }

  const isActive = localStorage.getItem('votingActive');
  const storedTitle = localStorage.getItem('electionTitle');

  if (isActive === 'true') {
    // Election is already running — block the setup form
    setupForm.style.display = 'none';
    alreadyActiveMsg.style.display = '';
    if (storedTitle) {
      activeElectionName.textContent = `"${storedTitle}"`;
    } else {
      activeElectionName.textContent = 'Untitled Election';
    }
  } else {
    // No active election — show the setup form
    setupForm.style.display = '';
    alreadyActiveMsg.style.display = 'none';
  }
}

// ===== Force Reset Modal =====
function setupForceReset() {
  // Open modal on click
  forceResetBtn.addEventListener('click', () => {
    resetModal.classList.add('active');
  });

  // Cancel reset
  resetCancelBtn.addEventListener('click', () => {
    resetModal.classList.remove('active');
  });

  // Click outside to cancel
  resetModal.addEventListener('click', (e) => {
    if (e.target === resetModal) resetModal.classList.remove('active');
  });

  // Confirm reset
  resetConfirmBtn.addEventListener('click', async () => {
    if (IS_SERVER) {
      try {
        await fetch('/reset', { method: 'POST' });
      } catch (e) {
        console.error('Server reset failed:', e);
      }
    }
    localStorage.removeItem('votingCandidates');
    localStorage.removeItem('votingActive');
    localStorage.removeItem('electionTitle');
    if (electionTitleInput) electionTitleInput.value = '';
    renderCandidateInputs();

    // Close modal & restore setup form
    resetModal.classList.remove('active');
    setupForm.style.display = '';
    alreadyActiveMsg.style.display = 'none';
  });
}

// ===== Count Selector =====
function setupCountSelector() {
  countSelector.addEventListener('click', (e) => {
    const btn = e.target.closest('.count-btn');
    if (!btn) return;

    // Update active state
    document.querySelectorAll('.count-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Update count and re-render inputs
    candidateCount = parseInt(btn.dataset.count);
    renderCandidateInputs();
  });
}

// ===== Render Candidate Inputs =====
function renderCandidateInputs() {
  candidatesForm.innerHTML = '';

  for (let i = 1; i <= candidateCount; i++) {
    const group = document.createElement('div');
    group.className = 'candidate-input-group';
    group.innerHTML = `
      <span class="candidate-number">${i}</span>
      <input 
        type="text" 
        class="candidate-input" 
        id="candidate-input-${i}"
        placeholder="Enter candidate ${i} name"
        maxlength="50"
        autocomplete="off"
      >
    `;
    candidatesForm.appendChild(group);
  }

  // Focus first input
  setTimeout(() => {
    const firstInput = document.getElementById('candidate-input-1');
    if (firstInput) firstInput.focus();
  }, 300);
}

// ===== Start Voting =====
function setupStartButton() {
  startVotingBtn.addEventListener('click', async () => {
    // Validate election title
    const electionTitle = electionTitleInput.value.trim();
    if (!electionTitle) {
      electionTitleInput.style.borderColor = '#f43f5e';
      electionTitleInput.setAttribute('placeholder', '⚠️ Please enter an election title');
      setTimeout(() => {
        electionTitleInput.style.borderColor = '';
        electionTitleInput.setAttribute('placeholder', 'e.g. Batch Representative, Club President');
      }, 2000);
      electionTitleInput.focus();
      return;
    }

    // Gather candidate names
    const candidates = [];
    let allFilled = true;

    for (let i = 1; i <= candidateCount; i++) {
      const input = document.getElementById(`candidate-input-${i}`);
      const name = input.value.trim();

      if (!name) {
        allFilled = false;
        input.style.borderColor = '#f43f5e';
        input.setAttribute('placeholder', '⚠️ Please enter a name');
        setTimeout(() => {
          input.style.borderColor = '';
          input.setAttribute('placeholder', `Enter candidate ${i} name`);
        }, 2000);
      } else {
        candidates.push({ id: i, name: name, votes: 0 });
      }
    }

    if (!allFilled) return;

    // Check for duplicate names
    const names = candidates.map(c => c.name.toLowerCase());
    const hasDuplicates = new Set(names).size !== names.length;
    if (hasDuplicates) {
      alert('Each candidate must have a unique name!');
      return;
    }

    // Save to localStorage (will switch to API call on Day 3)
    startVotingBtn.disabled = true;
    startVotingBtn.innerHTML = '⏳ Setting up...';

    try {
      if (IS_SERVER) {
        const response = await fetch('/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: electionTitle, candidates })
        });
        if (!response.ok) throw new Error('API Error');
      } else {
        // Local storage fallback for offline file preview
        localStorage.setItem('votingCandidates', JSON.stringify(candidates));
        localStorage.setItem('votingActive', 'true');
        localStorage.setItem('electionTitle', electionTitle);
      }

      // Success — redirect to voting page
      startVotingBtn.innerHTML = '✅ Ready!';
      setTimeout(() => {
        window.location.href = 'vote.html';
      }, 500);

    } catch (error) {
      console.error('Setup error:', error);
      startVotingBtn.disabled = false;
      startVotingBtn.innerHTML = '▶ Initialize Voting';
      alert('Something went wrong. Please try again.');
    }
  });
}
