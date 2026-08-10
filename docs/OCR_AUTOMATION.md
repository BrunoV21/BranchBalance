# Private OCR automation

BranchBalance has one fail-closed OCR entry point for both local development and GitHub Actions:

```sh
python scripts/ocr-pipeline.py <operation> --dataset /absolute/private/dataset/path
```

The current local dataset may remain at `ocr-dataset/`; it is gitignored. The safer long-term arrangement from [OCR_TRAINING_PROPOSAL.md](OCR_TRAINING_PROPOSAL.md) is a private directory outside the checkout. In either arrangement, never commit or upload receipt images, SQLite annotations, crops, predictions, benchmark reports, exports, or candidate weights.

## Local setup

Use Python 3.11 and a dedicated environment:

```sh
python3.11 -m venv /absolute/private/path/branchbalance-ocr-pipeline
source /absolute/private/path/branchbalance-ocr-pipeline/bin/activate
python -m pip install --upgrade pip
python -m pip install --requirement scripts/requirements-ocr-pipeline.txt
```

Run the fast structural checks after every dataset edit:

```sh
python scripts/ocr-pipeline.py validate --dataset ocr-dataset
```

Run both generic and fuel benchmarks and enforce the checked-in quality policy:

```sh
python scripts/ocr-pipeline.py quality --dataset ocr-dataset
```

`quality` checks SQLite integrity and foreign keys, canonical image hashes and dimensions, the seven-field contract, polygon bounds, split/profile coverage, benchmark cases, model checksums and size, then runs the profile parameter sweep. Raw predictions and reports are written only below the private dataset root.

Before training, run the stricter eligibility gate:

```sh
python scripts/ocr-pipeline.py train-readiness --dataset ocr-dataset --profile all
```

This command intentionally fails if selected fields or text regions are unreviewed, full transcriptions are incomplete, source-region links are absent, dictionary characters are unsupported, or a profile lacks at least one train, validation, or test merchant/layout group. Train-set benchmark performance does not satisfy this gate.

## Updating the dataset

For each new receipt/layout:

1. Add the private source image, receipt metadata, and extracted benchmark truth.
2. Assign the whole merchant/layout family to one split before generating crops or augmentations.
3. Run `prepare-ocr-dataset.py`; reruns preserve canonical images and reviewed rows and prelabel only receipts that have no regions.
4. Review every new selected field, polygon, and exact transcription in PPOCRLabel and add source-region links.
5. Run `validate`, then `quality`, then `train-readiness`.

Dataset updates are append-only. The preparer rejects removal of existing receipt IDs, changes to canonical source hashes, receipt group changes, group split changes, and generated values that disagree with reviewed expected fields. It updates unreviewed expected fields but never overwrites reviewed fields or existing text regions. The generated private `manifests/profile-benchmark-truth.json` is the only source used by automated benchmarks; GitHub does not need `invoices/extracted-data.txt`.

The quality thresholds live in [pipeline.json](../config/ocr/pipeline.json). The reproducible generic/fuel inference and training contracts live in [generic.json](../config/ocr/profiles/generic.json) and [fuel.json](../config/ocr/profiles/fuel.json). Raise receipt-count floors and approve new thresholds only after the expanded frozen validation/test sets have been reviewed. Do not lower a threshold just to make a candidate pass.

## Training hook and candidates

The orchestrator can call a private PaddleOCR trainer once readiness passes:

```sh
python scripts/ocr-pipeline.py train \
  --dataset /absolute/private/dataset/path \
  --profile generic \
  --trainer /absolute/private/path/train-paddle-profile.py
```

The trainer executable receives:

```text
--dataset <private-root>
--profile <generic|fuel>
--output <private-candidate-root/profile>
--pipeline-config <repository-config>
```

It must fail on unreviewed data and write a complete candidate bundle to the output directory: `model-bundle.json`, the three model artifacts declared by that manifest, and its recognition dictionary. The pipeline verifies every hash and the raw-size gate, benchmarks the candidate with the same Android-equivalent preprocessing, requires the candidate to pass profile-specific validation/test recall gates, and leaves all candidate files under `dataset/candidates/`.

A passing candidate is not automatically copied into the app. Per the approved proposal, replacement still requires ONNX/native compatibility checks, the frozen benchmark, physical Android performance/size acceptance, provenance updates, and explicit replacement of the existing assets.

## GitHub Actions

The [Private OCR quality workflow](../.github/workflows/ocr-quality.yml) runs only on `main` and only on a self-hosted runner carrying both labels:

```text
self-hosted
branchbalance-ocr
```

Configure these repository Actions variables:

- `BRANCHBALANCE_OCR_DATASET_ROOT`: absolute dataset path on that runner.
- `BRANCHBALANCE_OCR_TRAINER`: absolute private trainer path, required only for `train`.

Use a dedicated, access-controlled runner. The workflow uses `clean: false` so an ignored dataset inside its checkout is not erased, though a separate private root is preferred. It can be dispatched after a dataset update and also runs `quality` every Monday. Because ignored local files cannot trigger a GitHub event, dataset updates require manual dispatch or wait for the schedule.

The workflow prints only pass/fail in its OCR step and deliberately uploads no artifacts. Detailed summaries, predictions, annotations, and candidates remain on the runner.
