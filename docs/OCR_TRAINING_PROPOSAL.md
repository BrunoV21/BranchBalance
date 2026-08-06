# BranchBalance — Low-footprint OCR adaptation proposal

**Status:** Proposed

**Date:** 2026-08-06

**Related product scope:** PRD CR-006 — Private on-device receipt scanning

## 1. Decision requested

Approve a developer-managed, offline OCR improvement workflow that uses a private receipt dataset maintained independently from BranchBalance member data.

The first implementation should not add a general key-information-extraction or vision-language model to the Android application. It should:

1. benchmark the current PaddleOCR and deterministic parser pipeline;
2. learn small field-ranking weights when OCR text is correct but field selection is wrong;
3. fine-tune and replace an existing PaddleOCR detection or recognition model only when the benchmark identifies that model as the limiting stage; and
4. retain all deterministic validation, confidence gating, manual review, and explicit-save safeguards from CR-006.

This approach targets better receipt-field accuracy without materially increasing the APK. Training images, annotations, intermediate crops, and evaluation outputs are development assets and must never be included in the mobile application, GitHub-backed group repositories, telemetry, or production logs.

## 2. Context

The current receipt pipeline has two distinct responsibilities:

```text
receipt image
    -> PaddleOCR text detection, text-line orientation, and recognition
    -> text blocks with transcription, confidence, and quadrilateral coordinates
    -> deterministic TypeScript receipt parser
    -> editable Description, Amount, and Date prefills
```

The native PaddleOCR boundary finds and transcribes text. The TypeScript parser selects merchant, date, currency, subtotal, tax, tip, and total candidates using text, geometry, confidence, and arithmetic checks.

Expected receipt fields such as `merchant`, `date`, and `total_minor` are therefore not direct labels for ordinary OCR recognition training:

- text detection training needs receipt images and text-region polygons;
- text recognition training needs text-line crops and exact transcriptions; and
- field extraction training needs expected normalized values and the source text regions from which those values were derived.

A developer-maintained dataset can support all three tasks, but each task must consume only the annotations it needs.

## 3. Goals and non-goals

### 3.1 Goals

- Improve exact-match accuracy for merchant, receipt date, currency, and final total.
- Preserve high precision: uncertain fields remain blank and fall back to manual entry.
- Attribute failures to detection, recognition, field selection, or deterministic validation before changing a model.
- Keep inference fully on-device and offline.
- Avoid a material increase in packaged OCR assets.
- Make dataset versions, splits, training inputs, model provenance, and benchmark results reproducible.
- Keep the training dataset independent from application users and production corrections.

### 3.2 Non-goals

- Learning from BranchBalance member receipts, edits, or corrections.
- Shipping training data, receipt images, OCR output, or labels in the application.
- Automatic category, payment-method, payer, split, or participant selection.
- Item-level receipt extraction.
- Adding LayoutXLM, a general KIE transformer, or a local VLM in the first adaptation increment.
- Replacing deterministic date, currency, amount, ambiguity, or arithmetic validation with a model decision.
- Automatically saving an expense.

## 4. Proposed technical strategy

### 4.1 Measure before training

Run the current production-equivalent ONNX bundle and parser over a frozen validation and test set. For every incorrect or withheld field, assign one failure class:

| Failure class | Diagnostic | Preferred action |
| --- | --- | --- |
| Detection | The source text region was not returned or its box is unusable | Fine-tune and replace the detection model |
| Recognition | The source region was found but its transcription is wrong | Fine-tune and replace the recognition model |
| Field selection | The correct text exists in OCR output but the parser selected another block or abstained incorrectly | Train the lightweight field ranker or adjust deterministic candidate logic |
| Validation | The correct candidate was selected but normalization, ambiguity, currency, or arithmetic handling is wrong | Correct deterministic TypeScript logic and tests |
| Expected abstention | The receipt is ambiguous, unsupported, illegible, or unsafe to prefill | Preserve the manual fallback; do not train around it |

Field-level accuracy alone is insufficient because it cannot identify which stage should change.

### 4.2 Lightweight field ranker — default path

The default learned component should be a candidate ranker, not a document-understanding model.

The existing deterministic parser continues to generate bounded candidates:

- amount candidates from valid monetary strings;
- date candidates from valid calendar-date patterns;
- merchant candidates from prominent text near the top of the receipt; and
- currency candidates from explicit supported symbols and codes.

For each candidate, TypeScript derives a fixed feature vector. Suitable features include:

