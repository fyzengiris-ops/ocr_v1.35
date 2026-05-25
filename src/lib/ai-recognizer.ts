/**
 * AI 识别工具
 * 用于调用 Vision Model 识别试卷内容，并匹配用户画的框
 */

// ==================== 学科题型映射 ====================
export const SUBJECT_QUESTION_TYPES: Record<string, string[]> = {
  '英语': ['单选题', '多选题', '填空题', '完形填空', '阅读理解', '问答题', '翻译题', '书面表达', '短文填空', '选词填空', '任务型阅读'],
  '物理': ['单选题', '多选题', '判断题', '填空题', '计算题', '解答题', '证明题', '材料题', '综合题', '实验探究题', '问答题'],
  '数学': ['单选题', '多选题', '判断题', '填空题', '计算题', '解答题', '证明题', '材料题', '综合题', '实验探究题', '问答题'],
};

/** 根据学科获取有效题型列表 */
export function getValidQuestionTypes(subject: string): string[] {
  // 精确匹配
  if (SUBJECT_QUESTION_TYPES[subject]) return SUBJECT_QUESTION_TYPES[subject];
  // 模糊匹配（如 "初中英语" → "英语"）
  for (const [key, types] of Object.entries(SUBJECT_QUESTION_TYPES)) {
    if (subject.includes(key)) return types;
  }
  // 默认返回所有题型
  return Object.values(SUBJECT_QUESTION_TYPES).flat().filter((v, i, a) => a.indexOf(v) === i);
}

import type {
  PageImage,
  RecognizedBlock,
  RecognitionResult,
  QuestionBox,
  MatchedQuestion,
  AnswerMarker,
  BBox,
} from '@/types/recognition';
import { pixelToPercent, percentToPixel, calculateIoU } from '@/types/recognition';

/**
 * AI Prompt 模板（完整模式，用于整页识别）
 */
export const SYSTEM_PROMPT = `你是一个教育资料智能识别专家。用户会上传多页试卷/作业图片，请你完成以下任务：

## 任务1：识别所有文本块
- 标记每个文本块的位置（相对坐标，0-100 百分比）
- 标注所在页码（从1开始）

## 任务2：语义分类
- question：题干（包含题目描述、选项）
- answer：答案（如"A"、"答案：B"、"1.A 2.B"）
- analysis：解析（题目解答过程、说明）
- noise：干扰信息（页眉、页脚、考生信息）

## 任务3：题号识别
- 从题目文本中提取题号（如"第1题"、"1."、"一、"）
- 从答案文本中提取对应的题号

## 任务4：跨页关联（重要！）
- 答案可能集中在最后几页（答案页）
- 根据**题号**建立跨页关联
- 例如：第1页的"第1题" ↔ 第3页的"1.A"

## 任务5：答案剥离
- 如果答案在解析中（如"选B，因为..."），提取纯答案"B"
- 如果是答案汇总页（如"1.A 2.B 3.C"），拆分为独立答案

## 任务6：置信度评估
- 对每个识别结果给出置信度（0-1）
- 字迹模糊、识别困难的情况置信度较低

## 输出格式要求
严格按照以下JSON格式输出，不要输出其他内容：
{
  "pages": [
    {
      "pageNumber": 1,
      "width": 600,
      "height": 800
    }
  ],
  "blocks": [
    {
      "id": "q1",
      "type": "question",
      "pageNumber": 1,
      "questionNumber": 1,
      "content": "以下哪个是水果？A.苹果 B.白菜",
      "bbox": { "x": 5, "y": 15, "width": 45, "height": 8 },
      "matchedAnswerId": "a1",
      "matchedAnalysisId": "an1",
      "confidence": 0.95
    },
    {
      "id": "a1",
      "type": "answer",
      "pageNumber": 3,
      "questionNumber": 1,
      "content": "A",
      "rawContent": "1.A",
      "bbox": { "x": 5, "y": 20, "width": 10, "height": 3 },
      "confidence": 0.95
    },
    {
      "id": "an1",
      "type": "analysis",
      "pageNumber": 3,
      "questionNumber": 1,
      "content": "苹果是水果，白菜是蔬菜",
      "extractedAnswer": null,
      "bbox": { "x": 5, "y": 40, "width": 45, "height": 10 },
      "confidence": 0.9
    }
  ],
  "warnings": [
    "第3页答案'3.C'未找到对应题目"
  ],
  "summary": {
    "totalQuestions": 3,
    "matchedCount": 2,
    "unmatchedCount": 1,
    "lowConfidenceCount": 0
  }
}`;

/**
 * AI Prompt 模板（简化版，用于裁剪后的单个题目）
 */
export const SYSTEM_PROMPT_CROPPED = `你是一个教育资料智能识别专家。用户会发送多个裁剪后的题目图片，每个图片包含一道题目的内容。请你识别每张图片中的文字内容。

## 重要约束（必须遵守）
1. **只输出文字内容**：不要返回图片URL、不要返回图片描述，只提取图片中的实际文字
2. **禁止输出图片引用**：不要使用 "Image:"、"图片:"、"图x:" 等任何形式的图片引用
3. **纯文本输出**：所有内容必须是纯文本，不能包含任何图片链接或占位符
4. **数学公式表示**：使用简单纯文本表示数学内容
   * 分数：a/b 或 a÷b，上标：x^2，下标：x_1，根号：√2
   * 函数：f(x)，绝对值：|x|，集合：{x|x>0}
   * 特殊符号可直接使用：∈, ∞, ≤, ≥, ≠, ±, π, θ, α, β
5. **禁止LaTeX**：不要使用\\frac{}{}、\\sqrt{}{}等LaTeX命令，会导致JSON解析错误

## 识别内容
1. **题目内容**：完整的题目描述和选项（从图片中提取的纯文字）
2. **题目类型**：必须从用户消息中提供的【题型约束】列表中选择，绝对禁止使用列表之外的题型名称
   - 没有选项的题目不可能是选择题
   - 填空题特征：有横线/空格/下划线/括号需要填写
   - 解答题/问答题特征：有"证明"、"求"、"已知...求"等关键词，常带(1)(2)(3)子题
3. **选项数**：选择题统计选项总数（如A/B/C/D为4），非选择题为null
3.5. **填空数**：填空题统计需要填写的空位数（如____出现3次则为3），非填空题为null
4. **答案**：如果有答案，提取出来（如"A"、"B"等）
5. **解析**：如果有解析，提取出来

## 输出格式要求
你必须只输出一个有效的JSON对象，不要输出任何其他文字、解释或markdown标记。

输出格式示例：
{"questions":[{"imageIndex":0,"content":"以下哪个是水果？A.苹果 B.白菜 C.胡萝卜 D.西红柿","questionType":"单选题","optionCount":4,"blankCount":null,"answer":"A","analysis":"苹果是水果，白菜是蔬菜","confidence":0.95},{"imageIndex":1,"content":"已知f(x)=x^2+2x+1，则f(2)=____","questionType":"填空题","optionCount":null,"blankCount":1,"answer":"9","analysis":"f(2)=4+4+1=9","confidence":0.9},{"imageIndex":2,"content":"已知函数f(x)=ln(x^(-2)-x^2)\\n(1)证明f(x)是偶函数\\n(2)求f(x)的定义域","questionType":"解答题","optionCount":null,"blankCount":null,"answer":null,"analysis":null,"confidence":0.85}],"summary":{"totalCount":3,"hasAnswerCount":2,"noAnswerCount":1}}

## 重要规则
1. imageIndex 对应图片的顺序（从0开始）
2. 选择题（单选/多选）必须包含optionCount字段，非选择题optionCount设为null
2.5. 填空题必须包含blankCount字段（统计空位数），非填空题blankCount设为null
3. 如果图片中没有答案，answer 字段设为 null
4. 如果图片中没有解析，analysis 字段设为 null
5. confidence 表示识别置信度（0-1）
6. content 字段中的换行符必须用 \\\\n 转义
7. 不要在JSON前后添加任何其他内容
8. **关键**：没有选项的题目绝不可能是选择题，必须根据内容特征正确判断题型
9. **绝对不要输出任何图片URL或图片引用！**`;

