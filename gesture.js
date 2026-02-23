/**
 * gesture.js — ASL Fingerspelling Recognition Engine (v3)
 *
 * Improvements over v2:
 * - Full A–Z coverage including M, N, Q, S, T, X improvements
 * - Classifier order tuned: most specific / constrained rules first
 * - Better thumb position logic (x-relative, tip y vs MCP y)
 * - Improved J/Z trajectory detection with better noise tolerance
 * - BACKSPACE gesture: swipe left with flat open hand
 * - onProgress hook for stabilizer fill bar
 * - Word suggestion engine (getSuggestions)
 *
 * MediaPipe Hand Landmark indices:
 *   0  = WRIST
 *   1  = THUMB_CMC,   2 = THUMB_MCP,  3 = THUMB_IP,   4 = THUMB_TIP
 *   5  = INDEX_MCP,   6 = INDEX_PIP,  7 = INDEX_DIP,  8 = INDEX_TIP
 *   9  = MIDDLE_MCP, 10 = MIDDLE_PIP,11 = MIDDLE_DIP,12 = MIDDLE_TIP
 *  13  = RING_MCP,   14 = RING_PIP,  15 = RING_DIP,  16 = RING_TIP
 *  17  = PINKY_MCP,  18 = PINKY_PIP, 19 = PINKY_DIP, 20 = PINKY_TIP
 */

// ─── Landmark index constants ────────────────────────────────────────
const LM = {
    WRIST: 0,
    THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
    INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
    MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
    RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
    PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
};

// ─── Vector math helpers ─────────────────────────────────────────────

function dist(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function dist2D(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function angleBetween(a, b, c) {
    const ba = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    const bc = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
    const dot = ba.x * bc.x + ba.y * bc.y + ba.z * bc.z;
    const mag1 = Math.sqrt(ba.x ** 2 + ba.y ** 2 + ba.z ** 2);
    const mag2 = Math.sqrt(bc.x ** 2 + bc.y ** 2 + bc.z ** 2);
    if (mag1 === 0 || mag2 === 0) return 0;
    return Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2))));
}

// ─── Feature extraction (v3) ─────────────────────────────────────────