- normalized horizontal and vertical position;
- OCR confidence;
- box width and height relative to the image;
- alphabetic, numeric, and punctuation ratios;
- same-line and nearest-neighbour distance from known labels;
- label tokens such as `TOTAL`, `AMOUNT DUE`, `A PAGAR`, and `VALOR TOTAL`;
- exclusion tokens such as `SUBTOTAL`, `IVA`, `TAX`, `TIP`, `CHANGE`, and `TROCO`;
- locale and explicit-currency evidence;
- agreement with subtotal, tax, and tip arithmetic; and
- score separation from the next-best candidate.

Training can use logistic regression or another bounded linear model per field. The resulting coefficients and calibration thresholds should be exported as generated TypeScript constants. No new inference dependency or ONNX session is required. The expected packaged size is measured in kilobytes rather than megabytes.

The ranker proposes a candidate and confidence. The existing deterministic validation remains authoritative and may reject the result.

### 4.3 Conditional PaddleOCR fine-tuning

Fine-tune PaddleOCR only when held-out failure attribution shows that detection or transcription is a material bottleneck.

For detection:

- use original receipt images with quadrilateral annotations for all text lines required by the training configuration;
- begin from the matching PP-OCR mobile detection training checkpoint;
- preserve the detector input/output contract expected by the Kotlin post-processing; and
- replace `text_detection.onnx` rather than adding a second detector.

For recognition:

- derive perspective-corrected text-line crops from reviewed polygons;
- label every crop with its exact transcription;
- begin from the matching Latin PP-OCR mobile recognition training checkpoint;
- preserve the current character dictionary, CTC blank/space handling, input height, and output tensor contract unless a native-code change is separately approved; and
- replace `text_recognition.onnx` rather than adding a second recognizer.

The checked-in ONNX inference files are not training checkpoints and must not be fine-tuned in place. Training occurs in PaddlePaddle, followed by inference export, Paddle-to-ONNX conversion, compatibility verification, and physical-device benchmarking.

### 4.4 Model-size optimization after accuracy

Once a replacement model passes the float-model benchmark, the developer may evaluate static INT8 quantization using a representative calibration subset. Quantized and float models must be compared on the same frozen test set and physical devices. A size reduction does not justify a field-precision, latency, memory, or operator-compatibility regression.

Text-line orientation should also be tested as an ablation. If it does not materially improve the agreed receipt matrix, removing its model and session is preferable to keeping an unnecessary model or using the saved space for a larger extractor.

## 5. Dataset ownership and storage

### 5.1 Storage boundary

The canonical dataset should live outside this repository in a private, access-controlled directory. Images should be stored as files rather than SQLite BLOBs; SQLite stores stable paths, hashes, labels, polygons, provenance, split membership, and evaluation metadata.

Recommended layout:

```text
branchbalance-ocr-dataset/
├── dataset.sqlite
├── manifests/
│   ├── dataset-v001.json
│   └── checksums-v001.sha256
├── images/
│   ├── original/
│   │   └── <receipt-id>.<ext>
│   └── redacted/
│       └── <receipt-id>.<ext>
├── derived/                         # reproducible; safe to delete
│   ├── recognition-crops/
│   └── prepared-images/
├── predictions/                     # generated benchmark output
│   └── <model-bundle>/<parser-version>/
└── exports/                         # generated training inputs
    └── <dataset-version>/
        ├── field-ranking/
        ├── paddle-detection/
        └── paddle-recognition/
```

Only explicitly synthetic fixtures that are safe for public repository history may be copied into BranchBalance automated tests. A `.gitignore` rule is not an adequate privacy boundary for a real private dataset; the canonical dataset should have a separate root.

### 5.2 Dataset provenance

Every image must declare one of these source kinds:

- `synthetic` — generated content with documented generation method and asset rights;
- `developer_owned` — captured and controlled by the developer;
- `licensed` — obtained under terms that permit model training and internal retention; or
- `consented_redacted` — explicitly consented and reviewed after required redaction.

The dataset must not contain BranchBalance member submissions or corrections. Dataset provenance and model-training rights must be reviewable even when the images themselves remain private.

### 5.3 Split policy

Assign the train, validation, and test split at a merchant/layout group level before augmentation. Near duplicates, repeated captures, receipts from the same template family, and derived crops must remain in the same split.

This prevents a model from appearing to generalize by memorizing a merchant template present in both training and test data. The test split is frozen for a dataset version and is never used for threshold selection, calibration, quantization calibration, or manual rule tuning.

## 6. Canonical database structure

SQLite is the proposed canonical metadata and annotation store. The schema keeps immutable source-image identity separate from normalized expected fields, source regions, benchmark cases, and generated predictions.

