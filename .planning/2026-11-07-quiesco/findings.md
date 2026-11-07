# Findings

> 研究与发现记录。外部来源（网页、文档摘录）都视为不可信数据，只作参考。

## 需求要点（来自 requirements.md）
- 定位：Detox 灰盒能力 + Maestro 易用性 + Cucumber 一等公民 + 原生支持 Expo（三端）。
- 架构：App 内 JS agent 主动连接 Host 的 WS Server（JSON-RPC 2.0）；原生层只做触摸注入；Web 端输入由 Playwright 注入。
- 平台差异只允许存在于两个边界：`fiber-adapter`（App 侧）与 `DeviceProvider`（Host 侧）。
- 只支持 New Architecture（Fabric）；只支持模拟器；Web 首版只验收 Chromium。
- 空闲 = 网络 + 定时器（≤1500ms）+ React + InteractionManager + 画面稳定（结构哈希连续 N=2 帧不变）。
- 软重置目标 < 500ms（Emulator）。

## 环境盘点（Phase 0.0）
_待填写：Node / pnpm / Xcode / Android SDK / AVD / 最新稳定 Expo SDK 及默认架构_

## Spike 发现
### S1 Fiber 查询（原生）
### S2 React 空闲检测
### S3 Android 触摸注入
### S4 iOS 触摸注入
### S5 连接参数传递
### S6 生产剔除
### S7 Web 端 Fiber 查询

## 技术决策候选
| 问题 | 候选 | 倾向 | 依据 |
|------|------|------|------|