function extractFeatures(lm) {
    const palmSize = dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP]);

    // Position-based extension: tip above PIP joint (lower y = higher on screen)
    const indexTipAbovePIP  = lm[LM.INDEX_TIP].y  < lm[LM.INDEX_PIP].y;
    const middleTipAbovePIP = lm[LM.MIDDLE_TIP].y < lm[LM.MIDDLE_PIP].y;
    const ringTipAbovePIP   = lm[LM.RING_TIP].y   < lm[LM.RING_PIP].y;
    const pinkyTipAbovePIP  = lm[LM.PINKY_TIP].y  < lm[LM.PINKY_PIP].y;

    // Tip-to-MCP distance ratios
    const indexCurl  = dist(lm[LM.INDEX_TIP],  lm[LM.INDEX_MCP])  / palmSize;
    const middleCurl = dist(lm[LM.MIDDLE_TIP], lm[LM.MIDDLE_MCP]) / palmSize;
    const ringCurl   = dist(lm[LM.RING_TIP],   lm[LM.RING_MCP])   / palmSize;
    const pinkyCurl  = dist(lm[LM.PINKY_TIP],  lm[LM.PINKY_MCP])  / palmSize;
    const thumbCurl  = dist(lm[LM.THUMB_TIP],  lm[LM.THUMB_CMC])  / palmSize;

    const EXT_RATIO  = 1.1;
    const CURL_RATIO = 0.9;

    const indexExtended  = indexTipAbovePIP  && indexCurl  > EXT_RATIO;
    const middleExtended = middleTipAbovePIP && middleCurl > EXT_RATIO;
    const ringExtended   = ringTipAbovePIP   && ringCurl   > EXT_RATIO;
    const pinkyExtended  = pinkyTipAbovePIP  && pinkyCurl  > EXT_RATIO;

    const indexCurled  = !indexTipAbovePIP  && indexCurl  < CURL_RATIO;
    const middleCurled = !middleTipAbovePIP && middleCurl < CURL_RATIO;
    const ringCurled   = !ringTipAbovePIP   && ringCurl   < CURL_RATIO;
    const pinkyCurled  = !pinkyTipAbovePIP  && pinkyCurl  < CURL_RATIO;

    // Thumb — lateral anatomy, not vertical
    const thumbTipToIndexBase = dist(lm[LM.THUMB_TIP], lm[LM.INDEX_MCP]) / palmSize;
    const thumbExtended = thumbCurl > 1.0 && thumbTipToIndexBase > 0.6;
    const thumbCurled   = thumbCurl < 0.7;

    // Inter-finger distances
    const indexMiddleDist = dist(lm[LM.INDEX_TIP],  lm[LM.MIDDLE_TIP]) / palmSize;
    const middleRingDist  = dist(lm[LM.MIDDLE_TIP], lm[LM.RING_TIP])   / palmSize;
    const ringPinkyDist   = dist(lm[LM.RING_TIP],   lm[LM.PINKY_TIP])  / palmSize;
    const indexPinkyDist  = dist(lm[LM.INDEX_TIP],  lm[LM.PINKY_TIP])  / palmSize;

    // Thumb-to-finger distances
    const thumbTipToIndexMCP  = dist(lm[LM.THUMB_TIP], lm[LM.INDEX_MCP])  / palmSize;
    const thumbTipToMiddleMCP = dist(lm[LM.THUMB_TIP], lm[LM.MIDDLE_MCP]) / palmSize;
    const thumbTipToIndexTip  = dist(lm[LM.THUMB_TIP], lm[LM.INDEX_TIP])  / palmSize;
    const thumbTipToMiddleTip = dist(lm[LM.THUMB_TIP], lm[LM.MIDDLE_TIP]) / palmSize;
    const thumbTipToRingTip   = dist(lm[LM.THUMB_TIP], lm[LM.RING_TIP])   / palmSize;
    const thumbTipToPinkyTip  = dist(lm[LM.THUMB_TIP], lm[LM.PINKY_TIP])  / palmSize;
    const thumbTipToIndexDIP  = dist(lm[LM.THUMB_TIP], lm[LM.INDEX_DIP])  / palmSize;
    const thumbTipToMiddlePIP = dist(lm[LM.THUMB_TIP], lm[LM.MIDDLE_PIP]) / palmSize;

    // Touch detection
    const TOUCH_THRESH      = 0.45;
    const indexTouchesThumb  = thumbTipToIndexTip  < TOUCH_THRESH;
    const middleTouchesThumb = thumbTipToMiddleTip < TOUCH_THRESH;
    const ringTouchesThumb   = thumbTipToRingTip   < TOUCH_THRESH;
    const pinkyTouchesThumb  = thumbTipToPinkyTip  < TOUCH_THRESH;

    // Extended count
    const extendedCount = [indexExtended, middleExtended, ringExtended, pinkyExtended]
        .filter(Boolean).length + (thumbExtended ? 1 : 0);

    // PIP bend angles
    const indexPIPAngle  = angleBetween(lm[LM.INDEX_MCP],  lm[LM.INDEX_PIP],  lm[LM.INDEX_DIP]);
    const middlePIPAngle = angleBetween(lm[LM.MIDDLE_MCP], lm[LM.MIDDLE_PIP], lm[LM.MIDDLE_DIP]);

    // DIP/tip positions for hooked fingers
    const indexDIPAbovePIP = lm[LM.INDEX_DIP].y < lm[LM.INDEX_PIP].y;
    const indexTipBelowDIP = lm[LM.INDEX_TIP].y > lm[LM.INDEX_DIP].y;

    // Finger pointing direction
    const indexPointsUp   = (lm[LM.INDEX_MCP].y - lm[LM.INDEX_TIP].y) > 0.05;
    const indexPointsSide = Math.abs(lm[LM.INDEX_TIP].x - lm[LM.INDEX_MCP].x) >
                            Math.abs(lm[LM.INDEX_TIP].y - lm[LM.INDEX_MCP].y);
    const indexPointsDown = lm[LM.INDEX_TIP].y > lm[LM.INDEX_MCP].y + 0.02;

    // Wrist-relative tip positions
    const indexTipBelowWrist  = lm[LM.INDEX_TIP].y  > lm[LM.WRIST].y;
    const middleTipBelowWrist = lm[LM.MIDDLE_TIP].y > lm[LM.WRIST].y;

    return {
        palmSize,
        indexCurl, middleCurl, ringCurl, pinkyCurl, thumbCurl,
        indexTipAbovePIP, middleTipAbovePIP, ringTipAbovePIP, pinkyTipAbovePIP,
        indexExtended, middleExtended, ringExtended, pinkyExtended, thumbExtended,
        indexCurled, middleCurled, ringCurled, pinkyCurled, thumbCurled,
        indexMiddleDist, middleRingDist, ringPinkyDist, indexPinkyDist,
        thumbTipToIndexMCP, thumbTipToMiddleMCP,
        thumbTipToIndexTip, thumbTipToMiddleTip, thumbTipToRingTip, thumbTipToPinkyTip,
        thumbTipToIndexBase, thumbTipToIndexDIP, thumbTipToMiddlePIP,
        indexTouchesThumb, middleTouchesThumb, ringTouchesThumb, pinkyTouchesThumb,
        indexPIPAngle, middlePIPAngle,
        indexDIPAbovePIP, indexTipBelowDIP,
        indexPointsUp, indexPointsSide, indexPointsDown,
        extendedCount,
        indexTipBelowWrist, middleTipBelowWrist,
    };
}