/**
 * AI Prompt 模板（智能识别模式 - 支持题目和答案识别）
 */
export const SYSTEM_PROMPT_SMART = `你是教育资料智能识别专家。用户会发送多个裁剪后的图片，每个图片可能包含题目内容或答案解析。

## 识别任务

### 1. 题号识别（最重要！）
- **必须使用原卷上的实际题号**，不要重新编号！
- 标准格式：1. 2. 3. 或 一、二、三、或 第1题、第2题
- 提取题号数字，如"1."提取为1，"第2题"提取为2，"19."提取为19
- 如果原卷第1题题号是19，则questionNumber必须是19，不能是1
- 如果无法识别题号，设为 null

### 2. 类型判断（关键！答案和题目必须区分）
- **question**: 包含题目描述的任何内容（提出问题）
  * 选择题：有题目描述和选项（A、B、C、D等）
  * 填空题：有横线或空格需要填写，没有选项
  * 解答题/计算题：需要详细解答或计算过程，常见于数学、物理，包含证明、求解等
  * 问答题/材料题：开放性问答、基于材料作答
  * 判断题：判断对错
  * **重要**：即使没有选项，只要有题目描述就是question类型
- **answer**: 包含答案、解析、详解的内容（给出答案）
  * 特征1：有答案标记（如"A"、"答案：A"、"选A"、"对"/"错"）
  * 特征2：有解析/分析/详解标记（如"【分析】"、"【详解】"、"【解析】"、"【解答】"、"分析："、"详解："、"解析："）
  * 特征3：包含详细的解题过程、推导步骤、计算过程（不是题目要求，而是解答过程）
  * 特征4：出现"故选"、"所以"、"因此"、"综上所述"等结论性表述
  * **重要**：如果内容以分析、详解、解析为主，即使前面有简短的题目引用，也应判定为answer类型。判断关键：该内容的主要目的是给出答案和解题过程，还是提出问题。

### 3. 题型识别（type=question时必填）
- **单选题**：有选项A/B/C/D等，只能选一个
- **多选题**：题目明确说明"多选"或"选出正确选项"或有多个正确答案
- **判断题**：判断对错、√×
- **填空题**：有横线、空格、下划线或括号需要填写答案，没有选项；常见格式如"___"、"____"、"(  )"等
- **问答题**：开放性问答、简答
- **解答题**：需要详细解答过程的题目，常见于数学、物理；通常包含"证明"、"求"、"已知...求..."等关键词；常带子题标号如(1)(2)(3)
- **计算题**：以计算为主，有明确的计算过程要求；与解答题的区别是更侧重计算而非证明
- **材料题**：基于给定材料作答，通常先给出一段材料/背景，再提出多个子问题

**重要**：不要将填空题或解答题误判为单选题。没有选项的题目不可能是选择题。

### 4. 选项数识别（选择题必填）
- 统计题目中出现的选项总数（如A/B/C/D则为4，A/B/C/D/E/F则为6）
- 非选择题设为null

### 4.5 填空数识别（填空题必填）
- 统计题目中需要填写的空位数（如"____"出现3次则blankCount为3）
- 常见格式：横线"____"、下划线"___"、括号"(  )"、方框"□"等
- 非填空题设为null

### 5. 内容提取
- **题目框**：提取完整题目文本（题号+题目描述+选项）
- **答案框**：
  * 识别答案：A/B/C/D 或 对/错 或 填空答案
  * 识别解析：**完整保留原卷解析内容**，逐字提取原卷上的解析/详解/分析文字，不要精简摘要、不要改写、不要省略步骤。原卷写了什么就提取什么

### 6. 答案解析分离规则
常见格式：
- "A" → 答案：A，解析：无
- "A 苹果是水果" → 答案：A，解析：苹果是水果
- "答案：A" → 答案：A，解析：无
- "答案：A 苹果是水果" → 答案：A，解析：苹果是水果
- "选A" → 答案：A，解析：无
- "选A，因为..." → 答案：A，解析：因为...
- "对" / "错" → 答案：对/错，解析：无

## 重要约束
1. **数学公式表示**：使用简单纯文本表示数学内容
   * 分数：a/b 或 a÷b
   * 上标：x^2, a^n
   * 下标：x_1, a_n
   * 根号：√2, √(a+b)
   * 函数：f(x), g(x)
   * 特殊符号：∈, ∞, ≤, ≥, ≠, ±, π, θ, α, β, Σ, ∫ 等Unicode符号可直接使用
   * 绝对值：|x|
   * 集合：{x|x>0}
2. **禁止LaTeX**：不要使用\\frac{}{}、\\sqrt{}{}、\\mathbf等LaTeX命令，会导致JSON解析错误
3. **转义换行**：内容中的换行用 \\n 表示
4. **禁止反斜杠**：不要在内容中使用反斜杠\\，除非是转义换行符\\n

## 输出格式（严格JSON，不要其他内容）
{
  "regions": [
    {
      "imageIndex": 0,
      "questionNumber": 1,
      "type": "question",
      "questionType": "单选题",
      "optionCount": 4,
      "blankCount": null,
      "content": "下列哪个是水果？A.苹果 B.白菜 C.胡萝卜 D.西红柿",
      "confidence": 0.95
    },
    {
      "imageIndex": 1,
      "questionNumber": 1,
      "type": "answer",
      "content": "A 苹果是水果，白菜是蔬菜",
      "answer": "A",
      "analysis": "苹果是水果，白菜是蔬菜",
      "confidence": 0.95
    },
    {
      "imageIndex": 2,
      "questionNumber": 2,
      "type": "question",
      "questionType": "填空题",
      "optionCount": null,
      "blankCount": 1,
      "content": "已知f(x)=x^2+2x+1，则f(2)=____",
      "confidence": 0.9
    },
    {
      "imageIndex": 3,
      "questionNumber": 19,
      "type": "question",
      "questionType": "解答题",
      "optionCount": null,
      "content": "已知函数f(x)=ln(x^(-2)-x^2)\n(1)证明f(x)是偶函数\n(2)求f(x)的定义域",
      "confidence": 0.85
    }
  ],
  "summary": {
    "totalRegions": 4,
    "questionCount": 3,
    "answerCount": 1,
    "unmatchedCount": 0
  }
}

## 重要规则
1. **必须使用原卷题号**，不要重新从1开始编号！原卷第19题就是questionNumber:19
2. 答案框(type=answer)必须包含answer字段（可能为空字符串）
3. 题目框(type=question)必须包含questionType字段，可选值：单选题、多选题、判断题、填空题、问答题、解答题、计算题、材料题
4. 选择题（单选题/多选题）必须包含optionCount字段，表示选项总数；非选择题optionCount设为null
4.5. 填空题必须包含blankCount字段，表示需要填写的空位数；非填空题blankCount设为null
5. 分离答案和解析，不要混合
6. confidence表示识别置信度（0-1）
7. 禁止输出图片URL或引用
8. 只输出JSON，不要有其他文字
9. content字段请精简避免过长被截断；但analysis字段必须**完整保留原卷解析内容**，不要精简摘要，原卷写了什么就提取什么
10. **关键**：没有选项的题目绝不可能是选择题，必须根据内容特征正确判断题型
11. **关键**：题目明确说"多选"或有多个正确答案的才是多选题，否则默认为单选题`;

