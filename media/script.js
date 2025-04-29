// Configuration
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby4rveXek9uGiosaCqqDi2DkuyvnmlM_OFiQ-JpHHqwTR3zw38xjBpIoTDFT5eqrEE_qQ/exec';
let userData = null;
let apiData = null;
let favorites = JSON.parse(localStorage.getItem('favorites')) || [];
let recentlyViewed = JSON.parse(localStorage.getItem('recentlyViewed')) || [];
let jsonpCallbackCounter = 0;

// JSONP request helper
function jsonpRequest(params) {
    return new Promise((resolve, reject) => {
        const callbackName = `jsonpCallback_${jsonpCallbackCounter++}`;
        window[callbackName] = function(data) {
            delete window[callbackName];
            document.body.removeChild(script);
            resolve(data);
        };

        const query = Object.keys(params)
            .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
            .join('&');
        const url = `${SCRIPT_URL}?callback=${callbackName}&${query}`;

        const script = document.createElement('script');
        script.src = url;
        script.onerror = () => {
            delete window[callbackName];
            document.body.removeChild(script);
            reject(new Error('Błąd połączenia z serwerem'));
        };
        document.body.appendChild(script);
    });
}

// Sanitize input to prevent XSS
function sanitizeInput(input) {
    const div = document.createElement('div');
    div.textContent = input;
    return div.innerHTML;
}

// Show toast notification
function showToast(message, isError = true) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.style.background = isError ? '#f40612' : '#28a745';
    toast.classList.add('active');
    setTimeout(() => {
        toast.classList.remove('active');
    }, 3000);
}

// Generate avatar
function generateAvatar() {
    const avatar = document.getElementById('avatar');
    if (!avatar || !userData) return;
    avatar.style.backgroundColor = userData.avatarColor;
    avatar.textContent = userData.username.charAt(0).toUpperCase();
}

// Toggle dropdown menu
function toggleDropdown() {
    const dropdown = document.getElementById('dropdown');
    dropdown.classList.toggle('active');
}

// Close modal
function closeModal(modalId) {
    const modal = document.getElementById('modalId');
    if (modal) modal.style.display = 'none';
    const mediaPlayer = document.getElementById('mediaPlayer');
    if (mediaPlayer) mediaPlayer.innerHTML = '';
}

// Render carousel item
function renderCarouselItem(item, section) {
    const div = document.createElement('div');
    div.className = 'item';
    if (item.isPremium && !userData.premium) {
        div.className += ' premium-placeholder';
        div.innerHTML = `<div class="premium-lock">Treść Premium</div>`;
    } else {
        const isFavorite = favorites.some(fav => fav.id === item.id && fav.category === section);
        div.innerHTML = `
            <img src="${item.imageUrl}" alt="${item.title}">
            <p>${item.title}</p>
            <div class="tooltip">${item.description}</div>
            <button class="favorite ${isFavorite ? 'favorited' : ''}" aria-label="${isFavorite ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}">
                ♥
            </button>
            ${section === 'live' && item.liveStatus ? `<span class="live-badge">${item.liveStatus}</span>` : ''}
        `;
        div.querySelector('.favorite').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(item, section);
        });
        div.addEventListener('click', () => playMedia(item, section));
    }
    return div;
}

// Render carousel
function renderCarousel(section, items, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    items.forEach(item => {
        container.appendChild(renderCarouselItem(item, section));
    });

    const prevBtn = container.parentElement.querySelector('.carousel-prev');
    const nextBtn = container.parentElement.querySelector('.carousel-next');
    
    const updateButtons = () => {
        prevBtn.disabled = container.scrollLeft <= 0;
        nextBtn.disabled = container.scrollLeft + container.clientWidth >= container.scrollWidth;
    };

    prevBtn.addEventListener('click', () => {
        container.scrollBy({ left: -220, behavior: 'smooth' });
        setTimeout(updateButtons, 300);
    });

    nextBtn.addEventListener('click', () => {
        container.scrollBy({ left: 220, behavior: 'smooth' });
        setTimeout(updateButtons, 300);
    });

    container.addEventListener('scroll', updateButtons);
    updateButtons();
}

// Render content
function renderContent() {
    const favoritesOnly = document.getElementById('favoritesOnly')?.checked;
    const sections = {
        live: 'liveContent',
        films: 'moviesContent',
        music: 'musicContent',
        books: 'booksContent'
    };

    Object.keys(sections).forEach(section => {
        let items = apiData[section] || [];
        if (favoritesOnly) {
            items = items.filter(item => favorites.some(fav => fav.id === item.id && fav.category === section));
        }
        renderCarousel(section, items, sections[section]);
    });

    // Recently viewed
    const recentItems = recentlyViewed.map(view => ({
        ...view,
        isPremium: view.isPremium && !userData.premium
    }));
    renderCarousel('recentlyViewed', recentItems, 'recentlyViewedContent');
}

// Toggle favorite
function toggleFavorite(item, section) {
    const index = favorites.findIndex(fav => fav.id === item.id && fav.category === section);
    if (index === -1) {
        favorites.push({ ...item, category: section });
        showToast('Dodano do ulubionych', false);
    } else {
        favorites.splice(index, 1);
        showToast('Usunięto z ulubionych', false);
    }
    localStorage.setItem('favorites', JSON.stringify(favorites));
    renderContent();
}

