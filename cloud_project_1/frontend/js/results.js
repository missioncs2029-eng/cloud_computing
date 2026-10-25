/**
 * Results Page Logic
 * Displays vote counts, charts, and winner in machine theme.
 * Uses Chart.js for visualization.
 */

// ===== Mode Detection =====
const IS_SERVER = window.location.protocol.startsWith('http');

// ===== Chart Colors (matching button colors) =====
const CHART_COLORS = [
  { bg: 'rgba(230, 57, 70, 0.8)', border: '#e63946' },    // Red
  { bg: 'rgba(46, 196, 105, 0.8)', border: '#2ec469' },    // Green
  { bg: 'rgba(59, 130, 246, 0.8)', border: '#3b82f6' },    // Blue
  { bg: 'rgba(245, 158, 11, 0.8)', border: '#f59e0b' }     // Orange
];

// ===== State =====
let barChart = null;
let pieChart = null;

// ===== DOM Elements =====
const resultsGrid = document.getElementById('results-grid');
const chartsContainer = document.getElementById('charts-container');
const noDataMsg = document.getElementById('no-data-msg');
const actionBtns = document.getElementById('action-btns');
const refreshBtn = document.getElementById('refresh-btn');
const resetBtn = document.getElementById('reset-btn');
const resetModal = document.getElementById('reset-modal');
const resetConfirmBtn = document.getElementById('reset-confirm-btn');
const resetCancelBtn = document.getElementById('reset-cancel-btn');

// ===== Initialize =====
document.addEventListener('DOMContentLoaded', () => {
  loadElectionTitle();
  loadResults();
  setupListeners();
});

// ===== Load Election Title =====
function loadElectionTitle() {
  const title = localStorage.getItem('electionTitle');
  const el = document.getElementById('election-title');
  if (title && el) {
    el.textContent = `⚡ ${title} — Results`;
  }
}

// ===== Load Results =====
async function loadResults() {
  try {
    let candidates;

    if (IS_SERVER) {
      const response = await fetch('/results');
      if (!response.ok) throw new Error('API Error');
      const data = await response.json();
      if (data.active && data.candidates && data.candidates.length > 0) {
        candidates = data.candidates;
        if (data.title) {
          const el = document.getElementById('election-title');
          if (el) el.textContent = `⚡ ${data.title} — Results`;
        }
        renderResults(candidates);
      } else {
        showNoData();
      }
      return;
    } else {
      const stored = localStorage.getItem('votingCandidates');
      candidates = stored ? JSON.parse(stored) : [];
    }

    if (candidates.length > 0) {
      renderResults(candidates);
    } else {
      showNoData();
    }
  } catch (error) {
    console.error('Load error:', error);
    showNoData();
  }
}

// ===== Render Results =====
function renderResults(candidates) {
  const totalVotes = candidates.reduce((sum, c) => sum + (c.votes || 0), 0);
  const maxVotes = Math.max(...candidates.map(c => c.votes || 0));
  const winners = candidates.filter(c => (c.votes || 0) === maxVotes && maxVotes > 0);

  resultsGrid.style.display = '';
  chartsContainer.style.display = '';
  actionBtns.style.display = '';
  noDataMsg.style.display = 'none';

  renderStatCards(candidates, totalVotes, winners);
  renderBarChart(candidates);
  renderPieChart(candidates, totalVotes);
}

// ===== Stat Cards =====
function renderStatCards(candidates, totalVotes, winners) {
  resultsGrid.innerHTML = '';

  // Total votes card
  const totalCard = document.createElement('div');
  totalCard.className = 'stat-card';
  totalCard.innerHTML = `
    <div class="stat-card__value">${String(totalVotes).padStart(4, '0')}</div>
    <div class="stat-card__label">Total Votes</div>
  `;
  resultsGrid.appendChild(totalCard);

  // Candidate cards
  candidates.forEach((candidate, index) => {
    const votes = candidate.votes || 0;
    const isWinner = winners.some(w => w.id === candidate.id) && totalVotes > 0;
    const percentage = totalVotes > 0 ? ((votes / totalVotes) * 100).toFixed(1) : '0.0';

    const card = document.createElement('div');
    card.className = `stat-card ${isWinner ? 'stat-card--winner' : ''}`;
    card.innerHTML = `
      <div class="stat-card__value">${String(votes).padStart(4, '0')}</div>
      <div class="stat-card__label">
        ${isWinner ? '👑 ' : ''}${escapeHtml(candidate.name)}
        <br><small style="color: var(--text-secondary); font-size: 0.65rem;">${percentage}%</small>
      </div>
    `;
    resultsGrid.appendChild(card);
  });
}