/**
 * 答案匹配专用 Prompt（单框重新识别答案）
 * 用户已有一道题目的内容，现在需要从图片中提取该题的答案和解析
 */
export const SYSTEM_PROMPT_ANSWER_ONLY = `你是教育资料智能识别专家。用户会发送一张裁剪后的题目图片，该图片包含一道题目的完整内容（题目+选项+答案+解析）。

## 识别任务

你的唯一任务是从图片中**提取这道题的答案和解析**。不需要识别题目内容、题型、选项数等信息（这些已经存在）。

### 提取规则
1. **答案提取**：找到图片中的答案部分
   - 选择题：A/B/C/D 或 "选A"、"答案：A" 等
   - 判断题：对/错、√/×
   - 填空题：填空的具体内容
   - 解答题/计算题：最终结果或结论
2. **解析提取**：**完整保留原卷解析内容**，逐字提取原卷上的解析/详解/分析/解答过程文字
   - 不要精简摘要、不要改写、不要省略任何步骤
   - 原卷写了什么就提取什么，包括所有推导过程
3. 如果图片中只有答案没有解析，analysis 设为空字符串
4. 如果图片中只有解析没有明确答案标记，尝试从解析开头或结论处提取答案

## 输出格式（严格JSON，不要其他内容）
{
  "answer": "A",
  "analysis": "完整解析内容，逐字保留原卷文字..."
}

## 重要约束
1. **数学公式表示**：使用简单纯文本表示数学内容
   * 分数：a/b 或 a÷b
   * 上标：x^2, a^n
   * 下标：x_1, a_n
   * 根号：√2, √(a+b)
   * 函数：f(x), g(x)
   * 特殊符号：∈, ∞, ≤, ≥, ≠, ±, π, θ, α, β, Σ, ∫ 等Unicode符号可直接使用
   * 绝对值：|x|
2. **禁止LaTeX**：不要使用\\frac{}{}、\\sqrt{}{}、\\mathbf等LaTeX命令
3. **转义换行**：内容中的换行用 \\n 表示
4. 只输出JSON，不要有其他文字
5. analysis字段必须**完整保留原卷解析内容**，不得精简摘要`;

/**
 * 构建用户消息（裁剪模式）
 */
export function buildUserMessageCropped(croppedImages: PageImage[], subjectInfo?: string, validQuestionTypes?: string[]): Array<{
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail: 'high' | 'low' };
}> {
  const content: Array<{
    type: 'text' | 'image_url';
    text?: string;
    image_url?: { url: string; detail: 'high' | 'low' };
  }> = [];

  // 构建文本说明，包含学段学科信息
  let textDesc = `共${croppedImages.length}张裁剪后的题目图片，请逐个识别题目内容、答案和解析。`;
  if (subjectInfo) {
    textDesc += `\n学段学科：${subjectInfo}`;
  }

  // 添加题型约束（根据学科限制可选题型范围）
  if (validQuestionTypes && validQuestionTypes.length > 0) {
    textDesc += `\n\n【题型约束】当前学科仅支持以下题型，必须且只能从列表中选择：\n${validQuestionTypes.join('、')}\n如果图片内容看起来像其他题型，请映射到最接近的合法题型。绝对禁止使用列表之外的题型名称。`;
  }
  
  // 添加文本说明
  content.push({
    type: 'text',
    text: textDesc,
  });

  // 添加所有裁剪图片
  for (const image of croppedImages) {
    content.push({
      type: 'image_url',
      image_url: {
        url: image.imageData,
        detail: 'high',
      },
    });
  }

  return content;
}

/**
 * 解析裁剪模式的 AI 响应
 */
