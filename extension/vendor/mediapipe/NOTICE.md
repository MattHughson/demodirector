# Vendored: MediaPipe Tasks Vision

- `vision_bundle.mjs`, `vision_wasm_internal.js`, `vision_wasm_internal.wasm`: from npm `@mediapipe/tasks-vision@1.2.2` (Apache-2.0, © Google LLC).
- `selfie_segmenter.tflite`: MediaPipe Selfie Segmenter (float16), from `storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/` (Apache-2.0, © Google LLC).

Used by `camera.js` to replace the background behind the presenter. Everything runs locally; nothing is sent anywhere.
- The `sourceMappingURL` comment was removed from `vision_bundle.mjs` (the map isn't shipped).
