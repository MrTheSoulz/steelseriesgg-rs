#!/usr/bin/env python3
"""Validate authored runtime fields with snapd; NOT a Snapcraft expansion test."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import yaml

root = Path(__file__).resolve().parents[2]
recipe = yaml.safe_load((root / "snap/snapcraft.yaml").read_text())
metadata = {key: recipe[key] for key in (
    "name", "base", "version", "summary", "description", "grade", "confinement", "plugs"
)}
metadata["architectures"] = ["amd64"]
metadata["apps"] = {
    name: {key: value for key, value in app.items() if key in ("command", "plugs", "environment", "common-id")}
    for name, app in recipe["apps"].items()
}
assert recipe["apps"]["ssgg"]["extensions"] == ["gnome"]
assert metadata["confinement"] == "strict"
assert metadata["plugs"]["electron-sandbox"]["allow-sandbox"] is True
assert "raw-usb" not in metadata["apps"]["ssgg"]["plugs"]
with tempfile.TemporaryDirectory(prefix="ssgg-snap-skeleton-") as temp:
    stage = Path(temp)
    shutil.copytree(root / "snap/local", stage, dirs_exist_ok=True)
    (stage / "meta/gui").mkdir(parents=True)
    (stage / "meta/snap.yaml").write_text(yaml.safe_dump(metadata, sort_keys=False))
    shutil.copyfile(root / "snap/gui/ssgg.desktop", stage / "meta/gui/ssgg.desktop")
    for launcher in (stage / "bin").iterdir():
        launcher.chmod(0o755)
    subprocess.run(["snap", "pack", "--check-skeleton", str(stage)], check=True)
print("Authored runtime metadata and launcher permissions accepted by snap pack --check-skeleton.")
print("GNOME extension expansion, dependency closure and installed confinement remain separate build/runtime gates.")
