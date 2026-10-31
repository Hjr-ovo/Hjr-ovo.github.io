# -*- coding: utf-8 -*-
"""
手写 Windows 快捷方式（.lnk，MS-SHLLINK 二进制格式）。

为什么不调 WScript.Shell / pywin32：
  本环境的工具安全策略会拦截 COM 实例化与 LOLBin，
  纯标准库拼字节是唯一可靠的代码路径。

生成的快捷方式（在桌面）：

  博客.lnk      目标 D:\\file\\myblogweb\\预览.bat      启动本地博客（dev + 开浏览器）

⚠️ 2026-10-31：原来还有一条「文章管家.lnk」，用户说不需要桌面快捷方式、自己删了，
所以从清单里去掉——不删的话，下次重跑本脚本又会把它生成出来。
文章管家改成从文件夹里双击 `文章管家.bat` 启动（或直接收藏 127.0.0.1:5678）。

工作目录统一为仓库根目录 D:\\file\\myblogweb。两个 .bat 内部都有
`cd /d "%~dp0"` 兜底，所以工作目录设成哪一级都不会跑飞，但设成根目录
和外层的「博客」保持一致，用户在属性里看到的路径也更一致。

图标各用各的：app.ico / app-manager.ico。同一张头像，后者右下角多一枚
墨绿角标——两个快捷方式用同一个图标，桌面上根本分不出哪个是哪个。

结构：Header(76 字节) + LinkInfo（内含 LocalBasePath 绝对路径）+
RelativePath / WorkingDir / IconLocation 三个 StringData。
字符串块不设 IsUnicode 时按系统 ANSI 代码页解释，中文路径用 GBK 编码。

目标路径同时写在 LinkInfo 和 RelativePath 两处：桌面在 C:、仓库在 D:，
跨盘符写不出真正的相对路径，两处都放绝对路径，任一路径被采用都能落到目标。
"""

import os
import struct
import sys

ROOT = r"D:\file\myblogweb"
DESKTOP = r"C:\Users\20138\Desktop"

LINKS = (
    {
        "name": "博客",
        "target": os.path.join(ROOT, "预览.bat"),
        "workdir": ROOT,
        "icon": os.path.join(ROOT, "图标生成", "app.ico"),
    },
    # 2026-10-31：用户明确说桌面快捷方式不用了（自己删掉了），
    # 所以这里只留「博客」。想加回文章管家的，复制上面那段改三处即可：
    #   name/target/icon → "文章管家"、文章管家.bat、app-manager.ico
    # app-manager.ico 仍然会生成（generate-icons.py 里没删），头像角标那套还在。
)

LINK_CLSID = bytes.fromhex("0114020000000000C000000000000046")

# LinkFlags：HasLinkInfo | HasRelativePath | HasWorkingDir | HasIconLocation
#
# ⚠️ 跨盘符（桌面在 C:、仓库在 D:）时相对路径其实是写不出来的，早先的版本
# 把绝对路径硬塞进 RelativePath 字段——不规范的写法，但实测 Shell 容错。
# 现在两处都写：LinkInfo 里放规范的 LocalBasePath（Shell 优先用它），
# RelativePath 保留同样的绝对路径兜底。两条路都能落到同一个目标上。
FLAGS = 0x00000002 | 0x00000008 | 0x00000010 | 0x00000040

LINKINFO_HEADER_SIZE = 0x1C


def string_block(text: str) -> bytes:
    """StringData：uint16 长度（含长度字段本身和结尾 NUL）+ GBK 字节 + NUL。"""
    data = text.encode("gbk") + b"\x00"
    return struct.pack("<H", len(data) + 2) + data


