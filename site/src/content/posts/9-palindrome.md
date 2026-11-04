---
title: 9-回文数
description: 这篇文章为leetcode第9题回文数的解答。
pubDate: 2026-11-02
categories: [leetcode解答]
tags: [leetcode]
draft: false
---

# 题目

给你一个整数 `x` ，如果 `x` 是一个回文整数，返回 `true` ；否则，返回 `false` 。

回文数是指正序（从左向右）和倒序（从右向左）读都是一样的整数。

- 例如，`121` 是回文，而 `123` 不是。

**示例 1：**

```
输入：x = 121
输出：true
```

**示例 2：**

```
输入：x = -121
输出：false
解释：从左向右读, 为 -121 。 从右向左读, 为 121- 。因此它不是一个回文数。
```

**示例 3：**

```
输入：x = 10
输出：false
解释：从右向左读, 为 01 。因此它不是一个回文数。
```

**提示：**

- `-231 <= x <= 231 - 1`

**进阶：**你能不将整数转为字符串来解决这个问题吗？

---

*注：解法一为作者解答，解法二为官方解答，其余为ai解答（均已验证代码可行性）*

# 解法一：转字符串+双指针

代码如下：

```cpp
string str = to_string(x);
int left = 0, right = str.size() - 1;
while (left < right) 
{
	if (str[left] != str[right]) 
		{   return false;   }
	left++;
	right--;
}
return true;
```

代码解析：

```cpp
string str = to_string(x);
//把整数x转成字符串，存进变量str。
//比如x = 121，str就是"121"；x = -121，str就是"-121"。
//转成字符串之后，就能像数组一样用下标访问每一位字符。

int left = 0, right = str.size() - 1;
//两个指针：left指向字符串最左边（第0个字符），right指向字符串最右边（最后一个字符）。
//str.size()是字符串长度，减1才是最后一个字符的下标（下标从0开始）。

while (left < right) 
//只要left还在right左边，就继续比较。left < right保证两个指针指向不同的字符，不会自己跟自己比。

{
	if (str[left] != str[right]) 
		{   return false;   }
	//比较左右两个字符。只要有一对不相等，就说明不是回文，立刻返回false。

	left++;
	right--;
	//这一对相等，把left往右移一格，right往左移一格，继续比较下一对。
}
//while结束，说明所有对称位置都相等。

return true;
//全部比完都没返回false，说明是回文，返回true。
```

---

# 解法二：反转一半数字（官方解答）

代码如下：

```cpp
if (x < 0 || (x % 10 == 0 && x != 0)) 
	{   return false;   }
int revertedNumber = 0;
while (x > revertedNumber) 
{   
revertedNumber = revertedNumber * 10 + x % 10;
	x /= 10;
}
return x == revertedNumber || x == revertedNumber / 10;
```

代码解析：

```cpp
if (x < 0 || (x % 10 == 0 && x != 0)) 
	{   return false;   }
//两个特殊情况直接判死：
//1. x < 0：负数一定不是回文（负号只在最左边，右边对称位置不可能是负号）。
//2. x % 10 == 0 && x != 0：末位是0且不是0本身，一定不是回文。
//   因为回文要求首位等于末位，末位是0则首位也得是0，但整数首位不可能是0（除了0自己）。
//   加 x != 0 是为了保护 0 本身，0 是回文，不能被误杀。

int revertedNumber = 0;
//revertedNumber 用来存"反转后的后半部分"，初始为0。

while (x > revertedNumber) 
//只要原数 x 还大于反转数 revertedNumber，就继续。
//每轮 x 去掉一位（变短），revertedNumber 增加一位（变长），
//当 revertedNumber 的位数追上 x 的位数时，说明已经处理了一半，循环结束。

{   
	revertedNumber = revertedNumber * 10 + x % 10;
	//把 revertedNumber 整体左移一位（乘10），加上 x 的最末位（x % 10）。
	//效果：把 x 的最末位掰下来，接到 revertedNumber 的末尾，实现逐位反转。

	x /= 10;
	 //x 去掉最末位（整除10），剩下的就是还没处理的前半部分。
}

return x == revertedNumber || x == revertedNumber / 10;
//循环结束时，x 是前半部分，revertedNumber 是反转后的后半部分。
//偶数位数字：前后两半位数相同，直接比 x == revertedNumber。
//奇数位数字：revertedNumber 比 x 多一位（原数中间位落在 rev 末位），
//            用 revertedNumber / 10 去掉中间位，再和 x 比。
//两个条件满足一个就是回文。
```

---

# 解法三：转字符串 + 直接反转比较

代码如下：

```cpp
string s = to_string(x);
string t(s.rbegin(), s.rend());
return s == t;
```

代码解析：

```cpp
string s = to_string(x);
//把整数 x 转成字符串，存进 s。
//比如 x = 121，s = "121"；x = -121，s = "-121"。

string t(s.rbegin(), s.rend());
//用 s 的两个"反向迭代器"构造一个新字符串 t。
//s.rbegin() 指向 s 的最后一个字符，s.rend() 指向 s 第一个字符的前一个位置。
//从 rbegin 走到 rend，相当于从后往前遍历 s，所以 t 是 s 倒过来的一份副本。
//比如 s = "121"，t = "121"；s = "-121"，t = "121-"。

return s == t;
//比较 s 和 t 是否完全相同。相同就是回文，返回 true；不同返回 false。
```

