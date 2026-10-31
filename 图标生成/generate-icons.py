# -*- coding: utf-8 -*-
"""
博客 / 管理工具图标一键生成脚本（Pillow）。

输入：同目录下的 logo.png（阿然手绘风头像，白底，1224x1244）。
输出（按尺寸全部由本脚本一次产出，改 logo.png 后必须重跑，勿手改产物）：

  site/public/favicon.ico            16/32/48/64 四档（浏览器标签页）
  site/public/favicon.png            512（现代浏览器 png favicon）
  site/public/apple-touch-icon.png   180（iOS 添加到主屏）
  site/public/icon-192.png           192（Android Chrome / PWA）
  site/public/icon-512.png           512（Android Chrome / PWA）
  图标生成/app.ico                   16/32/48/64/128/256（Windows 快捷方式大图标，
                                     桌面「博客」快捷方式用，见 make-shortcut.py）
  图标生成/app-manager.ico           同上六档（桌面「文章管家」快捷方式用，
                                     底图同头像 + 右下角墨绿角标，便于区分）

两条硬规矩（来自踩坑）：
  1. ICO 必须自拼容器 —— Pillow 的 ICO 保存只认一张母图再统一 resize，
     会把「每档单独处理」的努力全部抹平，产出几百字节的假多尺寸。
     本脚本按「<128 走 BMP(DIB)，>=128 走 PNG」逐档原样嵌入。
  2. 小尺寸不是等比缩一下就完事 —— 位图缩到 16px 必然发软，
     按尺寸分档调锐化强度，越小越锐。
"""

import io
import os
import struct
import sys

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "logo.png")
ROOT = os.path.dirname(HERE)  # D:\file\myblogweb

SITE_PUBLIC = os.path.join(ROOT, "site", "public")

# Windows 快捷方式大图标：产物跟脚本放一起，不散落到别处。
# （2026-10-30 博客后台工具已删除，原先放在「博客后台工具/app.ico」，
#   现在快捷方式指向根目录的 预览.bat，图标就近放本目录。）
SHORTCUT_ICON = os.path.join(HERE, "app.ico")

# 「文章管家」桌面快捷方式图标。和«博客»用同一张头像做家族标识，
# 只在右下角加一枚角标区分功能——两个快捷方式同图标在桌面上会分不清。
MANAGER_ICON = os.path.join(HERE, "app-manager.ico")


# ---------------------------------------------------------------
# 缩放 + 按尺寸分档锐化
# ---------------------------------------------------------------

# 小尺寸裁切比例：原图带大面积暖白纸纹留白（背景色约 #F0EDE9），
# 纸纹一直蔓延到画布边缘，自动包围盒会把边缘装饰也框进来，
# 所以改用固定比例居中裁。0.88 = 人物约占全图 80%，裁后四周
# 仍留约 2% 安全边，切不到丸子头顶发和下巴。
# ⚠️ 换 logo.png 后必须人工复核这个比例。
SMALL_CROP_RATIO = 0.88


def build_icon(size: int) -> Image.Image:
    """把 logo.png 缩到 size x size。

    分档策略：
      <=64px  先居中裁掉 SMALL_CROP_RATIO 的暖白留白，主体更大更清楚
      >=128px 保留全图构图（大尺寸看得清原图取景）
    """
    src = Image.open(SRC).convert("RGBA")
    if size <= 64:
        w, h = src.size
        cw = ch = int(round(min(w, h) * SMALL_CROP_RATIO))
        left = (w - cw) // 2
        top = (h - ch) // 2
        src = src.crop((left, top, left + cw, top + ch))
    im = src.resize((size, size), Image.LANCZOS)

    if size >= 64:
        radius, percent, threshold = 1.2, 45, 2
    elif size >= 32:
        radius, percent, threshold = 1.0, 70, 2
    else:
        # 16px 及以下：不锐化就等于糊成一团色块
        radius, percent, threshold = 0.8, 90, 2

    return im.filter(
        ImageFilter.UnsharpMask(radius=radius, percent=percent, threshold=threshold)
    )


# ---------------------------------------------------------------
# 「文章管家」图标：头像 + 右下角标
# ---------------------------------------------------------------

