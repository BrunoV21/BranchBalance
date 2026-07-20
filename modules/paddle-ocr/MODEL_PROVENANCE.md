# PaddleOCR model provenance

Bundle version: `ppocr-v5-mobile-latin-2026-07-20`

The bundled models are official PaddleOCR inference artifacts converted locally to ONNX opset 11. PaddleOCR and its official models are distributed under the Apache License 2.0. Conversion used Python 3.11.15, PaddlePaddle 3.3.1, PaddleOCR 3.7.0, PaddleX 3.7.2, and the PaddleX-compatible Paddle2ONNX 2.0.2rc3.

| Role | Official artifact | Source SHA-256 | ONNX SHA-256 |
| --- | --- | --- | --- |
| Detection | `PP-OCRv5_mobile_det_infer.tar` | `50446e5d01ac2a73d5319c89513281f6578414c888c602f9af13f93feefffc58` | `a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d` |
| Latin recognition | `latin_PP-OCRv5_mobile_rec_infer.tar` | `b23105a6a1ea38e32a97c5a0ddc7e8a9bbf541d8e47421e2c99e9ccabe29509c` | `3d660629a5f53d9886400f9c4791e0a34972cceed63ad717d1977ba94b102891` |
| Text-line orientation | `PP-LCNet_x1_0_textline_ori_infer.tar` | `6171f69605215a85624d650e9079fa45f7c3eaf944296181bcc5395bf3ddc7f6` | `0c69bacd2ccda224bc78ef3518a5c2dbf8e1014eb19ea42b95cbd1debeb9cc06` |

Source base URL: `https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/`

Runtime dependencies are pinned to ONNX Runtime Android 1.26.0 and OpenCV Android 4.13.0. OpenCV performs only local image geometry and text-region extraction; PaddleOCR performs detection, orientation, and recognition.
