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
python -m pip install -q --upgrade pip
python -m pip install -q -e "$WORK"   # pulls litellm, pydantic, etc. (needs network)

cat <<'NOTE'

✓ tau2-bench installed.

Next:
  source .tau2/.venv/bin/activate
  export OPENAI_API_KEY=sk-...           # or ANTHROPIC_API_KEY (LiteLLM picks the provider)
  python3 run.py --domain retail --model gpt-4o-mini --tasks 5 --trials 2 --fault-p 0.3
  #   smoke tier ≈ $0.05–0.20

  # second experiment (premature-done gate on unmodified tau2):
  python3 run.py --no-faults --tasks 10 --trials 3

Pin a commit for reproducibility:  (cd .tau2 && git rev-parse HEAD)
NOTE
