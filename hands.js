/**
 * hands.js — Vesigna v4
 * Uses MediaPipe Tasks Vision GestureRecognizer (ESM import)
 */

import { GestureRecognizer, FilesetResolver, DrawingUtils }
    from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs';

import { GestureStabilizer, SentenceBuilder, getSuggestions } from './gesture.js';
import { showReferenceModal } from './asl-reference.js';

// ─── DOM elements ────────────────────────────────────────────────────

const videoElement  = document.getElementById('inputVideo');
const canvasElement = document.getElementById('outputCanvas');
const canvasCtx     = canvasElement.getContext('2d');

const loadingScreen        = document.getElementById('loadingScreen');
const appContainer         = document.getElementById('app');
const detectedLetterOverlay = document.getElementById('detectedLetterOverlay');
const detectedLetterEl     = document.getElementById('detectedLetter');
const detectedConfidenceEl = document.getElementById('detectedConfidence');
const signLetterEl         = document.getElementById('signLetter');
const signLabelEl          = document.getElementById('signLabel');
const currentSignEl        = document.querySelector('.current-sign');
const translationTextEl    = document.getElementById('translationText');
const headerStatusEl       = document.getElementById('headerStatus');
const statusTextEl         = headerStatusEl.querySelector('.status-text');
const fpsCounterEl         = document.getElementById('fpsCounter');
const btnClear             = document.getElementById('btnClear');
const btnCopy              = document.getElementById('btnCopy');
const btnDebug             = document.getElementById('btnDebug');
const debugPanel           = document.getElementById('debugPanel');
const debugContent         = document.getElementById('debugContent');

// ─── Progress bar element (injected below sign display) ──────────────

const progressBar = document.createElement('div');
progressBar.style.cssText = `
    width: 100%;
    height: 4px;
    background: rgba(255,255,255,0.08);
    border-radius: 2px;
    overflow: hidden;
    margin-top: 8px;
`;
const progressFill = document.createElement('div');
progressFill.style.cssText = `
    height: 100%;
    width: 0%;
    background: #6c5ce7;
    border-radius: 2px;
    transition: width 0.1s ease, background 0.2s ease;
`;
progressBar.appendChild(progressFill);
currentSignEl.appendChild(progressBar);

// ─── Word suggestions bar (injected below translation output) ─────────

const suggestionsEl = document.createElement('div');
suggestionsEl.id = 'suggestions';
suggestionsEl.style.cssText = `
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    min-height: 30px;
    margin-bottom: 12px;
`;
const translationOutput = document.getElementById('translationOutput');
translationOutput.after(suggestionsEl);

function renderSuggestions(currentText) {
    // Get last partial word
    const words  = currentText.trimEnd().split(' ');
    const partial = words[words.length - 1];
    const suggestions = getSuggestions(partial, 4);

    suggestionsEl.innerHTML = '';
    suggestions.forEach(word => {
        const btn = document.createElement('button');
        btn.textContent = word.charAt(0) + word.slice(1).toLowerCase();
        btn.style.cssText = `
            padding: 4px 10px;
            font-size: 12px;
            font-family: inherit;
            color: #a29bfe;
            background: rgba(108,92,231,0.12);
            border: 1px solid rgba(108,92,231,0.3);
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.15s ease;
        `;
        btn.onmouseenter = () => {
            btn.style.background = 'rgba(108,92,231,0.25)';
        };
        btn.onmouseleave = () => {
            btn.style.background = 'rgba(108,92,231,0.12)';
        };
        btn.addEventListener('click', () => {
            // Replace the last partial word with the suggestion
            words[words.length - 1] = word;
            sentence.text = words.join(' ');
            sentence.onChange && sentence.onChange(sentence.text);
            stabilizer.reset();
        });
        suggestionsEl.appendChild(btn);
    });
}

// ─── Gesture recognition pipeline ───────────────────────────────────

const stabilizer = new GestureStabilizer(20, 30);
const sentence   = new SentenceBuilder();
let debugMode    = false;

stabilizer.onLetterCommit = (letter) => {
    sentence.addLetter(letter);
    if (letter === 'BACKSPACE') {
        showToast('← Backspace');
    }
};

stabilizer.onProgress = (progress, letter) => {
    progressFill.style.width = `${progress * 100}%`;
    progressFill.style.background = progress >= 1
        ? '#00cec9'
        : letter === 'SPACE' || letter === 'BACKSPACE'
            ? '#fdcb6e'
            : '#6c5ce7';
};