### 6.1 Schema

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE dataset_group (
  group_id             TEXT PRIMARY KEY,
  group_kind           TEXT NOT NULL CHECK (
    group_kind IN ('merchant', 'layout_family', 'synthetic_family')
  ),
  display_name         TEXT,
  split                TEXT NOT NULL CHECK (
    split IN ('train', 'validation', 'test')
  ),
  dataset_version      TEXT NOT NULL,
  created_at_utc       TEXT NOT NULL
);

CREATE TABLE receipt_image (
  receipt_id           TEXT PRIMARY KEY,
  group_id             TEXT NOT NULL REFERENCES dataset_group(group_id),
  relative_image_path  TEXT NOT NULL UNIQUE,
  image_sha256         TEXT NOT NULL UNIQUE CHECK (length(image_sha256) = 64),
  mime_type            TEXT NOT NULL CHECK (
    mime_type IN ('image/jpeg', 'image/png', 'image/webp')
  ),
  width_px             INTEGER NOT NULL CHECK (width_px > 0),
  height_px            INTEGER NOT NULL CHECK (height_px > 0),
  source_kind          TEXT NOT NULL CHECK (
    source_kind IN ('synthetic', 'developer_owned', 'licensed', 'consented_redacted')
  ),
  provenance_ref       TEXT NOT NULL,
  redaction_status     TEXT NOT NULL CHECK (
    redaction_status IN ('not_required', 'redacted', 'verified')
  ),
  locale_hint          TEXT,
  capture_condition    TEXT,
  created_at_utc       TEXT NOT NULL
);

CREATE TABLE expected_field (
  field_id             TEXT PRIMARY KEY,
  receipt_id           TEXT NOT NULL REFERENCES receipt_image(receipt_id) ON DELETE CASCADE,
  field_name           TEXT NOT NULL CHECK (
    field_name IN (
      'merchant',
      'receipt_date',
      'currency',
      'subtotal_minor',
      'tax_minor',
      'tip_minor',
      'total_minor'
    )
  ),
  field_state          TEXT NOT NULL CHECK (
    field_state IN ('present', 'absent', 'ambiguous', 'illegible', 'unsupported')
  ),
  normalized_text      TEXT,
  normalized_minor     INTEGER,
  safe_to_extract      INTEGER NOT NULL CHECK (safe_to_extract IN (0, 1)),
  annotation_origin    TEXT NOT NULL DEFAULT 'manual' CHECK (
    annotation_origin IN ('manual', 'ocr_prelabel', 'assisted')
  ),
  reviewed             INTEGER NOT NULL DEFAULT 0 CHECK (reviewed IN (0, 1)),
  annotation_notes     TEXT,
  UNIQUE (receipt_id, field_name),
  CHECK (
    (field_state = 'present' AND
      ((normalized_text IS NOT NULL AND normalized_minor IS NULL) OR
       (normalized_text IS NULL AND normalized_minor IS NOT NULL)))
    OR
    (field_state <> 'present' AND normalized_text IS NULL AND normalized_minor IS NULL)
  )
);

CREATE TABLE text_region (
  region_id            TEXT PRIMARY KEY,
  receipt_id           TEXT NOT NULL REFERENCES receipt_image(receipt_id) ON DELETE CASCADE,
  annotation_level     TEXT NOT NULL CHECK (
    annotation_level IN ('field_source', 'full_transcription')
  ),
  transcription       TEXT,
  x1                   REAL NOT NULL,
  y1                   REAL NOT NULL,
  x2                   REAL NOT NULL,
  y2                   REAL NOT NULL,
  x3                   REAL NOT NULL,
  y3                   REAL NOT NULL,
  x4                   REAL NOT NULL,
  y4                   REAL NOT NULL,
  reading_order        INTEGER,
  annotation_origin    TEXT NOT NULL DEFAULT 'manual' CHECK (
    annotation_origin IN ('manual', 'ocr_prelabel', 'assisted')
  ),
  reviewed             INTEGER NOT NULL DEFAULT 0 CHECK (reviewed IN (0, 1))
);

CREATE TABLE field_region_link (
  field_id             TEXT NOT NULL REFERENCES expected_field(field_id) ON DELETE CASCADE,
  region_id            TEXT NOT NULL REFERENCES text_region(region_id) ON DELETE CASCADE,
  region_role          TEXT NOT NULL CHECK (
    region_role IN ('label', 'value', 'combined', 'supporting_evidence')
  ),
  PRIMARY KEY (field_id, region_id, region_role)
);