# 角标底色取站点的 --accent（墨绿 #0F6E56），和站点、管家界面同一套色。
BADGE_FILL = (15, 110, 86, 255)
BADGE_RING = (255, 255, 255, 235)   # 白色描边：头像本身是暖白纸底，没这圈角标会糊进背景
BADGE_INK = (255, 255, 255, 255)

# 小于这个尺寸不再画三条横线：16px 上角标只有 3px 高，横线必然糊成一块。
# 但角标本体仍然保留——纯色小圆挤在小图标里虽然简陋，至少还能一眼看出
# 它和«博客»不是同一个程序；完全不画的话，桌面切"小图标"视图就彻底分不清了。
BARS_MIN_SIZE = 24


def build_manager_icon(size: int) -> Image.Image:
    """头像 + 右下角墨绿圆形角标（内含三条白横线，取「列表 / 管理」意象）。

    ⚠️ 角标必须先在 4 倍画布上画完再缩回目标尺寸：直接按 size 画圆和横线，
    32px 下边缘全是台阶状锯齿。缩回来不做二次锐化——头像那层已经锐过一次，
    再锐会过头起白边。
    """
    base = build_icon(size)

    scale = 4
    S = size * scale
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    r = int(S * 0.195)                     # 角标半径
    cx = cy = S - r - int(S * 0.045)       # 圆心靠右下，外缘留约 2.5% 安全边
    ring = max(1, int(S * 0.03))           # 白色描边宽度

    d.ellipse([cx - r - ring, cy - r - ring, cx + r + ring, cy + r + ring], fill=BADGE_RING)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BADGE_FILL)

    if size >= BARS_MIN_SIZE:
        # 三条横线用圆角矩形而不是 line()：line 是平头，缩到 32px 会显尖。
        bar_h = max(2, int(r * 0.26))
        half = int(r * 0.52)
        for frac in (-0.44, 0.0, 0.44):
            y = cy + int(r * frac)
            d.rounded_rectangle(
                [cx - half, y - bar_h // 2, cx + half, y + bar_h // 2],
                radius=bar_h // 2,
                fill=BADGE_INK,
            )

    return Image.alpha_composite(base, layer.resize((size, size), Image.LANCZOS))


# ---------------------------------------------------------------
# 自拼 ICO 容器
# ---------------------------------------------------------------

def _dib_bytes(im: Image.Image) -> bytes:
    """BGRA、自底向上、biHeight 写两倍（上半 XOR 像素图、下半 AND 掩码）。

    AND 掩码行必须真的写出来：只写一半数据 Pillow 读得出来（宽容），
    Windows 按 biHeight=2h 解析会越界失败，图标显示为默认白图标。
    """
    w, h = im.size
    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    px = im.convert("RGBA").load()
    rows = []
    for y in range(h - 1, -1, -1):
        row = bytearray()
        for x in range(w):
            r, g, b, a = px[x, y]
            row += bytes((b, g, r, a))
        rows.append(bytes(row))
    and_stride = ((w + 31) // 32) * 4  # 1bpp 行按 4 字节对齐
    for _ in range(h):
        rows.append(bytes(and_stride))  # 全 0 掩码，h 行
    return header + b"".join(rows)


def write_ico(path: str, sizes, builder=build_icon) -> None:
    """把每档成品图原样嵌进 ICO 容器（分档策略由此保住）。"""
    entries, blobs = [], []
    offset = 6 + 16 * len(sizes)
    for size in sizes:
        im = builder(size)
        if size >= 128:
            buf = io.BytesIO()
            im.save(buf, format="PNG")
            data = buf.getvalue()
        else:
            data = _dib_bytes(im)
        entries.append(struct.pack(
            "<BBBBHHII",
            size if size < 256 else 0, size if size < 256 else 0,
            0, 0, 1, 32, len(data), offset,
        ))
        blobs.append(data)
        offset += len(data)
    with open(path, "wb") as f:
        f.write(struct.pack("<HHH", 0, 1, len(sizes)))
        for e in entries:
            f.write(e)
        for b in blobs:
            f.write(b)


def save_png(im: Image.Image, path: str) -> None:
    im.save(path, format="PNG", optimize=True)


# ---------------------------------------------------------------
# 验收：ICO 取帧必须与独立 PNG 逐像素一致
# ---------------------------------------------------------------

def check_ico_structure(ico_path: str, sizes) -> None:
    """逐档验证数据块长度与目录项声明一致。

    Pillow 读 ICO 很宽容（缺 AND 掩码也能读出来），Windows 不宽容——
    必须按「目录项声明的字节数 == 实际数据块字节数」硬校验，
    BMP 帧还要按 biHeight=2h 核对 40+像素行+掩码行 的总长。
    """
    with open(ico_path, "rb") as f:
        data = f.read()
    reserved, typ, count = struct.unpack("<HHH", data[:6])
    assert reserved == 0 and typ == 1, "不是合法 ICO 头"
    assert count == len(sizes), f"目录项数 {count} != {len(sizes)}"
    off = 6
    for i, size in enumerate(sizes):
        w, h, _c, _r, _p, _b, bsize, boff = struct.unpack(
            "<BBBBHHII", data[off:off + 16]
        )
        # ICO 目录项尺寸字段是 1 字节：256 装不下，规范约定写 0 表示 256
        dw = 256 if w == 0 else w
        dh = 256 if h == 0 else h
        assert (dw, dh) == (size, size), f"第 {i} 档目录项尺寸 {dw}x{dh} != {size}"
        assert boff + bsize <= len(data), f"第 {i} 档数据块越界"
        blob = data[boff:boff + bsize]
        if size >= 128:
            assert blob[:8] == b"\x89PNG\r\n\x1a\n", f"{size}px 档应为 PNG 数据"
        else:
            bw, bh = struct.unpack("<ii", blob[4:12])
            and_stride = ((bw + 31) // 32) * 4
            expect = 40 + (bh // 2) * (bw * 4) + (bh // 2) * and_stride
            assert bh == bw * 2, f"{size}px 档 biHeight={bh} 应为 {bw * 2}"
            assert len(blob) == expect, (
                f"{size}px DIB 长度 {len(blob)} != 声明 {expect}（缺 AND 掩码？）"
            )
        off += 16
    print(f"[OK] {os.path.basename(ico_path)} 目录项与数据块结构一致（{len(sizes)} 档）")


def verify_ico(ico_path: str, sizes, builder=build_icon) -> None:
    ico = Image.open(ico_path)
    for s in sizes:
        ico.size = (s, s)
        ico.load()
        expect = builder(s)
        from PIL import ImageChops
        d = ImageChops.difference(ico.convert("RGBA"), expect).getbbox()
        if d is not None:
            raise SystemExit(f"[FAIL] {ico_path} 的 {s}px 帧与 PNG 不一致: bbox={d}")
    print(f"[OK] {os.path.basename(ico_path)} 逐帧与 PNG 一致（{len(sizes)} 档）")


def main() -> None:
    src = Image.open(SRC)
    print(f"源图: {SRC}  {src.size[0]}x{src.size[1]}  {src.mode}")

    # ---- 站点（博客本体）----
    write_ico(os.path.join(SITE_PUBLIC, "favicon.ico"), (16, 32, 48, 64))
    save_png(build_icon(512), os.path.join(SITE_PUBLIC, "favicon.png"))
    save_png(build_icon(180), os.path.join(SITE_PUBLIC, "apple-touch-icon.png"))
    save_png(build_icon(192), os.path.join(SITE_PUBLIC, "icon-192.png"))
    save_png(build_icon(512), os.path.join(SITE_PUBLIC, "icon-512.png"))
    check_ico_structure(os.path.join(SITE_PUBLIC, "favicon.ico"), (16, 32, 48, 64))
    verify_ico(os.path.join(SITE_PUBLIC, "favicon.ico"), (16, 32, 48, 64))

    # ---- Windows 快捷方式大图标 ----
    SIX = (16, 32, 48, 64, 128, 256)
    write_ico(SHORTCUT_ICON, SIX)
    check_ico_structure(SHORTCUT_ICON, SIX)
    verify_ico(SHORTCUT_ICON, SIX)

    # ---- 「文章管家」快捷方式图标（头像 + 角标）----
    write_ico(MANAGER_ICON, SIX, build_manager_icon)
    check_ico_structure(MANAGER_ICON, SIX)
    verify_ico(MANAGER_ICON, SIX, build_manager_icon)

    print("全部图标生成完毕。")


if __name__ == "__main__":
    main()