export function parseCroppedAIResponse(responseText: string): Array<{
  imageIndex: number;
  content: string;
  questionType: string;
  optionCount: number | null;
  answer: string | null;
  analysis: string | null;
  confidence: number;
}> | null {
  try {
    let jsonStr = responseText.trim();

    // 去除可能的 markdown 代码块标记
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    // 找到 JSON 对象
    if (!jsonStr.startsWith('{')) {
      const startIdx = jsonStr.indexOf('{');
      if (startIdx !== -1) {
        jsonStr = jsonStr.slice(startIdx);
      }
    }

    // 找到匹配的结束大括号
    let braceCount = 0;
    let endIdx = -1;
    for (let i = 0; i < jsonStr.length; i++) {
      if (jsonStr[i] === '{') braceCount++;
      else if (jsonStr[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx !== -1) {
      jsonStr = jsonStr.slice(0, endIdx + 1);
    }

    // 修复常见的 JSON 格式问题
    // 修复尾部逗号
    jsonStr = jsonStr.replace(/,\s*}/g, '}');
    jsonStr = jsonStr.replace(/,\s*]/g, ']');
    
    // 移除注释
    jsonStr = jsonStr.replace(/\/\/.*$/gm, '');
    jsonStr = jsonStr.replace(/\/\*[\s\S]*?\*\//g, '');

    let result;
    try {
      result = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('JSON 解析失败:', parseError);
      console.error('JSON 字符串前500字符:', jsonStr.slice(0, 500));
      console.error('JSON 字符串后200字符:', jsonStr.slice(-200));
      
      // 尝试更激进的修复
      // 修复字符串值中的未转义换行符
      // 这个正则会匹配 "key": "value 中的实际换行
      const fixStringNewlines = (str: string): string => {
        // 在JSON字符串值中转义换行符
        // 匹配 "key": "value" 中的value部分
        return str.replace(/"([^"]*)":\s*"((?:[^"\\]|\\.)*)"/g, (match, key, value) => {
          // 转义value中的未转义换行
          const fixedValue = value
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
          return `"${key}": "${fixedValue}"`;
        });
      };
      
      jsonStr = fixStringNewlines(jsonStr);
      
      try {
        result = JSON.parse(jsonStr);
      } catch (secondError) {
        console.error('二次解析仍然失败:', secondError);
        return null;
      }
    }
    
    if (!result.questions || !Array.isArray(result.questions)) {
      console.error('裁剪模式响应缺少 questions 数组，实际返回:', JSON.stringify(Object.keys(result)));
      return null;
    }

    // 清理每个问题的content字段，移除图片URL引用
    result.questions = result.questions.map((q: any) => {
      if (q.content && typeof q.content === 'string') {
        // 移除图片URL引用，包括但不限于：
        // - "Image: [url]"
        // - "图片: url"
        // - "图x: url"
        // - 任何http/https URL
        let cleanedContent = q.content
          .replace(/Image:\s*\[[^\]]*\]/gi, '')
          .replace(/图片[:：]\s*[^\s\n]+/gi, '')
          .replace(/图\d+[:：]\s*[^\s\n]+/gi, '')
          .replace(/https?:\/\/[^\s\n]+/gi, '')
          .replace(/\[图片\]/g, '')
          .replace(/\[image\]/gi, '')
          .trim();

        // 如果清理后内容为空，保留原始内容但添加提示
        if (!cleanedContent) {
          console.warn(`问题 ${q.imageIndex} 的content被清理后为空，原始内容:`, q.content);
          cleanedContent = q.content;
        }

        q.content = cleanedContent;
      }
      return q;
    });

    return result.questions;
  } catch (error) {
    console.error('解析裁剪模式 AI 响应失败:', error);
    console.error('原始响应文本前500字符:', responseText.slice(0, 500));
    return null;
  }
}

/**
 * 解析答案匹配专用 AI 响应
 * 返回 { answer: string, analysis: string }
 */
export function parseAnswerOnlyResponse(responseText: string): { answer: string; analysis: string } | null {
  try {
    // 尝试直接解析 JSON
    const cleaned = responseText.trim().replace(/^```json\s*|\s*```$/g, '');
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (typeof parsed.answer === 'string' && typeof parsed.analysis === 'string') {
      return {
        answer: parsed.answer || '',
        analysis: parsed.analysis || '',
      };
    }
    return null;
  } catch (error) {
    console.error('解析答案匹配响应失败:', error);
    return null;
  }
}

/**
 * 构建用户消息
 */
export function buildUserMessage(pages: PageImage[]): Array<{
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail: 'high' | 'low' };
}> {
  const content: Array<{
    type: 'text' | 'image_url';
    text?: string;
    image_url?: { url: string; detail: 'high' | 'low' };
  }> = [];

  // 添加文本说明
  content.push({
    type: 'text',
    text: `共${pages.length}页图片，请识别所有题目、答案、解析，并建立关联关系。
每张图片按顺序对应页码1-${pages.length}。
请特别注意：答案和解析可能在后面的页面，需要通过题号建立跨页关联。`,
  });

  // 添加所有页面图片
  for (const page of pages) {
    content.push({
      type: 'image_url',
      image_url: {
        url: page.imageData,
        detail: 'high',
      },
    });
  }

  return content;
}

/**
 * 解析 AI 返回的 JSON
 */
export function parseAIResponse(responseText: string): RecognitionResult | null {
  try {
    // 尝试提取 JSON 内容（可能被 markdown 包裹）
    let jsonStr = responseText.trim();

    // 方法1：去除可能的 markdown 代码块标记
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    // 方法2：尝试找到 JSON 对象的起始和结束位置
    if (!jsonStr.startsWith('{')) {
      const startIdx = jsonStr.indexOf('{');
      if (startIdx !== -1) {
        jsonStr = jsonStr.slice(startIdx);
      }
    }

    // 尝试找到匹配的结束大括号
    let braceCount = 0;
    let endIdx = -1;
    for (let i = 0; i < jsonStr.length; i++) {
      if (jsonStr[i] === '{') braceCount++;
      else if (jsonStr[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx !== -1) {
      jsonStr = jsonStr.slice(0, endIdx + 1);
    }

    // 方法3：修复常见的 JSON 格式问题
    // 修复尾部逗号
    jsonStr = jsonStr.replace(/,\s*}/g, '}');
    jsonStr = jsonStr.replace(/,\s*]/g, ']');
    
    // 移除注释
    jsonStr = jsonStr.replace(/\/\/.*$/gm, '');
    jsonStr = jsonStr.replace(/\/\*[\s\S]*?\*\//g, '');

    let result: RecognitionResult;
    try {
      result = JSON.parse(jsonStr) as RecognitionResult;
    } catch (parseError) {
      console.error('JSON 解析失败，尝试修复后重试:', parseError);
      console.error('JSON 字符串前300字符:', jsonStr.slice(0, 300));
      console.error('JSON 字符串后200字符:', jsonStr.slice(-200));
      
      // 尝试更激进的修复 - 处理字符串中的未转义字符
      const fixJsonString = (str: string): string => {
        // 在JSON字符串值中转义换行符
        // 匹配 "key": "value" 中的value部分，并转义其中的特殊字符
        return str.replace(/"([^"]+)":\s*"((?:[^"\\]|\\.)*?)"/g, (match, key, value) => {
          // 转义value中的未转义换行和制表符
          const fixedValue = value
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
          return `"${key}": "${fixedValue}"`;
        });
      };
      
      jsonStr = fixJsonString(jsonStr);
      
      try {
        result = JSON.parse(jsonStr) as RecognitionResult;
      } catch (secondError) {
        console.error('二次解析仍然失败:', secondError);
        return null;
      }
    }

    // 验证必要字段
    if (!result.pages || !result.blocks) {
      console.error('AI 返回的数据缺少必要字段');
      return null;
    }

    // 补充默认值
    result.summary = result.summary || {
      totalQuestions: result.blocks.filter(b => b.type === 'question').length,
      matchedCount: result.blocks.filter(b => b.matchedAnswerId).length,
      unmatchedCount: 0,
      lowConfidenceCount: 0,
    };

    result.warnings = result.warnings || [];

    return result;
  } catch (error) {
    console.error('解析 AI 响应失败:', error);
    console.error('原始响应文本前500字符:', responseText.slice(0, 500));
    return null;
  }
}

/**
 * 匹配用户画的框与 AI 识别的文本块
 */
export function matchUserBoxToBlock(
  userBox: QuestionBox,
  blocks: RecognizedBlock[],
  pageWidth: number,
  pageHeight: number,
  ioUThreshold: number = 0.3
): RecognizedBlock | null {
  // 将用户框的像素坐标转换为百分比
  const userPercent = pixelToPercent(userBox, pageWidth, pageHeight);

  // 找同页的题目块
  const candidateBlocks = blocks.filter(
    b => b.type === 'question' && b.pageNumber === userBox.pageNumber
  );

  if (candidateBlocks.length === 0) {
    return null;
  }

  // 找重叠度最高的块
  let bestMatch: RecognizedBlock | null = null;
  let bestIoU = 0;

  for (const block of candidateBlocks) {
    const iou = calculateIoU(userPercent, block.bbox);
    if (iou > bestIoU && iou >= ioUThreshold) {
      bestIoU = iou;
      bestMatch = block;
    }
  }

  return bestMatch;
}

/**
 * 根据匹配结果生成 MatchedQuestion
 */
export function generateMatchedQuestions(
  userBoxes: QuestionBox[],
  recognitionResult: RecognitionResult,
  pageImages: PageImage[]
): MatchedQuestion[] {
  const questions: MatchedQuestion[] = [];
  let questionId = 1;

  // 只处理选中的框
  const selectedBoxes = userBoxes.filter(box => box.isSelected);

  for (const box of selectedBoxes) {
    const pageInfo = pageImages.find(p => p.pageNumber === box.pageNumber);
    if (!pageInfo) continue;

    // 匹配用户框到识别的题目块
    const matchedBlock = matchUserBoxToBlock(
      box,
      recognitionResult.blocks,
      pageInfo.width,
      pageInfo.height
    );

    if (!matchedBlock) {
      // 未匹配到识别结果，创建待确认的题目
      questions.push({
        id: questionId++,
        number: questions.length + 1,
        questionBoxId: box.id,
        questionBox: box,
        pageNumber: box.pageNumber,
        questionContent: '',
        questionType: '填空题',
        answerSource: 'manual',
        status: 'pending_confirm',
        showRecognizedContent: false,
      });
      continue;
    }

    // 查找关联的答案块
    let answer: string | undefined;
    let answerSource: 'direct' | 'extracted' | 'manual' = 'direct';
    let answerBlock: RecognizedBlock | undefined;
    let answerConfidence: number | undefined;

    if (matchedBlock.matchedAnswerId) {
      answerBlock = recognitionResult.blocks.find(
        b => b.id === matchedBlock.matchedAnswerId
      );
      if (answerBlock) {
        answer = answerBlock.content;
        answerConfidence = answerBlock.confidence;
      }
    }

    // 如果答案块没有直接的答案，尝试从解析中提取
    let analysisBlock: RecognizedBlock | undefined;
    if (matchedBlock.matchedAnalysisId) {
      analysisBlock = recognitionResult.blocks.find(
        b => b.id === matchedBlock.matchedAnalysisId
      );
      if (analysisBlock) {
        if (!answer && analysisBlock.extractedAnswer) {
          answer = analysisBlock.extractedAnswer;
          answerSource = 'extracted';
        }
      }
    }

    // 判断题目类型
    const questionType = inferQuestionType(matchedBlock.content);

    // 判断状态
    let status: 'matched' | 'pending_confirm' | 'no_answer' = 'matched';
    if (!answer) {
      status = 'no_answer';
    } else if (answerConfidence && answerConfidence < 0.7) {
      status = 'pending_confirm';
    }

    questions.push({
      id: questionId++,
      number: matchedBlock.questionNumber || questions.length + 1,
      questionBoxId: box.id,
      questionBox: box,
      pageNumber: box.pageNumber,
      questionContent: matchedBlock.content,
      questionType,
      answer,
      answerSource,
      answerBlockId: answerBlock?.id,
      answerPageNumber: answerBlock?.pageNumber,
      answerConfidence,
      analysis: analysisBlock?.content,
      analysisBlockId: analysisBlock?.id,
      analysisPageNumber: analysisBlock?.pageNumber,
      status,
      showRecognizedContent: true,
      questionBBox: matchedBlock.bbox,
    });
  }

  // 按题号排序
  questions.sort((a, b) => a.number - b.number);

  // 重新分配 ID
  questions.forEach((q, index) => {
    q.id = index + 1;
  });

  return questions;
}

/**
 * 推断题目类型
 */
function inferQuestionType(content: string): MatchedQuestion['questionType'] {
  const lowerContent = content.toLowerCase();

  if (lowerContent.includes('判断') || lowerContent.includes('对错') || lowerContent.includes('√×')) {
    return '判断题';
  }
  if (lowerContent.includes('填空') || lowerContent.includes('____') || lowerContent.includes('____')) {
    return '填空题';
  }
  if (lowerContent.includes('问答') || lowerContent.includes('简答') || lowerContent.includes('论述')) {
    return '问答题';
  }
  if (lowerContent.includes('解答') || lowerContent.includes('证明')) {
    return '解答题';
  }
  if (lowerContent.includes('计算') || lowerContent.includes('求解')) {
    return '计算题';
  }
  if (lowerContent.includes('材料') || lowerContent.includes('阅读以下') || lowerContent.includes('根据材料')) {
    return '材料题';
  }
  if (lowerContent.includes('多选') || /选出正确.*项/i.test(content)) {
    return '多选题';
  }

  // 有选项特征时默认单选题
  if (/[A-D][.、．)\s]/.test(content) && /[B-D][.、．)\s]/.test(content)) {
    return '单选题';
  }

  // 无选项特征时默认填空题
  return '填空题';
}

