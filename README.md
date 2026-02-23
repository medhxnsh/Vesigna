# Vesigna

Vesigna is a lightweight, browser‑based experiment built on **MediaPipe Hands**, focused on clean hand tracking and iterative sign‑recognition research. The project intentionally keeps the UI and codebase minimal to allow fast experimentation and clear version control.

## Features

* Hands‑only MediaPipe setup
* Fullscreen camera with canvas overlay
* Clean, uncluttered UI (no demo controls)
* Simple local development workflow

## Project structure

```
Vesigna/
├─ hands.html   # App entry point
├─ hands.js     # Hand tracking logic
├─ hands.css    # Minimal UI styling
├─ img/
├─ README.md
└─ LICENSE
```

## Run locally

```bash
python3 -m http.server 3000
```

Open:

```
http://localhost:3000/hands.html
```

## Notes

* No build step required
* MediaPipe assets are loaded via CDN
* Designed as a clean base for further iteration

## License

Inherited from the upstream MediaPipe JS demos license.
