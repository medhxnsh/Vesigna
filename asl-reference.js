/**
 * asl-reference.js — ASL Fingerspelling Reference Modal (video edition)
 * Videos loaded lazily from ./AlphabetVid/<letter>.mp4 on first open.
 * Exports: window.showReferenceModal(currentLetter?)
 *          window.updateReferenceHighlight(letter)
 */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// ─── State ────────────────────────────────────────────────────────────────────

let modalEl      = null;  // backdrop element (null until first open)
let videosLoaded = false; // tracks whether src attributes have been set

// ─── Style injection ──────────────────────────────────────────────────────────

function injectStyles() {
    if (document.getElementById('asl-ref-styles')) return;
    const style = document.createElement('style');
    style.id = 'asl-ref-styles';
    style.textContent = `
        /* ── Backdrop ── */
        .asl-backdrop {
            position: fixed;
            inset: 0;
            z-index: 2000;
            background: rgba(0, 0, 0, 0.80);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            opacity: 0;
            transition: opacity 0.25s ease;
        }
        .asl-backdrop.visible { opacity: 1; }

        /* ── Panel ── */
        .asl-panel {
            background: var(--bg-secondary, #12121a);
            border: 1px solid var(--border-glass, rgba(255,255,255,0.08));
            border-radius: 20px;
            padding: 24px 24px 20px;
            width: 100%;
            max-width: 960px;
            max-height: 92vh;
            overflow-y: auto;
            scrollbar-width: thin;
            scrollbar-color: rgba(255,255,255,0.08) transparent;
            box-shadow: 0 28px 80px rgba(0,0,0,0.75);
            transform: translateY(14px) scale(0.99);
            transition: transform 0.25s cubic-bezier(0.4,0,0.2,1);
        }
        .asl-backdrop.visible .asl-panel {
            transform: translateY(0) scale(1);
        }

        /* ── Header ── */
        .asl-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            margin-bottom: 20px;
            gap: 12px;
        }
        .asl-title {
            font-family: var(--font, 'Inter', sans-serif);
            font-size: 17px;
            font-weight: 600;
            color: var(--text-primary, #f0f0f5);
            letter-spacing: -0.01em;
        }
        .asl-subtitle {
            font-family: var(--font, 'Inter', sans-serif);
            font-size: 12px;
            color: var(--text-secondary, #8888a0);
            margin-top: 3px;
        }
        .asl-close {
            flex-shrink: 0;
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--bg-glass, rgba(255,255,255,0.04));
            border: 1px solid var(--border-glass, rgba(255,255,255,0.08));
            border-radius: 8px;
            color: var(--text-secondary, #8888a0);
            font-size: 20px;
            line-height: 1;
            cursor: pointer;
            transition: background 0.15s ease, color 0.15s ease;
            font-family: var(--font, 'Inter', sans-serif);
        }
        .asl-close:hover {
            background: var(--bg-glass-hover, rgba(255,255,255,0.07));
            color: var(--text-primary, #f0f0f5);
        }

        /* ── Grid (6 columns) ── */
        .asl-grid {
            display: grid;
            grid-template-columns: repeat(6, 1fr);
            gap: 10px;
        }
        @media (max-width: 700px) {
            .asl-grid { grid-template-columns: repeat(4, 1fr); }
        }
        @media (max-width: 480px) {
            .asl-grid { grid-template-columns: repeat(3, 1fr); }
        }

        /* ── Card ── */
        .asl-card {
            background: var(--bg-glass, rgba(255,255,255,0.04));
            border: 1px solid var(--border-glass, rgba(255,255,255,0.08));
            border-radius: 12px;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            align-items: center;
            cursor: default;
            transition:
                border-color 0.18s ease,
                background   0.18s ease,
                transform    0.18s cubic-bezier(0.4,0,0.2,1),
                box-shadow   0.18s ease;
        }
        .asl-card:hover {
            transform: scale(1.06);
            background: rgba(108, 92, 231, 0.10);
            border-color: rgba(108, 92, 231, 0.40);
            box-shadow: 0 0 18px rgba(108, 92, 231, 0.25);
            z-index: 1;
        }
        .asl-card.active {
            border-color: var(--accent, #6c5ce7);
            background: rgba(108, 92, 231, 0.18);
            box-shadow: 0 0 22px rgba(108, 92, 231, 0.45);
        }

        /* ── Video inside card ── */
        .asl-card-video {
            width: 100%;
            aspect-ratio: 1 / 1;
            object-fit: cover;
            display: block;
            background: #07070f;
        }

        /* ── Letter label ── */
        .asl-card-label {
            font-family: var(--font, 'Inter', sans-serif);
            font-size: 13px;
            font-weight: 600;
            color: var(--accent-light, #a29bfe);
            padding: 5px 0 6px;
            letter-spacing: 0.02em;
        }
        .asl-card.active .asl-card-label {
            color: #ffffff;
        }

        /* ── Footer note ── */
        .asl-note {
            margin-top: 16px;
            padding: 11px 14px;
            background: rgba(108, 92, 231, 0.07);
            border: 1px solid rgba(108, 92, 231, 0.18);
            border-radius: 10px;
            font-family: var(--font, 'Inter', sans-serif);
            font-size: 11.5px;
            color: var(--accent-light, #a29bfe);
            line-height: 1.55;
        }
    `;
    document.head.appendChild(style);
}