// ===== Bar Chart =====
function renderBarChart(candidates) {
  const ctx = document.getElementById('bar-chart').getContext('2d');
  if (barChart) barChart.destroy();

  barChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: candidates.map(c => c.name),
      datasets: [{
        label: 'Votes',
        data: candidates.map(c => c.votes || 0),
        backgroundColor: candidates.map((_, i) => CHART_COLORS[i % CHART_COLORS.length].bg),
        borderColor: candidates.map((_, i) => CHART_COLORS[i % CHART_COLORS.length].border),
        borderWidth: 2,
        borderRadius: 6,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0d1520',
          titleColor: '#e0e8f0',
          titleFont: { family: 'Chakra Petch', size: 11 },
          bodyColor: '#8899aa',
          bodyFont: { family: 'Space Mono' },
          borderColor: '#2a3a4e',
          borderWidth: 1,
          cornerRadius: 6,
          padding: 12
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            color: '#4a5568',
            stepSize: 1,
            font: { family: 'Space Mono', size: 11 }
          },
          grid: { color: 'rgba(42, 58, 78, 0.5)' }
        },
        x: {
          ticks: {
            color: '#8899aa',
            font: { family: 'Chakra Petch', size: 10, weight: 600 }
          },
          grid: { display: false }
        }
      },
      animation: { duration: 1000, easing: 'easeOutQuart' }
    }
  });
}

// ===== Pie Chart =====
function renderPieChart(candidates, totalVotes) {
  const ctx = document.getElementById('pie-chart').getContext('2d');
  if (pieChart) pieChart.destroy();

  pieChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: candidates.map(c => c.name),
      datasets: [{
        data: candidates.map(c => c.votes || 0),
        backgroundColor: candidates.map((_, i) => CHART_COLORS[i % CHART_COLORS.length].bg),
        borderColor: '#0d1520',
        borderWidth: 3,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '55%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#8899aa',
            padding: 14,
            usePointStyle: true,
            pointStyleWidth: 10,
            font: { family: 'Space Mono', size: 11 }
          }
        },
        tooltip: {
          backgroundColor: '#0d1520',
          titleColor: '#e0e8f0',
          bodyColor: '#8899aa',
          bodyFont: { family: 'Share Tech Mono' },
          borderColor: '#2a3a4e',
          borderWidth: 1,
          cornerRadius: 6,
          padding: 12,
          callbacks: {
            label: function(context) {
              const pct = totalVotes > 0 ? ((context.raw / totalVotes) * 100).toFixed(1) : '0.0';
              return ` ${context.label}: ${context.raw} votes (${pct}%)`;
            }
          }
        }
      },
      animation: { animateRotate: true, duration: 1200, easing: 'easeOutQuart' }
    }
  });
}

// ===== Listeners =====
function setupListeners() {
  refreshBtn.addEventListener('click', () => {
    refreshBtn.innerHTML = '⏳ Loading...';
    setTimeout(() => {
      loadResults();
      refreshBtn.innerHTML = '🔄 Refresh';
    }, 500);
  });

  resetBtn.addEventListener('click', () => {
    resetModal.classList.add('active');
  });

  resetCancelBtn.addEventListener('click', () => {
    resetModal.classList.remove('active');
  });

  resetModal.addEventListener('click', (e) => {
    if (e.target === resetModal) resetModal.classList.remove('active');
  });

  resetConfirmBtn.addEventListener('click', async () => {
    resetConfirmBtn.disabled = true;
    resetConfirmBtn.innerHTML = '⏳ Resetting...';

    try {
      if (IS_SERVER) {
        const response = await fetch('/reset', { method: 'POST' });
        if (!response.ok) throw new Error('API Error');
      }
      localStorage.removeItem('votingCandidates');
      localStorage.removeItem('votingActive');
      localStorage.removeItem('electionTitle');

      resetModal.classList.remove('active');
      resetConfirmBtn.disabled = false;
      resetConfirmBtn.innerHTML = '🗑️ Confirm Reset';
      window.location.href = 'index.html';

    } catch (error) {
      console.error('Reset error:', error);
      resetConfirmBtn.disabled = false;
      resetConfirmBtn.innerHTML = '🗑️ Confirm Reset';
      alert('Something went wrong. Please try again.');
    }
  });
}

// ===== Show No Data =====
function showNoData() {
  resultsGrid.style.display = 'none';
  chartsContainer.style.display = 'none';
  actionBtns.style.display = 'none';
  noDataMsg.style.display = '';
}

// ===== Utility =====
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
