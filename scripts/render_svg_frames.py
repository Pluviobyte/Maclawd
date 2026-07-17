#!/usr/bin/env python3
"""Render deterministic frames from a CSS-animated SVG in Chromium."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from playwright.sync_api import sync_playwright


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("svg", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--duration", type=float, required=True)
    parser.add_argument("--fps", type=int, default=10)
    parser.add_argument("--size", type=int, default=500)
    parser.add_argument("--scale", type=float, default=2)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    svg = args.svg.resolve()
    output_dir = args.output_dir.resolve()
    frame_count = round(args.duration * args.fps)

    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        context = browser.new_context(
            viewport={"width": args.size, "height": args.size},
            device_scale_factor=args.scale,
        )
        page = context.new_page()

        for frame in range(frame_count):
            seconds = frame / args.fps
            page.goto(svg.as_uri(), wait_until="load")
            # Direct SVG documents keep their authored width/height (500px in
            # Maclawd) even when the browser viewport is smaller. Resize the
            # root SVG to the requested capture size so a 96px QA render does
            # not capture only the transparent top-left corner.
            page.evaluate(
                """(size) => {
                    const svg = document.documentElement;
                    svg.setAttribute('width', String(size));
                    svg.setAttribute('height', String(size));
                    svg.style.width = `${size}px`;
                    svg.style.height = `${size}px`;
                    svg.style.display = 'block';
                }""",
                args.size,
            )
            page.evaluate(
                """(seconds) => {
                    const style = document.createElementNS(
                        'http://www.w3.org/2000/svg',
                        'style'
                    );
                    style.textContent = `* {
                        animation-delay: -${seconds.toFixed(4)}s !important;
                        animation-play-state: paused !important;
                    }`;
                    document.documentElement.appendChild(style);
                }""",
                seconds,
            )
            # External stylesheets and stepped SVG transforms may update their
            # computed style before Chromium repaints the SVG surface. Two
            # animation frames make the captured pixels match that style.
            page.evaluate(
                """() => new Promise((resolve) => {
                    requestAnimationFrame(() => requestAnimationFrame(resolve));
                })"""
            )
            page.screenshot(
                path=output_dir / f"{frame:03d}.png",
                omit_background=True,
            )

        context.close()
        browser.close()


if __name__ == "__main__":
    main()
