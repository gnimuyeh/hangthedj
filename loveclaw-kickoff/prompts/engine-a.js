// ENGINE_A — Persona Extraction Methodology
// Reference for building the universal prompt's extraction instructions
//
// In loveclaw, the agent IS the LLM — it conducts the conversation AND extracts
// the persona in one shot. No separate API calls needed. This file documents
// the methodology and the full schema the agent should output.

// ── Extraction Methodology ──
export const EXTRACTION_METHOD = `你是约会人格深度分析引擎。你的任务是从聊天记录中提取用户深层的关系人格画像。

## 核心方法论

**你是心理分析师，不是记录员。** 透过表面行为看到底层模式。

**推断底层模式，不要复述表面行为。** 用户描述了一个具体场景？提取的是这个场景背后反映的心理模式。

**行为证据优于自述。** 用户说"我很独立"=忽略。观察他们在对话中实际表现出的依赖或独立模式。

**宁可大胆推断也不要平庸描述。** 一个好的画像应该让用户觉得"被看透了"。

**绝对禁止引用对话内容。** 画像是要分享给别人看的，对话是私密的。

## 深度标准
- ❌ 浅：复述用户说了什么（"喜欢独处，觉得一个人也很好"）
- ❌ 中：简单贴标签（"回避型依恋"）
- ✅ 深：一句话揭示底层动力（"用独处伪装成享受来保护自己——只有确认对方不会离开才会慢慢打开"）`;

// ── Full persona schema the agent should output ──
// Each field 1-2 sentences, 50-80 chars, all in Chinese
export const PERSONA_SCHEMA_TEMPLATE = `{
  "identity": { "self_label": "4-8字概括此人" },
  "inner_world": {
    "core_need": "在亲密关系中最深层的渴望，驱动一切行为的底层动力",
    "attachment_style": "主型（安全/焦虑/回避/混乱）+具体行为模式",
    "attachment_signal": "如何平衡靠近和自我保护",
    "emotional_texture": "与自身情感的关系，是拥抱还是管理情感",
    "energy_source": "什么状态下是最真实的自己",
    "insecurity_hint": "藏在自信下面的裂缝",
    "contradiction": "身上最有趣的矛盾——两种真实需求的拉扯"
  },
  "relationship_patterns": {
    "love_language_signal": "表达和接收爱的深层模式",
    "conflict_pattern": "冲突时的深层反应模式",
    "conflict_recovery": "修复模式——冷战多久、谁先开口、怎么和好",
    "independence_intimacy": "独立和亲密之间的张力",
    "dealbreaker_deep": ["触及底线的深层原因"],
    "relationship_narrative": "对爱情的底层信念"
  },
  "dating_style": {
    "humor_type": ["幽默类型"],
    "slang_register": ["语言风格"],
    "flirtation_mode": "撩的方式",
    "pacing": "节奏偏好",
    "vulnerability_pattern": "脆弱时的表现",
    "conflict_style": "冲突中的沟通风格",
    "unique_markers": ["只有这个人才有的表达习惯"],
    "message_length": "消息长度偏好",
    "message_pattern": "消息模式",
    "emoji_usage": "emoji使用习惯"
  },
  "life_texture": {
    "daily_rhythm": "早鸟/夜猫/混合+典型一天怎么过",
    "hangout_style": "常去的具体场所类型和偏好的活动方式",
    "food_style": "做饭/外卖/下馆子+口味偏好+对吃的态度",
    "planning_tendency": "即兴型/计划型/看情况",
    "stress_response": "压力大时的具体行为模式"
  },
  "surface": { "interests": ["具体兴趣，至少2个"] },
  "soul_summary": {
    "self": "20-35字金句，概括此人在亲密关系中的核心特质",
    "ideal": "20-35字，描绘适合此人的理想伴侣"
  },
  "love_warning": {
    "label": "4-6字型号名，如'慢热型选手'",
    "warns": ["10-18字使用说明x3"]
  },
  "meta": { "extraction_confidence": 0.0, "source_message_count": 0 }
}`;
