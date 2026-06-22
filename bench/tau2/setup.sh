#!/usr/bin/env bash
# Set up tau2-bench for the TrueCall integration (it is MIT but heavy — cloned, not vendored).
# After this, set an LLM API key and run:  python3 run.py --tasks 5 --trials 2
set -euo pipefail
cd "$(dirname "$0")"
WORK=".tau2"   # gitignored

if [ ! -d "$WORK" ]; then
  echo "→ cloning sierra-research/tau2-bench into $WORK ..."
  git clone --depth 1 https://github.com/sierra-research/tau2-bench "$WORK"
fi

echo "→ creating a venv + installing tau2-bench (editable) ..."
python3 -m venv "$WORK/.venv"
# shellcheck disable=SC1091
source "$WORK/.venv/bin/activate"
# Force PUBLIC PyPI: some corp machines pin pip to an internal index that lacks public
# build deps (e.g. hatchling) and needs SSO. Public PyPI is what tau2-bench needs.
PUBPY="https://pypi.org/simple/"
python -m pip install -q --index-url "$PUBPY" --upgrade pip
python -m pip install -q --index-url "$PUBPY" -e "$WORK"   # litellm, pydantic, openai, …
# Python 3.13 removed the stdlib `audioop` that tau2's voice module imports; restore it.
python -m pip install -q --index-url "$PUBPY" audioop-lts 2>/dev/null || true

cat <<'NOTE'

✓ tau2-bench installed.

Next:
  source .tau2/.venv/bin/activate
  export OPENAI_API_KEY=sk-...           # or ANTHROPIC_API_KEY / GEMINI_API_KEY (LiteLLM picks the provider)
  python3 run.py --domain retail --model gpt-4o-mini --tasks 5 --trials 2 --fault-p 0.3
  #   smoke tier ≈ $0.05–0.20

  # Gemini (needs a key on a project with ACTIVE billing — a dunning/billing block returns 403):
  #   export GEMINI_API_KEY=...
  #   python3 run.py --domain retail --model gemini/gemini-2.5-flash --tasks 5 --trials 2 --fault-p 0.3

  # second experiment (premature-done gate on unmodified tau2):
  python3 run.py --no-faults --tasks 10 --trials 3

Pin a commit for reproducibility:  (cd .tau2 && git rev-parse HEAD)
NOTE
