# Daotianji （盗天机）

Daotianji — Free online divination and charting: 34 tools (Meihua, Liuyao, Bazi, Ziwei, Tarot, astrology...), local computation + AI interpretation.

"Bring your question. Take the secret with you."

Live site: https://tianji.vitaglint.com (also https://oneday.vitaglint.com)

## What it is

Daotianji （盗天机， "stealing heaven's secrets") is a free, open-source divination
site. All 34 tools run entirely in the browser — charts are computed locally, no
account and no server needed for the core tools. An optional lightweight AI
interpretation backend (Gemini) explains a reading in plain language.

Interface languages: Simplified Chinese, Traditional Chinese, English, Japanese.
(The divination content itself stays in Chinese.)

## The 34 tools

- `bazi` — Bazi (Four Pillars of Destiny)
- `bazi-hepan` — Bazi Synastry
- `cezi` — Character Divination (Cezi)
- `chenggu` — Bone Weight Fortune (Chenggu)
- `daliuren` — Da Liuren (Great Six Ren)
- `huangji` — Huangji Jingshi
- `jiemeng` — Dream Interpretation
- `jingfang` — Jingfang Yi
- `jinkoujue` — Jinkoujue (Golden Mouth Formula)
- `leinuoman` — Lenormand
- `lingqi` — Lingqi (Spirit Chess)
- `liunian` — Annual & Monthly Fortune
- `liuyao` — Liuyao (Six Lines)
- `lunen` — Norse Runes
- `maya` — Maya Calendar
- `meihua` — Meihua Yishu (Plum Blossom)
- `qimen` — Qimen Dunjia
- `qizheng` — Qizheng Siyu (Seven Governors)
- `shengminglingshu` — Life Path Number
- `taixuan` — Taixuan Jing
- `taiyi` — Taiyi Shenshu
- `taluo` — Tarot
- `tieban` — Tieban Shenshu (Iron Plate)
- `xiaoliuren` — Xiaoliuren (Lesser Six Ren)
- `xiyang` — Western Astrology
- `xiyang-hepan` — Western Synastry
- `yilin` — Jiaoshi Yilin
- `yindu` — Indian Astrology (Vedic)
- `yindu-hepan` — Indian Synastry
- `zhanxing` — Astrology Dice
- `zhouyi` — Zhouyi (I Ching)
- `zhuge` — Zhuge Divination
- `ziwei` — Ziwei Doushu (Purple Star Astrology)
- `ziwei-hepan` — Ziwei Synastry

## Run it locally

The site is fully static. Serve the repository root with any static server:

```sh
python3 -m http.server 8000
# then open http://127.0.0.1:8000/
```

Most tools work out of the box. A few data-driven tools load their datasets from
`/data/` (see below); without the data files those tools show a notice instead
of a result.

## Data

The divination datasets are NOT bundled in this repository. They come from the
third-party open-source project
[comprehensive-shushu-engine](https://github.com/wang-er-1-2003/comprehensive-shushu-engine)
(GPL-3.0). To use the data-driven tools, clone that repository and copy its
`engine/data/` directory to `data/` in the site root, so the files are served
at `/data/`.

## AI interpretation backend (optional)

`oneday-api/jiegua.py` is a small Python (standard library only) service that
explains a reading using Gemini. It contains no API key: it forwards requests
to a local Gemini-compatible proxy at `http://127.0.0.1:8083/v1/chat/completions`
(the proxy injects the key). See `oneday-api/README.md` for setup and rate
limits. The site works fully without it — the "AI interpretation" button
simply needs the backend to be reachable at `/api/jiegua`.

## License

GPL-3.0. See [LICENSE](LICENSE). The datasets are also GPL-3.0; see
[license/](license/) for the full text and attribution.