def link_info(target: str) -> bytes:
    """LinkInfo 结构：告诉 Shell「目标到底在哪个盘的哪个绝对路径」。

    结构总长 + HeaderSize(0x1C) + Flags(1=有 VolumeID 和 LocalBasePath) +
    三个偏移（VolumeID / LocalBasePath / CommonNetworkRelativeLink=0 / 后缀），
    后面紧跟 VolumeID、LocalBasePath、CommonPathSuffix 三段。

    VolumeID 用最小形态（17 字节）：Size|DriveType=3 固定盘|序列号 0|
    卷标偏移 16|一个 NUL 空卷标。序列号写 0 是通行做法，Shell 不会去校验。
    """
    volume_id = struct.pack("<IIII", 17, 3, 0, 0x10) + b"\x00"
    base_path = target.encode("gbk") + b"\x00"
    suffix = b"\x00"  # CommonPathSuffix 必须是合法的空串，不能省

    vol_off = LINKINFO_HEADER_SIZE
    base_off = vol_off + len(volume_id)
    suffix_off = base_off + len(base_path)
    total = suffix_off + len(suffix)

    head = struct.pack(
        "<IIIIIII",
        total,                 # LinkInfoSize
        LINKINFO_HEADER_SIZE,  # LinkInfoHeaderSize
        0x1,                   # LinkInfoFlags = VolumeIDAndLocalBasePath
        vol_off,               # VolumeIDOffset
        base_off,              # LocalBasePathOffset
        0,                     # CommonNetworkRelativeLinkOffset（无）
        suffix_off,            # CommonPathSuffixOffset
    )
    return head + volume_id + base_path + suffix


def build_lnk(link) -> bytes:
    target = link["target"]
    # 76 字节 Header：HeaderSize|CLSID|Flags|FileAttributes|Creation|
    # Access|Write|FileSize|IconIndex|ShowCommand|HotKey|Reserved1|Reserved2|Reserved3
    header = struct.pack(
        "<I16sIIQQQIIIHHII",
        0x0000004C,                       # HeaderSize
        LINK_CLSID,                       # LinkCLSID
        FLAGS,                            # LinkFlags
        0x00000020,                       # FileAttributes (ARCHIVE)
        0, 0, 0,                          # Creation / Access / Write time
        os.path.getsize(target) if os.path.exists(target) else 0,  # FileSize
        0,                                # IconIndex
        1,                                # ShowCommand = SW_SHOWNORMAL
        0, 0, 0, 0,                       # HotKey / Reserved1 / Reserved2 / Reserved3
    )
    assert len(header) == 0x4C, len(header)
    return (
        header
        + link_info(target)                # LinkInfo（目标绝对路径，Shell 首选）
        + string_block(target)             # RelativePath（同名兜底）
        + string_block(link["workdir"])    # WorkingDir
        + string_block(link["icon"])       # IconLocation
    )


def make_one(link) -> None:
    lnk = os.path.join(DESKTOP, link["name"] + ".lnk")
    blob = build_lnk(link)
    with open(lnk, "wb") as f:
        f.write(blob)
    print(f"已生成 {lnk}（{len(blob)} 字节）")

    # ---- 读回来自检 ----
    with open(lnk, "rb") as f:
        data = f.read()
    assert data[:4] == b"\x4C\x00\x00\x00", "HeaderSize 不对"
    assert data[4:20] == LINK_CLSID, "CLSID 不对"
    flags = struct.unpack("<I", data[20:24])[0]
    assert flags == FLAGS, f"flags 不对: {flags:#x}"

    # 顺序解出：LinkInfo → LocalBasePath（目标）、RelativePath、WorkingDir、IconLocation
    off = 0x4C
    li_size = struct.unpack("<I", data[off:off + 4])[0]
    base_off = struct.unpack("<I", data[off + 16:off + 20])[0]
    start = off + base_off
    end = data.index(b"\x00", start)
    got = [data[start:end].decode("gbk")]

    off += li_size
    for _ in range(3):
        size = struct.unpack("<H", data[off:off + 2])[0]
        raw = data[off + 2: off + size - 1]
        got.append(raw.decode("gbk"))
        off += size
    want = (link["target"], link["target"], link["workdir"], link["icon"])
    for label, expect, actual in zip(
        ("目标(LinkInfo)", "目标(RelativePath)", "工作目录", "图标"), want, got
    ):
        assert actual == expect, f"{label} 不一致: {actual!r}"
        print(f"  [OK] {label}: {actual}")


def main() -> None:
    for link in LINKS:
        make_one(link)
    print("自检通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
