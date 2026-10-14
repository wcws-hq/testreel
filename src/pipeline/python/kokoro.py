#!/usr/bin/env python
"""Local text to speech worker for the voice stage.

Usage: kokoro.py <kokoro.onnx> <voices.bin>
Reads one JSON job per line on stdin and answers with one JSON line on the real stdout:
  job   {"out": "<path>.wav", "voice": "af_heart", "text": "...", "speed": 1.0}
  reply {"ok": true, "dur": <seconds>, "words": [{"w": "word", "s": 0.0, "e": 0.3}]}
        {"ok": false, "error": "..."}
The first line printed is {"ready": true} once both models are loaded.

[pause] is 0.7 s and [beat] is 0.35 s of silence. The clip is written as 24 kHz mono 16 bit wav with its edge
silence trimmed, so a gap chosen by the caller is the real gap. Word times come from faster-whisper over the
finished clip, in seconds from the start of the written file; where its words line up with the script the
script's own spelling is used so on-screen callouts can match the written words."""
import difflib
import json
import os
import re
import sys

import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel
from kokoro_onnx import Kokoro

# Replies go to the original stdout; anything the libraries print is sent to stderr instead.
reply_out = os.fdopen(os.dup(1), "w")
os.dup2(2, 1)

BREAKS = {"pause": 0.7, "beat": 0.35}
MARKERS = re.compile(r"\s*\[(pause|beat)\]\s*", re.I)
SILENCE_FLOOR = 0.003
KEEP_HEAD = 0.05
KEEP_TAIL = 0.08


def say(obj):
    reply_out.write(json.dumps(obj) + "\n")
    reply_out.flush()


def synthesize(kokoro, job):
    chunks, rate = [], 24000
    for part in MARKERS.split(job["text"]):
        if part.lower() in BREAKS:
            chunks.append(np.zeros(int(rate * BREAKS[part.lower()]), dtype=np.float32))
        elif part.strip():
            audio, rate = kokoro.create(part.strip(), voice=job["voice"], speed=job["speed"], lang="en-us")
            chunks.append(audio.astype(np.float32))
    audio = np.concatenate(chunks)
    loud = np.flatnonzero(np.abs(audio) > SILENCE_FLOOR)
    if loud.size:
        audio = audio[max(0, loud[0] - int(KEEP_HEAD * rate)) : min(len(audio), loud[-1] + int(KEEP_TAIL * rate))]
    return audio, rate


def norm(word):
    return re.sub(r"[^a-z0-9]", "", word.lower())


def spell(spoken, heard):
    """Heard words, replaced by the script's spelling wherever the two line up."""
    out = [h[0] for h in heard]
    matcher = difflib.SequenceMatcher(a=[norm(w) for w in spoken], b=[norm(h[0]) for h in heard], autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal" or (tag == "replace" and i2 - i1 == j2 - j1):
            out[j1:j2] = spoken[i1:i2]
    return out


CONTINUATION = re.compile(r"^[.,'\u2019%:;!?)\]\-\u2010-\u2014]")


def merge_split(heard):
    """Glue tokens that start with punctuation (',235', '.1') onto the word before them."""
    out = []
    for text, start, end in heard:
        if out and CONTINUATION.match(text):
            out[-1] = (out[-1][0] + text, out[-1][1], max(out[-1][2], end))
        else:
            out.append((text, start, end))
    return out


def transcribe(whisper, path, text):
    segments, _ = whisper.transcribe(path, word_timestamps=True, language="en", beam_size=5)
    heard = merge_split([(w.word.strip(), w.start, w.end) for s in segments for w in s.words if w.word.strip()])
    spoken = MARKERS.sub(" ", text).split()
    return [{"w": w, "s": round(h[1], 3), "e": round(h[2], 3)} for w, h in zip(spell(spoken, heard), heard)]


def main():
    kokoro = Kokoro(sys.argv[1], sys.argv[2])
    whisper = WhisperModel("small.en", device="cpu", compute_type="int8")
    say({"ready": True})
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            job = json.loads(line)
            audio, rate = synthesize(kokoro, job)
            tmp = job["out"] + ".part.wav"
            sf.write(tmp, audio, rate, subtype="PCM_16")
            words = transcribe(whisper, tmp, job["text"])
            os.replace(tmp, job["out"])
            say({"ok": True, "dur": len(audio) / rate, "words": words})
        except Exception as e:  # reported to the caller, which decides what to do
            say({"ok": False, "error": f"{type(e).__name__}: {e}"})


main()
