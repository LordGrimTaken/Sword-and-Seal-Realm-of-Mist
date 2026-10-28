#!/usr/bin/env python3
"""Convert real in-game screenshots (docs/shots) into compressed webp for the site. Run: python3 website/scripts/process-images.py"""
from PIL import Image
import os
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
SH = os.path.join(ROOT, 'docs', 'shots')
OUT = os.path.join(ROOT, 'website', 'src', 'img')
os.makedirs(OUT, exist_ok=True)
# name: (source, crop box or None, target width)
JOBS = {
  'gate':    ('rename_gate.png', None, 1280),
  'login':   ('rename_login.png', (300, 20, 980, 700), 900),
  'pond':    ('final3_pond_bridge.png', None, 1280),
  'grove':   ('final3_grove_combat.png', None, 1280),
  'foxhills':('r4art_foxhills.png', None, 1280),
  'shrine':  ('r4art_shrine_telegraph.png', None, 1280),
  'guardian':('r4art_shrine_boss.png', None, 1280),
  'pagoda':  ('r4art_pagoda.png', None, 1280),
  'sword':   ('r3art_class_sword.png', (330, 90, 890, 720), 720),
  'talisman':('r3art_class_tal.png', (330, 90, 890, 720), 720),
  'physician':('r3art_class_phy.png', (330, 90, 890, 720), 720),
}
for name, (src, box, w) in JOBS.items():
    im = Image.open(os.path.join(SH, src)).convert('RGB')
    if box: im = im.crop(box)
    if im.width > w: im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    q = 80
    while True:
        p = os.path.join(OUT, name + '.webp')
        im.save(p, 'WEBP', quality=q, method=6)
        if os.path.getsize(p) < 280_000 or q <= 40: break
        q -= 6
    print(name, im.size, os.path.getsize(p) // 1024, 'KB q', q)
