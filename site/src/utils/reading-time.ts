// 阅读时长估算
//
// 为什么单独放一个文件：文章页要显示、以后首页列表可能也要显示，
// 算法必须只有一份，否则「文章页说 3 分钟、列表说 5 分钟」这种矛盾迟早出现。
//
// 中文和英文的阅读速度差很多，不能用一个「字数 / 200」糊过去：
//   - 中文按**字**算，正常人 300-400 字/分钟（技术文偏慢，取 350）
//   - 英文按**词**算，约 200 词/分钟
//   - 代码块不算「字」，按行折算：技术文里读代码比读散文慢，取 50 行/分钟
//
// 结果是「至少 1 分钟」的整数，因为「约 0 分钟读完」没有意义。

/** 汉字（含常见中文标点区以外的 CJK 统一表意文字） */
const CJK = /[\u4e00-\u9fa5]/g;

export function readingMinutes(body: string | undefined): number {
  if (!body) return 1;

  // 先把围栏代码块整段抽出来单独算，避免代码里的英文单词被当成正文
  const codeBlocks = body.match(/```[\s\S]*?```/g) ?? [];
  const codeLines = codeBlocks.reduce(
    (sum, block) => sum + block.split('\n').length - 2,
    0,
  );

  const prose = body
    .replace(/```[\s\S]*?```/g, ' ') // 去掉代码块
    .replace(/`[^`]*`/g, ' ') // 去掉行内代码
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 去掉图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接只留文字
    .replace(/<[^>]+>/g, ' '); // 去掉 HTML 标签

  const cjkCount = (prose.match(CJK) ?? []).length;
  const wordCount = (prose.replace(CJK, ' ').match(/[A-Za-z0-9_]+/g) ?? []).length;

  const minutes = cjkCount / 350 + wordCount / 200 + codeLines / 50;

  return Math.max(1, Math.round(minutes));
}
