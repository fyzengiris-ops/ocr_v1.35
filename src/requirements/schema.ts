// 需求注册表结构定义
// 说明：本文件定义页面需求注册表的数据结构，供右侧 PRD 阅读面板、页面锚点激活和 Markdown PRD 生成共用。

export type RequirementObjectType =
  | 'field'
  | 'copy'
  | 'button'
  | 'region'
  | 'dialog'
  | 'panel'
  | 'tab'
  | 'step'
  | 'state'
  | 'data';

export type AnchorStatus = 'implemented' | 'planned';

export type RequirementSourceType = 'code' | 'decision' | 'code+decision';

export type RequirementChangeType = 'new' | 'changed' | 'unchanged';

export type ActivationStep =
  | { type: 'navigate'; label: string; to: string }
  | { type: 'openPanel'; label: string; panel: string }
  | { type: 'openDialog'; label: string; dialog: string }
  | { type: 'setStep'; label: string; step: string }
  | { type: 'setTab'; label: string; tab: string }
  | { type: 'scrollTo'; label: string; anchorId: string }
  | { type: 'highlight'; label: string; anchorId: string };

export interface RequirementDisplay {
  /** 中文名称：显示说明标题；用途：概括页面展示点；使用方：Skill3、Skill4 */
  title: string;
  /** 中文名称：显示说明正文；用途：只描述用户能看见什么；使用方：Skill3、Skill4 */
  description: string;
  /** 中文名称：涉及字段；用途：列出展示相关字段、按钮、文案、区域；使用方：Skill3、Skill4 */
  fields?: string[];
  /** 中文名称：涉及状态；用途：列出禁用态、空态、加载态等；使用方：Skill3、Skill4 */
  states?: string[];
}

export interface RequirementOperation {
  /** 中文名称：操作说明标题；用途：概括操作规则；使用方：Skill3、Skill4 */
  title: string;
  /** 中文名称：操作说明正文；用途：描述用户如何操作或不能如何操作；使用方：Skill3、Skill4 */
  description: string;
  /** 中文名称：权限说明；用途：描述角色、页面权限、是否沿用父页面权限；使用方：Skill3、Skill4 */
  permission: string;
  /** 中文名称：数据流转；用途：描述是否产生数据、写入哪里、如何传递；使用方：Skill3、Skill4 */
  dataFlow: string;
  /** 中文名称：异常情况；用途：描述异常、禁用、失败、重复操作等处理；使用方：Skill3、Skill4 */
  exceptions: string;
}

export interface RequirementSource {
  /** 中文名称：决策文件；用途：追溯需求来源；使用方：Skill2、Skill4 */
  decisionFile: string;
  /** 中文名称：决策对象；用途：对应 decision.md 中的对象名称；使用方：Skill2、Skill4 */
  decisionObject: string;
  /** 中文名称：相关代码文件；用途：追溯影响代码；使用方：Skill2、Skill3、Skill4 */
  relatedFiles: string[];
}

export interface RequirementItem {
  /** 中文名称：需求编号；用途：稳定引用编号；使用方：Skill3、Skill4、Skill5 */
  id: string;
  /** 中文名称：需求标题；用途：右侧 PRD 列表和 Markdown PRD 标题；使用方：Skill3、Skill4、Skill5 */
  title: string;
  /** 中文名称：来源类型；用途：区分代码事实、决策补充或二者合并；使用方：Skill2、Skill3、Skill4、Skill5 */
  sourceType: RequirementSourceType;
  /** 中文名称：变更类型；用途：标记新增/变更/未变；Skill3 据此控制角标颜色（橙色=new/changed）；使用方：Skill3 */
  changeType?: RequirementChangeType;
  /** 中文名称：变更日期；用途：本次变更日期标注，如"6.2"；Skill3 在悬浮面板显示 [日期] 格式；使用方：Skill3 */
  changeDate?: string;
  /** 中文名称：对象类型；用途：标识需求对应对象；使用方：Skill3、Skill4 */
  objectType: RequirementObjectType;
  /** 中文名称：对象名称；用途：页面上的具体对象名称；使用方：Skill3、Skill4 */
  objectName: string;
  /** 中文名称：所属模块；用途：分组展示；使用方：Skill3、Skill4 */
  module: string;
  /** 中文名称：页面名称；用途：所属页面/组件/流程名称；使用方：Skill3、Skill4 */
  pageName: string;
  /** 中文名称：页面路由/组件标识；用途：页面跳转或组件定位依据；使用方：Skill3 */
  route: string;
  /** 中文名称：页面锚点编号；用途：定位和高亮；使用方：Skill3 */
  anchorId: string;
  /** 中文名称：锚点状态；用途：标记锚点已实现或待实现；使用方：Skill3 */
  anchorStatus: AnchorStatus;
  /** 中文名称：激活路径；用途：点击需求后打开正确页面状态；使用方：Skill3 */
  activate: ActivationStep[];
  /** 中文名称：显示说明；用途：描述页面展示什么；使用方：Skill3、Skill4 */
  display: RequirementDisplay;
  /** 中文名称：操作说明；用途：描述操作、权限、数据流转、异常情况；使用方：Skill3、Skill4 */
  operation: RequirementOperation;
  /** 中文名称：验收标准；用途：验证需求是否实现；使用方：Skill4、测试 */
  acceptance: string[];
  /** 中文名称：来源信息；用途：追溯需求来自哪里；使用方：Skill2、Skill4 */
  source: RequirementSource;
}

export interface ExcludedDecision {
  /** 中文名称：对象名称；用途：说明哪个对象未纳入需求卡片；使用方：Skill4 */
  objectName: string;
  /** 中文名称：未纳入原因；用途：说明范围边界；使用方：Skill4 */
  reason: string;
  /** 中文名称：来源决策；用途：追溯原始决策；使用方：Skill4 */
  sourceDecision: string;
}

export interface RequirementRegistry {
  /** 中文名称：注册表编号；用途：标识当前页面或流程的需求注册表；使用方：Skill3、Skill4 */
  registryId: string;
  /** 中文名称：页面名称；用途：人类可读名称；使用方：Skill3、Skill4 */
  pageName: string;
  /** 中文名称：页面路由/组件标识；用途：页面跳转或组件定位依据；使用方：Skill3 */
  route: string;
  /** 中文名称：所属业务模块；用途：分组展示；使用方：Skill3、Skill4 */
  module: string;
  /** 中文名称：注册表说明；用途：描述覆盖范围和业务边界；使用方：Skill4 */
  description: string;
  /** 中文名称：来源决策文件；用途：追溯来源；使用方：Skill2、Skill4 */
  sourceDecisionFile: string;
  /** 中文名称：相关代码文件；用途：追溯影响代码；使用方：Skill2、Skill3、Skill4 */
  relatedFiles: string[];
  /** 中文名称：需求项列表；用途：进入右侧面板、页面标注、Markdown PRD；使用方：Skill3、Skill4 */
  requirements: RequirementItem[];
  /** 中文名称：未纳入需求卡片的决策；用途：保留范围边界；使用方：Skill4 */
  excludedDecisions: ExcludedDecision[];
  /** 中文名称：展示序号排序；用途：覆盖右侧面板的默认注册表顺序；使用方：Skill4 */
  displayOrder?: string[];
  /** 中文名称：展示序号映射；用途：强制指定每个需求ID的显示序号；使用方：Skill4 */
  displayNumberMap?: Record<string, number>;
}
