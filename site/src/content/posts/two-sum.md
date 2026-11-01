---
title: LeetCode 1. 两数之和：穷举、哈希表、双指针
description: LeetCode 第 1 题，用穷举、哈希表、排序双指针三种思路做，哈希解法逐行注释。
pubDate: 2026-11-01
categories: [数据结构]
tags: [哈希算法, 双指针, 数组]
draft: false
---

# 题目：

给定一个整数数组 `nums` 和一个整数目标值 `target`，请你在该数组中找出 **和为目标值** `target` 的那 **两个** 整数，并返回它们的数组下标。

你可以假设每种输入只会对应一个答案，并且你不能使用两次相同的元素。

你可以按任意顺序返回答案。

**示例 1：**

```
输入：nums = [2,7,11,15], target = 9
输出：[0,1]
解释：因为 nums[0] + nums[1] == 9 ，返回 [0, 1] 。
```

**示例 2：**

```
输入：nums = [3,2,4], target = 6
输出：[1,2]
```

**示例 3：**

```
输入：nums = [3,3], target = 6
输出：[0,1]
```

**提示：**

* `2 <= nums.length <= 10<sup>4</sup>`
* `-10<sup>9</sup> <= nums[i] <= 10<sup>9</sup>`
* `-10<sup>9</sup> <= target <= 10<sup>9</sup>`
* **只会存在一个有效答案**

**进阶：** 你可以想出一个时间复杂度小于 `O(n<sup>2</sup>)` 的算法吗？

---



# 解法一：直接穷举

代码如下：

```cpp
for(int i=0;i<nums.size();i++)
{
    for(int j=i+1;j<nums.size();j++)
    {
        if(nums[i]+nums[j]==target)
        {
            return {i,j};
        }
    }
}
return {};
```

将任意两数之和一个一个算出来，直到出现目标值

---

# 解法二：哈希算法

代码如下：

```cpp
unordered_map<int, int> hashtable;
for (int i = 0; i < nums.size(); ++i) {
    auto it = hashtable.find(target - nums[i]);
    if (it != hashtable.end()) {
        return {it->second, i};
    }
    hashtable[nums[i]] = i;
}
return {};
```


代码解析：

```cpp
unordered_map<int, int> hashtable;
//用unordered_map函数创建一个哈希表，命名为hashtable，前一个int放入key（键），后一个int放入value（值）。
//在这段代码里：key（键）放的是数组里的数值nums[i]，value（值）放的是这个数值对应的下标i。

for (int i = 0; i < nums.size(); ++i) {
//用for循环从数组第0个元素开始，一个一个往后遍历。i是当前元素的下标，nums[i]是当前这个数，循环到数组末尾为止。

    auto it = hashtable.find(target - nums[i]);
    //先算 target - nums[i]，得到当前这个数还差多少才能凑成target，这个差值就是当前数的"搭档"。
    //再用find去哈希表里查这个搭档有没有出现过；找到了就返回指向那条记录的迭代器，没找到就返回hashtable.end()。
    //find的查询结果存进变量it，auto让编译器自动推断it的类型，不用手写长长的迭代器类型。

    if (it != hashtable.end()) {
    //判断it是否不等于hashtable.end()。不等于就说明找到了搭档；等于就说明没找到。

        return {it->second, i};
        //找到搭档了，返回两个下标：it->second是搭档的下标（哈希表里那条记录的值），i是当前数的下标。这两个下标对应的数加起来正好是target。

    }

    hashtable[nums[i]] = i;
    //没找到搭档，就把当前这个数存进哈希表：key（键）放数值nums[i]，value（值）放下标i。
    //注意这一句在find之后，保证哈希表里只有之前处理过的数，没有当前数自己，所以不会出现自己配自己的情况。

}
//for循环结束。

return {};
//如果整个数组遍历完都没返回过，说明找不到任何一对数加起来等于target，返回一个空结果。
```

---

# 解法三：排序 + 双指针

代码如下：

```cpp
int n = nums.size();
vector<pair<int, int>> a(n);
for (int i = 0; i < n; ++i) a[i] = {nums[i], i};
sort(a.begin(), a.end());

int l = 0, r = n - 1;
while (l < r) {
    int s = a[l].first + a[r].first;
    if (s == target) return {a[l].second, a[r].second};
    if (s < target) ++l;
    else            --r;
}
return {};
```

代码解析：

```cpp
int n = nums.size();
//把数组长度存进n。

vector<pair<int, int>> a(n);
//创建一个长度为n的数组a，a里每个元素是一个pair<int,int>，也就是一个装两个int的小盒子。
//在这段代码里：盒子的first放数值nums[i]，盒子的second放这个数值的原始下标i。

for (int i = 0; i < n; ++i) a[i] = {nums[i], i};
//遍历原数组，把每个"数值 + 原始下标"打包成一个pair，放进a里。
//比如nums = [2,7,11,15]，a就是 {(2,0), (7,1), (11,2), (15,3)}。
//为什么要带上下标？因为下一步要排序，排序会打乱位置，原始下标必须跟着数值一起走，排完才能找回原来的位置。

sort(a.begin(), a.end());
//把数组a从小到大排序。pair排序规则是先比first（数值），first相同再比second（下标）。
//排完之后a按数值升序排列，但每个pair里还带着它的原始下标。

int l = 0, r = n - 1;
//两个指针：l指向数组最左边（最小值），r指向数组最右边（最大值）。准备从两头往中间夹。

while (l < r) {
//只要l还在r左边，就继续。l < r保证两个指针指向不同的元素，不会用同一个数两次。

    int s = a[l].first + a[r].first;
    //把左指针的数值和右指针的数值加起来，存进s。a[l].first是左边那个数，a[r].first是右边那个数。

    if (s == target) return {a[l].second, a[r].second};
    //如果两数之和正好等于target，找到了。
    //返回的是a[l].second和a[r].second，也就是这两个数的原始下标，不是l和r（l和r是排序后的位置）。

    if (s < target) ++l;
    else            --r;
    //如果和小于target，说明和太小，需要更大一点：因为数组升序，把l往右移一格，左边的数变大，和就增大。
    //否则（和大于target），说明和太大，需要更小一点：把r往左移一格，右边的数变小，和就减小。
}

return {};
//如果while走完都没返回，说明找不到任何一对数加起来等于target，返回空结果。
```
