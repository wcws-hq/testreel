#!/usr/bin/env bash
# Sets up the local text-to-speech voice: a Python virtual environment and the Kokoro model files.
# Everything goes into the settings folder (default ~/.testreel, override with TESTREEL_SETTINGS).
#
#   bash scripts/setup-voice.sh            full setup (about 400 MB download)
#   bash scripts/setup-voice.sh --no-models  only the Python environment
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS="${TESTREEL_SETTINGS:-$HOME/.testreel}"
VENV="$SETTINGS/.venv"
MODELS="$SETTINGS/assets/kokoro"
BASE="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"

# kokoro-onnx needs Python 3.10 to 3.12.
PY=""
for candidate in python3.12 python3.11 python3.10 python3; do
  if command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -c 'import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 12) else 1)'; then
      PY="$candidate"
      break
    fi
  fi
done
if [ -z "$PY" ]; then
  echo "Python 3.10, 3.11 or 3.12 is required (kokoro-onnx does not support newer versions yet)." >&2
  echo "On macOS: brew install python@3.12" >&2
  exit 1
fi

mkdir -p "$SETTINGS"
if [ ! -x "$VENV/bin/python" ]; then
  echo "Creating the Python environment in $VENV with $("$PY" --version)"
  "$PY" -m venv "$VENV"
fi
"$VENV/bin/python" -m pip install --quiet --upgrade pip
"$VENV/bin/python" -m pip install --quiet -r "$HERE/requirements-voice.txt"
echo "Python packages installed."

if [ "${1:-}" = "--no-models" ]; then
  echo "Skipped the model files. Put kokoro-v1.0.onnx and voices-v1.0.bin in $MODELS"
  exit 0
fi

mkdir -p "$MODELS"
for file in kokoro-v1.0.onnx voices-v1.0.bin; do
  if [ -s "$MODELS/$file" ]; then
    echo "$file is already there."
  else
    echo "Downloading $file"
    curl -L --fail --progress-bar -C - -o "$MODELS/$file" "$BASE/$file"
  fi
done

echo "Done. The voice is ready in $SETTINGS"
echo "The first run also downloads the small.en speech-recognition model (about 460 MB) used to time the words."
