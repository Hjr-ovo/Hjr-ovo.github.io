---
title: 哈希算法（Hash）入门：从一个整数下标讲起
description: 哈希函数是什么、为什么碰撞躲不掉、常见算法怎么选，以及密码存储 / 哈希表 / 文件校验这些真实场景里它到底在干什么。示例统一用 C++17。
pubDate: 2026-10-30
categories:
  - 算法
tags:
  - 哈希
  - 数据结构
---

## 一、哈希函数是什么

**哈希函数（hash function）是一个「把任意长度的输入，变成固定长度输出」的函数。**

- 输入可以是任意东西：一段文字、一个文件、一个整数、一张图片的二进制……
- 输出是一个固定长度的「摘要」，通常叫**哈希值 / 散列值 / digest**，经常用一串十六进制表示，比如 `5e8b9a...`。

最直观的例子——把字符串映射成数组下标：

```cpp
#include <string>

// 把字符串映射到 0 ~ size-1 的一个下标
int simple_hash(const std::string& s, int size) {
    int h = 0;
    for (char ch : s) {
        h = (h * 31 + static_cast<unsigned char>(ch)) % size;
    }
    return h;
}

// simple_hash("apple", 10)  ->  7
// simple_hash("banana", 10) ->  3
```

无论 `"apple"` 多长，出来的永远是一个 `0~9` 之间的整数。这就是哈希最朴素的样子。

## 二、好的哈希函数长什么样

不同场景对哈希的要求不一样，但有几个**通用性质**是基本功：

| 性质 | 含义 | 为什么重要 |
| --- | --- | --- |
| **确定性** | 同一个输入永远得到同一个输出 | 否则你存的密码下回对不上了 |
| **固定长度输出** | 不管输入 1 字节还是 1 GB，输出长度不变 | 方便当索引、存数据库 |
| **雪崩效应** | 输入改 1 个比特，输出约半数比特翻转 | 让输出「看起来随机」，难以预测 |
| **不可逆**（密码学哈希） | 知道输出也几乎算不出输入 | 存密码、数字签名的前提 |

> ⚠️ 注意区分两类哈希：**非密码学哈希**（如上面那个 `simple_hash`、CRC32）追求「快、分布均匀」，用于哈希表；**密码学哈希**（MD5/SHA 系列）额外要求「不可逆、抗碰撞」，用于安全。把快的当安全的用，是新手最常见的翻车点。

## 三、碰撞：躲不掉的宿命

**碰撞（collision）** 指的是：两个不同的输入，算出了**同一个**哈希值。

为什么必有碰撞？用抽屉原理（pigeonhole principle）想一下：

- 输入空间是「无限」的（任意长度字符串）
- 输出空间是「有限」的（比如 256 位，最多 `2^256` 个值）

无限往有限里塞，必然有两个输入撞到同一个格子。所以**碰撞不是 bug，是数学上的必然**。问题从来不是「有没有碰撞」，而是「能不能被人故意制造出来」。

工程上怎么处理碰撞，取决于用途：

### 1. 哈希表里的碰撞 → 链地址法 / 开放寻址

```cpp
#include <list>
#include <string>
#include <utility>
#include <vector>

// 链地址法：同一个下标挂一条链表
std::vector<std::list<std::pair<std::string, int>>> table(8);

void insert(const std::string& key, int value) {
    int idx = simple_hash(key, 8);
    table[idx].push_back({key, value});   // 撞了就往链表后面挂
}
```

### 2. 安全场景里的碰撞 → 只能选「抗碰撞」的算法

普通哈希（如 MD5）已经被攻破：能**人为构造**两个不同文件拥有相同 MD5。所以安全场景只能选 SHA-256 这类目前未被攻破的算法。

## 四、常见哈希算法怎么选

| 算法 | 输出长度 | 现状 | 典型用途 |
| --- | --- | --- | --- |
| **MD5** | 128 位 | ❌ 已不安全，碰撞可人为构造 | 只配做文件完整性粗校验（非安全场景） |
| **SHA-1** | 160 位 | ❌ 已不安全 | 老系统遗留，新项目别用 |
| **SHA-256** | 256 位 | ✅ 目前安全 | 密码存储、区块链、数字签名、Git 对象标识 |
| **CRC32** | 32 位 | 非密码学 | 网络传输、压缩包的错误检测 |
| **FNV / 整数哈希** | 可变 | 非密码学 | 哈希表、内存里的快速索引 |

> 一句话记忆：**要安全就 SHA-256；要快就 FNV / 整数哈希；MD5 / SHA-1 除非只是随手校验文件有没有传坏，否则别碰。**

