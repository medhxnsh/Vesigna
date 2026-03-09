/**
 * hands.js — Vesigna v6
 * Uses TensorFlow.js (tfjs@3.21) + MediaPipe Hands for ASL recognition.
 * Model: ./model/model.json — 42 inputs (21 landmarks × x,y), 26 outputs (A-Z).
 * GestureStabilizer, SentenceBuilder, getSuggestions injected as window globals
 * by gesture.js.  showReferenceModal injected by asl-reference.js.
 */

// ─── ASL class labels (index 0 = A … 25 = Z) ─────────────────────────
const LABELS = [
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
];

// ─── Mish activation (not natively supported by tfjs) ────────────────

function mish(x) {
    return tf.tidy(() => {
        const softplus = tf.log(tf.add(tf.exp(x), tf.scalar(1)));
        return tf.mul(x, tf.tanh(softplus));
    });
}

// ─── DOM elements ────────────────────────────────────────────────────

const videoElement = document.getElementById('inputVideo');
const canvasElement = document.getElementById('outputCanvas');
const canvasCtx = canvasElement.getContext('2d');

const loadingScreen = document.getElementById('loadingScreen');
const appContainer = document.getElementById('app');
const detectedLetterOverlay = document.getElementById('detectedLetterOverlay');
const detectedLetterEl = document.getElementById('detectedLetter');
const detectedConfidenceEl = document.getElementById('detectedConfidence');
const signLetterEl = document.getElementById('signLetter');
const signLabelEl = document.getElementById('signLabel');
const currentSignEl = document.querySelector('.current-sign');
const translationTextEl = document.getElementById('translationText');
const headerStatusEl = document.getElementById('headerStatus');
const statusTextEl = headerStatusEl.querySelector('.status-text');
const fpsCounterEl = document.getElementById('fpsCounter');
const btnClear = document.getElementById('btnClear');
const btnCopy = document.getElementById('btnCopy');
const btnDebug = document.getElementById('btnDebug');
const debugPanel = document.getElementById('debugPanel');
const debugContent = document.getElementById('debugContent');

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
    const words = currentText.trimEnd().split(' ');
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
        btn.onmouseenter = () => { btn.style.background = 'rgba(108,92,231,0.25)'; };
        btn.onmouseleave = () => { btn.style.background = 'rgba(108,92,231,0.12)'; };
        btn.addEventListener('click', () => {
            words[words.length - 1] = word;
            sentence.text = words.join(' ');
            sentence.onChange && sentence.onChange(sentence.text);
            stabilizer.reset();
        });
        suggestionsEl.appendChild(btn);
    });
}

// ─── Gesture recognition pipeline ───────────────────────────────────

const stabilizer = new GestureStabilizer(15, 25);
const sentence = new SentenceBuilder();
let debugMode = false;
let lastDetectedLetter = null;

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

let frameCount = 0;
let lastFpsTime = performance.now();

function updateFps() {
    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
        fpsCounterEl.textContent = `${frameCount} FPS`;
        frameCount = 0;
        lastFpsTime = now;
    }
}

// ─── Canvas sizing (letterbox 16:9) ──────────────────────────────────

const VIDEO_W = 1280;
const VIDEO_H = 720;
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

    canvasElement.width = w;
    canvasElement.height = h;
}

// ─── TF model (assigned in boot) ─────────────────────────────────────

let model = null;

// ─── Live landmarks (updated each frame, used by data collector) ──────

let currentRawLandmarks = null;

// ─── Data Collection Mode ─────────────────────────────────────────────

const COLLECT_LETTERS = 'ABCDEFGHIKLMNOPQRSTUVWXY'.split(''); // A-Z minus J and Z
const SAMPLES_PER_LETTER = 200;

let collectMode = false;
let collectIndex = 0;   // index into COLLECT_LETTERS
let collectSamples = [];  // { label, values[] }[]
let collectOverlay = null;

