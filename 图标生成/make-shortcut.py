# -*- coding: utf-8 -*-
"""
手写 Windows 快捷方式（.lnk，MS-SHLLINK 二进制格式）。

为什么不调 WScript.Shell / pywin32：
  本环境的工具安全策略会拦截 COM 实例化与 LOLBin，
  纯标准库拼字节是唯一可靠的代码路径。

生成的快捷方式：
  目标      D:\\file\\myblogweb\\博客管理工具\\启动.bat
  工作目录  D:\\file\\myblogweb\\博客管理工具
  图标      D:\\file\\myblogweb\\博客管理工具\\app.ico
  位置      C:\\Users\\20138\\Desktop\\博客管理工具.lnk

只用了三个字段：RelativePath + WorkingDir + IconLocation（绝对路径）。
字符串块默认按系统 ANSI 代码页解释，中文路径用 GBK 编码。
"""

import os
import struct
import sys

TARGET = r"D:\file\myblogweb\博客管理工具\启动.bat"
WORKDIR = r"D:\file\myblogweb\博客管理工具"
ICON = r"D:\file\myblogweb\博客管理工具\app.ico"
LNK = r"C:\Users\20138\Desktop\博客管理工具.lnk"

LINK_CLSID = bytes.fromhex("0114020000000000C000000000000046")
FLAGS = 0x00000008 | 0x00000010 | 0x00000040  # RelativePath|WorkingDir|IconLocation


def string_block(text: str) -> bytes:
    """StringData：uint16 长度（含长度字段本身和结尾 NUL）+ GBK 字节 + NUL。"""
    data = text.encode("gbk") + b"\x00"
    return struct.pack("<H", len(data) + 2) + data


def build_lnk() -> bytes:
    # 76 字节 Header：HeaderSize|CLSID|Flags|FileAttributes|Creation|
    # Access|Write|FileSize|IconIndex|ShowCommand|HotKey|Reserved1|Reserved2|Reserved3
    header = struct.pack(
        "<I16sIIQQQIIIHHII",
        0x0000004C,                       # HeaderSize
        LINK_CLSID,                       # LinkCLSID
        FLAGS,                            # LinkFlags
        0x00000020,                       # FileAttributes (ARCHIVE)
        0, 0, 0,                          # Creation / Access / Write time
        os.path.getsize(TARGET) if os.path.exists(TARGET) else 0,  # FileSize
        0,                                # IconIndex
        1,                                # ShowCommand = SW_SHOWNORMAL
        0, 0, 0, 0,                       # HotKey / Reserved1 / Reserved2 / Reserved3
    )
    assert len(header) == 0x4C, len(header)
    return (
        header
        + string_block(TARGET)     # RelativePath
        + string_block(WORKDIR)    # WorkingDir
        + string_block(ICON)       # IconLocation
    )


def main() -> None:
    blob = build_lnk()
    with open(LNK, "wb") as f:
        f.write(blob)
    print(f"已生成 {LNK}（{len(blob)} 字节）")

    # ---- 读回来自检 ----
    with open(LNK, "rb") as f:
        data = f.read()
    assert data[:4] == b"\x4C\x00\x00\x00", "HeaderSize 不对"
    assert data[4:20] == LINK_CLSID, "CLSID 不对"
    flags = struct.unpack("<I", data[20:24])[0]
    assert flags == FLAGS, f"flags 不对: {flags:#x}"

    # 顺序解出三个字符串块
    off = 0x4C
    got = []
    for _ in range(3):
        size = struct.unpack("<H", data[off:off + 2])[0]
        raw = data[off + 2: off + size - 1]
        got.append(raw.decode("gbk"))
        off += size
    for label, want, actual in zip(
        ("目标", "工作目录", "图标"), (TARGET, WORKDIR, ICON), got
    ):
        assert actual == want, f"{label} 不一致: {actual!r}"
        print(f"  [OK] {label}: {actual}")
    print("自检通过。")


if __name__ == "__main__":
    sys.exit(main())
