# TrueCall Playground

An in-browser, zero-build demo of TrueCall: pick a scenario, flip "silently failed," and watch the
deterministic verifier catch a tool that returned success but didn't change the world.

Static HTML/CSS/JS — no framework, no build, no backend. The verify engine (`engine.js`) mirrors
[`docs/spec.md`](../docs/spec.md); the `file_exists`/`http`/`shell` checks run against a **simulated
environment** in your browser (a real browser has no fs/shell/network-to-localhost).

## Run locally
Open `index.html` in a browser, or serve the folder:
```bash
cd playground && python3 -m http.server 8000   # then open http://localhost:8000
```

## Test the engine
```bash
cd playground && node --test engine.test.js
```

## Deploy (Vercel, static)
```bash
cd playground && vercel deploy --prod --yes
```