// ─── ASL Fingerspelling Classifier (v3) ──────────────────────────────
// Rules are ordered most-specific first to prevent broad rules from
// shadowing narrower ones. Test by holding real ASL shapes.

function classifyASL(landmarks) {
    const f  = extractFeatures(landmarks);
    const lm = landmarks;

    // ── 5-finger open palm ──────────────────────────────────────────
    if (f.extendedCount === 5) {
        return { letter: 'SPACE', confidence: 'medium' };
    }

    // ── B: all 4 fingers up and together, thumb folded across ───────
    if (f.indexExtended && f.middleExtended && f.ringExtended && f.pinkyExtended
        && !f.thumbExtended
        && f.indexMiddleDist < 0.45 && f.middleRingDist < 0.45) {
        return { letter: 'B', confidence: 'high' };
    }

    // ── W: index + middle + ring spread, pinky curled ───────────────
    if (f.indexExtended && f.middleExtended && f.ringExtended && !f.pinkyExtended
        && f.pinkyCurled
        && f.indexMiddleDist > 0.2 && f.middleRingDist > 0.2) {
        return { letter: 'W', confidence: 'high' };
    }

    // ── V: index + middle spread, ring + pinky curled ───────────────
    if (f.indexExtended && f.middleExtended && f.ringCurled && f.pinkyCurled
        && f.indexMiddleDist >= 0.45 && !f.thumbExtended) {
        return { letter: 'V', confidence: 'high' };
    }

    // ── K: index + middle up, thumb between, spread ─────────────────
    if (f.indexExtended && f.middleExtended && f.ringCurled && f.pinkyCurled
        && f.thumbExtended && f.indexMiddleDist > 0.3
        && f.thumbTipToMiddleMCP < 0.7 && f.indexPointsUp) {
        return { letter: 'K', confidence: 'medium' };
    }

    // ── P: like K but pointing down ─────────────────────────────────
    if (f.indexExtended && f.middleExtended && f.ringCurled && f.pinkyCurled
        && f.thumbExtended && f.indexPointsDown) {
        return { letter: 'P', confidence: 'medium' };
    }

    // ── H: index + middle horizontal/sideways, ring + pinky curled ──
    if (f.indexExtended && f.middleExtended && f.ringCurled && f.pinkyCurled
        && f.indexPointsSide && !f.thumbExtended) {
        return { letter: 'H', confidence: 'medium' };
    }

    // ── U: index + middle together pointing up ───────────────────────
    if (f.indexExtended && f.middleExtended && f.ringCurled && f.pinkyCurled
        && f.indexMiddleDist >= 0.15 && f.indexMiddleDist < 0.45
        && !f.thumbExtended && f.indexPointsUp) {
        return { letter: 'U', confidence: 'medium' };
    }

    // ── R: index + middle crossed (very close), pointing up ─────────
    if (f.indexExtended && f.middleExtended && f.ringCurled && f.pinkyCurled
        && f.indexMiddleDist < 0.18 && !f.thumbExtended) {
        return { letter: 'R', confidence: 'medium' };
    }

    // ── L: index up + thumb sideways (classic L) ────────────────────
    if (f.indexExtended && f.middleCurled && f.ringCurled && f.pinkyCurled
        && f.thumbExtended && f.indexPointsUp) {
        return { letter: 'L', confidence: 'high' };
    }

    // ── G: index + thumb horizontal (gun shape sideways) ────────────
    if (f.indexExtended && f.middleCurled && f.ringCurled && f.pinkyCurled
        && f.thumbExtended && f.indexPointsSide) {
        return { letter: 'G', confidence: 'medium' };
    }

    // ── Q: index + thumb pointing down ──────────────────────────────
    if (f.indexExtended && f.middleCurled && f.ringCurled && f.pinkyCurled
        && f.thumbExtended && f.indexPointsDown) {
        return { letter: 'Q', confidence: 'medium' };
    }

    // ── D: index up, thumb touches middle ───────────────────────────
    if (f.indexExtended && f.middleCurled && f.ringCurled && f.pinkyCurled
        && f.middleTouchesThumb && !f.thumbExtended) {
        return { letter: 'D', confidence: 'high' };
    }

    // ── X: index hooked (bent at PIP, tip curves toward palm) ───────
    if (!f.indexExtended && !f.indexCurled
        && f.middleCurled && f.ringCurled && f.pinkyCurled && !f.thumbExtended
        && f.indexTipBelowDIP && f.indexDIPAbovePIP) {
        return { letter: 'X', confidence: 'medium' };
    }

    // ── Y: thumb + pinky extended (shaka / hang loose) ──────────────
    if (f.thumbExtended && f.pinkyExtended
        && f.indexCurled && f.middleCurled && f.ringCurled) {
        return { letter: 'Y', confidence: 'high' };
    }

    // ── I: pinky only extended ───────────────────────────────────────
    if (f.pinkyExtended && f.indexCurled && f.middleCurled && f.ringCurled
        && !f.thumbExtended) {
        return { letter: 'I', confidence: 'high' };
    }

    // ── F: index + thumb circle, middle/ring/pinky extended ─────────
    if (f.middleExtended && f.ringExtended && f.pinkyExtended
        && f.indexTouchesThumb && !f.indexExtended) {
        return { letter: 'F', confidence: 'high' };
    }

    // ── O: all fingers curving to meet thumb ────────────────────────
    if (f.indexTouchesThumb && f.thumbTipToMiddleTip < 0.7
        && !f.indexExtended && !f.middleExtended && !f.ringExtended && !f.pinkyExtended) {
        return { letter: 'O', confidence: 'medium' };
    }

    // ── C: curved C shape, gap between fingertips and thumb ─────────
    if (!f.indexExtended && !f.indexCurled
        && !f.middleExtended && !f.middleCurled
        && f.thumbTipToIndexTip > 0.5 && f.thumbTipToIndexTip < 1.4
        && f.thumbExtended && f.indexMiddleDist < 0.6) {
        return { letter: 'C', confidence: 'medium' };
    }

    // ─── Fist variants — order: T → N → M → A → S ───────────────────
    // T: thumb pokes up between index and middle finger
    if (f.indexCurled && f.middleCurled && f.ringCurled && f.pinkyCurled
        && !f.thumbExtended
        && f.thumbTipToIndexDIP < 0.5
        && lm[LM.THUMB_TIP].y < lm[LM.INDEX_MCP].y
        && lm[LM.THUMB_TIP].y > lm[LM.INDEX_DIP].y) {
        return { letter: 'T', confidence: 'medium' };
    }

    // N: thumb tucked under 2 fingers (index + middle)
    if (f.indexCurled && f.middleCurled && f.ringCurled && f.pinkyCurled
        && !f.thumbExtended
        && f.thumbTipToIndexTip < 0.65 && f.thumbTipToMiddleTip < 0.65
        && lm[LM.THUMB_TIP].y > lm[LM.INDEX_DIP].y) {
        return { letter: 'N', confidence: 'low' };
    }

    // M: thumb tucked under 3 fingers (index + middle + ring)
    if (f.indexCurled && f.middleCurled && f.ringCurled && f.pinkyCurled
        && !f.thumbExtended
        && f.thumbTipToIndexTip < 0.75 && f.thumbTipToMiddleTip < 0.75 && f.thumbTipToRingTip < 0.75
        && lm[LM.THUMB_TIP].y > lm[LM.INDEX_DIP].y) {
        return { letter: 'M', confidence: 'low' };
    }

    // A: fist with thumb alongside index (thumb rests beside, not under fingers)
    if (f.indexCurled && f.middleCurled && f.ringCurled && f.pinkyCurled
        && f.thumbExtended && f.thumbTipToIndexMCP < 0.8) {
        return { letter: 'A', confidence: 'high' };
    }

    // E: fingers hooked (bent but not fully closed), thumb tucked under
    if (!f.indexExtended && !f.middleExtended && !f.ringExtended && !f.pinkyExtended
        && !f.indexCurled && !f.middleCurled && !f.thumbExtended
        && f.thumbTipToIndexTip < 0.7 && f.indexTipBelowWrist) {
        return { letter: 'E', confidence: 'medium' };
    }

    // S: tight fist, thumb wrapped across front (stricter — avoids false positives)
    if (f.indexCurled && f.middleCurled && f.ringCurled && f.pinkyCurled
        && !f.thumbExtended
        && f.thumbTipToIndexTip < 0.8
        && f.thumbCurl < 0.65) {
        return { letter: 'S', confidence: 'medium' };
    }

    return { letter: null, confidence: 'none' };
}

