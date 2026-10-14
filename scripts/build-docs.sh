#!/usr/bin/env bash
# Render docs/TECHNICAL_DOCUMENTATION.md to docs/natlas-js-technical-documentation.pdf
# Requires: pandoc and WeasyPrint (pip install weasyprint). DejaVu fonts for Yoruba/Hausa/Igbo characters.
# Optional: REBUILD_DIAGRAM=1 needs pdflatex + pdftoppm to regenerate docs/assets/architecture.png.
set -euo pipefail
cd "$(dirname "$0")/../docs"

if [[ "${REBUILD_DIAGRAM:-0}" == "1" ]]; then
  (cd assets && pdflatex -interaction=nonstopmode architecture.tex >/dev/null && \
   pdftoppm -png -r 220 -singlefile architecture.pdf architecture && rm -f architecture.aux architecture.log)
fi

pandoc TECHNICAL_DOCUMENTATION.md \
  --from markdown+pipe_tables+yaml_metadata_block \
  --to html5 --standalone --embed-resources \
  --toc --toc-depth=2 --number-sections \
  --no-highlight \
  --css assets/print.css \
  --resource-path=.:assets \
  --metadata lang=en \
  -o /tmp/natlas-docs.html

python3 -m weasyprint /tmp/natlas-docs.html natlas-js-technical-documentation.pdf
echo "wrote docs/natlas-js-technical-documentation.pdf"