CREATE TABLE benchmark_case (
  case_id                    TEXT PRIMARY KEY,
  receipt_id                 TEXT NOT NULL REFERENCES receipt_image(receipt_id) ON DELETE CASCADE,
  group_currency             TEXT NOT NULL CHECK (group_currency IN ('EUR', 'USD', 'GBP')),
  expected_description       TEXT,
  expected_amount_minor      INTEGER,
  expected_expense_date      TEXT,
  expected_detected_currency TEXT CHECK (
    expected_detected_currency IS NULL OR
    expected_detected_currency IN ('EUR', 'USD', 'GBP')
  ),
  expect_amount_prefill      INTEGER NOT NULL CHECK (expect_amount_prefill IN (0, 1)),
  expect_date_prefill        INTEGER NOT NULL CHECK (expect_date_prefill IN (0, 1)),
  expect_description_prefill INTEGER NOT NULL CHECK (expect_description_prefill IN (0, 1)),
  expected_warning_code      TEXT,
  UNIQUE (receipt_id, group_currency)
);

CREATE TABLE evaluation_run (
  run_id                TEXT PRIMARY KEY,
  dataset_version       TEXT NOT NULL,
  model_bundle_version  TEXT NOT NULL,
  parser_version        TEXT NOT NULL,
  source_commit         TEXT NOT NULL,
  device_profile        TEXT,
  started_at_utc        TEXT NOT NULL,
  completed_at_utc      TEXT
);

CREATE TABLE field_prediction (
  run_id                TEXT NOT NULL REFERENCES evaluation_run(run_id) ON DELETE CASCADE,
  case_id               TEXT NOT NULL REFERENCES benchmark_case(case_id) ON DELETE CASCADE,
  field_name            TEXT NOT NULL CHECK (
    field_name IN ('merchant', 'receipt_date', 'currency', 'total_minor')
  ),
  predicted_text        TEXT,
  predicted_minor       INTEGER,
  model_score           REAL,
  accepted_for_prefill  INTEGER NOT NULL CHECK (accepted_for_prefill IN (0, 1)),
  exact_match           INTEGER NOT NULL CHECK (exact_match IN (0, 1)),
  failure_class         TEXT CHECK (
    failure_class IS NULL OR failure_class IN (
      'detection',
      'recognition',
      'field_selection',
      'validation',
      'expected_abstention'
    )
  ),
  PRIMARY KEY (run_id, case_id, field_name)
);
```

### 6.2 Expected-field normalization

| Field | Database representation | Rules |
| --- | --- | --- |
| Merchant | `normalized_text` | Trimmed display text; preserve meaningful accents and casing selected by the annotation policy |
| Receipt date | `normalized_text` | ISO calendar date `YYYY-MM-DD` only |
| Currency | `normalized_text` | `EUR`, `USD`, or `GBP`; absence is distinct from assuming the group currency |
| Subtotal, tax, tip, total | `normalized_minor` | Signed integer minor units in the detected receipt currency; `safe_to_extract` decides whether the app may use it |

`field_state` records whether a field is visibly present independently of whether BranchBalance should prefill it. For example, a refund total may be present and correctly annotated with a negative minor-unit value while `safe_to_extract` is `0` because CR-006 accepts only a positive final total.

The `benchmark_case` table adds the group-currency context required to evaluate currency mismatches and the exact editable form prefill. One image may therefore have more than one benchmark case without duplicating its ground-truth annotations.

### 6.3 Region coordinates

Store four clockwise points in canonical-image pixel coordinates, starting at the top-left point. Validation tooling must reject:

- points outside the image bounds;
- zero-area or self-intersecting quadrilaterals;
- field-source regions without a reviewed transcription when used for recognition training; and
- a `present` expected field with no linked `value` or `combined` region unless the annotation explicitly records why no source region can be located.

Label and value regions may be separate. For example, `TOTAL` can be linked with role `label` and `43,27` with role `value`. A single line `TOTAL EUR 43,27` uses role `combined`.

### 6.4 Polygon annotation tool and installation

Use [PPOCRLabel](https://github.com/PFCCLab/PPOCRLabel) as the default annotation application. It is PaddleOCR's semi-automatic annotation tool and can:

- run OCR to propose initial boxes and transcriptions;
- create and adjust four-point text boxes;
- attach a field class to a box in KIE labeling mode;
- export detection labels as `Label.txt`; and
- export reviewed recognition crops plus `rec_gt.txt`.

KIE mode is used here only to attach convenient field-role names to source regions. This proposal does not ship or train a KIE model.

Install the tool in a dedicated virtual environment outside this repository. The following versions match the current BranchBalance OCR provenance and the current PPOCRLabel release:

```sh
python3 -m venv /absolute/private/path/branchbalance-ocr-tools
source /absolute/private/path/branchbalance-ocr-tools/bin/activate
python -m pip install --upgrade pip
python -m pip install "paddlepaddle==3.3.1" "paddleocr==3.7.0" "PPOCRLabel==3.1.6"
PPOCRLabel --lang en --kie True
```

PPOCRLabel requires Python 3.9 or newer. Its annotation environment is independent from the React Native application and is never packaged into the APK. On macOS, use a clean virtual environment before applying any PyQt or OpenCV workaround; do not alter BranchBalance's Node or Android dependencies to make the annotation GUI run.

If PPOCRLabel cannot run on the development machine, `labelme` is an acceptable fallback for four-point polygons. Its JSON output requires a converter into the canonical SQLite schema and does not provide PaddleOCR's direct detection/recognition exports.

### 6.5 Prepare each image before labeling

The annotated image must be the immutable canonical training image referenced by `receipt_image.relative_image_path`:

1. apply required redaction;
2. normalize EXIF orientation;
3. choose the final pixel dimensions and encoding;
4. calculate and store its SHA-256; and
5. only then begin polygon annotation.

Do not rotate, crop, resize, redact, or recompress an image after polygons have been recorded. Any pixel-changing edit creates a new canonical image hash and requires transformed or repeated annotations.

### 6.6 How to draw each polygon

In PPOCRLabel:

1. Choose **Open Dir** and select the folder containing the canonical images.
2. Optionally choose **Auto recognition** to generate draft boxes. Auto-recognition output is only a starting point and must be reviewed manually.
3. Press `Q` or `Home` to enter four-point mode.
4. Click the corners in this order: top-left, top-right, bottom-right, bottom-left. Double-click the final point to finish.
5. Edit the transcription so that it exactly matches the visible text.
6. In KIE mode, select the box and press `Ctrl+X` to assign its field-role class.
7. Press **Check** or `Ctrl+V`/`End` only after every required box and transcription on the image has been reviewed.
8. Export `Label.txt`; export recognition results only for boxes approved for recognition training.

Draw polygons using these rules:

- Use exactly four points, even though the tool supports more general polygons.
- Draw one polygon around one visually continuous text line or text run.
- Follow the text-line angle and perspective; do not use a horizontal rectangle for visibly skewed text.
- Leave a small, consistent margin around the glyphs without touching an adjacent line. Approximately 5% of the text-line height is a reasonable starting point.
- Do not trace individual letters and do not combine vertically stacked lines.
- Split label and value into separate boxes when a large blank column separates them, such as `TOTAL` on the left and `43,27` on the right.
- Use one combined box when label, currency, and amount form one continuous printed run, such as `TOTAL EUR 43,27`.
- For a multi-line merchant logo, draw one box per readable line and link all applicable lines to the same expected merchant.
- When date and time share one continuous line, transcribe the complete line while storing only the normalized `YYYY-MM-DD` value in `expected_field`.
- If a curved or damaged line cannot be represented by a reliable quadrilateral, mark the expected field as `illegible` or `unsupported` rather than inventing a box.

For a field-selection/ranker dataset, only the expected field sources and realistic competing candidates require manual source classification. For detection fine-tuning, every text line in every exported training image must be boxed. Selectively boxed images must retain `annotation_level = 'field_source'` and must never be exported as complete detection ground truth.

For full detection annotations, use the exact visible transcription for readable text. Use PaddleOCR's reserved transcription `###` for a boxed region that must be ignored during detection training. Such a region must not be exported as a recognition crop.