// ─── Motion Tracker (v3) ─────────────────────────────────────────────

class MotionTracker {
    constructor(bufferSize = 40) {
        this.bufferSize      = bufferSize;
        this.indexBuffer     = [];
        this.pinkyBuffer     = [];
        this.cooldown        = 0;
        this.COOLDOWN_FRAMES = 35;
    }

    update(landmarks, features) {
        if (this.cooldown > 0) {
            this.cooldown--;
            return { letter: null, confidence: 'none', trail: [] };
        }

        const indexTip = { x: landmarks[LM.INDEX_TIP].x, y: landmarks[LM.INDEX_TIP].y };
        const pinkyTip = { x: landmarks[LM.PINKY_TIP].x, y: landmarks[LM.PINKY_TIP].y };

        this.indexBuffer.push(indexTip);
        this.pinkyBuffer.push(pinkyTip);
        if (this.indexBuffer.length > this.bufferSize) this.indexBuffer.shift();
        if (this.pinkyBuffer.length > this.bufferSize) this.pinkyBuffer.shift();

        if (this.indexBuffer.length < 15) {
            return { letter: null, confidence: 'none', trail: [] };
        }

        // Z: index finger extended only → trace Z shape
        if (features.indexExtended && features.middleCurled && features.ringCurled && features.pinkyCurled) {
            if (this._detectZ(this.indexBuffer)) {
                this.cooldown    = this.COOLDOWN_FRAMES;
                this.indexBuffer = [];
                return { letter: 'Z', confidence: 'high', trail: [] };
            }
            return { letter: null, confidence: 'none', trail: this.indexBuffer.slice() };
        }

        // J: pinky extended only → trace J shape
        if (features.pinkyExtended && features.indexCurled && features.middleCurled && features.ringCurled
            && !features.thumbExtended) {
            if (this._detectJ(this.pinkyBuffer)) {
                this.cooldown    = this.COOLDOWN_FRAMES;
                this.pinkyBuffer = [];
                return { letter: 'J', confidence: 'high', trail: [] };
            }
            return { letter: null, confidence: 'none', trail: this.pinkyBuffer.slice() };
        }

        // BACKSPACE: flat hand, swipe left quickly
        if (features.indexExtended && features.middleExtended && features.ringExtended && features.pinkyExtended) {
            if (this._detectSwipeLeft(this.indexBuffer)) {
                this.cooldown    = this.COOLDOWN_FRAMES;
                this.indexBuffer = [];
                return { letter: 'BACKSPACE', confidence: 'medium', trail: [] };
            }
        }

        return { letter: null, confidence: 'none', trail: [] };
    }

