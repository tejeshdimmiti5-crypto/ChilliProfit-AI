# 🌶️ ChilliProfit AI

**AI-Based Chilli Disease Detection and Farm Intelligence Platform**

ChilliProfit AI is a smart-farming platform designed to help chilli growers monitor crop health, identify possible diseases from leaf images, understand farm-zone risk and evaluate farm economics.

The platform is **not limited to a fixed farm size**. Farm zones, crop observations and economic inputs are designed to scale according to the user's actual farm.

## Current architecture

```text
Leaf Image
   ↓
FastAPI validation
   ↓
EfficientNet-B0 chilli classifier
   ↓
Disease class + confidence + probability distribution
   ↓
Farm-zone interface
   ↓
Risk / yield / economics features
```

The repository includes the FastAPI inference API, reproducible PyTorch training pipeline, model inference module, automated GitHub Actions training workflow, model integrity manifest generation, and release publishing. The production API can bootstrap a trained model from a GitHub release using environment variables.

## Current application

- Chilli-focused responsive web interface
- Leaf image upload and preview
- Backend-connected disease screening workflow
- Configurable farm-zone health map
- Browser-persisted zone layout and risk states
- Zone risk indicators
- Revenue and net-return calculator
- FastAPI health and model-status endpoints
- Image validation and upload-size protection
- EfficientNet-B0 transfer-learning classifier
- Confidence and probability reporting
- Automated model artifact and SHA-256 publishing

> **Important:** A model prediction is a screening aid, not a definitive agricultural diagnosis. The API deliberately avoids presenting confidence as biological disease severity. Field confirmation and qualified agricultural guidance are appropriate before treatment decisions.

## Machine-learning pipeline

Primary training dataset:

`Project-AgML/COLD_chili_leaf_disease_classification`

Training uses the raw image collection, a stratified train/validation/test split, training-only augmentation, class-weighted loss, EfficientNet-B0 transfer learning, early stopping and macro-F1 model selection.

### Model 1 — trained successfully

GitHub Actions training run: `35230162129`  
Release: `model-1`

- Test accuracy: **88.75%**
- Test macro F1: **0.8798**
- Best validation macro F1: **0.8073**
- Test set: **80 images**
- Best checkpoint: **epoch 4**
- Classes: `cercospora`, `healthy`, `mites_and_trips`, `nutritional`, `powdery_mildew`

These metrics are held-out test-set results for the COLD dataset and should not be interpreted as field accuracy. Field validation is still required.

Model artifacts are published in the `model-1` GitHub Release:

- `chilli_model.pt` — trained checkpoint
- `chilli_model.json` — evaluation metrics and confusion matrix
- `chilli_model.sha256` — integrity manifest

The Krishna River Basin chilli dataset is kept as an external validation source and is not silently mixed into training.

### Multi-crop candidate (experimental, not deployed)

The next training pipeline combines the 532-image COLD chilli dataset with the public [PlantVillage full dataset](https://huggingface.co/datasets/geraldmc/plantvillage-full), which has 54,304 images across 14 plant species and 38 crop-specific health/disease classes. With the separate chilli classes, the candidate is expected to cover up to 15 crop species and 43 crop-specific classes. Rice is not included in this first source and would need a separate, compatible dataset.

- Candidate trainer: `ml/train_multicrop.py`
- Candidate training workflow: `.github/workflows/train-multicrop-candidate.yml`
- Candidate artifacts use `multicrop_model.*`; they do **not** overwrite the deployed `chilli_model.pt`.
- The workflow uploads metrics and the candidate checkpoint for review; it does not create a production release or deploy to Render.
- PlantVillage images were photographed against relatively plain backgrounds under controlled conditions. Good benchmark metrics are not proof of performance on real farm photos.

The deployed API remains pinned to `model-1` until a multi-crop candidate passes automated checks, per-class review and real-world validation.

## Technology stack

- Frontend: HTML, CSS, JavaScript
- Backend: Python + FastAPI
- ML: PyTorch + torchvision
- Model: EfficientNet-B0 transfer learning
- Data: Hugging Face datasets + external field validation dataset
- Deployment: Docker + Render configuration
- Model delivery: GitHub Releases

API keys and secrets should **never** be committed to this repository. Use environment variables on the backend.

## Backend endpoints

- `GET /` — service status
- `GET /health` — deployment health check
- `GET /api/health` — API and model status
- `POST /api/analyze` — validate and screen a chilli leaf image

`POST /api/analyze` also accepts an optional multipart `zone` field so the analysis response can identify the selected farm zone.

## Farm-map persistence

The current frontend persists the farm grid dimensions, selected zone and zone risk states in the browser using `localStorage`. This keeps the farmer's map available after page refreshes on the same browser/device.

This is **client-side persistence**, not a cloud database. Cross-device or multi-user farm records require a backend database and authentication layer, which remain future work.

## Model bootstrap

The Docker image runs `backend.fetch_model` before starting FastAPI. Configure `CHILLIPROFIT_MODEL_URL` with the trained release asset URL, `CHILLIPROFIT_MODEL_SHA256` to verify the downloaded checkpoint, and `CHILLIPROFIT_MODEL_VERSION` to identify the deployed release.

For `model-1`, the release asset is:

`https://github.com/tejeshdimmiti5-crypto/StyleSense-AI/releases/download/model-1/chilli_model.pt`

The SHA-256 recorded for the model asset is:

`b2db895fd43bf801fcc522c3f749fe8f5a9766583cc0e4f336a3553e645bb0ce`

## Deployment

The repository contains a Render Blueprint at `render.yaml`. It builds the API from the root `Dockerfile`, downloads and verifies `model-1`, exposes `/health` for deployment health checks, and is configured to deploy only after repository CI checks pass.

After creating the Render service, copy its generated API URL into `config.js` and set `FRONTEND_ORIGIN` on the backend to the deployed frontend origin. Then run the GitHub Actions **Production API verification** workflow with the API URL. That workflow verifies service health, model identity, image inference and farm-zone propagation.

## Roadmap

- [x] Build responsive chilli-farming interface
- [x] Add FastAPI image-analysis endpoint
- [x] Add reproducible transfer-learning training pipeline
- [x] Add model inference integration
- [x] Add automated model training and release workflow
- [x] Complete first successful trained-model release
- [x] Add Docker and Render deployment configuration
- [x] Persist farm layout and zone risk states locally in the browser
- [ ] Validate shared classes on Krishna Basin field images
- [ ] Add disease severity estimation as a separate calibrated model
- [ ] Add cloud persistence and user accounts
- [ ] Add weather and soil inputs
- [ ] Add yield prediction
- [ ] Add richer cost/profit scenarios
- [ ] Add Telugu + English farmer interface
- [ ] Deploy and verify production API

## Project name

**ChilliProfit AI — Smart Chilli Farming Intelligence**