function buildCollectOverlay() {
    // Inject styles once
    if (!document.getElementById('collect-styles')) {
        const s = document.createElement('style');
        s.id = 'collect-styles';
        s.textContent = `
            .collect-overlay {
                position: absolute;
                inset: 0;
                z-index: 50;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: flex-end;
                padding-bottom: 24px;
                background: rgba(0,0,0,0.45);
                backdrop-filter: blur(2px);
                pointer-events: none;
            }
            .collect-panel {
                pointer-events: all;
                background: rgba(10,10,20,0.88);
                border: 1px solid rgba(108,92,231,0.4);
                border-radius: 16px;
                padding: 18px 28px 16px;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 10px;
                min-width: 480px;
                max-width: 90%;
                box-shadow: 0 8px 40px rgba(0,0,0,0.6);
            }
            .collect-letter {
                font-family: var(--font,'Inter',sans-serif);
                font-size: 52px;
                font-weight: 800;
                color: #a29bfe;
                line-height: 1;
                letter-spacing: -2px;
            }
            .collect-count {
                font-family: var(--font,'Inter',sans-serif);
                font-size: 13px;
                color: #8888a0;
            }
            .collect-bar-wrap {
                width: 100%;
                height: 6px;
                background: rgba(255,255,255,0.08);
                border-radius: 3px;
                overflow: hidden;
            }
            .collect-bar-fill {
                height: 100%;
                background: #6c5ce7;
                border-radius: 3px;
                transition: width 0.1s ease;
            }
            .collect-actions {
                display: flex;
                gap: 8px;
                margin-top: 12px;
                flex-wrap: wrap;
                justify-content: center;
                width: 100%;
            }
            .collect-hint {
                font-family: var(--font,'Inter',sans-serif);
                font-size: 11px;
                color: #55556a;
            }
            .collect-flash {
                animation: collectFlash 0.3s ease-out forwards;
            }
            @keyframes collectFlash {
                0%   { box-shadow: 0 0 0 4px rgba(0,210,120,0.85); }
                100% { box-shadow: 0 0 0 0   rgba(0,210,120,0); }
            }
        `;
        document.head.appendChild(s);
    }

    const overlay = document.createElement('div');
    overlay.className = 'collect-overlay';

    const panel = document.createElement('div');
    panel.className = 'collect-panel';

    const letterEl = document.createElement('div');
    letterEl.className = 'collect-letter';
    letterEl.id = 'collectLetter';

    const countEl = document.createElement('div');
    countEl.className = 'collect-count';
    countEl.id = 'collectCount';

    const barWrap = document.createElement('div');
    barWrap.className = 'collect-bar-wrap';
    const barFill = document.createElement('div');
    barFill.className = 'collect-bar-fill';
    barFill.id = 'collectBarFill';
    barWrap.appendChild(barFill);

    const actions = document.createElement('div');
    actions.className = 'collect-actions';

    const btnNext = document.createElement('button');
    btnNext.className = 'btn';
    btnNext.textContent = '⏭ Next Letter';
    btnNext.addEventListener('click', () => collectNextLetter());

    const btnRedo = document.createElement('button');
    btnRedo.className = 'btn';
    btnRedo.textContent = '↩ Redo';
    btnRedo.title = 'Clear all samples for current letter';
    btnRedo.addEventListener('click', () => redoCurrentLetter());

    const btnDeleteLast = document.createElement('button');
    btnDeleteLast.className = 'btn';
    btnDeleteLast.textContent = '⌫ Delete Last';
    btnDeleteLast.title = 'Remove the last recorded sample';
    btnDeleteLast.addEventListener('click', () => deleteLastSample());

    const btnDownload = document.createElement('button');
    btnDownload.className = 'btn';
    btnDownload.textContent = '💾 Download CSV';
    btnDownload.addEventListener('click', () => downloadCSV());

    const btnClose = document.createElement('button');
    btnClose.className = 'btn';
    btnClose.textContent = '✕ Close';
    btnClose.addEventListener('click', () => stopCollectMode());

    // Order: ↩ Redo | ⌫ Last | ⏭ Next | 💾 Download | ✕ Close
    actions.appendChild(btnRedo);
    actions.appendChild(btnDeleteLast);
    actions.appendChild(btnNext);
    actions.appendChild(btnDownload);
    actions.appendChild(btnClose);

    const hint = document.createElement('div');
    hint.className = 'collect-hint';
    hint.textContent = 'Press SPACE to record a sample';

    panel.appendChild(letterEl);
    panel.appendChild(countEl);
    panel.appendChild(barWrap);
    panel.appendChild(actions);
    panel.appendChild(hint);
    overlay.appendChild(panel);

    return overlay;
}