    _detectZ(buffer) {
        const segs = this._getSegments(buffer);
        if (segs.length < 3) return false;
        for (let i = 0; i <= segs.length - 3; i++) {
            const [s1, s2, s3] = [segs[i], segs[i+1], segs[i+2]];
            const ok =
                s1.dx > 0 && Math.abs(s1.dx) > Math.abs(s1.dy) * 0.5 && Math.abs(s1.dx) > 0.025 &&
                s2.dx < 0 && s2.dy > 0 && Math.sqrt(s2.dx**2 + s2.dy**2) > 0.025 &&
                s3.dx > 0 && Math.abs(s3.dx) > Math.abs(s3.dy) * 0.5 && Math.abs(s3.dx) > 0.025;
            if (ok) return true;
        }
        return false;
    }

    _detectJ(buffer) {
        const segs = this._getSegments(buffer);
        if (segs.length < 2) return false;
        for (let i = 0; i <= segs.length - 2; i++) {
            const [s1, s2] = [segs[i], segs[i+1]];
            const ok =
                s1.dy > 0 && Math.abs(s1.dy) > Math.abs(s1.dx) * 0.5 && Math.abs(s1.dy) > 0.025 &&
                (s2.dx < 0 || s2.dy < 0) && Math.sqrt(s2.dx**2 + s2.dy**2) > 0.025;
            if (ok) return true;
        }
        return false;
    }