sentence.onChange = (text) => {
    if (text.length === 0) {
        translationTextEl.innerHTML = '<span class="cursor-blink">|</span>';
    } else {
        translationTextEl.innerHTML = escapeHtml(text) + '<span class="cursor-blink">|</span>';
    }
    renderSuggestions(text);
};

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ─── FPS tracking ─────────────────────────────────────────────────────

let frameCount  = 0;
let lastFpsTime = performance.now();

function updateFps() {
    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
        fpsCounterEl.textContent = `${frameCount} FPS`;
        frameCount  = 0;
        lastFpsTime = now;
    }
}

// ─── Canvas sizing (letterbox 16:9) ──────────────────────────────────

const VIDEO_W      = 1280;
const VIDEO_H      = 720;
const VIDEO_ASPECT = VIDEO_W / VIDEO_H;

function resizeCanvas() {
    const container = document.getElementById('cameraContainer');
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const containerAspect = cw / ch;

    let w, h;
    if (containerAspect > VIDEO_ASPECT) {
        h = ch; w = ch * VIDEO_ASPECT;
    } else {
        w = cw; h = cw / VIDEO_ASPECT;
    }

    canvasElement.width  = w;
    canvasElement.height = h;
}

// ─── Gesture mapping ─────────────────────────────────────────────────────────

const IGNORE_GESTURES = new Set([
    'Victory', 'ILoveYou', 'Thumb_Up', 'Thumb_Down', 'Closed_Fist', 'None', '',
]);
const LETTER_RE = /^[A-Z]$/;

function mapGesture(categoryName) {
    if (!categoryName) return null;
    if (categoryName === 'Open_Palm') return 'SPACE';
    if (IGNORE_GESTURES.has(categoryName)) return null;
    if (LETTER_RE.test(categoryName)) return categoryName;
    return null;
}

// ─── GestureRecognizer state ──────────────────────────────────────────────────

let gestureRecognizer = null;
let lastTimestamp     = -1;
let drawingUtil       = null;

// ─── Per-frame processing ─────────────────────────────────────────────────────

function processFrame() {
    requestAnimationFrame(processFrame);

    // Must have a playing video and an initialised recognizer
    if (!gestureRecognizer || videoElement.readyState < 2 || videoElement.paused) return;

    const now = Date.now();
    if (now <= lastTimestamp) return;
    lastTimestamp = now;

    updateFps();
    resizeCanvas();

    const W = canvasElement.width;
    const H = canvasElement.height;

    // ── Draw video frame (mirrored for selfie) ────────────────────────────────
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, W, H);
    canvasCtx.translate(W, 0);
    canvasCtx.scale(-1, 1);
    canvasCtx.drawImage(videoElement, 0, 0, W, H);

    // ── Run GestureRecognizer ─────────────────────────────────────────────────
    let result;
    try {
        result = gestureRecognizer.recognizeForVideo(videoElement, now);
    } catch (e) {
        canvasCtx.restore();
        return;
    }

    // ── Draw hand skeleton (inside mirrored context so it aligns with video) ──
    const hands = result.landmarks ?? [];
    if (hands.length > 0) {
        if (!drawingUtil) drawingUtil = new DrawingUtils(canvasCtx);
        drawingUtil.drawConnectors(
            hands[0],
            GestureRecognizer.HAND_CONNECTIONS,
            { color: 'rgba(162, 155, 254, 0.6)', lineWidth: 2.5 },
        );
        drawingUtil.drawLandmarks(hands[0], {
            color: '#a29bfe',
            fillColor: '#6c5ce7',
            lineWidth: 1,
        });
    }

    canvasCtx.restore();

    // ── Classify gesture ──────────────────────────────────────────────────────
    const gestures = result.gestures ?? [];
    if (gestures.length > 0) {
        const top    = gestures[0][0];
        // DEBUG: bypass mapGesture — show raw model output directly
        const raw    = top.categoryName;
        const score  = (top.score * 100).toFixed(0) + '%';

        // Show raw category in overlay unconditionally
        detectedLetterOverlay.classList.add('active');
        detectedLetterEl.textContent     = raw;
        detectedConfidenceEl.textContent = score;

        signLetterEl.textContent = raw;
        signLabelEl.textContent  = `Raw: ${raw}`;
        currentSignEl.classList.add('detected');
        statusTextEl.textContent = `Raw: ${raw} (${score})`;

        // Debug panel — show everything the model returned this frame
        if (debugContent) {
            const allGestures = gestures[0]
                .slice(0, 5)
                .map(g => `  ${g.categoryName.padEnd(20)} ${(g.score * 100).toFixed(1)}%`)
                .join('\n');
            const lms = hands[0];
            debugContent.textContent =
                `── RAW MODEL OUTPUT ──────────────\n` +
                `Top:        ${raw}\n` +
                `Score:      ${score}\n` +
                `Hands det:  ${hands.length}\n` +
                `\n── ALL CANDIDATES ───────────────\n` +
                allGestures + '\n' +
                `\n── LANDMARKS ────────────────────\n` +
                (lms ? `Index tip:  x=${lms[8].x.toFixed(3)}  y=${lms[8].y.toFixed(3)}\n` : 'no landmarks\n') +
                (lms ? `Pinky tip:  x=${lms[20].x.toFixed(3)}  y=${lms[20].y.toFixed(3)}\n` : '') +
                `\n── STABILIZER ───────────────────\n` +
                `Frames:     ${stabilizer.frameCount}/${stabilizer.requiredFrames}`;
            debugPanel?.classList.add('visible');
        }

    } else {
        detectedLetterOverlay.classList.remove('active');
        signLetterEl.textContent = '\u2014';
        signLabelEl.textContent  = 'Show a sign to begin';
        currentSignEl.classList.remove('detected');
        statusTextEl.textContent = 'No hand detected';

        stabilizer.update({ letter: null, confidence: 'none' });
        if (debugContent) {
            debugContent.textContent =
                `── RAW MODEL OUTPUT ──────────────\n` +
                `Top:        (none)\n` +
                `Hands det:  ${hands.length}\n` +
                `\nNo gestures returned this frame.`;
            debugPanel?.classList.add('visible');
        }
    }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