### 6.7 Field-role classes in PPOCRLabel

Use these controlled KIE-mode class names:

| PPOCRLabel class | Canonical field/role |
| --- | --- |
| `merchant_value` | `merchant` / `value` |
| `receipt_date_value` | `receipt_date` / `value` |
| `currency_value` | `currency` / `value` |
| `subtotal_label`, `subtotal_value`, `subtotal_combined` | `subtotal_minor` / corresponding region role |
| `tax_label`, `tax_value`, `tax_combined` | `tax_minor` / corresponding region role |
| `tip_label`, `tip_value`, `tip_combined` | `tip_minor` / corresponding region role |
| `total_label`, `total_value`, `total_combined` | `total_minor` / corresponding region role |
| `other` | Reviewed text with no expected-field link |

Only the regions that support the correct expected value receive a field-role class. Other totals, dates, tax lines, cash-tendered values, and change values remain `other`; they become negative candidates during field-ranker export.

A source region may support more than one canonical field. For example, `TOTAL EUR 43,27` can link to both `total_minor` and `currency`. The PPOCRLabel class is an import hint, while `field_region_link` remains the canonical many-to-many relationship.

### 6.8 Expected normalized values

PPOCRLabel records polygons, transcriptions, and field-role hints. It does not replace the canonical expected values or states. Until a dedicated SQLite annotation form exists, maintain an `ExpectedFields.json` sidecar in the private annotation directory and import it together with `Label.txt`:

```json
{
  "r_001.jpg": {
    "merchant": {
      "field_state": "present",
      "normalized_text": "CAFE CENTRAL",
      "safe_to_extract": true
    },
    "receipt_date": {
      "field_state": "present",
      "normalized_text": "2026-07-20",
      "safe_to_extract": true
    },
    "currency": {
      "field_state": "present",
      "normalized_text": "EUR",
      "safe_to_extract": true
    },
    "subtotal_minor": {
      "field_state": "absent",
      "safe_to_extract": false
    },
    "tax_minor": {
      "field_state": "absent",
      "safe_to_extract": false
    },
    "tip_minor": {
      "field_state": "absent",
      "safe_to_extract": false
    },
    "total_minor": {
      "field_state": "present",
      "normalized_minor": 4327,
      "safe_to_extract": true
    }
  }
}
```

Every receipt must contain all seven expected-field entries. Use `absent`, `ambiguous`, `illegible`, or `unsupported` explicitly; a missing JSON property means the annotation is incomplete, not that the receipt lacks the field.

An import validator must match each image by stable receipt ID and SHA-256, validate normalized values, map PPOCRLabel field-role classes to `field_region_link`, and require manual resolution when a class is missing, duplicated unexpectedly, or inconsistent with the sidecar.

### 6.9 Assisted pre-labeling workflow

The developer does not need to draw every baseline polygon from scratch. Codex or a local batch annotation utility may generate proposed polygons, transcriptions, field-role classes, and normalized expected values from one or more developer-approved gold examples.

A single gold receipt establishes the annotation contract:

- which image version is canonical;
- polygon point order and margin convention;
- whether separated label/value columns use separate regions;
- exact-transcription policy;
- PPOCRLabel field-role names; and
- normalization rules for merchant, date, currency, and minor-unit amounts.

It does not train a reliable new detector or establish every merchant layout. Add further gold examples when the dataset introduces materially different layouts, languages, currencies, print quality, or capture conditions.

The assisted workflow is:

1. The developer provides at least one reviewed image, its PPOCRLabel `Label.txt` entry, and its complete expected-field record.
2. The remaining immutable canonical images are placed in a private input directory.
3. The current OCR bundle or a version-matched local PaddleOCR pipeline proposes text quadrilaterals, transcriptions, and confidence scores.
4. Deterministic receipt parsing and assisted classification propose field-role classes and normalized values.
5. The process writes generated artifacts to a separate pre-label directory; it never overwrites reviewed canonical records.
6. Missing, ambiguous, conflicting, low-confidence, or structurally unusual results enter a review queue.
7. The developer opens the generated labels in PPOCRLabel, corrects polygons and exact transcriptions, confirms expected normalized values, and explicitly marks each image or field reviewed.
8. Only reviewed records are merged into the canonical SQLite catalog and become eligible for training export.

Recommended generated artifacts are:

```text
prelabels/<run-id>/
├── Label.txt
├── ExpectedFields.auto.json
├── ReviewQueue.json
├── run-manifest.json
└── report.json
```

The run manifest records the image hashes, OCR model bundle, parser/ranker version, source commit, gold-example IDs, thresholds, and generation time. Re-running the process is idempotent for the same inputs and configuration.

All generated staging `expected_field` and `text_region` records use:

```text
annotation_origin = 'assisted'
reviewed = 0
```

When boxes come directly from OCR without assisted field classification, use `annotation_origin = 'ocr_prelabel'`. Human review changes only `reviewed`; it does not erase the origin, allowing later accuracy measurement of the pre-labeling process itself.

Review requirements depend on the intended training task:

| Intended use | What can be generated | Mandatory developer review |
| --- | --- | --- |
| Field-ranker baseline | Target-field polygons, competing candidates, role classes, normalized values | Confirm the correct source candidates, explicit absent/ambiguous states, normalization, and safe-to-extract decision |
| Detection fine-tuning | Draft polygons for every text line | Inspect the complete image for missing, merged, split, or badly aligned regions; the current detector cannot pre-label text it failed to detect |
| Recognition fine-tuning | Draft transcription and perspective crop for each reviewed region | Correct every character, accent, symbol, space, separator, and decimal mark; never train on unreviewed OCR text |

Assisted pre-labeling is therefore a productivity baseline, not final ground truth. Training and test exporters must fail closed if any selected image, expected field, linked source region, or recognition transcription has `reviewed = 0`.

To request a new assisted annotation run, provide:

- the private directory path containing the canonical images;
- one or more gold receipt IDs and annotations;
- whether the run should label only expected-field sources and competing candidates or every text line;
- the default group currency for generated benchmark cases, when applicable; and
- the desired output directory, which must remain outside application assets.

## 7. Training export formats