    _detectSwipeLeft(buffer) {
        if (buffer.length < 8) return false;
        const recent = buffer.slice(-14);
        const netX = recent[recent.length - 1].x - recent[0].x;
        const netY = Math.abs(recent[recent.length - 1].y - recent[0].y);
        return netX < -0.12 && netY < 0.08;
    }

    _getSegments(buffer) {
        if (buffer.length < 3) return [];
        const sampled = [];
        for (let i = 0; i < buffer.length; i += 3) sampled.push(buffer[i]);
        if (sampled.length < 2) return [];

        const deltas = [];
        for (let i = 1; i < sampled.length; i++) {
            deltas.push({
                dx: sampled[i].x - sampled[i-1].x,
                dy: sampled[i].y - sampled[i-1].y,
            });
        }

        const segs = [];
        let cur = { ...deltas[0] };
        for (let i = 1; i < deltas.length; i++) {
            const d = deltas[i];
            const dot = cur.dx * d.dx + cur.dy * d.dy;
            const m1  = Math.sqrt(cur.dx**2 + cur.dy**2);
            const m2  = Math.sqrt(d.dx**2 + d.dy**2);
            if (m1 > 0 && m2 > 0 && dot / (m1 * m2) > 0.3) {
                cur.dx += d.dx; cur.dy += d.dy;
            } else {
                segs.push(cur);
                cur = { ...d };
            }
        }
        segs.push(cur);
        return segs;
    }

    reset() {
        this.indexBuffer = [];
        this.pinkyBuffer = [];
        this.cooldown    = 0;
    }
}

// ─── Gesture Stabilizer ───────────────────────────────────────────────

class GestureStabilizer {
    constructor(requiredFrames = 12, cooldownFrames = 20) {
        this.requiredFrames  = requiredFrames;
        this.cooldownFrames  = cooldownFrames;
        this.currentLetter   = null;
        this.frameCount      = 0;
        this.cooldownCounter = 0;
        this.lastCommitted   = null;
        this.onLetterCommit  = null;
        this.onProgress      = null; // (progress: 0-1, letter: string|null) => void
    }

