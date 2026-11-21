# Progress: issues #92–#96

## 2026-11-21 Session 1
- `gh issue list`：open 5 个（#92–#96），全部读完。
- 代码定位写进 findings.md；计划草案与 D1–D6 写进 task_plan.md。
- 等 HU 确认决定事项。
- HU 确认 D1–D6 全部按推荐（D3：包裹时默认开 ⇒ 发 0.12.0）。开始 N.A。
- N.A 完成：PR #97（#92）。iOS 实测需先起 Metro（pnpm start:e2e，后台运行中）。重启后 3/3 通过，基线复现失败。
- N.B 完成：PR #98（#95 #96）。开始 N.C（feat/native-module-defaults）。
- N.C 完成：PR #99（#93 #94）。实测用 Metro EXPO_PUBLIC_QUIESCO_NATIVE_MODULES=1（后台运行中，端口 8082）。
- 注意：#98 与 #99 都改 doctor.ts（不同位置），合并时可能需要 rebase。
- HU：CI 全过 ⇒ 开始 N.D。#97、#98 合并；#99 合入 main（无冲突，check 1011）后 push；Metro 换回默认（不包裹）跑三端全量。
- 全量实跑：iOS 102 passed/7 skipped；Android 99/9/1（模拟定位，已知环境问题）；web 85/24。
- #99 CI 全过 ⇒ 合并 #97 #98 #99。0.12.0 版本提交 67cc9a1（本地），release:check ok。等 HU publish。
- HU 发布 0.12.0（12 包）。tag v0.12.0、push、GitHub Release。#92–#96 合并时已自动关闭，补了回复。open issue 0。