(async () => {
    try {
        const fileset = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm',
        );
        gestureRecognizer = await GestureRecognizer.createFromOptions(fileset, {
            baseOptions: {
                modelAssetPath:
                    'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
                delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numHands: 1,
        });

        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: VIDEO_W, height: VIDEO_H, facingMode: 'user' },
            audio: false,
        });
        videoElement.srcObject = stream;
        videoElement.style.display = 'block';
        videoElement.style.position = 'absolute';
        videoElement.style.opacity = '0';
        videoElement.style.pointerEvents = 'none';

        await new Promise((resolve) => { videoElement.onloadeddata = resolve; });
        await videoElement.play();

        // Both recognizer and video are ready — reveal the app now
        loadingScreen.classList.add('hidden');
        appContainer.classList.add('visible');

        requestAnimationFrame(processFrame);
    } catch (err) {
        console.error('Vesigna init error:', err);
        const txt = document.querySelector('.loading-text');
        if (txt) txt.textContent = `Init failed: ${err.message}`;
    }
})();

// ─── Button handlers ──────────────────────────────────────────────────

btnClear.addEventListener('click', () => {
    sentence.clear();
    stabilizer.reset();
    suggestionsEl.innerHTML = '';
});

btnCopy.addEventListener('click', () => {
    const text = sentence.getText();
    if (text.trim()) {
        navigator.clipboard.writeText(text)
            .then(() => showToast('Copied to clipboard!'))
            .catch(() => showToast('Failed to copy'));
    }
});

if (btnDebug) {
    btnDebug.addEventListener('click', () => {
        debugMode = !debugMode;
        debugPanel?.classList.toggle('visible', debugMode);
        btnDebug.classList.toggle('active', debugMode);
    });
}

const btnReference = document.getElementById('btnReference');
if (btnReference) {
    btnReference.addEventListener('click', () => showReferenceModal());
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        sentence.clear();
        stabilizer.reset();
    }
    if (e.key === 'Backspace' && document.activeElement === document.body) {
        e.preventDefault();
        sentence.addLetter('BACKSPACE');
        sentence.onChange && sentence.onChange(sentence.getText());
    }
    if (e.key === ' ' && document.activeElement === document.body) {
        e.preventDefault();
        sentence.addLetter('SPACE');
        sentence.onChange && sentence.onChange(sentence.getText());
    }
});

// ─── Toast helper ─────────────────────────────────────────────────────

function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className   = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}