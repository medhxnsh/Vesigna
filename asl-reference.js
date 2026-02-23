/**
 * asl-reference.js — ASL Fingerspelling Reference Modal
 * Exports showReferenceModal() — no external dependencies.
 */

// ─── ASL letter data ─────────────────────────────────────────────────────────

const ASL_LETTERS = [
    { letter: 'A', emoji: '✊', desc: 'Fist, thumb rests alongside index finger' },
    { letter: 'B', emoji: '🖐', desc: 'Four fingers straight up, thumb folded across palm' },
    { letter: 'C', emoji: '🤏', desc: 'Curved open hand, like holding a tennis ball' },
    { letter: 'D', emoji: '☝️', desc: 'Index up, fingers curve to touch thumb tip' },
    { letter: 'E', emoji: '🤜', desc: 'All fingers bent forward, thumb tucked under' },
    { letter: 'F', emoji: '👌', desc: 'Index & thumb circle, three fingers extended' },
    { letter: 'G', emoji: '👉', desc: 'Index points sideways, thumb parallel to it' },
    { letter: 'H', emoji: '✌️', desc: 'Index & middle point sideways together' },
    { letter: 'I', emoji: '🤙', desc: 'Pinky finger only extended, fist shape' },
    { letter: 'J', emoji: '🤙', desc: 'Pinky extended — trace a J in the air' },
    { letter: 'K', emoji: '✌️', desc: 'Index & middle up, thumb rests between them' },
    { letter: 'L', emoji: '🤙', desc: 'Index up, thumb out — forms an L shape' },
    { letter: 'M', emoji: '✊', desc: 'Three fingers (idx, mid, ring) folded over thumb' },
    { letter: 'N', emoji: '✊', desc: 'Two fingers (index, middle) folded over thumb' },
    { letter: 'O', emoji: '👌', desc: 'All fingertips curve to meet thumb, forming an O' },
    { letter: 'P', emoji: '🤞', desc: 'Like K but hand points downward' },
    { letter: 'Q', emoji: '👇', desc: 'Like G but hand points downward' },
    { letter: 'R', emoji: '🤞', desc: 'Index & middle extended and crossed over each other' },
    { letter: 'S', emoji: '✊', desc: 'Fist, thumb wrapped across the front of fingers' },
    { letter: 'T', emoji: '✊', desc: 'Fist, thumb tip pokes between index and middle' },
    { letter: 'U', emoji: '✌️', desc: 'Index & middle together, pointing straight up' },
    { letter: 'V', emoji: '✌️', desc: 'Index & middle spread apart (peace sign)' },
    { letter: 'W', emoji: '🖖', desc: 'Index, middle, ring spread and extended' },
    { letter: 'X', emoji: '☝️', desc: 'Index finger hooked (bent at first joint)' },
    { letter: 'Y', emoji: '🤙', desc: 'Thumb & pinky extended, other fingers folded' },
    { letter: 'Z', emoji: '☝️', desc: 'Index extended — trace a Z in the air' },
];

// ─── Modal injection ──────────────────────────────────────────────────────────

let modalEl = null;

