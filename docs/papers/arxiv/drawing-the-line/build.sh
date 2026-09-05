#!/usr/bin/env bash
# Build the paper PDF with tectonic (self-contained LaTeX engine).
# Install once:  brew install tectonic
set -euo pipefail
cd "$(dirname "$0")"
tectonic main.tex
echo "Built: $(pwd)/main.pdf"