# 解法四：转字符串 + 递归

代码如下：

```cpp
class Solution {
public:
    bool check(const string& s, int l, int r)
    {
        if (l >= r) return true;
        if (s[l] != s[r]) return false;
        return check(s, l + 1, r - 1);
    }

    bool isPalindrome(int x)
    {
        if (x < 0) return false;                
        string s = to_string(x);                
        return check(s, 0, (int)s.size() - 1);  
    }
};
```

代码解析：

```cpp
class Solution {
public:
//LeetCode 规定的类，所有代码写在类里面。

    bool check(const string& s, int l, int r) 
    //辅助函数：判断字符串 s 的 [l, r] 区间是不是回文。
    //const string&：传引用，不拷贝字符串，函数内也不修改它。
    //l：区间左边界下标；r：区间右边界下标。

    {
        if (l >= r) return true;
        //递归终止条件：区间里最多剩一个字符（l == r）或已经空了（l > r）。
        //单字符或空串，天然是回文，返回 true。

        if (s[l] != s[r]) return false;
        //比较当前区间的一头一尾。不相等 → 不是回文，立刻返回 false。

        return check(s, l + 1, r - 1);
        //一头一尾相等，递归判断"去掉两头后的里面"是不是回文。
        //左边界右移一格（l+1），右边界左移一格（r-1）。
    }

    bool isPalindrome(int x) 
    //题目要求的入口函数。输入整数 x，返回它是不是回文。
    {
        if (x < 0) return false;                 
        //负数一定不是回文。负号只在最左边，右边对称位置不可能是负号。
        //在入口就排除，不进入 check，省事。

        string s = to_string(x);                 
        //把整数 x 转成字符串。
        //比如 x = 121 → s = "121"；x = 10 → s = "10"。
        //转成字符串后，每一位变成字符，可以用下标访问。

        return check(s, 0, (int)s.size() - 1);   
        //调用 check，判断整个字符串 [0, 最后一个字符] 是不是回文。
        //(int)s.size() - 1：先转 int 再减 1，得到最后一个字符的下标。
        //不能写成 s.size() - 1，因为 size() 返回无符号数，空串时 0-1 会下溢。
    }
};
```

---
# 解法五：转字符串 + 栈

代码如下：

```cpp
string s = to_string(x);
stack<char> st;
for (char c : s) st.push(c);
for (char c : s) 
{
    if (c != st.top()) return false;
    st.pop();
}
return true;
```

代码解释：

```cpp
string s = to_string(x);
//把整数 x 转成字符串，存进 s。
//比如 x = 121，s = "121"；x = -121，s = "-121"。

stack<char> st;
//创建一个栈，栈里装 char（字符）。此时栈是空的。

for (char c : s) st.push(c);
//遍历字符串 s 的每个字符，依次压入栈。
//压栈顺序是正序：先压 '1'，再压 '2'，最后压 '1'。
//栈的特性是"后进先出"，所以最后压进去的字符（原串最后一个字符）会在栈顶。

for (char c : s) 
//再从头遍历一次字符串 s，这次是正序读。
{
    if (c != st.top()) return false;
    //把当前字符 c 和栈顶比较。
    //栈顶 = 原串还没被弹出部分里"最靠后"的字符，也就是倒序读的下一个字符。
    //不相等就说明不是回文，立刻返回 false。

    st.pop();
    //这一对相等，把栈顶弹出，准备比较下一对。
}

return true;
//两轮都走完，所有字符都配对成功，说明是回文，返回 true。
```

---
# 解法六：反转整个数字

代码如下：

```cpp
if (x < 0) return false;
long long rev = 0;
int original = x;
while (x > 0) 
{
    rev = rev * 10 + x % 10;
    x /= 10;
}
return rev == original;
```

代码解释：

```cpp
if (x < 0) return false;
//负数一定不是回文，直接返回 false。
//负号只在最左边，右边对称位置不可能是负号，永远配不上。

long long rev = 0;
//rev 用来存"完全反转后的数字"，初始为 0。
//这里必须用 long long，不能用 int，原因后面细讲（防溢出）。

int original = x;
//把原数备份一份到 original。
//因为下面的 while 循环会不断修改 x，最后 x 会变成 0，原值就丢了。
//备份下来，最后才能拿反转结果和原数比较。

while (x > 0) 
{
//只要 x 还大于 0，就继续掰位。
//前面已经排除了负数，所以 x 一定是非负，用 > 0 就够了。

    rev = rev * 10 + x % 10;
    //把 rev 整体左移一位（乘10），加上 x 的最末位（x % 10）。
    //效果：把 x 的最末位接到 rev 的末尾，实现逐位反转。

    x /= 10;
    //x 去掉最末位（整除10），剩下的部分继续下一轮。
}

return rev == original;
//循环结束时，rev 是原数完全反转后的结果，original 是原数。
//两者相等就是回文，返回 true；否则返回 false。
```