    update(result) {
        if (this.cooldownCounter > 0) {
            this.cooldownCounter--;
            return null;
        }

        if (!result.letter || result.confidence === 'none') {
            this.currentLetter = null;
            this.frameCount    = 0;
            if (this.onProgress) this.onProgress(0, null);
            return null;
        }

        if (result.letter === this.currentLetter) {
            this.frameCount++;
        } else {
            this.currentLetter = result.letter;
            this.frameCount    = 1;
        }

        const progress = Math.min(this.frameCount / this.requiredFrames, 1);
        if (this.onProgress) this.onProgress(progress, this.currentLetter);

        if (this.frameCount >= this.requiredFrames) {
            this.lastCommitted   = this.currentLetter;
            this.frameCount      = 0;
            this.cooldownCounter = this.cooldownFrames;
            if (this.onLetterCommit) this.onLetterCommit(this.lastCommitted);
            return this.lastCommitted;
        }

        return null;
    }

    reset() {
        this.currentLetter   = null;
        this.frameCount      = 0;
        this.cooldownCounter = 0;
        this.lastCommitted   = null;
        if (this.onProgress) this.onProgress(0, null);
    }
}

// ─── Sentence Builder ─────────────────────────────────────────────────

class SentenceBuilder {
    constructor() {
        this.text     = '';
        this.onChange = null;
    }

    addLetter(letter) {
        if (letter === 'SPACE') {
            this.text += ' ';
        } else if (letter === 'BACKSPACE') {
            this.text = this.text.slice(0, -1);
        } else {
            this.text += letter;
        }
        if (this.onChange) this.onChange(this.text);
    }

    clear() {
        this.text = '';
        if (this.onChange) this.onChange(this.text);
    }

    getText() { return this.text; }
}

// ─── Word suggestion engine ───────────────────────────────────────────

const WORD_LIST = [
    'ABOUT','ABOVE','AFTER','AGAIN','ALSO','ALWAYS','AND','ANOTHER','ANY','ARE',
    'AROUND','ASL','AWAY','BACK','BECAUSE','BEEN','BEFORE','BOTH','BUT','BY',
    'CALL','CAN','COME','COULD','DIFFERENT','DO','DOES','DONE','DOWN','EACH',
    'EVEN','EVERY','FEEL','FIND','FIRST','FOR','FROM','GET','GIVE','GO',
    'GOOD','GREAT','HAND','HAPPY','HAVE','HE','HELLO','HELP','HER','HERE',
    'HIM','HIS','HOW','IF','IN','INTO','IS','IT','ITS','JUST','KNOW',
    'LEARN','LIKE','LITTLE','LOOK','LOVE','MAKE','MANY','ME','MORE','MOST',
    'MY','NAME','NEW','NO','NOT','NOW','OF','OFF','ON','ONE','ONLY','OR',
    'OTHER','OUR','OUT','OVER','OWN','PEOPLE','PLACE','PRACTICE','PUT','REALLY',
    'SAME','SAY','SEE','SHE','SHOULD','SIGN','SINCE','SOME','SOMETHING',
    'STILL','STUDY','SUCH','TAKE','THANK','THAT','THE','THEIR','THEM',
    'THEN','THERE','THESE','THEY','THINK','THIS','THOSE','THROUGH','TIME',
    'TO','TODAY','TOO','UNDER','UP','USE','VERY','WANT','WAS','WAY','WE',
    'WELL','WERE','WHAT','WHEN','WHERE','WHICH','WHO','WILL','WITH','WORD',
    'WORLD','WOULD','YEAR','YOU','YOUR',
];

/**
 * Returns up to `limit` completions for the current partial word.
 * @param {string} prefix  – current partial word (case-insensitive)
 * @param {number} limit
 */
function getSuggestions(prefix, limit = 4) {
    if (!prefix || prefix.length < 2) return [];
    const upper = prefix.toUpperCase();
    return WORD_LIST.filter(w => w.startsWith(upper)).slice(0, limit);
}

// ─── Exports ──────────────────────────────────────────────────────────

export { classifyASL, extractFeatures, GestureStabilizer, SentenceBuilder, MotionTracker, getSuggestions, LM };