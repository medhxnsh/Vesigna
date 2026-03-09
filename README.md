# Vesigna — ASL Fingerspelling Translator

> Real-time American Sign Language fingerspelling recognition, running entirely in the browser. No server. No build step. No dependencies beyond a CDN.

![Version](https://img.shields.io/badge/version-3.0-6c5ce7?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-00cec9?style=flat-square)
![Stack](https://img.shields.io/badge/stack-vanilla%20JS-fdcb6e?style=flat-square)
![MediaPipe](https://img.shields.io/badge/MediaPipe-Tasks%20Vision-a29bfe?style=flat-square)

---

## Overview

Vesigna captures your webcam feed, extracts 21 hand landmarks per frame using MediaPipe, and classifies them into ASL fingerspelling letters through a custom heuristic engine. Committed letters accumulate into a live translation with word autocomplete suggestions.

Dynamic letters J and Z are recognized via fingertip motion trajectory analysis rather than static pose, running in parallel with the static classifier.

---

## Features

- 60 FPS hand tracking with skeleton overlay
- Full A–Z fingerspelling classification (static + motion-based)
- Frame-count stabilizer with progress bar — commit only when held steady
- Word autocomplete suggestions from a built-in dictionary
- BACKSPACE gesture — swipe flat hand left to delete last character
- SPACE gesture — open palm inserts a word boundary
- Live debug panel showing raw feature values for every frame
- In-app ASL reference guide for all 26 letters
- Copy to clipboard, clear, keyboard shortcuts

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/your-username/vesigna.git
cd vesigna

# 2. Serve locally (any static server works)
python3 -m http.server 3000

# 3. Open in Chrome
http://localhost:3000/hands.html
```

> Chrome is recommended. Safari has known issues with the MediaPipe camera utilities. Allow camera access when prompted.

---

## Project Structure

```
vesigna/
├── hands.html        # App entry point
├── hands.js          # Camera loop, MediaPipe wiring, UI logic
├── gesture.js        # Recognition engine: features, classifier, stabilizer
├── hands.css         # Dark glassmorphic theme and layout
└── README.md
```

---

## How It Works

```
Webcam Feed
    │
    ▼
MediaPipe Tasks Vision
(21 hand landmarks per frame)
    │
    ├──► extractFeatures()
    │    Curl ratios, tip positions,
    │    inter-finger distances,
    │    direction flags
    │
    ├──► classifyASL()              ──► Static letter (A–Y)
    │    Heuristic rule engine
    │    (most specific rules first)
    │
    ├──► MotionTracker.update()     ──► Dynamic letter (J, Z)
    │    40-frame fingertip buffer
    │    Trajectory segmentation
    │
    ▼
GestureStabilizer
(requires N consistent frames, then cooldown)
    │
    ▼
SentenceBuilder
(accumulates letters → text)
    │
    ▼
UI Output + Word Suggestions
```

---

## Gesture Reference

### Static Letters

| Letter | Hand Shape |
|--------|-----------|
| A | Fist with thumb resting beside index finger |
| B | Four fingers extended together, thumb folded across palm |
| C | Curved hand as if holding a cup |
| D | Index pointing up, thumb touches middle finger |
| E | All fingers hooked downward, thumb tucked under |
| F | Index and thumb form a circle, three fingers extended |
| G | Index and thumb pointing horizontally |
| H | Index and middle fingers pointing sideways |
| I | Pinky only extended |
| K | Index and middle extended upward, thumb between them |
| L | Index pointing up, thumb pointing out — L shape |
| M | Thumb tucked under three fingers |
| N | Thumb tucked under two fingers |
| O | All fingertips curved to meet thumb |
| P | K shape rotated to point downward |
| Q | G shape rotated to point downward |
| R | Index and middle fingers crossed |
| S | Tight fist, thumb wrapped across front knuckles |
| T | Thumb poking up between index and middle finger |
| U | Index and middle extended together, pointing up |
| V | Index and middle spread apart — peace sign |
| W | Index, middle, and ring fingers spread |
| X | Index finger hooked at the first joint |
| Y | Thumb and pinky extended — shaka / hang loose |

### Dynamic Letters (Motion-Based)

| Letter | Motion |
|--------|--------|
| J | Extend pinky only, trace a J shape downward then hook left |
| Z | Extend index only, trace a Z shape in the air |

### Command Gestures

| Gesture | Action |
|---------|--------|
| Open palm (4+ fingers extended) | Insert space |
| Flat hand swipe left | Delete last character |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Insert space |
| `Backspace` | Delete last character |
| `Escape` | Clear all text |

---

## Debug Mode

Click the **Debug** button in the sidebar to enable the live feature overlay. This shows the raw values the classifier evaluates every frame.

| Field | Description |
|-------|-------------|
| `ext` / `curl` | Whether each finger is extended or fully curled |
| `ratio` | Tip-to-MCP distance divided by palm size |
| `abovePIP` | Whether the fingertip is above its PIP joint |
| `Thumb→XTip` | Normalized distance from thumb tip to each fingertip |
| `IndexDir` | Whether index finger points up, sideways, or down |
| `Static` / `Motion` | Raw output of each classifier before priority resolution |

Use these values to tune thresholds in `gesture.js` when a letter misclassifies on your hand geometry.

---

## Tuning the Classifier

The classifier evaluates rules top-to-bottom — more specific rules must appear before broader ones. If a letter is not recognized or fires incorrectly, enable Debug mode, hold the sign, note the feature values, and adjust the corresponding rule.

```js
// Example: tighten the S rule to require thumb closer to knuckles
if (f.indexCurled && f.middleCurled && f.ringCurled && f.pinkyCurled
    && !f.thumbExtended
    && f.thumbTipToIndexTip < 0.8      // add distance constraint
    && f.thumbCurl < 0.65) {           // require tighter thumb
    return { letter: 'S', confidence: 'medium' };
}
```

To reduce noise during hand transitions, increase the stabilizer frame requirement in `hands.js`:

```js
// requiredFrames: frames held before commit
// cooldownFrames: lockout frames after commit
const stabilizer = new GestureStabilizer(20, 30);
```

---

## Roadmap

- [x] Hand tracking and skeleton rendering at 60 FPS
- [x] Static letter classifier for A–Z (minus J, Z)
- [x] Dynamic letter detection for J and Z via motion trajectory
- [x] Frame stabilization, cooldown, and progress bar
- [x] BACKSPACE swipe gesture and SPACE open-palm gesture
- [x] Word autocomplete suggestions
- [x] Live debug panel and in-app ASL reference guide
- [ ] Custom trained ML model (Teachable Machine / TensorFlow.js) for improved accuracy
- [ ] Text-to-speech output via Web Speech API
- [ ] Multi-hand support for two-handed signs
- [ ] Full ASL word recognition beyond fingerspelling

---

## Dependencies

All loaded via CDN — no install required.

| Library | Purpose |
|---------|---------|
| MediaPipe Tasks Vision | Hand landmark detection |
| TensorFlow.js | Future ML model inference |
| Google Fonts (DM Sans) | UI typography |

---

## License

MIT License. See `LICENSE` for details.

MediaPipe is subject to the Apache 2.0 License from Google.