// ─── Build modal DOM ──────────────────────────────────────────────────────────

function buildModal() {
    injectStyles();

    const backdrop = document.createElement('div');
    backdrop.className = 'asl-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', 'ASL Fingerspelling Guide');

    const panel = document.createElement('div');
    panel.className = 'asl-panel';

    // ── Header ────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'asl-header';

    const titleBlock = document.createElement('div');
    titleBlock.innerHTML = `
        <div class="asl-title">✋ ASL Fingerspelling Guide</div>
        <div class="asl-subtitle">American Sign Language — 26 handshape videos</div>
    `;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'asl-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', hideReferenceModal);

    header.appendChild(titleBlock);
    header.appendChild(closeBtn);

    // ── Grid ──────────────────────────────────────────────────────────
    const grid = document.createElement('div');
    grid.className = 'asl-grid';
    grid.id = 'asl-letter-grid';

    LETTERS.forEach(letter => {
        const card = document.createElement('div');
        card.className = 'asl-card';
        card.dataset.letter = letter;
        card.id = `asl-card-${letter}`;

        // Video element — src set lazily on first open; plays only on hover
        const video = document.createElement('video');
        video.className = 'asl-card-video';
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.poster = '';  // shows first frame as static thumbnail

        // Desktop: play on hover, pause + reset on leave
        card.addEventListener('mouseenter', () => { video.play(); });
        card.addEventListener('mouseleave', () => {
            video.pause();
            video.currentTime = 0;
        });

        // Mobile: tap to toggle play/pause
        card.addEventListener('touchstart', e => {
            e.preventDefault();
            if (video.paused) {
                video.play();
            } else {
                video.pause();
                video.currentTime = 0;
            }
        });

        const label = document.createElement('div');
        label.className = 'asl-card-label';
        label.textContent = letter;

        card.appendChild(video);
        card.appendChild(label);
        grid.appendChild(card);
    });

    // ── Footer note ───────────────────────────────────────────────────
    const note = document.createElement('div');
    note.className = 'asl-note';
    note.textContent =
        '💡 J and Z are motion letters — trace their shape in the air. ' +
        'Open palm = Space. The model works best in good lighting with a clear background.';

    panel.appendChild(header);
    panel.appendChild(grid);
    panel.appendChild(note);
    backdrop.appendChild(panel);

    // Close when clicking the backdrop (outside the panel)
    backdrop.addEventListener('click', e => {
        if (e.target === backdrop) hideReferenceModal();
    });

    return backdrop;
}

// ─── Lazy video loading ───────────────────────────────────────────────────────

function loadVideos() {
    if (videosLoaded) return;
    videosLoaded = true;

    LETTERS.forEach(letter => {
        const card = document.getElementById(`asl-card-${letter}`);
        if (!card) return;
        const video = card.querySelector('video');
        if (!video) return;
        video.src = `./AlphabetVid/${letter}.mp4`;
        video.load();
    });
}

// ─── Highlight helper ─────────────────────────────────────────────────────────

function applyHighlight(letter) {
    if (!modalEl) return;
    const prev = modalEl.querySelector('.asl-card.active');
    if (prev) prev.classList.remove('active');

    if (letter) {
        const card = document.getElementById(`asl-card-${letter.toUpperCase()}`);
        if (card) {
            card.classList.add('active');
            card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        }
    }
}

// ─── Keyboard handler ─────────────────────────────────────────────────────────

function onModalKeyDown(e) {
    if (e.key === 'Escape') hideReferenceModal();
}

// ─── Public API ───────────────────────────────────────────────────────────────

function showReferenceModal(currentLetter) {
    if (!modalEl) {
        modalEl = buildModal();
        document.body.appendChild(modalEl);
    }

    loadVideos(); // no-op after first call

    modalEl.style.display = 'flex';
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            modalEl.classList.add('visible');
            applyHighlight(currentLetter || null);
        });
    });

    document.addEventListener('keydown', onModalKeyDown);
}

function hideReferenceModal() {
    if (!modalEl) return;
    modalEl.classList.remove('visible');
    document.removeEventListener('keydown', onModalKeyDown);

    modalEl.addEventListener('transitionend', () => {
        if (!modalEl.classList.contains('visible')) {
            modalEl.style.display = 'none';
        }
    }, { once: true });
}

function updateReferenceHighlight(letter) {
    if (!modalEl || modalEl.style.display === 'none') return;
    applyHighlight(letter);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

window.showReferenceModal       = showReferenceModal;
window.updateReferenceHighlight = updateReferenceHighlight;

