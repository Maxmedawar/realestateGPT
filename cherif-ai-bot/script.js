// ---- Auth + API wiring for real backend ----

// Elements
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const mobileLoginBtn = document.getElementById('mobile-login-btn');
const mobileLogoutBtn = document.getElementById('mobile-logout-btn');
const userMenu = document.getElementById('user-menu');
const userGreeting = document.getElementById('user-greeting');
const planIndicator = document.getElementById('plan-indicator');
const chatSection = document.getElementById('chat-section');
const chatMessagesDiv = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const messagesRemainingSpan = document.getElementById('messages-remaining');
const planReminder = document.getElementById('chat-plan-reminder');
const upgradeOverlay = document.getElementById('upgrade-overlay');
const upgradeBtn = document.getElementById('upgrade-btn');
const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
const mobileNavDropdown = document.getElementById('mobile-nav-dropdown');

// Local state
let currentUser = null;
let userPlan = 'free';
let remaining = 3;

// Backend base URL (adjust if needed)
const API_BASE = "/api";

// ------ Auth flows ------
async function login() {
  const provider = new firebase.auth.GoogleAuthProvider();
  await firebase.auth().signInWithPopup(provider);
}

async function logout() {
  await firebase.auth().signOut();
}

// Observe auth state
firebase.auth().onAuthStateChanged(async (user) => {
  currentUser = user;
  if (user) {
    // greet and fetch session from backend
    userGreeting.textContent = `Hello, ${user.displayName || 'User'}`;
    await refreshSession();
    showChat();
  } else {
    hideChat();
  }
  updateAuthButtons();
});

function updateAuthButtons() {
  if (currentUser) {
    userMenu.style.display = 'flex';
    if (loginBtn) loginBtn.style.display = 'none';
    if (mobileLoginBtn) mobileLoginBtn.style.display = 'none';
    if (mobileLogoutBtn) mobileLogoutBtn.style.display = 'inline-block';
  } else {
    userMenu.style.display = 'none';
    if (loginBtn) loginBtn.style.display = 'inline-block';
    if (mobileLoginBtn) mobileLoginBtn.style.display = 'inline-block';
    if (mobileLogoutBtn) mobileLogoutBtn.style.display = 'none';
  }
}

// ------ Session & Chat helpers ------
async function authHeader() {
  const token = await firebase.auth().currentUser.getIdToken(/* forceRefresh */ true);
  return { Authorization: `Bearer ${token}` };
}

async function refreshSession() {
  try {
    const headers = await authHeader();
    const res = await fetch(`${API_BASE}/session`, { headers });
    if (!res.ok) throw new Error(`Session error: ${res.status}`);
    const data = await res.json(); // { uid, plan, remaining }
    userPlan = (data.plan || 'free').toLowerCase();
    remaining = data.remaining == null ? null : data.remaining;
    planIndicator.textContent = `Plan: ${userPlan.charAt(0).toUpperCase() + userPlan.slice(1)}`;
    if (userPlan === 'pro') {
      planReminder.textContent = "Pro Plan: Unlimited messages";
    } else {
      planReminder.textContent = `Free Plan: ${remaining} messages left this week`;
      messagesRemainingSpan.textContent = remaining;
    }
  } catch (e) {
    console.error(e);
  }
}

function showChat() {
  chatSection.style.display = 'block';
  document.getElementById('hero').style.display = 'none';
  document.getElementById('features').style.display = 'none';
  document.querySelector('.examples-section').style.display = 'none';
  document.querySelector('.testimonials-section').style.display = 'none';
  document.getElementById('pricing').style.display = 'none';
  document.getElementById('faq').style.display = 'none';
  window.scrollTo({ top: chatSection.offsetTop, behavior: 'smooth' });
}

function hideChat() {
  chatSection.style.display = 'none';
  document.getElementById('hero').style.display = 'block';
  document.getElementById('features').style.display = 'block';
  document.querySelector('.examples-section').style.display = 'block';
  document.querySelector('.testimonials-section').style.display = 'block';
  document.getElementById('pricing').style.display = 'block';
  document.getElementById('faq').style.display = 'block';
}

