// PawPrints — Firebase Auth

const firebaseConfig = {
    apiKey: "AIzaSyASJUZ4ycHsJKk0CGFWFPK9UfjdFFzpwi0",
    authDomain: "paw-prints-d6c63.firebaseapp.com",
    projectId: "paw-prints-d6c63",
    storageBucket: "paw-prints-d6c63.firebasestorage.app",
    messagingSenderId: "129751625227",
    appId: "1:129751625227:web:52e63d91aed1b15c36e10e",
    measurementId: "G-VX58MBYEQN"
};

// Init Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

let currentUser = null;

// Auth state listener
auth.onAuthStateChanged(user => {
    currentUser = user;
    updateAuthUI();
    if (user) {
        APP.email = user.email;
        loadUserProfile(user.uid);
    }
});

function updateAuthUI() {
    const signedIn = !!currentUser;
    const navAuth = document.getElementById('nav-auth');
    
    if (signedIn) {
        const photo = currentUser.photoURL || '';
        const name = currentUser.displayName || currentUser.email;
        navAuth.innerHTML = `
            <button class="nav-avatar" onclick="togglePortal()">
                ${photo ? `<img src="${photo}" alt="${name}">` : '👤'}
            </button>
        `;
    } else {
        navAuth.innerHTML = `
            <button class="btn-sign-in" onclick="showSignIn()">Sign In</button>
        `;
    }
}

// Sign in with Google
async function signInWithGoogle() {
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        await auth.signInWithPopup(provider);
        hideSignIn();
    } catch (err) {
        console.error('Google sign-in error:', err);
        alert('Sign-in failed. Please try again.');
    }
}

// Sign out
async function signOut() {
    await auth.signOut();
    currentUser = null;
    hidePortal();
}

// Show/hide sign-in modal
function showSignIn() {
    document.getElementById('auth-modal').classList.add('active');
}

function hideSignIn() {
    document.getElementById('auth-modal').classList.remove('active');
}

// Show/hide user portal
function togglePortal() {
    const portal = document.getElementById('screen-portal');
    if (portal.classList.contains('active')) {
        hidePortal();
    } else {
        showPortal();
    }
}

function showPortal() {
    if (!currentUser) return showSignIn();
    
    document.getElementById('portal-name').textContent = currentUser.displayName || '';
    document.getElementById('portal-email').textContent = currentUser.email || '';
    const avatar = document.getElementById('portal-avatar');
    if (currentUser.photoURL) {
        avatar.innerHTML = `<img src="${currentUser.photoURL}" alt="Avatar">`;
    } else {
        avatar.textContent = '👤';
    }
    
    // Load saved profile data
    const profile = getUserProfile();
    if (profile) {
        document.getElementById('profile-phone').value = profile.phone || '';
        document.getElementById('profile-address').value = profile.address || '';
        document.getElementById('profile-city').value = profile.city || '';
        document.getElementById('profile-state').value = profile.state || '';
        document.getElementById('profile-postcode').value = profile.postcode || '';
        document.getElementById('profile-country').value = profile.country || 'AU';
        document.getElementById('profile-marketing').checked = profile.marketingConsent || false;
    }
    
    document.getElementById('portal-credits').textContent = getUserCredits();
    renderSavedModels();
    renderOrderHistory();
    
    document.getElementById('screen-portal').classList.add('active');
}

function hidePortal() {
    document.getElementById('screen-portal').classList.remove('active');
}

// ─── Local Profile Storage (Firebase Firestore later) ───
function getUserProfile() {
    if (!currentUser) return null;
    const data = localStorage.getItem(`pp_profile_${currentUser.uid}`);
    return data ? JSON.parse(data) : null;
}

function saveUserProfile() {
    if (!currentUser) return;
    const profile = {
        phone: document.getElementById('profile-phone').value,
        address: document.getElementById('profile-address').value,
        city: document.getElementById('profile-city').value,
        state: document.getElementById('profile-state').value,
        postcode: document.getElementById('profile-postcode').value,
        country: document.getElementById('profile-country').value,
        marketingConsent: document.getElementById('profile-marketing').checked,
        updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(`pp_profile_${currentUser.uid}`, JSON.stringify(profile));
    
    // Also send to backend
    fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: currentUser.uid, email: currentUser.email, ...profile }),
    }).catch(console.error);
    
    alert('Profile saved ✅');
}