function collectCurrentLetterSamplesCount() {
    const letter = COLLECT_LETTERS[collectIndex];
    return collectSamples.filter(s => s.label === letter).length;
}

function updateCollectUI() {
    const letter = COLLECT_LETTERS[collectIndex];
    const count = collectCurrentLetterSamplesCount();
    document.getElementById('collectLetter').textContent = `Sign: ${letter}`;
    document.getElementById('collectCount').textContent = `Samples: ${count} / ${SAMPLES_PER_LETTER}`;
    document.getElementById('collectBarFill').style.width = `${Math.min(count / SAMPLES_PER_LETTER * 100, 100)}%`;
}

function collectNextLetter() {
    collectIndex = (collectIndex + 1) % COLLECT_LETTERS.length;
    updateCollectUI();
}

function redoCurrentLetter() {
    const letter = COLLECT_LETTERS[collectIndex];
    collectSamples = collectSamples.filter(s => s.label !== letter);
    updateCollectUI();
    showToast(`Cleared samples for ${letter}`);
}

function deleteLastSample() {
    const letter = COLLECT_LETTERS[collectIndex];
    // Find and remove the last sample belonging to the current letter
    for (let i = collectSamples.length - 1; i >= 0; i--) {
        if (collectSamples[i].label === letter) {
            collectSamples.splice(i, 1);
            updateCollectUI();
            showToast(`Deleted last sample for ${letter}`);
            return;
        }
    }
    showToast(`No samples for ${letter} to delete`);
}

function flashSampleCapture() {
    const container = document.getElementById('cameraContainer');
    if (!container) return;
    container.classList.remove('collect-flash');
    // Force reflow so the animation restarts even on rapid successive presses
    void container.offsetWidth;
    container.classList.add('collect-flash');
    container.addEventListener('animationend', () => container.classList.remove('collect-flash'), { once: true });
}

function recordSample() {
    if (!currentRawLandmarks) { showToast('No hand detected'); return; }
    const letter = COLLECT_LETTERS[collectIndex];
    const count = collectCurrentLetterSamplesCount();
    if (count >= SAMPLES_PER_LETTER) { showToast(`${letter} already has ${SAMPLES_PER_LETTER} samples`); return; }

    const wrist = currentRawLandmarks[0];
    const flat = [];
    for (let i = 0; i < 21; i++) {
        flat.push(currentRawLandmarks[i].x - wrist.x);
        flat.push(currentRawLandmarks[i].y - wrist.y);
    }
    const maxVal = Math.max(...flat.map(Math.abs)) || 1;
    const values = flat.map(v => v / maxVal);

    collectSamples.push({ label: letter, values });
    updateCollectUI();
    flashSampleCapture();
    showToast(`${letter}: ${count + 1}/${SAMPLES_PER_LETTER}`);
}

function downloadCSV() {
    if (collectSamples.length === 0) { showToast('No samples collected'); return; }
    const header = ['label', ...Array.from({ length: 21 }, (_, i) => [`x${i}`, `y${i}`]).flat()].join(',');
    const rows = collectSamples.map(s => [s.label, ...s.values.map(v => v.toFixed(6))].join(','));
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'training_data.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${collectSamples.length} samples`);
}

function startCollectMode() {
    collectMode = true;
    collectIndex = 0;
    if (!collectOverlay) {
        collectOverlay = buildCollectOverlay();
        document.getElementById('cameraContainer').appendChild(collectOverlay);
    }
    collectOverlay.style.display = 'flex';
    updateCollectUI();
    document.getElementById('btnCollect').classList.add('active');
}