/**
 * 生成答案标记（用于显示在左侧资料区）
 */
export function generateAnswerMarkers(
  questions: MatchedQuestion[],
  recognitionResult: RecognitionResult,
  pageImages: PageImage[]
): AnswerMarker[] {
  const markers: AnswerMarker[] = [];

  for (const question of questions) {
    if (!question.answerBlockId) continue;

    const answerBlock = recognitionResult.blocks.find(
      b => b.id === question.answerBlockId
    );
    if (!answerBlock) continue;

    const pageInfo = pageImages.find(p => p.pageNumber === answerBlock.pageNumber);
    if (!pageInfo) continue;

    // 将百分比坐标转换为像素坐标
    const pixelBbox = percentToPixel(answerBlock.bbox, pageInfo.width, pageInfo.height);

    markers.push({
      id: `marker-${question.id}`,
      questionId: String(question.id),
      content: question.answer || '',
      analysis: question.analysis || '',
      x: pixelBbox.x,
      y: pixelBbox.y,
      width: pixelBbox.width,
      height: pixelBbox.height,
      pageNumber: answerBlock.pageNumber,
      status: 'linked',
      confidence: answerBlock.confidence,
    });
  }

  // 添加未关联的答案块
  const linkedAnswerIds = new Set(
    questions.filter(q => q.answerBlockId).map(q => q.answerBlockId)
  );

  for (const block of recognitionResult.blocks) {
    if (block.type !== 'answer') continue;
    if (linkedAnswerIds.has(block.id)) continue;

    const pageInfo = pageImages.find(p => p.pageNumber === block.pageNumber);
    if (!pageInfo) continue;

    const pixelBbox = percentToPixel(block.bbox, pageInfo.width, pageInfo.height);

    markers.push({
      id: `marker-unlinked-${block.id}`,
      questionId: null,
      content: block.content,
      analysis: '',
      x: pixelBbox.x,
      y: pixelBbox.y,
      width: pixelBbox.width,
      height: pixelBbox.height,
      pageNumber: block.pageNumber,
      status: 'unlinked',
      confidence: block.confidence,
    });
  }

  return markers;
}

/**
 * 从解析文本中提取答案
 */