The SQLite catalog is canonical. Training files are generated outputs and must include the source dataset version and export-tool version.

### 7.1 Field-ranking export

Generate one JSON Lines row per candidate, not merely one row per receipt:

```json
{"receipt_id":"r_001","field":"total_minor","candidate_block":"b_017","features":{"y":0.91,"ocr_confidence":0.97,"has_total_label":1,"has_subtotal_label":0,"same_line_distance":0.03,"arithmetic_consistent":1},"target":1}
{"receipt_id":"r_001","field":"total_minor","candidate_block":"b_011","features":{"y":0.72,"ocr_confidence":0.99,"has_total_label":0,"has_subtotal_label":1,"same_line_distance":0.01,"arithmetic_consistent":0},"target":0}
```

Every positive candidate must be accompanied by the realistic negative candidates produced for the same receipt. Receipts with absent, ambiguous, illegible, or unsupported fields are required to train and measure abstention.

### 7.2 PaddleOCR detection export

Generate PaddleOCR detection annotations from reviewed full-transcription regions:

```text
images/redacted/r_001.jpg\t[{"transcription":"CAFE CENTRAL","points":[[62,44],[411,44],[411,91],[62,91]]},{"transcription":"TOTAL EUR 43,27","points":[[58,1260],[542,1258],[543,1311],[59,1313]]}]
```

Detection export requires the annotation coverage expected by the selected PaddleOCR training configuration. Selective field-only polygons must not be presented as complete detection ground truth because unlabelled receipt text would be treated incorrectly.

### 7.3 PaddleOCR recognition export

Generate reviewed perspective crops and a tab-separated transcription file:

```text
derived/recognition-crops/r_001_region_001.png\tCAFE CENTRAL
derived/recognition-crops/r_001_region_017.png\tTOTAL EUR 43,27
```

The export validator must confirm that every transcription character exists in the approved recognition dictionary. Dictionary changes require a new native-contract review and cannot be introduced silently by the export process.

## 8. Dataset composition

The dataset should deliberately cover:

- English and Portuguese receipt vocabulary;
- EUR, USD, and GBP symbols and codes;
- comma and period decimal conventions and thousands separators;
- inline and separate total label/value layouts;
- subtotal, tax, VAT/IVA, tip, cash tendered, and change lines;
- ISO, day/month/year, month/day/year, ambiguous, and invalid dates;
- multiple total-like lines, duplicated totals, refunds, zero/negative values, and missing fields;
- long receipts, small print, faded thermal print, skew, perspective distortion, shadow, glare, blur, and low contrast;
- new camera captures and photo-library images; and
- receipts that should result in a correct abstention rather than a prefill.

Synthetic augmentation may vary geometry, illumination, blur, noise, and contrast after the source receipt has been assigned to a split. Augmented descendants inherit the source split and must never cross into validation or test.

## 9. Evaluation and acceptance gates

### 9.1 Metrics

Record at least:

- relevant-field detection recall by source-region intersection;
- character error rate and exact transcription rate for linked source regions;
- exact match for merchant, normalized date, detected currency, and total minor units;
- prefill precision, prefill coverage, and abstention correctness per field;
- currency-mismatch false-prefill count;
- arithmetic-inconsistency false-prefill count;
- cold and warm end-to-end latency;
- peak memory and crash/out-of-memory behavior; and
- raw OCR asset size plus universal and per-ABI release size.

Train-set metrics are diagnostic only. Model selection and threshold calibration use validation data. Final acceptance uses the frozen test split once per candidate release.

### 9.2 Safety gates

A candidate must not ship when it:

- silently prefills an amount for a known currency mismatch;
- accepts a negative, zero, ambiguous, or arithmetically inconsistent total;
- reduces held-out total or date prefill precision to gain coverage;
- changes manual category, payment-method, payer, split, or participant behavior;
- bypasses runtime schema validation or explicit user review; or
- introduces production logging or persistence of OCR content.

The initial target is to improve exact-match accuracy and safe coverage over the current baseline with no safety-regression fixture failures. Numeric thresholds should be approved only after the frozen test set is large enough to make them meaningful; raw counts and confidence intervals must accompany percentages.

### 9.3 Size gates

The current OCR asset directory is 19,676,564 bytes before APK packaging:

| Asset | Current bytes | Strategy |
| --- | ---: | --- |
| `text_detection.onnx` | 4,826,518 | Replace in place if fine-tuned |
| `text_recognition.onnx` | 8,069,614 | Replace in place if fine-tuned |
| `text_orientation.onnx` | 6,776,997 | Keep only if the ablation justifies it |
| Dictionary and manifest | 3,435 | Update in place |

Proposed packaging rules:

- A generated field ranker and its metadata should remain below 100 KiB uncompressed.
- Do not bundle old and new OCR models together in production.
- Do not add a KIE transformer or VLM under this proposal.
- Prefer a combined OCR asset footprint no larger than the current 19,676,564-byte baseline.
- Any increase above 1 MiB in raw OCR assets requires an explicit size/performance review.
- Record the delivered per-device size; a universal development APK is not a substitute for release-size measurement.

Quantization, ORT-format conversion, a reduced-operator ONNX Runtime build, and per-ABI delivery are optional later optimizations. Each changes the release toolchain or runtime and must be benchmarked independently from model-quality changes.

## 10. Reproducibility and release procedure

Every candidate model or ranker release must record:

- immutable dataset version and manifest checksum;
- train, validation, test, and quantization-calibration group IDs;
- PaddleOCR/PaddlePaddle/Paddle2ONNX/ONNX Runtime versions as applicable;
- source training checkpoint and license;
- training configuration, seed, epochs, and selected checkpoint;
- character dictionary checksum;
- exported model checksum, ONNX opset, input/output names, shapes, and dtypes;
- parser/ranker source commit;
- benchmark report and physical-device profiles; and
- raw model asset and delivered application-size deltas.

For an approved replacement:

1. export only the selected inference artifact;
2. verify the model with the same native preprocessing and post-processing used by Android;
3. replace the existing asset rather than retaining the baseline model;
4. update `model-bundle.json`, checksums, bundle version, and `MODEL_PROVENANCE.md`;
5. rebuild the Expo Development Build;
6. run automated schema/parser tests and the frozen benchmark;
7. run CR-006 physical-device acceptance with networking disabled during OCR; and
8. retain the prior released artifact outside the APK for rollback and reproducibility.

## 11. Proposed implementation phases

### Phase A — Dataset and baseline

- Create the private dataset directory and SQLite catalog.
- Implement schema validation, checksum verification, split-leakage checks, and JSONL/Paddle export validation.
- Implement an idempotent assisted pre-label command that preserves reviewed annotations and produces a review queue.
- Annotate expected receipt fields and their source regions.
- Run the current bundle and parser to establish field, latency, memory, and size baselines.

### Phase B — Lightweight extraction

- Add deterministic candidate export with positive and negative labels.
- Train and calibrate bounded linear rankers.
- Generate typed TypeScript weights and version metadata.
- Preserve deterministic validation and add regression fixtures for every changed selection.
- Accept this phase only if held-out prefill precision and safe coverage improve with a sub-100-KiB artifact.

### Phase C — Conditional OCR adaptation

- Review baseline failure attribution.
- Fully transcribe and polygon-label the subset required by the failing OCR stage.
- Fine-tune only detection, only recognition, or both when independently justified.
- Export compatible ONNX replacements and repeat all benchmarks.

### Phase D — Footprint optimization

- Run the orientation-model ablation.
- Evaluate static INT8 quantization with a training-only calibration subset.
- Consider ORT-format models and a reduced-operator runtime only if release size remains a material problem.
- Measure per-ABI release delivery separately from the universal development APK.

## 12. Approval consequences

Approving this proposal authorizes development-time experimentation on the developer-managed dataset. It does not authorize:

- collection from BranchBalance users;
- uploading any production receipt or OCR result;
- committing private receipt images to this repository;
- weakening manual review or explicit save; or
- shipping a model that has not passed provenance, compatibility, accuracy, device-performance, and size gates.

If later work proposes member-contributed training data, correction-based learning, a KIE transformer, or a VLM, that work requires a separate product, privacy, licensing, and architecture decision.

## 13. References

- [BranchBalance CR-006 product requirements](PRD.md#21-change-request-cr-006--private-on-device-receipt-scanning)
- [BranchBalance PaddleOCR model provenance](../modules/paddle-ocr/MODEL_PROVENANCE.md)
- [PaddleOCR text recognition training](https://www.paddleocr.ai/v2.10.0/en/ppocr/model_train/recognition.html)
- [PaddleOCR data annotation tools](https://www.paddleocr.ai/main/en/data_anno_synth/data_annotation.html)
- [PaddleOCR dataset and polygon annotation format](https://www.paddleocr.ai/main/en/datasets/ocr_datasets.html)
- [PPOCRLabel installation and usage](https://github.com/PFCCLab/PPOCRLabel)
- [PaddleOCR key information extraction annotation format](https://www.paddleocr.ai/main/en/version2.x/ppocr/model_train/kie.html)
- [ONNX Runtime quantization](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)
- [ONNX Runtime mobile deployment and size optimization](https://onnxruntime.ai/docs/tutorials/mobile/)
