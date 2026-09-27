# UltraFace RFB 320

`ultraface-rfb-320.onnx` is the 1.2 MB face detector from
[Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB](https://github.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB),
revision `dffdddda9794a50607cba8f318507a28c1c27cab`, file
`models/onnx/version-RFB-320.onnx`. Distributed under the accompanying MIT LICENSE.

SHA-256: `34cd7e60aeff28744c657de7a3dc64e872d506741de66987f3426f2b79f88017`.

Input is RGB, 320 × 240, NCHW float32, normalized as `(channel - 127) / 128`.
Outputs `scores` and `boxes` contain face confidence and normalized rectangles.
The model is bundled so production inference requires no model download.
