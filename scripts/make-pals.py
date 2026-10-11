#!/usr/bin/env python3
"""ADR-089: the workers' pal definitions, each made from Pal's (assets/pals/pal.json) with its own colours and
shapes, in the same avatar-definition format. Run from the repo root: python3 scripts/make-pals.py"""
import copy, json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "pals"
base = json.loads((ROOT / "pal.json").read_text())

def ears(d, **surface):
    for node in d["body"]["nodes"][:2]:
        node["surface"].update(surface)

def ear_tilt(d, degrees):
    d["body"]["nodes"][0]["rotation"][2] = -degrees
    d["body"]["nodes"][1]["rotation"][2] = degrees

def ear_spread(d, x):
    d["body"]["nodes"][0]["position"][0] = x
    d["body"]["nodes"][1]["position"][0] = -x

def body(d, **surface):
    d["body"]["primary"].update(surface)

def capsule_ears(d, width, height, y):
    for node in d["body"]["nodes"][:2]:
        node["surface"] = {"type": "capsule", "width": width, "height": height, "depth": width * 0.7, "roundness": 1}
        node["position"][1] = y

def antenna(d):
    d["body"]["nodes"] = d["body"]["nodes"][2:]  # no ears
    d["body"]["nodes"].append({"surface": {"type": "capsule", "width": 18, "height": 80, "depth": 18, "roundness": 1}, "position": [0, 150, -10], "rotation": [0, 0, 0]})
    d["body"]["nodes"].append({"surface": {"type": "cube", "width": 42, "height": 42, "depth": 42, "roundness": 2}, "position": [0, 198, -10], "rotation": [0, 0, 0]})

VARIANTS = {
    # Sid, the researcher: sea-glass blue, tall alert ears.
    "sid": dict(colors={"body": "#bfe3ef", "eyes": "#1d4f73"}, make=lambda d: (ears(d, height=118, width=70), ear_tilt(d, 8))),
    # Kame, the coder: mint, low round nubs, a broader body.
    "kame": dict(colors={"body": "#bfe8c6", "eyes": "#1f5a35"}, make=lambda d: (ears(d, height=46, width=72, morphRoundness=1), body(d, width=262, roundness=1.6))),
    # Puff, the designer: blush pink, long soft ears.
    "puff": dict(colors={"body": "#f9cfdc", "eyes": "#8a2f55"}, make=lambda d: (capsule_ears(d, 48, 150, 175), ear_tilt(d, 12))),
    # Quill, the documenter: warm paper, one ear folded.
    "quill": dict(colors={"body": "#f3e6c8", "eyes": "#6a4520"}, make=lambda d: (ears(d, height=96), d["body"]["nodes"][1]["rotation"].__setitem__(2, 38))),
    # Penny, financial information: soft gold, small neat ears set wide.
    "penny": dict(colors={"body": "#f6dc8e", "eyes": "#6b4a00"}, make=lambda d: (ears(d, height=64, width=60), ear_spread(d, 70))),
    # Hana, HR: lavender, round ears.
    "hana": dict(colors={"body": "#ddd2f7", "eyes": "#4a3486"}, make=lambda d: (ears(d, height=70, width=82, morphRoundness=1, tipRoundness=2), ear_spread(d, 62))),
    # Tinker, the improver: apricot, an antenna instead of ears.
    "tinker": dict(colors={"body": "#fbc9a2", "eyes": "#7a3410"}, make=lambda d: antenna(d)),
}

for pal_id, variant in VARIANTS.items():
    d = copy.deepcopy(base)
    d["name"] = pal_id.capitalize()
    d["colors"] = variant["colors"]
    variant["make"](d)
    (ROOT / f"{pal_id}.json").write_text(json.dumps(d, indent=1, ensure_ascii=False) + "\n")
    print("wrote", pal_id)