// Play media
function playMedia(item, section) {
    if (item.isPremium && !userData.premium) {
        showToast('Treść dostępna tylko dla użytkowników Premium');
        return;
    }

    // Add to recently viewed
    recentlyViewed = recentlyViewed.filter(view => view.id !== item.id || view.category !== section);
    recentlyViewed.unshift({ ...item, category: section });
    if (recentlyViewed.length > 5) recentlyViewed.pop();
    localStorage.setItem('recentlyViewed', JSON.stringify(recentlyViewed));

    // Handle books: redirect to URL
    if (section === 'books') {
        window.location.href = item.url;
        return;
    }

    // Handle other categories: show modal with embedded video
    const modal = document.getElementById('mediaModal');
    const title = document.getElementById('modalTitle');
    const mediaPlayer = document.getElementById('mediaPlayer');
    const pdfViewerContainer = document.getElementById('pdfViewerContainer');

    title.textContent = item.title;
    mediaPlayer.innerHTML = '';
    pdfViewerContainer.style.display = 'none';

    if (item.url) {
        if (item.url.match(/\.(mp4|webm)$/)) {
            mediaPlayer.innerHTML = `<video controls><source src="${item.url}" type="video/${item.url.split('.').pop()}"></video>`;
        } else {
            // Assume URL is a YouTube embed or similar iframe-compatible URL
            mediaPlayer.innerHTML = `<iframe src="${item.url}" frameborder="0" allowfullscreen></iframe>`;
        }
    } else {
        showToast('Brak dostępnego źródła multimediów');
        return;
    }

    modal.style.display = 'flex';
    renderContent();
}

// Search content
function searchContent(query) {
    const searchResults = document.getElementById('searchResults');
    searchResults.innerHTML = '';
    if (!query) return;

    const results = [];
    Object.keys(apiData).forEach(section => {
        apiData[section].forEach(item => {
            if (item.title.toLowerCase().includes(query.toLowerCase()) && !(item.isPremium && !userData.premium)) {
                results.push({ ...item, category: section });
            }
        });
    });

    if (results.length === 0) {
        searchResults.textContent = 'Brak wyników';
        return;
    }

    results.forEach(result => {
        const div = document.createElement('div');
        div.textContent = `${result.title} (${result.category})`;
        div.style.cursor = 'pointer';
        div.addEventListener('click', () => playMedia(result, result.category));
        searchResults.appendChild(div);
    });
}

// Login
async function login(e) {
    e.preventDefault();
    const username = sanitizeInput(document.getElementById('username').value.trim());
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('errorMessage');
    const loginButton = document.getElementById('loginButton');

    if (!username || !password) {
        errorMessage.textContent = 'Wypełnij wszystkie pola';
        errorMessage.style.display = 'block';
        return;
    }

    loginButton.disabled = true;
    loginButton.classList.add('loading');

    const params = { endpoint: 'login', username, password };
    try {
        const result = await jsonpRequest(params);

        loginButton.disabled = false;
        loginButton.classList.remove('loading');

        if (result.success && result.access) {
            userData = { premium: result.premium, access: true, username, avatarColor: result.avatarColor };
            generateAvatar();
            document.getElementById('loginContainer').style.display = 'none';
            document.getElementById('contentContainer').style.display = 'block';
            document.getElementById('contentContainer').classList.add('active');
            document.getElementById('avatar').style.display = 'flex';
            errorMessage.style.display = 'none';
            loadContent();
        } else {
            errorMessage.textContent = result.access === false ? 'Konto zablokowane' : result.message || 'Nieprawidłowy login lub hasło';
            errorMessage.style.display = 'block';
            showToast(result.access === false ? 'Twoje konto jest zablokowane.' : result.message || 'Nieprawidłowy login lub hasło.');
        }
    } catch (error) {
        loginButton.disabled = false;
        loginButton.classList.remove('loading');
        errorMessage.textContent = 'Błąd połączenia';
        errorMessage.style.display = 'block';
        showToast('Nie można zalogować. Spróbuj ponownie.');
        console.error('Login error:', error.message);
    }
}