function stopCollectMode() {
    collectMode = false;
    if (collectOverlay) collectOverlay.style.display = 'none';
    document.getElementById('btnCollect').classList.remove('active');
}

// ─── Landmark normalisation + classification ──────────────────────────

function classifyLandmarks(landmarks) {
    const wrist = landmarks[0];
    const flat = [];
    for (let i = 0; i < 21; i++) {
        flat.push(landmarks[i].x - wrist.x);
        flat.push(landmarks[i].y - wrist.y);
    }
    const maxVal = Math.max(...flat.map(Math.abs)) || 1;
    const normalized = flat.map(v => v / maxVal);

    return tf.tidy(() => {
        let x = tf.tensor2d([normalized]);

        // Get weights by name
        const weights = {};
        for (const layer of model.layers) {
            const w = layer.getWeights();
            if (w.length > 0) weights[layer.name] = w;
        }

        // BatchNorm
        const bn = weights['batch_normalization'] || weights['bn'];
        if (bn) {
            const [gamma, beta, mean, variance] = bn;
            x = tf.add(
                tf.mul(gamma, tf.div(tf.sub(x, mean), tf.sqrt(tf.add(variance, tf.scalar(0.001))))),
                beta
            );
        }

        // Dense 0 → mish
        const d0 = weights['dense'] || weights['d0'];
        if (d0) x = mish(tf.add(tf.matMul(x, d0[0]), d0[1]));

        // Dense 1 → mish
        const d1 = weights['dense_1'] || weights['d1'];
        if (d1) x = mish(tf.add(tf.matMul(x, d1[0]), d1[1]));

        // Dense 2 → mish
        const d2 = weights['dense_2'] || weights['d2'];
        if (d2) x = mish(tf.add(tf.matMul(x, d2[0]), d2[1]));

        // Dense 3 → softmax
        const d3 = weights['dense_3'] || weights['d3'];
        if (d3) x = tf.softmax(tf.add(tf.matMul(x, d3[0]), d3[1]));

        const values = x.dataSync();
        const classIndex = values.indexOf(Math.max(...values));
        const confidence = values[classIndex];

        const LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
            'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

        return { letter: LABELS[classIndex], confidence, allScores: Array.from(values) };
    });
}

// ─── MediaPipe onResults callback ─────────────────────────────────────