// ------ Chat UI ------
function appendMessage(content, sender) {
  const msgDiv = document.createElement('div');
  msgDiv.classList.add('message', sender === 'bot' ? 'bot-message' : 'user-message');
  const inner = document.createElement('div');
  inner.classList.add('message-content');
  inner.textContent = content;
  msgDiv.appendChild(inner);
  chatMessagesDiv.appendChild(msgDiv);
  chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
}

function showUpgradePrompt() {
  upgradeOverlay.style.display = 'flex';
}
function dismissUpgrade() {
  upgradeOverlay.style.display = 'none';
}
function startChat() {
  if (!currentUser) login();
  else window.scrollTo({ top: chatSection.offsetTop, behavior: 'smooth' });
}
window.startChat = startChat; // used by the hero button

// ------ Send message -> backend ------
async function sendMessage() {
  const text = (chatInput.value || '').trim();
  if (!text) return;
  if (!currentUser) {
    await login();
    return;
  }
  // If free and at limit: overlay
  if (userPlan === 'free' && typeof remaining === 'number' && remaining <= 0) {
    showUpgradePrompt();
    return;
  }

  appendMessage(text, 'user');
  chatInput.value = '';

  // optimistic decrement
  if (userPlan === 'free' && typeof remaining === 'number') {
    remaining = Math.max(0, remaining - 1);
    messagesRemainingSpan.textContent = remaining;
    planReminder.textContent = `Free Plan: ${remaining} messages left this week`;
  }

  try {
    const headers = {
      ...(await authHeader()),
      'Content-Type': 'application/json'
    };
    const res = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: text })
    });

    if (res.status === 402) {
      // limit reached according to server—show paywall
      showUpgradePrompt();
      return;
    }
    if (!res.ok) throw new Error(`Chat error: ${res.status}`);

    const data = await res.json(); // { reply, plan, remaining }
    appendMessage(data.reply, 'bot');

    // authoritative remaining from server
    userPlan = (data.plan || userPlan).toLowerCase();
    if (data.remaining === null || data.remaining === undefined) {
      planReminder.textContent = "Pro Plan: Unlimited messages";
    } else {
      remaining = data.remaining;
      messagesRemainingSpan.textContent = remaining;
      planReminder.textContent = `Free Plan: ${remaining} messages left this week`;
      if (remaining <= 0) showUpgradePrompt();
    }
  } catch (e) {
    console.error(e);
    appendMessage("🤖 Sorry, I had a problem answering. Try again.", 'bot');
  }
}

// ------ Upgrade button (Stripe) ------
function openUpgrade() {
  // If you use a hosted Stripe Checkout link, redirect here:
  // window.location.href = "https://buy.stripe.com/your_live_checkout_link";
  // Or call a backend endpoint to create a checkout session, then redirect to session.url.
  alert("Redirecting to checkout… (plug your Stripe link here)");
}
function bindEvents() {
  loginBtn?.addEventListener('click', login);
  mobileLoginBtn?.addEventListener('click', login);
  logoutBtn?.addEventListener('click', logout);
  mobileLogoutBtn?.addEventListener('click', logout);
  sendBtn?.addEventListener('click', sendMessage);
  chatInput?.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

  // FAQ accordions
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const answerDiv = btn.nextElementSibling;
      const toggleSymbol = btn.querySelector('.faq-toggle');
      const open = answerDiv.style.display === 'block';
      answerDiv.style.display = open ? 'none' : 'block';
      toggleSymbol.textContent = open ? '+' : '–';
    });
  });

  // Mobile menu
  if (mobileMenuToggle) {
    mobileMenuToggle.addEventListener('click', () => {
      mobileNavDropdown.style.display = (mobileNavDropdown.style.display === 'flex') ? 'none' : 'flex';
    });
  }

  // expose upgrade actions
  window.openUpgrade = openUpgrade;
  window.dismissUpgrade = dismissUpgrade;
}
bindEvents();