export function extractAnswerFromAnalysis(analysis: string): string | null {
  const patterns = [
    /选\s*([A-Fa-f])/,
    /答案\s*[是为：:]\s*([A-Fa-f])/i,
    /正确答案\s*[是为：:]\s*([A-Fa-f])/i,
    /应选\s*([A-Fa-f])/,
    /故选\s*([A-Fa-f])/,
  ];

  for (const pattern of patterns) {
    const match = analysis.match(pattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }

  return null;
}

/**
 * 合并多个页面的图片为一个大的 base64（可选，用于调试）
 */
export function mergePageImages(pageImages: PageImage[]): string | null {
  if (pageImages.length === 0) return null;

  // 简单返回第一页
  return pageImages[0].imageData;
}

/**
 * 验证识别结果
 */
export function validateRecognitionResult(result: RecognitionResult): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!result.pages || result.pages.length === 0) {
    errors.push('缺少页面信息');
  }

  if (!result.blocks || result.blocks.length === 0) {
    errors.push('未识别到任何文本块');
  }

  // 检查关联的有效性
  for (const block of result.blocks || []) {
    if (block.matchedAnswerId) {
      const answerBlock = result.blocks.find(b => b.id === block.matchedAnswerId);
      if (!answerBlock) {
        errors.push(`块 ${block.id} 关联的答案块 ${block.matchedAnswerId} 不存在`);
      }
    }
    if (block.matchedAnalysisId) {
      const analysisBlock = result.blocks.find(b => b.id === block.matchedAnalysisId);
      if (!analysisBlock) {
        errors.push(`块 ${block.id} 关联的解析块 ${block.matchedAnalysisId} 不存在`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * 答案解析分离函数
 * 从答案框的完整内容中分离出答案和解析
 */
export function parseAnswerAndAnalysis(content: string): {
  answer: string;
  analysis: string;
} {
  if (!content || content.trim() === '') {
    return { answer: '', analysis: '' };
  }

  const trimmedContent = content.trim();

  // 匹配答案模式（按优先级排序）
  const patterns = [
    /^答案[：:]\s*([A-Fa-f对错是否])\s*[,，]?\s*(.*)$/,      // "答案：A 解析内容"
    /^答案[：:]\s*([A-Fa-f对错是否])\s*(.*)$/,                // "答案：A解析内容"
    /^选\s*([A-Fa-f对错是否])\s*[,，]?\s*(.*)$/,             // "选A，解析内容"
    /^选\s*([A-Fa-f对错是否])\s*(.*)$/,                       // "选A 解析内容"
    /^([A-Fa-f])\s*[,，.。、]\s*(.*)$/,                       // "A，解析内容" 或 "A。解析内容"
    /^([A-Fa-f])\s+(.*)$/,                                     // "A 解析内容"
    /^([对错是否])\s*[,，.。、]?\s*(.*)$/,                    // "对 解析内容"（判断题）
    /^([对错是否])\s+(.*)$/,                                   // "对 解析内容"
  ];

  for (const pattern of patterns) {
    const match = trimmedContent.match(pattern);
    if (match) {
      const answer = match[1].toUpperCase();
      const analysis = match[2].trim();
      return { answer, analysis };
    }
  }

  // 如果都不匹配，检查是否只是答案（没有解析）
  if (/^[A-Fa-f对错是否]$/.test(trimmedContent)) {
    return { answer: trimmedContent.toUpperCase(), analysis: '' };
  }

  // 无法分离时，全部作为解析
  return { answer: '', analysis: trimmedContent };
}

/**
 * 智能关联匹配函数
 * 根据题号关联题目和答案
 */
export function smartMatchQuestionsAndAnswers(
  regions: Array<{
    imageIndex: number;
    questionNumber: number | null;
    type: 'question' | 'answer';
    questionType?: string;
    optionCount?: number | null;
    blankCount?: number | null;
    content: string;
    answer?: string;
    analysis?: string;
    confidence: number;
  }>,
  croppedImages: Map<string, string>,
  userBoxes: QuestionBox[],
  existingQuestions?: Array<{
    id: number; number: number; content: string; questionType: string; hasAnswer: boolean;
    subQuestions?: Array<{ id: number; number: number; content: string; questionType: string; hasAnswer: boolean }>;
  }>
): {
  questions: MatchedQuestion[];
  unmatchedAnswers: Array<{
    id: string;
    questionNumber: number | null;
    content: string;
    answer: string;
    analysis: string;
    boxId: string;
    croppedImageData?: string;
  }>;
  boxTypes: Array<{
    boxId: string;
    type: 'question' | 'answer';
    questionNumber: number | null;
  }>;
  preMatchedAnswers?: Array<{
    id: string;
    questionId: number;
    questionNumber: number;
    answer: string;
    analysis: string;
    boxId: string;
  }>;
} {
  const questions: MatchedQuestion[] = [];
  const answerMap = new Map<number, typeof regions[0]>();
  const unmatchedAnswers: Array<{
    id: string;
    questionNumber: number | null;
    content: string;
    answer: string;
    analysis: string;
    boxId: string;
    croppedImageData?: string;
  }> = [];
  
  // 收集所有框的类型信息
  const boxTypes: Array<{
    boxId: string;
    type: 'question' | 'answer';
    questionNumber: number | null;
  }> = [];

  // 记录每个 imageIndex 是否已生成题目（一个框 = 一个题目，防止AI把一个框拆成多题）
  const usedImageIndices = new Set<number>();

  // 1. 分离题目和答案
  for (const region of regions) {
    const box = userBoxes[region.imageIndex];
    const boxId = box?.id || `box-${region.imageIndex}`;
    
    // 记录框类型（每种类型只记录一次，避免重复）
    if (!boxTypes.find(bt => bt.boxId === boxId)) {
      boxTypes.push({
        boxId,
        type: region.type,
        questionNumber: region.questionNumber,
      });
    }
    
    if (region.type === 'question') {
      // 关键修复：一个用户框只能对应一道题
      // AI有时会把单个框内的内容拆成多个region（如把选择题的题干和选项分成两个region）
      // 忽略同一 imageIndex 的后续 question 类型 region，避免产生重复题目
      if (usedImageIndices.has(region.imageIndex)) {
        console.warn(`[smartMatch] 跳过重复题目 region: imageIndex=${region.imageIndex}, 已有题目`);
        continue;
      }
      usedImageIndices.add(region.imageIndex);
      
      questions.push({
        id: questions.length + 1,
        number: region.questionNumber || questions.length + 1,
        questionBoxId: boxId,
        questionBox: box,
        pageNumber: box?.pageNumber || 1,
        questionContent: region.content,
        questionType: (region.questionType || inferQuestionTypeFromContent(region.content || '')) as MatchedQuestion['questionType'],
        optionCount: region.optionCount ?? undefined,
        blankCount: region.blankCount ?? undefined,
        answerSource: 'manual',
        status: 'no_answer',
        showRecognizedContent: false,
        croppedImageData: croppedImages.get(boxId),
      });
    } else if (region.type === 'answer') {
      if (region.questionNumber !== null) {
        answerMap.set(region.questionNumber, region);
      } else {
        // 未识别出题号的答案，放入未匹配列表
        unmatchedAnswers.push({
          id: `unmatched-${region.imageIndex}`,
          questionNumber: null,
          content: typeof region.content === 'string' ? region.content : JSON.stringify(region.content),
          answer: typeof region.answer === 'string' ? region.answer : String(region.answer || ''),
          analysis: typeof region.analysis === 'string' ? region.analysis : String(region.analysis || ''),
          boxId,
          croppedImageData: croppedImages.get(boxId),
        });
      }
    }
  }

  // 1.5 当有已有题目时，优先将答案匹配到已有题目（特别是子题结构）
  const preMatchedAnswers: Array<{
    id: string;
    questionId: number;
    questionNumber: number;
    answer: string;
    analysis: string;
    boxId: string;
  }> = [];

  if (existingQuestions && existingQuestions.length > 0) {
    // 构建已有题目的查找表（包含子题）
    const existingQuestionMap = new Map<number, { id: number; hasAnswer: boolean; isSub: boolean }>();
    for (const eq of existingQuestions) {
      existingQuestionMap.set(eq.number, { id: eq.id, hasAnswer: eq.hasAnswer, isSub: false });
      // 子题也加入查找表
      if (eq.subQuestions) {
        for (const sq of eq.subQuestions) {
          existingQuestionMap.set(sq.number, { id: sq.id, hasAnswer: sq.hasAnswer, isSub: true });
        }
      }
    }

    // 遍历所有 answer region，尝试匹配到已有题目
    for (const region of regions) {
      if (region.type !== 'answer' || region.questionNumber === null) continue;

      const existing = existingQuestionMap.get(region.questionNumber);
      if (existing && !existing.hasAnswer) {
        // 找到对应的已有题目且该题还没有答案 → 直接预匹配
        const box = userBoxes[region.imageIndex];
        preMatchedAnswers.push({
          id: `prematched-${region.questionNumber}`,
          questionId: existing.id,
          questionNumber: region.questionNumber,
          answer: typeof region.answer === 'string' ? region.answer : String(region.answer || ''),
          analysis: typeof region.analysis === 'string' ? region.analysis : String(region.analysis || ''),
          boxId: box?.id || `box-${region.imageIndex}`,
        });
        // 从 answerMap 中移除已预匹配的（避免重复）
        answerMap.delete(region.questionNumber);
        console.log(`[smartMatch] 答案预匹配到已有题目: questionNumber=${region.questionNumber}, questionId=${existing.id}`);
      }
    }
  }

  // 2. 关联答案
  for (const question of questions) {
    const answerRegion = answerMap.get(question.number);
    if (answerRegion) {
      question.answer = typeof answerRegion.answer === 'string' ? answerRegion.answer : String(answerRegion.answer || '');
      question.analysis = typeof answerRegion.analysis === 'string' ? answerRegion.analysis : String(answerRegion.analysis || '');
      question.answerSource = 'direct';
      question.status = 'matched';
      answerMap.delete(question.number); // 移除已匹配的答案
    }
  }

  // 3. 未匹配的答案（题号存在但无对应题目）
  for (const [num, region] of answerMap.entries()) {
    const box = userBoxes[region.imageIndex];
    unmatchedAnswers.push({
      id: `unmatched-${region.imageIndex}`,
      questionNumber: num,
      content: typeof region.content === 'string' ? region.content : JSON.stringify(region.content),
      answer: typeof region.answer === 'string' ? region.answer : String(region.answer || ''),
      analysis: typeof region.analysis === 'string' ? region.analysis : String(region.analysis || ''),
      boxId: box?.id || `box-${region.imageIndex}`,
      croppedImageData: croppedImages.get(box?.id || `box-${region.imageIndex}`),
    });
  }

  console.log(`[smartMatch] regions=${regions.length}, userBoxes=${userBoxes.length}, questions=${questions.length}(去重后), preMatched=${preMatchedAnswers.length}, unmatched=${unmatchedAnswers.length}`);

  return { questions, unmatchedAnswers, boxTypes, preMatchedAnswers };
}

/**
 * 根据题目内容智能推断题型（当AI未返回questionType时使用）
 */
function inferQuestionTypeFromContent(content: string): string {
  if (!content) return '填空题'; // 无内容时默认填空题而非单选题

  const lowerContent = content.toLowerCase();

  // 有选项的特征：包含A. B. C. D. 或 A、B、C、D、 选项格式
  const hasOptions = /[A-D][.、．)\s]/.test(content) && /[B-D][.、．)\s]/.test(content);
  if (hasOptions) {
    if (lowerContent.includes('多选')) return '多选题';
    return '单选题';
  }

  // 判断题
  if (lowerContent.includes('判断') || /√×/.test(content) || /对错/.test(content)) {
    return '判断题';
  }

  // 填空题：有横线、空格、下划线
  if (/_{2,}/.test(content) || /____/.test(content) || /□/.test(content) || /\(\s*\)/.test(content)) {
    return '填空题';
  }

  // 解答题/计算题：有"证明"、"求"、"已知...求"、"计算"等关键词
  if (lowerContent.includes('证明') || lowerContent.includes('已知') || /求[解证]/.test(content)) {
    return '解答题';
  }
  if (lowerContent.includes('计算') || lowerContent.includes('求解')) {
    return '计算题';
  }

  // 材料题
  if (lowerContent.includes('材料') || lowerContent.includes('阅读以下') || lowerContent.includes('根据材料')) {
    return '材料题';
  }

  // 问答题
  if (lowerContent.includes('问答') || lowerContent.includes('简答') || lowerContent.includes('论述')) {
    return '问答题';
  }

  // 有子题标号(1)(2)(3)但没有选项，倾向于解答题
  if (/\([1-9]\)/.test(content) || /（[1-9]）/.test(content)) {
    return '解答题';
  }

  // 兜底：没有选项的情况下默认填空题
  return '填空题';
}

/**
 * 解析智能识别的AI响应
 */
export function parseSmartAIResponse(responseText: string): Array<{
  imageIndex: number;
  questionNumber: number | null;
  type: 'question' | 'answer';
  questionType?: string;
  optionCount?: number | null;
  blankCount?: number | null;
  content: string;
  answer?: string;
  analysis?: string;
  confidence: number;
}> | null {
  try {
    let jsonStr = responseText.trim();

    // 去除可能的 markdown 代码块标记
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    // 找到 JSON 对象
    if (!jsonStr.startsWith('{')) {
      const startIdx = jsonStr.indexOf('{');
      if (startIdx !== -1) {
        jsonStr = jsonStr.slice(startIdx);
      }
    }

    // 找到匹配的结束大括号
    let braceCount = 0;
    let endIdx = -1;
    for (let i = 0; i < jsonStr.length; i++) {
      if (jsonStr[i] === '{') braceCount++;
      else if (jsonStr[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx !== -1) {
      jsonStr = jsonStr.slice(0, endIdx + 1);
    }

    // 修复常见的 JSON 格式问题
    jsonStr = jsonStr.replace(/,\s*}/g, '}');
    jsonStr = jsonStr.replace(/,\s*]/g, ']');
    jsonStr = jsonStr.replace(/\/\/.*$/gm, '');
    jsonStr = jsonStr.replace(/\/\*[\s\S]*?\*\//g, '');

    // 修复AI返回的换行转义问题
    // AI经常在JSON字符串值中输出 \\\n (反斜杠+实际换行) 或 \\\\n 等多重转义
    // 策略：在JSON字符串值内，将实际换行符替换为 \n，将无效转义序列双重转义
    const fixJsonStringValues = (str: string): string => {
      // 逐字符解析，找到JSON字符串值，修复其中的换行和无效转义
      // 合法的JSON转义序列：\" \\ \/ \b \f \n \r \t \uXXXX
      // 其他如 \l \p \s 等都是无效的，需要双重转义（\\l → JSON解析后得到 \l）
      let result = '';
      let inString = false;
      let i = 0;
      while (i < str.length) {
        if (inString) {
          if (str[i] === '\\' && i + 1 < str.length) {
            const next = str[i + 1];
            if (next === '"') {
              result += '\\"';
              i += 2;
            } else if (next === '\\') {
              result += '\\\\';
              i += 2;
            } else if (next === 'n' || next === 'r' || next === 't' || next === 'b') {
              // 这些是常见且有意义的JSON转义，保留原样
              // 注意：\f（form-feed）不在此列，因为教育场景中 \f 几乎总是LaTeX命令（如\frac, \forall）
              result += '\\' + next;
              i += 2;
            } else if (next === 'f') {
              // \f 是合法JSON转义（form-feed），但在教育场景中几乎总是LaTeX命令的一部分
              // 判断策略：如果 \f 后面紧跟字母，说明是LaTeX命令（如\frac, \forall），需要双重转义
              if (i + 2 < str.length && /[a-zA-Z]/.test(str[i + 2])) {
                result += '\\\\f';
                i += 2;
              } else {
                result += '\\f';
                i += 2;
              }
            } else if (next === 'u' && i + 5 < str.length && /[0-9a-fA-F]{4}/.test(str.slice(i + 2, i + 6))) {
              // 合法的 \uXXXX Unicode 转义
              result += str.slice(i, i + 6);
              i += 6;
            } else if (next === '/' || next === '\'') {
              // \/ 和 \' 虽然不是严格必需的转义，但也是合法的
              result += '\\' + next;
              i += 2;
            } else if (next === '\n' || next === '\r') {
              // 反斜杠后跟实际换行 → AI意图是 \n，替换为转义换行
              result += '\\n';
              i += 2;
              if (next === '\r' && i < str.length && str[i] === '\n') i++;
            } else {
              // 无效的JSON转义序列（如LaTeX命令 \ln, \sqrt, \pi 等），需要双重转义
              // 这样JSON解析后得到的是原始的反斜杠+字符，如 \\l → 解析后得到 \l
              result += '\\\\' + next;
              i += 2;
            }
          } else if (str[i] === '"') {
            result += '"';
            inString = false;
            i++;
          } else if (str[i] === '\n' || str[i] === '\r') {
            // 字符串值内的裸换行符 → 替换为 \n
            result += '\\n';
            i++;
            if (str[i] === '\r' && i < str.length && str[i] === '\n') i++;
          } else {
            result += str[i];
            i++;
          }
        } else {
          if (str[i] === '"') {
            inString = true;
            result += '"';
            i++;
          } else {
            result += str[i];
            i++;
          }
        }
      }
      return result;
    };

    jsonStr = fixJsonStringValues(jsonStr);

    // 修复截断的JSON：AI响应可能因输出token限制被截断
    // 策略：关闭未闭合的字符串、数组和对象
    const repairTruncatedJson = (str: string): string => {
      let inStr = false;
      let escape = false;
      const stack: string[] = []; // 记录开括号栈: [ 或 {
      
      for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\' && inStr) { escape = true; continue; }
        if (ch === '"' && !escape) { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === '{' || ch === '[') { stack.push(ch); }
        if (ch === '}' && stack.length > 0 && stack[stack.length - 1] === '{') { stack.pop(); }
        if (ch === ']' && stack.length > 0 && stack[stack.length - 1] === '[') { stack.pop(); }
      }
      
      // 如果有未闭合的字符串，先关闭它
      if (inStr) {
        str += '"';
      }
      
      // 如果有未闭合的数组/对象，关闭它们
      // 但需要先处理可能的尾部逗号和不完整的键值对
      while (stack.length > 0) {
        const opener = stack.pop()!;
        // 尝试清理尾部，移除不完整的键值对
        // 移除尾部的逗号和可能的未完成键
        str = str.replace(/,\s*$/, ''); // 移除尾部逗号
        
        // 检查是否在对象中有未完成的键值对（如 "key": 后面没有值）
        // 匹配 "xxx":\s*$ 模式，移除不完整的键值对
        str = str.replace(/,\s*"[^"]*"\s*:\s*$/, '');
        
        if (opener === '{') {
          str += '}';
        } else if (opener === '[') {
          str += ']';
        }
      }
      
      return str;
    };

    let result;
    try {
      result = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('智能识别JSON解析失败:', parseError);
      console.error('JSON字符串前200字符:', jsonStr.slice(0, 200));
      console.error('JSON字符串最后200字符:', jsonStr.slice(-200));

      // 尝试修复截断的JSON
      const repairedJson = repairTruncatedJson(jsonStr);
      try {
        result = JSON.parse(repairedJson);
        console.log('截断JSON修复成功，解析出regions数:', result.regions?.length);
      } catch (repairError) {
        console.error('截断JSON修复失败:', repairError);

        // 最后一次尝试：二次运行字符级修复 + 截断修复
        const secondFix = repairTruncatedJson(fixJsonStringValues(jsonStr));
        try {
          result = JSON.parse(secondFix);
          console.log('二次修复后JSON解析成功，regions数:', result.regions?.length);
        } catch (secondError) {
          console.error('二次解析仍然失败:', secondError);
          console.error('修复后JSON字符串前200字符:', secondFix.slice(0, 200));
          console.error('修复后JSON字符串最后200字符:', secondFix.slice(-200));
          return null;
        }
      }
    }

    if (!result.regions || !Array.isArray(result.regions)) {
      console.error('智能识别响应缺少 regions 数组，实际返回:', JSON.stringify(Object.keys(result)));
      return null;
    }

    // 处理每个区域：确保 answer 和 analysis 字段始终是字符串
    return result.regions.map((region: any) => {
      if (region.type === 'answer') {
        // 强制确保 answer 和 analysis 是字符串类型
        // AI可能返回对象格式的答案（如 {"(1)": "xxx", "(2)": "yyy"}），需要转为可读字符串
        const objectToReadableString = (obj: any): string => {
          if (typeof obj === 'string') return obj;
          if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
          if (obj === null || obj === undefined) return '';
          if (typeof obj === 'object') {
            // 如果是数组，用换行拼接
            if (Array.isArray(obj)) {
              return obj.map((item: any) => typeof item === 'object' ? JSON.stringify(item) : String(item)).join('\n');
            }
            // 如果是对象，尝试按键排序拼接为 "键 值" 格式
            const entries = Object.entries(obj);
            if (entries.length > 0) {
              return entries.map(([key, value]) => `${key} ${value}`).join('\n');
            }
            return JSON.stringify(obj);
          }
          return String(obj);
        };

        region.answer = objectToReadableString(region.answer);
        region.analysis = objectToReadableString(region.analysis);
        
        // 如果 answer 为空但有 content，尝试从 content 分离答案和解析
        if (!region.answer && region.content) {
          const { answer, analysis } = parseAnswerAndAnalysis(region.content);
          region.answer = answer;
          region.analysis = analysis;
        }
      }
      // 确保题目类型字段有默认值
      if (region.type === 'question') {
        if (!region.questionType) {
          // 智能推断题型，而非默认"单选题"
          region.questionType = inferQuestionTypeFromContent(region.content || '');
        }
        region.optionCount = region.optionCount ?? null;
      }
      return region;
    });
  } catch (error) {
    console.error('解析智能识别AI响应失败:', error);
    console.error('原始响应文本前500字符:', responseText.slice(0, 500));
    return null;
  }
}
