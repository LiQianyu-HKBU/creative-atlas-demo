# Creative Atlas — GitHub Pages edition

An interactive static research demo of 215 advertisements from 14 brands.

## Features

- Browse all 215 per-video structural subgraphs, with filtering, node inspection, zoom and pan.
- View the saved validation predictions from the structural and similarity GNNs for 20 videos.
- Compare frozen validation and test metrics for four models.

## Prediction mode

This edition displays **saved model predictions**. It does not run Python, PyTorch, a neural network, or a backend API. The full local demos remain separate and retain actual inference. Historical observed views are display context and were not model inputs. No new-video or future-outcome forecasting is provided.

## Publish

In this repository's Settings → Pages, use Deploy from a branch, the main branch, and the root folder. All application paths are relative so project-subdirectory hosting works. The .nojekyll file disables Jekyll processing.

For a local preview, run `python3 -m http.server 8002` from this directory, then open http://127.0.0.1:8002/.

## Display data

The public data directory contains only video display metadata, per-video graph data, 40 saved validation outputs, and aggregate model metrics. It does not contain training checkpoints, preprocessing objects, private conversation records, or the full original project archive. The source-data hashes and export counts are recorded in site-manifest.json.

The study is exploratory: test n=21; campaign grouping used recorded case-sensitive labels; graph links and prediction patterns do not establish causal creative effects.