function buildModal() {
    // Inject styles once
    if (!document.getElementById('asl-ref-styles')) {
        const style = document.createElement('style');
        style.id = 'asl-ref-styles';
        style.textContent = `
            .asl-modal-backdrop {
                position: fixed;
                inset: 0;
                z-index: 2000;
                background: rgba(0, 0, 0, 0.75);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 24px;
                opacity: 0;
                transition: opacity 0.25s ease;
            }
            .asl-modal-backdrop.visible {
                opacity: 1;
            }
            .asl-modal {
                background: #12121a;
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 20px;
                padding: 28px 28px 24px;
                max-width: 880px;
                width: 100%;
                max-height: 90vh;
                overflow-y: auto;
                scrollbar-width: thin;
                scrollbar-color: rgba(255,255,255,0.1) transparent;
                transform: translateY(16px);
                transition: transform 0.25s ease;
                box-shadow: 0 24px 80px rgba(0,0,0,0.7);
            }
            .asl-modal-backdrop.visible .asl-modal {
                transform: translateY(0);
            }
            .asl-modal-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 20px;
            }
            .asl-modal-title {
                font-family: 'Inter', sans-serif;
                font-size: 18px;
                font-weight: 600;
                color: #f0f0f5;
                letter-spacing: -0.01em;
            }
            .asl-modal-subtitle {
                font-family: 'Inter', sans-serif;
                font-size: 12px;
                color: #8888a0;
                margin-top: 2px;
            }
            .asl-modal-close {
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(255,255,255,0.06);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 8px;
                color: #8888a0;
                font-size: 18px;
                cursor: pointer;
                transition: all 0.15s ease;
                font-family: 'Inter', sans-serif;
                flex-shrink: 0;
            }
            .asl-modal-close:hover {
                background: rgba(255,255,255,0.12);
                color: #f0f0f5;
            }
            .asl-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
                gap: 10px;
            }
            .asl-card {
                background: rgba(255,255,255,0.03);
                border: 1px solid rgba(255,255,255,0.07);
                border-radius: 12px;
                padding: 14px 12px;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 6px;
                text-align: center;
                transition: border-color 0.15s ease, background 0.15s ease;
                cursor: default;
            }
            .asl-card:hover {
                background: rgba(108,92,231,0.08);
                border-color: rgba(108,92,231,0.35);
            }
            .asl-card-letter {
                font-family: 'Inter', sans-serif;
                font-size: 36px;
                font-weight: 700;
                color: #a29bfe;
                line-height: 1;
                text-shadow: 0 0 20px rgba(108,92,231,0.4);
            }
            .asl-card-emoji {
                font-size: 22px;
                line-height: 1;
                filter: grayscale(0.2);
            }
            .asl-card-desc {
                font-family: 'Inter', sans-serif;
                font-size: 10.5px;
                color: #8888a0;
                line-height: 1.4;
            }
            .asl-modal-note {
                margin-top: 18px;
                padding: 12px 16px;
                background: rgba(108,92,231,0.08);
                border: 1px solid rgba(108,92,231,0.2);
                border-radius: 10px;
                font-family: 'Inter', sans-serif;
                font-size: 12px;
                color: #a29bfe;
                line-height: 1.5;
            }
        `;
        document.head.appendChild(style);
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'asl-modal-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', 'ASL Fingerspelling Reference');

    const modal = document.createElement('div');
    modal.className = 'asl-modal';

    // Header
    const header = document.createElement('div');
    header.className = 'asl-modal-header';

    const titleBlock = document.createElement('div');
    titleBlock.innerHTML = `
        <div class="asl-modal-title">✋ ASL Fingerspelling Guide</div>
        <div class="asl-modal-subtitle">American Sign Language — 26 letter handshapes</div>
    `;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'asl-modal-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close reference guide');
    closeBtn.addEventListener('click', hideReferenceModal);

    header.appendChild(titleBlock);
    header.appendChild(closeBtn);

    // Grid of letter cards
    const grid = document.createElement('div');
    grid.className = 'asl-grid';

    ASL_LETTERS.forEach(({ letter, emoji, desc }) => {
        const card = document.createElement('div');
        card.className = 'asl-card';
        card.innerHTML = `
            <span class="asl-card-letter">${letter}</span>
            <span class="asl-card-emoji">${emoji}</span>
            <span class="asl-card-desc">${desc}</span>
        `;
        grid.appendChild(card);
    });

    // Footer note
    const note = document.createElement('div');
    note.className = 'asl-modal-note';
    note.textContent =
        '💡 Tip: J and Z are motion letters — trace their shape in the air. ' +
        'Open palm = Space. The model works best in good lighting with a clear background.';

    modal.appendChild(header);
    modal.appendChild(grid);
    modal.appendChild(note);
    backdrop.appendChild(modal);

    // Close on backdrop click (outside modal)
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) hideReferenceModal();
    });

    return backdrop;
}

// ─── Public API ───────────────────────────────────────────────────────────────

function showReferenceModal() {
    if (!modalEl) {
        modalEl = buildModal();
        document.body.appendChild(modalEl);
    }

    modalEl.style.display = 'flex';
    // Animate in on next frame
    requestAnimationFrame(() => {
        requestAnimationFrame(() => modalEl.classList.add('visible'));
    });

    document.addEventListener('keydown', onModalKeyDown);
}

function hideReferenceModal() {
    if (!modalEl) return;
    modalEl.classList.remove('visible');
    document.removeEventListener('keydown', onModalKeyDown);

    // Hide after transition
    modalEl.addEventListener('transitionend', () => {
        if (!modalEl.classList.contains('visible')) {
            modalEl.style.display = 'none';
        }
    }, { once: true });
}

function onModalKeyDown(e) {
    if (e.key === 'Escape') hideReferenceModal();
}

export { showReferenceModal };
