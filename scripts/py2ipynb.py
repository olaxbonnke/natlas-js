#!/usr/bin/env python3
"""Regenerate server/kaggle_natlas_server.ipynb from the "# %%"-celled .py file (single source of truth)."""
import json, re, sys
from pathlib import Path

src = Path(sys.argv[1] if len(sys.argv) > 1 else "server/kaggle_natlas_server.py")
dst = src.with_suffix(".ipynb")
cells, kind, buf = [], None, []

def flush():
    if kind is None:
        return
    lines = buf[:]
    while lines and not lines[-1].strip():
        lines.pop()
    if kind == "markdown":
        lines = [re.sub(r"^# ?", "", l) for l in lines]
    text = [l + "\n" for l in lines]
    if text:
        text[-1] = text[-1].rstrip("\n")
    cell = {"cell_type": kind, "metadata": {}, "source": text}
    if kind == "code":
        cell.update(execution_count=None, outputs=[])
    cells.append(cell)

for line in src.read_text().splitlines():
    if line.startswith("# %%"):
        flush()
        kind, buf = ("markdown" if "[markdown]" in line else "code"), []
    else:
        buf.append(line)
flush()

nb = {
    "cells": cells,
    "metadata": {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python"},
        "kaggle": {"accelerator": "nvidiaTeslaT4", "isInternetEnabled": True, "isGpuEnabled": True},
        "colab": {"provenance": [], "gpuType": "T4"},
        "accelerator": "GPU",
    },
    "nbformat": 4,
    "nbformat_minor": 5,
}
for i, c in enumerate(nb["cells"]):
    c["id"] = f"cell-{i:02d}"
dst.write_text(json.dumps(nb, indent=1, ensure_ascii=False) + "\n")
print(f"wrote {dst} ({len(cells)} cells)")