---
# 解法七：提取成数组 + 双指针

代码如下：

```cpp
if (x < 0) return false;
vector<int> d;
while (x > 0) 
{ 
	d.push_back(x % 10); 
	x /= 10; 
}
int l = 0, r = d.size() - 1;
while (l < r) 
{
    if (d[l] != d[r]) return false;
    l++; r--;
}
return true;
```

代码解释：

```cpp
if (x < 0) return false;
//负数一定不是回文，直接返回 false。
//负号只在最左边，右边对称位置不可能是负号，永远配不上。

vector<int> d;
//创建一个空的动态数组 d，用来存整数的每一位数字。
//注意是 vector<int>，每个元素是 int（一位数字），不是 char。

while (x > 0) 
{ 
	d.push_back(x % 10); 
	x /= 10; 
}
//只要 x 还大于 0，就继续抠位。
//  x % 10：取 x 的最末位，push_back 到 d 的末尾。
//  x /= 10：去掉 x 的最末位。
//注意：先抠的是最末位，所以 d[0] 是原数的个位，d 里存的是"倒序"的数字。
//举例 x = 123，d 最后是 [3, 2, 1]（个位、十位、百位）。

int l = 0, r = d.size() - 1;
//两个指针：l 指向数组最左边（d[0]），r 指向数组最右边（d 的最后一个元素）。
//d.size() 是数组长度，减 1 才是最后一个元素的下标。

while (l < r) 
//只要 l 还在 r 左边，就继续比较。l < r 保证两个指针指向不同元素，不会自己跟自己比。

{
    if (d[l] != d[r]) return false;
    //比较左右两个数字。只要有一对不同，立刻返回 false。

    l++; r--;
    //这一对相等，l 往右移一格，r 往左移一格，继续比较下一对。
}

return true;
//全部比完都没返回 false，说明是回文，返回 true。
```

---
# 解法八：数学取对称位

代码如下：

```cpp
if (x < 0) return false;
int div = 1;
while (x / div >= 10) div *= 10;   

while (x > 0) 
{
    int left  = x / div;           
    int right = x % 10;           
    if (left != right) return false;
    x = (x % div) / 10;          
    div /= 100;                 
}
return true;
```

代码解释：

```cpp
if (x < 0) return false;
//负数一定不是回文，直接返回 false。
//负号只在最左边，右边对称位置不可能是负号，永远配不上。

int div = 1;
//div 是"最高位的权重"，初始为 1（个位的权重）。
//下面这个 while 会把它放大到和 x 最高位对齐。

while (x / div >= 10) div *= 10;   
//只要 x 除以 div 的结果还 >= 10（说明 div 还没到最高位），
//就把 div 乘 10（权重升一位）。
//循环结束后：x / div 是 1~9 之间的数，也就是 x 的最高位；div 是最高位的权重。
//举例 x = 12321：div 从 1 → 10 → 100 → 1000 → 10000 停下，
//此时 12321 / 10000 = 1（最高位），div = 10000。

while (x > 0) 
{
    int left  = x / div;           
    //取当前 x 的"最高位"。比如 x = 12321, div = 10000 → left = 1。

    int right = x % 10;           
    //取当前 x 的"最低位"。比如 x = 12321 → right = 1。

    if (left != right) return false;
    //最高位和最低位不相等，说明不是回文，立刻返回 false。

    x = (x % div) / 10;          
    //把最高位和最低位"同时去掉"，留下中间部分。
    //  x % div ：去掉最高位（保留 div 以下的位）
    //  / 10    ：再去掉最低位
    //举例 x = 12321, div = 10000：
    //  x % div = 2321（去掉最高位 1）
    //  2321 / 10 = 232（再去掉最低位 1）
    //  结果 x = 232，正好是中间三位。

    div /= 100;                 
    //权重降两位：因为同时去掉了最高位和最低位，位数减 2。
    //举例 div = 10000 → 100。
}
//循环结束。

return true;
//while 走完都没返回 false，说明所有对称位都相等，是回文。
```

---
# 总结比较

| 解法  | 名字          | 时间       | 空间       | 特点                  |
| --- | ----------- | -------- | -------- | ------------------- |
| 1   | 转字符串 + 双指针  | O(log n) | O(log n) | 最直观                 |
| 2   | **反转一半数字**  | O(log n) | **O(1)** | **最优，进阶标准答案**       |
| 3   | 转字符串 + 反转比较 | O(log n) | O(log n) | 最短                  |
| 4   | 转字符串 + 递归   | O(log n) | O(log n) | 炫技                  |
| 5   | 转字符串 + 栈    | O(log n) | O(log n) | 体现倒序                |
| 6   | 反转整个数字      | O(log n) | O(1)     | 有溢出风险，需 `long long` |
| 7   | 提取成数组 + 双指针 | O(log n) | O(log n) | 和解法一等价              |
| 8   | 数学取对称位      | O(log n) | O(1)     | 不构造反转数              |