async function onResults(results) {
    if (!model) return;

    updateFps();
    resizeCanvas();

    const W = canvasElement.width;
    const H = canvasElement.height;

    // Draw video frame, mirrored for selfie feel
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, W, H);
    canvasCtx.translate(W, 0);
    canvasCtx.scale(-1, 1);
    canvasCtx.drawImage(results.image, 0, 0, W, H);
    canvasCtx.restore();

    const rawLandmarks = results.multiHandLandmarks && results.multiHandLandmarks[0];
    currentRawLandmarks = rawLandmarks || null;
    let classResult = null;
    const rawLandmarkCount = rawLandmarks ? rawLandmarks.length : 0;

    if (rawLandmarks) {
        // Flip x for drawing because the canvas is mirrored above
        const drawLms = rawLandmarks.map(lm => ({ x: 1 - lm.x, y: lm.y, z: lm.z }));

        drawConnectors(canvasCtx, drawLms, HAND_CONNECTIONS, {
            color: 'rgba(162,155,254,0.6)',
            lineWidth: 2.5,
        });
        drawLandmarks(canvasCtx, drawLms, {
            color: '#a29bfe',
            fillColor: '#6c5ce7',
            lineWidth: 1,
            radius: 4,
        });

        // Classify using the original (unflipped) landmarks; apply hysteresis
        const raw = classifyLandmarks(rawLandmarks);
        if (raw.confidence >= 0.5) {
            lastDetectedLetter = raw.letter;
            classResult = raw;
        } else if (raw.confidence >= 0.35 && raw.letter === lastDetectedLetter) {
            classResult = { ...raw, letter: lastDetectedLetter };
        } else {
            lastDetectedLetter = null;
            classResult = { ...raw, letter: null };
        }
    }

    // ─── Update UI overlays ────────────────────────────────────────────
    if (classResult && classResult.letter) {
        const { letter, confidence } = classResult;
        const pct = (confidence * 100).toFixed(0) + '%';

        detectedLetterOverlay.classList.add('active');
        detectedLetterEl.textContent = letter;
        detectedConfidenceEl.textContent = pct;
        signLetterEl.textContent = letter;
        signLabelEl.textContent = pct;
        currentSignEl.classList.add('detected');
        statusTextEl.textContent = `${letter} (${pct})`;
    } else {
        detectedLetterOverlay.classList.remove('active');
        signLetterEl.textContent = '—';
        signLabelEl.textContent = 'Show a sign to begin';
        currentSignEl.classList.remove('detected');
        statusTextEl.textContent = 'Detecting…';
    }

    // ─── Debug panel ───────────────────────────────────────────────────
    if (debugContent) {
        const _top3Str = classResult && classResult.allScores
            ? (() => {
                const _L = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
                    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
                return classResult.allScores
                    .map((v, i) => ({ letter: _L[i], score: v }))
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 3)
                    .map(t => `  ${t.letter}: ${(t.score * 100).toFixed(0)}%`)
                    .join('\n');
            })()
            : '  (no detection)';

        debugContent.textContent =
            `── TF MODEL (A-Z) ───────────────\n` +
            `Predicted:  ${classResult?.letter ?? '—'}\n` +
            `Confidence: ${classResult ? (classResult.confidence * 100).toFixed(1) + '%' : '—'}\n` +
            `Threshold:  50% / hysteresis 35%\n` +
            `\n── TOP 3 PREDICTIONS ────────────\n` +
            _top3Str + '\n' +
            `\n── LANDMARKS ────────────────────\n` +
            `Raw count:  ${rawLandmarkCount}\n` +
            `\n── STABILIZER ───────────────────\n` +
            `Frames:     ${stabilizer.frameCount}/${stabilizer.requiredFrames}`;

        if (debugMode) debugPanel?.classList.add('visible');
    }

    // ─── Feed stabilizer → sentence builder ───────────────────────────
    stabilizer.update({
        letter: classResult ? classResult.letter : null,
        confidence: classResult ? 'high' : 'none',
    });

    // ─── Sync reference modal highlight ───────────────────────────────
    if (window.updateReferenceHighlight) window.updateReferenceHighlight(classResult ? classResult.letter : null);
}

// ─── Boot ─────────────────────────────────────────────────────────────

(async () => {
    const loadingText = document.querySelector('.loading-text');
    try {
        // 1. Start loading the TF model immediately
        const modelPromise = tf.loadLayersModel('./model/model.json');

        // 2. Set up MediaPipe Hands
        const hands = new Hands({
            locateFile: (file) =>
                `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
        });
        hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.5,
        });
        hands.onResults(onResults);

        // 3. Set up Camera utility (starts the webcam stream)
        const camera = new Camera(videoElement, {
            onFrame: async () => {
                await hands.send({ image: videoElement });
            },
            width: VIDEO_W,
            height: VIDEO_H,
        });

        // 4. Wait for both the TF model AND the camera/video to be ready
        [model] = await Promise.all([modelPromise, camera.start()]);

        // Both ready — reveal the app
        loadingScreen.classList.add('hidden');
        appContainer.classList.add('visible');
    } catch (err) {
        console.error('Vesigna init error:', err);
        if (loadingText) loadingText.textContent = `Load failed: ${err.message}`;
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

const btnCollect = document.getElementById('btnCollect');
if (btnCollect) {
    btnCollect.addEventListener('click', () => {
        if (collectMode) stopCollectMode();
        else startCollectMode();
    });
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
        if (collectMode) {
            recordSample();
        } else {
            sentence.addLetter('SPACE');
            sentence.onChange && sentence.onChange(sentence.getText());
        }
    }
});

// ─── Toast helper ─────────────────────────────────────────────────────

function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}