function getUserCredits() {
    if (!currentUser) return 0;
    const credits = localStorage.getItem(`pp_credits_${currentUser.uid}`);
    return credits ? parseInt(credits) : 3; // default 3 free
}

function setUserCredits(n) {
    if (!currentUser) return;
    localStorage.setItem(`pp_credits_${currentUser.uid}`, n.toString());
    document.getElementById('portal-credits').textContent = n;
}

// ─── Order History ───
function getOrderHistory() {
    if (!currentUser) return [];
    const data = localStorage.getItem(`pp_orders_${currentUser.uid}`);
    return data ? JSON.parse(data) : [];
}

function addOrder(order) {
    if (!currentUser) return;
    const orders = getOrderHistory();
    orders.unshift(order);
    localStorage.setItem(`pp_orders_${currentUser.uid}`, JSON.stringify(orders));
}

// ─── Saved Models (for repeat orders) ───
function getSavedModels() {
    if (!currentUser) return [];
    const data = localStorage.getItem(`pp_models_${currentUser.uid}`);
    return data ? JSON.parse(data) : [];
}

function saveModel(modelData) {
    if (!currentUser) return;
    const models = getSavedModels();
    models.unshift(modelData);
    localStorage.setItem(`pp_models_${currentUser.uid}`, JSON.stringify(models.slice(0, 20))); // keep 20 max
}

function renderSavedModels() {
    const models = getSavedModels();
    const container = document.getElementById('portal-models');
    if (!container) return;

    if (models.length === 0) {
        container.innerHTML = '<div class="empty-state">No saved pets yet — create your first keepsake!</div>';
        return;
    }

    container.innerHTML = models.map((m, i) => `
        <div class="saved-model-card">
            <img src="${m.sourceImage || m.processedImage || ''}" alt="Pet" class="saved-model-img">
            <div class="saved-model-info">
                <div class="saved-model-name">${m.petName || 'My Pet'} <span class="saved-model-type">${m.productType || 'statue'}</span></div>
                <div class="saved-model-date">${m.date || ''}</div>
            </div>
            <button class="btn btn-sm btn-primary" onclick="reorderModel(${i})">Reorder</button>
        </div>
    `).join('');
}

function reorderModel(idx) {
    const models = getSavedModels();
    const m = models[idx];
    if (!m) return;
    APP.modelUrl = m.modelUrl;
    APP.productType = m.productType || 'statue';
    APP.processedImage = m.processedImage;
    APP.processedPath = m.processedPath;
    hidePortal();
    initCustomise();
    showScreen('customise');
}

// ─── Social Sharing ───
function shareOrder(orderId, price) {
    const text = encodeURIComponent(`Just ordered a custom 3D-printed pet keepsake from PawPrints! 🐾✨ Check it out:`);
    const url = encodeURIComponent('https://douphraite.com');
    
    return {
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}&quote=${text}`,
        x: `https://twitter.com/intent/tweet?text=${text}&url=${url}`,
        instagram: null, // no direct share URL — prompt user to screenshot
        whatsapp: `https://wa.me/?text=${text}%20${url}`,
    };
}

function renderOrderHistory() {
    const orders = getOrderHistory();
    const container = document.getElementById('portal-orders');
    
    if (orders.length === 0) {
        container.innerHTML = '<div class="empty-state">No orders yet</div>';
        return;
    }
    
    container.innerHTML = orders.map(o => `
        <div class="order-row">
            <div>
                <div class="order-id">${o.id}</div>
                <div class="order-meta">${o.product} · ${o.material} · ${o.size}</div>
            </div>
            <div>
                <div class="order-price">${o.price}</div>
                <div class="order-status">${o.status}</div>
            </div>
        </div>
    `).join('');
}

// ─── Load user profile from backend ───
async function loadUserProfile(uid) {
    try {
        const res = await fetch(`/api/profile/${uid}`);
        if (res.ok) {
            const data = await res.json();
            if (data.profile) {
                localStorage.setItem(`pp_profile_${uid}`, JSON.stringify(data.profile));
            }
        }
    } catch (e) { /* ignore */ }
}

// ─── Check auth before processing ───
function requireAuth(callback) {
    if (currentUser) {
        callback();
    } else {
        showSignIn();
        // Set pending action
        window._pendingAuthAction = callback;
    }
}

// After sign-in, run pending action
auth.onAuthStateChanged(user => {
    if (user && window._pendingAuthAction) {
        const action = window._pendingAuthAction;
        window._pendingAuthAction = null;
        action();
    }
});