## 五、真实场景里它在干什么

### 1. 哈希表（平均 O(1) 查找）

`std::unordered_map`、`std::unordered_set` 底层都是哈希。查找、插入平均 **O(1)**，靠的就是把 key 哈希成数组下标直奔目标。

### 2. 密码存储（必须加盐）

直接 `hash(密码)` 存库还不够——相同密码会得到相同哈希，黑客拿「彩虹表」一比对就破。正确做法是加**盐（salt）**：每个用户一份随机盐，和密码拼在一起再哈希。

```cpp
#include <openssl/sha.h>
#include <random>
#include <string>

// 需要链接 OpenSSL：g++ -std=c++17 main.cpp -lcrypto
std::string sha256_hex(const std::string& data) {
    unsigned char digest[SHA256_DIGEST_LENGTH];
    SHA256(reinterpret_cast<const unsigned char*>(data.data()), data.size(), digest);

    static const char* hex = "0123456789abcdef";
    std::string out;
    out.reserve(SHA256_DIGEST_LENGTH * 2);
    for (unsigned char c : digest) {
        out += hex[c >> 4];
        out += hex[c & 0x0F];
    }
    return out;
}

std::string store_password(const std::string& password) {
    // 每个用户独一无二的随机盐
    std::random_device rd;
    std::string salt;
    for (int i = 0; i < 16; ++i) {
        salt += "0123456789abcdef"[rd() % 16];
    }

    std::string h = sha256_hex(salt + password);
    return salt + ":" + h;   // 盐要和哈希一起存
}

// 验证时：按 ':' 拆出盐，用同样的盐重算一遍再比对
```

> 实际项目里别自己拼这套流程，用 `bcrypt` / `argon2` 这类**专门为了抗暴力破解**设计的算法，它们内部会做慢哈希和参数调节。

### 3. 数据完整性校验

下载大文件时常看到 `SHA256SUMS` 文件，就是官方给出的哈希值。你本地算一遍，和官方对上，说明文件没被篡改、没下坏。

```bash
# Linux / macOS
sha256sum your-file.zip
# Windows PowerShell
Get-FileHash your-file.zip -Algorithm SHA256
```

### 4. Git / 区块链

Git 里每个 commit、每个 blob 都用哈希做唯一标识；区块链把前一个区块的哈希写进后一个区块，篡改任意历史都会让后面所有哈希「断链」。

### 5. 布隆过滤器

用多个哈希函数把元素映射到位数组，能极省内存地判断「某个元素**一定不在**或**可能在**」集合里，常用于缓存穿透防护。

## 六、新手最容易踩的坑

1. **用 MD5 / SHA-1 存密码** —— 至少上 SHA-256 + 盐；更省心的是直接用 `bcrypt` / `argon2`。
2. **把哈希当加密** —— 哈希是单向的，不能「解密」。需要还原原文请用对称加密（AES），别混淆。
3. **忽略哈希碰撞 DoS** —— 攻击者专门构造大量**同哈希**的 key 攻击哈希表，让 O(1) 退化成 O(n)，拖垮服务。Java 8+、Python 3.3+ 已在字符串哈希里加了随机化种子缓解。
4. **自定义类型放进 `unordered_map` 却只写了一半** —— C++ 里必须**同时**提供 `operator==` 和 `std::hash` 特化（或用自定义哈希器）。少写一个，编译器可能报一大串模板错误；写错一个，`find` 就永远找不到键。

```cpp
#include <functional>
#include <string>
#include <unordered_map>

struct User {
    int id;
    std::string name;

    bool operator==(const User& other) const {
        return id == other.id && name == other.name;
    }
};

// 只给 User 提供哈希，不然 unordered_map<User, int> 编不过
template <>
struct std::hash<User> {
    std::size_t operator()(const User& u) const noexcept {
        return std::hash<int>{}(u.id) ^ (std::hash<std::string>{}(u.name) << 1);
    }
};
```

## 七、小结

- 哈希 = **任意输入 → 固定输出** 的映射，确定性是底线。
- 碰撞是**数学必然**，工程上要么「挂链表 / 开放寻址」容忍它（哈希表），要么「选抗碰撞算法」对抗它（安全）。
- 算法选型：**安全 → SHA-256；速度 → 非密码学哈希；MD5 / SHA-1 基本可以退休**。
- 密码存储牢记：**哈希 ≠ 加密，且必须加盐**。

> 这篇是入门概览，没覆盖具体算法的内部数学（压缩函数、位运算实现）。如果后面要深挖 SHA-256 的轮函数，或者哈希表扩容时机的工程取舍，都可以单独再写一篇。