// Load content
async function loadContent() {
    const contentLoading = document.getElementById('contentLoading');
    const progressBar = document.getElementById('progressBar');
    contentLoading.classList.add('active');

    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += 10;
        progressBar.style.width = `${Math.min(progress, 90)}%`;
    }, 500);

    const cachedData = localStorage.getItem('contentCache');
    const cacheTimestamp = localStorage.getItem('contentCacheTimestamp');
    const cacheAge = cacheTimestamp ? (Date.now() - parseInt(cacheTimestamp)) / 1000 / 60 / 60 : Infinity;

    if (cachedData && cacheAge < 1) {
        apiData = JSON.parse(cachedData);
        renderContent();
        clearInterval(progressInterval);
        progressBar.style.width = '100%';
        setTimeout(() => contentLoading.classList.remove('active'), 300);
        return;
    }

    try {
        const result = await jsonpRequest({ endpoint: 'content', premium: userData.premium });

        clearInterval(progressInterval);
        progressBar.style.width = '100%';
        setTimeout(() => contentLoading.classList.remove('active'), 300);

        if (result.success && result.data) {
            apiData = result.data;
            if (!userData.premium) {
                Object.keys(apiData).forEach(section => {
                    apiData[section] = apiData[section].map(item =>
                        item.isPremium ? { isPremium: true, title: '', imageUrl: '', url: '', description: '', id: item.id, category: item.category } : item
                    );
                });
            }
            localStorage.setItem('contentCache', JSON.stringify(apiData));
            localStorage.setItem('contentCacheTimestamp', Date.now().toString());
            renderContent();
        } else {
            showToast('Nie udało się pobrać zawartości: ' + (result.message || 'Błąd serwera'));
            if (cachedData) {
                apiData = JSON.parse(cachedData);
                renderContent();
                showToast('Użyto zbuforowanych danych.', false);
            } else {
                apiData = { films: [], music: [], books: [], live: [] };
                renderContent();
                showToast('Brak danych. Wyświetlono pustą zawartość.');
            }
        }
    } catch (error) {
        clearInterval(progressInterval);
        progressBar.style.width = '100%';
        setTimeout(() => contentLoading.classList.remove('active'), 300);
        console.error('Błąd ładowania treści:', error);
        if (cachedData) {
            apiData = JSON.parse(cachedData);
            renderContent();
            showToast('Brak połączenia. Użyto zbuforowanych danych.', false);
        } else {
            apiData = { films: [], music: [], books: [], live: [] };
            renderContent();
            showToast('Brak połączenia. Wyświetlono pustą zawartość.');
        }
    }
}

// Save profile
async function saveProfile(e) {
    e.preventDefault();
    const avatarColor = document.getElementById('profileAvatar').value;
    try {
        const result = await jsonpRequest({ endpoint: 'updateProfile', username: userData.username, avatarColor });
        if (result.success) {
            userData.avatarColor = avatarColor;
            generateAvatar();
            showToast('Profil zaktualizowany pomyślnie', false);
            closeModal('profileModal');
        } else {
            showToast('Nie udało się zaktualizować profilu: ' + (result.message || 'Błąd serwera'));
        }
    } catch (error) {
        showToast('Błąd połączenia. Spróbuj ponownie.');
        console.error('Błąd zapisu profilu:', error);
    }
}

// Settings and themes
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    document.querySelectorAll('.theme-preview').forEach(preview => {
        preview.classList.toggle('selected', preview.dataset.theme === theme);
    });
}

function applyView(compact) {
    document.documentElement.setAttribute('data-view', compact ? 'compact' : 'normal');
    localStorage.setItem('view', compact ? 'compact' : 'normal');
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Apply saved theme and view
    const savedTheme = localStorage.getItem('theme') || 'dark';
    const savedView = localStorage.getItem('view') === 'compact';
    applyTheme(savedTheme);
    document.getElementById('compactView').checked = savedView;
    applyView(savedView);

    // Login form
    document.getElementById('loginButton').addEventListener('click', login);

    // Avatar and dropdown
    const avatar = document.getElementById('avatar');
    avatar.addEventListener('click', toggleDropdown);
    avatar.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') toggleDropdown();
    });

    // Dropdown buttons
    document.querySelectorAll('.dropdown button').forEach(button => {
        button.addEventListener('click', () => {
            const action = button.textContent;
            toggleDropdown();
            if (action === 'Profil') {
                document.getElementById('profileModal').style.display = 'flex';
                document.getElementById('profileAvatar').value = userData?.avatarColor || '#ff2e63';
            } else if (action === 'Ustawienia') {
                document.getElementById('settingsModal').style.display = 'flex';
            } else if (action === 'Ulubione') {
                document.getElementById('favoritesOnly').checked = true;
                renderContent();
            } else if (action === 'Wyloguj') {
                userData = null;
                apiData = null;
                localStorage.removeItem('contentCache');
                localStorage.removeItem('contentCacheTimestamp');
                document.getElementById('contentContainer').style.display = 'none';
                document.getElementById('loginContainer').style.display = 'flex';
                document.getElementById('avatar').style.display = 'none';
            }
        });
    });

    // Close modals
    document.querySelectorAll('.close-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal');
            closeModal(modal.id);
        });
    });

    // Profile form
    document.getElementById('profileForm').addEventListener('submit', saveProfile);

    // Settings
    document.querySelectorAll('.theme-preview').forEach(preview => {
        preview.addEventListener('click', () => applyTheme(preview.dataset.theme));
    });

    document.getElementById('compactView').addEventListener('change', (e) => {
        applyView(e.target.checked);
        renderContent();
    });

    document.getElementById('favoritesOnly').addEventListener('change', renderContent);

    // Search
    document.getElementById('searchInput').addEventListener('input', (e) => {
        searchContent(e.target.value);
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        if (!avatar.contains(e.target) && !document.getElementById('dropdown').contains(e.target)) {
            document.getElementById('dropdown').classList.remove('active');
        }
    });
});
