# Third party notices

Testreel is MIT licensed. It bundles or depends on the following.

## Bundled fonts

Inter, Outfit and JetBrains Mono are used in the web UI, the rendered videos and the thumbnails. They are licensed under the SIL Open Font License 1.1, <https://openfontlicense.org>.

- Inter, copyright The Inter Project Authors, <https://github.com/rsms/inter>
- Outfit, copyright The Outfit Project Authors, <https://github.com/Outfitio/Outfit-Fonts>
- JetBrains Mono, copyright The JetBrains Mono Project Authors, <https://github.com/JetBrains/JetBrainsMono>

## npm dependencies

`react`, `react-dom` (MIT), `motion` (MIT), `puppeteer-core` (Apache-2.0). Dev: `typescript` (Apache-2.0), `@types/*` (MIT).

## Installed by `scripts/setup-voice.sh`, not distributed here

- `kokoro-onnx` (MIT) and the Kokoro-82M model files it loads, released under Apache-2.0 at <https://github.com/thewh1teagle/kokoro-onnx>
- `faster-whisper` (MIT) and the `small.en` model it downloads from Hugging Face
- `onnxruntime`, `numpy`, `soundfile` and their dependencies. The phonemizer used by `kokoro-onnx` loads eSpeak NG, which is GPL-3.0 licensed. It runs as a separate library in your own Python environment and is not part of this repository.

Check the licenses of the models and packages yourself if you redistribute videos or a build that includes them.
